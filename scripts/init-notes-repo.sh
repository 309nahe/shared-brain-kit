#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 OWNER REPO DESTINATION [BRANCH]" >&2
  echo "Example: $0 alice my-notes ./my-notes" >&2
  exit 2
}

[[ $# -ge 3 && $# -le 4 ]] || usage
OWNER="$1"
REPO="$2"
DEST="$3"
BRANCH="${4:-main}"

if [[ ! "$OWNER" =~ ^[A-Za-z0-9-]+$ || ! "$REPO" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "OWNER or REPO contains unsupported characters" >&2
  exit 1
fi
if [[ -e "$DEST" ]]; then
  echo "Refusing to overwrite existing path: $DEST" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$DEST"/{app/vendor,app/icons,shared,projects,personal}

cp "$ROOT/README.md" "$DEST/README.md"
cp "$ROOT/AGENT.md" "$DEST/AGENT.md"
cp "$ROOT/LICENSE" "$DEST/LICENSE"
cp -R "$ROOT/app/." "$DEST/app/"
cp -R "$ROOT/app/vendor/." "$DEST/app/vendor/"
cp -R "$ROOT/app/icons/." "$DEST/app/icons/"

cat > "$DEST/app/config.js" <<EOF
window.SHARED_BRAIN_CONFIG = {
  owner: '$OWNER',
  repo: '$REPO',
  branch: '$BRANCH',
};
EOF

cat > "$DEST/README.md" <<EOF
# My Shared Brain

Private Markdown notes shared by a human and an AI agent.

See [AGENT.md](AGENT.md) for the writing and privacy contract. The browser app lives in [app/](app/).

## Layout

- [shared/shared-brain.md](shared/shared-brain.md) — shared scratchpad
- [shared/decisions.md](shared/decisions.md) — durable decisions
- [projects/](projects/) — project context
- [personal/](personal/) — explicitly approved personal notes

This repository is configured for GitHub repository **$OWNER/$REPO** on branch **$BRANCH**.
EOF

cat > "$DEST/shared/shared-brain.md" <<'EOF'
# Shared Brain

Shared scratchpad. New entries go on top, dated and attributed. Keep durable context here; keep secrets out.

---

## YYYY-MM-DD — [Human/Agent] First entry

- What matters now:
- Open question:
- Next useful action:
EOF

cat > "$DEST/shared/decisions.md" <<'EOF'
# Decisions

Record decisions that should remain easy to find.

| Date | Decision | Reason | Revisit when |
|---|---|---|---|
| YYYY-MM-DD | Example decision | Example reason | Example trigger |
EOF

cat > "$DEST/.gitignore" <<'EOF'
# Never commit local secrets or editor state
.env
.env.*
.DS_Store
.vscode/
.idea/
EOF

printf 'Created clean notes workspace at %s\n' "$DEST"
printf 'Configured PWA for %s/%s (%s)\n' "$OWNER" "$REPO" "$BRANCH"
printf 'Next: review AGENT.md, git init, commit, and push to a private GitHub repository.\n'
