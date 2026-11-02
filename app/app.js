'use strict';

const CONFIG = window.SHARED_BRAIN_CONFIG || {
  owner: 'YOUR_GITHUB_USERNAME',
  repo: 'YOUR_NOTES_REPO',
  branch: 'main',
};

const API = 'https://api.github.com';
const LS_TOKEN = 'notes_gh_token';
const LS_LAST_PATH = 'notes_last_path';

let state = {
  token: localStorage.getItem(LS_TOKEN) || '',
  tree: [],          // flat list from GitHub tree API
  currentPath: null,
  currentSha: null,
  dirty: false,
  mode: 'read',       // 'read' | 'edit'
};

// ---------- DOM refs ----------
const el = (id) => document.getElementById(id);
const setupScreen = el('setup');
const appScreen = el('app');
const tokenInput = el('token-input');
const tokenSaveBtn = el('token-save');
const treeEl = el('tree');
const sidebarEl = el('sidebar');
const sidebarBackdrop = el('sidebar-backdrop');
const menuBtn = el('menu-btn');
const currentPathEl = el('current-path');
const readerEl = el('reader');
const editorEl = el('editor');
const emptyStateEl = el('empty-state');
const editToggleBtn = el('edit-toggle-btn');
const saveBtn = el('save-btn');
const refreshBtn = el('refresh-btn');
const newFileBtn = el('new-file-btn');
const logoutBtn = el('logout-btn');
const toastEl = el('toast');

// ---------- base64 helpers (UTF-8 safe) ----------
function b64DecodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function toast(msg, kind) {
  toastEl.textContent = msg;
  toastEl.className = 'show' + (kind ? ' ' + kind : '');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.className = ''; }, 3200);
}

// ---------- GitHub API ----------
async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: 'application/vnd.github+json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function fetchTree() {
  const data = await gh(`/repos/${CONFIG.owner}/${CONFIG.repo}/git/trees/${CONFIG.branch}?recursive=1`);
  return data.tree.filter((n) => n.type === 'blob');
}

async function fetchFileRaw(path) {
  // returns { content (base64), sha, encoding }
  return gh(`/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${encodeURIComponentPath(path)}?ref=${CONFIG.branch}`);
}

function encodeURIComponentPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function putFile(path, contentUtf8, sha, message) {
  const body = {
    message: message || `Update ${path} via Notes PWA`,
    content: b64EncodeUtf8(contentUtf8),
    branch: CONFIG.branch,
  };
  if (sha) body.sha = sha;
  return gh(`/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${encodeURIComponentPath(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp',
};
const imageCache = new Map();

async function imageDataUri(path) {
  if (imageCache.has(path)) return imageCache.get(path);
  const ext = (path.split('.').pop() || '').toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  const data = await fetchFileRaw(path);
  const uri = `data:${mime};base64,${data.content.replace(/\n/g, '')}`;
  imageCache.set(path, uri);
  return uri;
}

// ---------- tree UI ----------
function buildNestedTree(flat) {
  const root = { folders: {}, files: [] };
  for (const node of flat) {
    if (!node.path.endsWith('.md')) continue; // sidebar shows markdown notes only
    const parts = node.path.split('/');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      cur.folders[seg] = cur.folders[seg] || { folders: {}, files: [] };
      cur = cur.folders[seg];
    }
    cur.files.push({ name: parts[parts.length - 1], path: node.path });
  }
  return root;
}

function renderTree(node, container, depth = 0) {
  const folderNames = Object.keys(node.folders).sort();
  for (const fname of folderNames) {
    const row = document.createElement('div');
    row.className = 'folder-row';
    row.innerHTML = `<span class="tree-icon">📁</span><span>${fname}</span>`;
    const childWrap = document.createElement('div');
    childWrap.className = 'folder-children';
    row.addEventListener('click', () => {
      childWrap.classList.toggle('hidden');
    });
    container.appendChild(row);
    container.appendChild(childWrap);
    renderTree(node.folders[fname], childWrap, depth + 1);
  }
  const files = node.files.sort((a, b) => a.name.localeCompare(b.name));
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.dataset.path = f.path;
    row.innerHTML = `<span class="tree-icon">📄</span><span>${f.name}</span>`;
    row.addEventListener('click', () => openFile(f.path));
    container.appendChild(row);
  }
}

function refreshActiveRow() {
  document.querySelectorAll('.file-row').forEach((r) => {
    r.classList.toggle('active', r.dataset.path === state.currentPath);
  });
}

async function loadTreeAndRender() {
  state.tree = await fetchTree();
  treeEl.innerHTML = '';
  const nested = buildNestedTree(state.tree);
  renderTree(nested, treeEl);
  refreshActiveRow();
}

// ---------- rendering a file ----------
async function renderMarkdownWithImages(mdText, filePath) {
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  let html = DOMPurify.sanitize(marked.parse(mdText, { gfm: true, breaks: false }));
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const imgs = wrapper.querySelectorAll('img');
  await Promise.all(Array.from(imgs).map(async (img) => {
    const src = img.getAttribute('src') || '';
    if (/^(https?:|data:)/.test(src)) return;
    const resolved = resolveRelativePath(dir, src);
    try {
      img.src = await imageDataUri(resolved);
    } catch (e) {
      img.alt = `[image not found: ${resolved}]`;
    }
  }));
  return wrapper.innerHTML;
}

function resolveRelativePath(dir, rel) {
  const parts = (dir ? dir.split('/') : []).concat(rel.split('/'));
  const out = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

async function openFile(path) {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  try {
    const data = await fetchFileRaw(path);
    const text = b64DecodeUtf8(data.content);
    state.currentPath = path;
    state.currentSha = data.sha;
    state.dirty = false;
    state._rawText = text;
    currentPathEl.textContent = path;
    emptyStateEl.classList.add('hidden');
    setMode('read');
    await renderReadMode();
    refreshActiveRow();
    localStorage.setItem(LS_LAST_PATH, path);
    closeSidebarMobile();
  } catch (e) {
    toast('Failed to open: ' + e.message, 'err');
  }
}

async function renderReadMode() {
  readerEl.innerHTML = '<p style="color:var(--text-dim)">Rendering…</p>';
  readerEl.classList.remove('hidden');
  editorEl.classList.add('hidden');
  try {
    readerEl.innerHTML = await renderMarkdownWithImages(state._rawText, state.currentPath);
  } catch (e) {
    readerEl.innerHTML = `<p style="color:var(--danger)">Render error: ${e.message}</p>`;
  }
}

function setMode(mode) {
  state.mode = mode;
  if (mode === 'edit') {
    editorEl.value = state._rawText || '';
    editorEl.classList.remove('hidden');
    readerEl.classList.add('hidden');
    saveBtn.classList.remove('hidden');
    editToggleBtn.textContent = '👁';
  } else {
    saveBtn.classList.add('hidden');
    editToggleBtn.textContent = '✎';
    renderReadMode();
  }
}

editToggleBtn.addEventListener('click', () => {
  if (!state.currentPath) return;
  if (state.mode === 'edit') {
    state._rawText = editorEl.value;
    setMode('read');
  } else {
    setMode('edit');
  }
});

editorEl.addEventListener('input', () => {
  state.dirty = editorEl.value !== state._rawText || state.dirty;
});

saveBtn.addEventListener('click', async () => {
  if (!state.currentPath) return;
  const newText = editorEl.value;
  const msg = prompt('Commit message:', `Update ${state.currentPath}`);
  if (msg === null) return;
  saveBtn.disabled = true;
  try {
    const result = await putFile(state.currentPath, newText, state.currentSha, msg);
    state.currentSha = result.content.sha;
    state._rawText = newText;
    state.dirty = false;
    toast('Saved to GitHub ✓', 'ok');
  } catch (e) {
    toast('Save failed: ' + e.message, 'err');
  } finally {
    saveBtn.disabled = false;
  }
});

refreshBtn.addEventListener('click', async () => {
  try {
    await loadTreeAndRender();
    if (state.currentPath) await openFile(state.currentPath);
    toast('Refreshed', 'ok');
  } catch (e) {
    toast('Refresh failed: ' + e.message, 'err');
  }
});

newFileBtn.addEventListener('click', async () => {
  const path = prompt('New file path (e.g. personal/new-note.md):');
  if (!path) return;
  if (!path.endsWith('.md')) { toast('Path must end in .md', 'err'); return; }
  try {
    await putFile(path, `# ${path.split('/').pop().replace('.md', '')}\n\n`, null, `Create ${path}`);
    toast('Created ' + path, 'ok');
    await loadTreeAndRender();
    await openFile(path);
  } catch (e) {
    toast('Create failed: ' + e.message, 'err');
  }
});

logoutBtn.addEventListener('click', () => {
  if (!confirm('Sign out and clear the stored token?')) return;
  localStorage.removeItem(LS_TOKEN);
  state.token = '';
  location.reload();
});

menuBtn.addEventListener('click', () => {
  sidebarEl.classList.toggle('open');
  sidebarBackdrop.classList.toggle('show');
});
sidebarBackdrop.addEventListener('click', closeSidebarMobile);
function closeSidebarMobile() {
  sidebarEl.classList.remove('open');
  sidebarBackdrop.classList.remove('show');
}

tokenSaveBtn.addEventListener('click', async () => {
  const t = tokenInput.value.trim();
  if (!t) return;
  state.token = t;
  localStorage.setItem(LS_TOKEN, t);
  await boot();
});

// ---------- boot ----------
async function boot() {
  if (!state.token) {
    setupScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
    return;
  }
  try {
    await loadTreeAndRender();
    setupScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    const last = localStorage.getItem(LS_LAST_PATH);
    if (last && state.tree.some((n) => n.path === last)) {
      openFile(last);
    }
  } catch (e) {
    toast('Could not load repo: ' + e.message, 'err');
    setupScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

boot();
