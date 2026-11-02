# Shared Brain

A tiny, private-by-default shared memory system for a human and an AI agent.

It combines three deliberately boring pieces:

- **Markdown in Git** — durable, portable notes you can read in any editor.
- **A static PWA** — browse and edit the notes from a phone or desktop.
- **An agent contract** — `AGENT.md` tells an AI where memory lives, how to write it, and what never belongs there.

No database. No custom backend. No account service. GitHub is the sync layer and the browser talks to GitHub's Contents API directly.

> This repository is a clean template. It contains no personal notes, credentials, tokens, or private URLs.

## Quick start

### 1. Create a private notes repository

Create an empty **private** GitHub repository for your notes. It can be any name, for example `my-notes`.

Give your agent access to that repository through its normal Git checkout, or use the PWA with a fine-grained GitHub token scoped to that repository only:

- Repository access: **Only the notes repository**
- Permissions: **Contents: Read and write**

Never put the token in this repository or in a public URL.

### 2. Generate a clean notes workspace

From this repository:

```bash
./scripts/init-notes-repo.sh YOUR_GITHUB_USER YOUR_NOTES_REPO ./my-notes
```

This creates a starter notes repository containing only generic examples and an `AGENT.md`. It does not copy this template's Git history or any existing notes.

### 3. Configure the PWA

Edit `app/config.js` in the generated workspace:

```js
window.SHARED_BRAIN_CONFIG = {
  owner: 'YOUR_GITHUB_USER',
  repo: 'YOUR_NOTES_REPO',
  branch: 'main',
};
```

Serve the generated workspace over HTTP(S) — service workers do not work from `file://`:

```bash
cd my-notes
python3 -m http.server 8080
```

Open <http://localhost:8080/app/>. Paste the fine-grained token into the setup screen. It is stored only in that browser's local storage and sent only to `api.github.com`.

For a public deployment, serve `app/`, `vendor/`, `icons/`, and the generated `app/config.js` as static files. HTTPS is required for installability and service workers (localhost is the exception).

## How it works

1. The PWA fetches the repository tree through the GitHub REST API.
2. Markdown files appear in the sidebar.
3. Read mode renders Markdown with `marked` and sanitizes the result with `DOMPurify`.
4. Edit mode saves with GitHub's atomic Contents API `PUT` endpoint.
5. Relative images are fetched through the authenticated Contents API and displayed as local data URIs, so private-repository images work too.
6. The service worker caches only the app shell. Notes and API responses stay network-only.

## The agent side

Copy `AGENT.md` into the root of the notes repository and adapt the few marked placeholders. It is intentionally provider-neutral: any coding agent, chat agent, or automation that can read and commit files can use the same convention.

A good first structure is:

```text
AGENT.md
README.md
shared/
  shared-brain.md
  decisions.md
personal/
projects/
```

Keep sensitive credentials, API keys, passwords, medical details, and high-risk personal data out of notes unless you have explicitly designed and secured the repository for that purpose. Private GitHub is useful, not magical.

## Security model

- The PWA has no server-side secret store and no backend proxy.
- Tokens live in browser local storage. Use a dedicated fine-grained token with the smallest possible repository scope.
- Anyone who can use that browser profile can potentially use the stored token. Sign out on shared devices.
- Git history is permanent enough to matter: do not commit secrets and do not assume deleting a note removes every copy.
- Review generated commits and repository visibility before sharing the URL.

## Development

The frontend is dependency-light and intentionally has no build step. `marked.min.js` and `purify.min.js` are vendored so the app remains usable offline after its first load.

To test the generated workspace:

```bash
./scripts/init-notes-repo.sh alice example-notes /tmp/example-notes
cd /tmp/example-notes
python3 -m http.server 8080
```

Then verify the setup screen loads and the browser console has no JavaScript errors. API operations require a real repository and token.

## License

MIT. See [LICENSE](LICENSE).
