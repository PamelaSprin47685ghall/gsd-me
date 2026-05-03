#!/usr/bin/env bash
# sync.sh — developer sync tool for gsd-me submodule suite
#
# Usage:
#   ./sync.sh             sync all active submodules (push parent)
#   ./sync.sh --no-push   sync only, don't push parent commit
#   ./sync.sh --help      show this help
#
# Design:
# - Syncs all 5 plugin submodules (always active).
# - Also syncs gsd-2 IF the developer has initialized it (git submodule init gsd-2).
# - Runs `npm test` in the root before pushing to catch regressions.
# - Auto-converts submodule URLs from HTTPS to SSH for push access (local config only).
set -euo pipefail
cd "$(dirname "$0")"
NO_PUSH=

while [[ $# -gt 0 ]]; do
  case $1 in
    --no-push) NO_PUSH=1 ;;
    --help|-h)
      cat <<'EOF'
sync.sh — developer sync tool for gsd-me submodule suite

Usage:
  ./sync.sh             sync all active submodules (push parent)
  ./sync.sh --no-push   sync only, don't push parent commit
  ./sync.sh --help      show this help

Design:
- Syncs all 5 plugin submodules (always active).
- Also syncs gsd-2 IF the developer has initialized it.
- Runs npm test before pushing to catch regressions.
- Auto-converts submodule URLs from HTTPS to SSH for push access.
EOF
      exit 0 ;;
    *) echo "unknown: $1"; exit 1 ;;
  esac
  shift
done

# ── Auto-convert HTTPS to SSH for developers ──────────────────────────
echo "Checking submodule URLs..."
CONVERTED=0
for d in gsd-explicit-reactive gsd-guardian gsd-system-prompt gsd-magic-todo gsd-agent-loop gsd-2; do
  if [[ -d "$d" ]]; then
    # Get current remote URL
    current_url=$(git -C "$d" remote get-url origin 2>/dev/null || echo "")
    
    # Convert HTTPS to SSH if needed
    if [[ $current_url == https://github.com/* ]]; then
      ssh_url=$(echo "$current_url" | sed 's|https://github.com/|git@github.com:|')
      git -C "$d" remote set-url origin "$ssh_url"
      echo "  ✓ $d: converted to SSH"
      CONVERTED=$((CONVERTED + 1))
    fi
  fi
done

if [[ $CONVERTED -gt 0 ]]; then
  echo "Converted $CONVERTED submodule(s) to SSH for push access."
  echo "Note: .gitmodules still uses HTTPS (for public users)."
  echo ""
fi

# ── Detect active submodules ──────────────────────────────────────────
ACTIVE=()
for d in gsd-explicit-reactive gsd-guardian gsd-system-prompt gsd-magic-todo gsd-agent-loop; do
  if [[ -d "$d/.git" || -f "$d/.git" ]]; then
    # Check for uncommitted changes before checkout
    if ! git -C "$d" diff --quiet 2>/dev/null; then
      echo "  ⚠  $d has uncommitted changes. Stash or commit first."
      exit 1
    fi
    ACTIVE+=("$d")
  fi
done

# Opt-in: gsd-2 (dev reference, not auto-initialized)
if [[ -d gsd-2/.git || -f gsd-2/.git ]]; then
  ACTIVE+=(gsd-2)
fi

if [[ ${#ACTIVE[@]} -eq 0 ]]; then
  echo "No submodules initialized. Run: git submodule update --init"
  exit 1
fi

echo "Syncing ${#ACTIVE[@]} submodule(s): ${ACTIVE[*]}"

# ── Update each submodule ─────────────────────────────────────────────
for d in "${ACTIVE[@]}"; do
  printf '\n=== %s ===\n' "$d"

  # Ensure we're on main
  if ! git -C "$d" checkout main 2>&1; then
    echo "  ⚠  could not checkout main in $d — branch may not exist; skipping pull"
    continue
  fi

  # Fetch + rebase (faster than pull, avoids merge commits)
  git -C "$d" fetch origin 2>&1
  if git -C "$d" rev-parse --verify refs/remotes/origin/main >/dev/null 2>&1; then
    git -C "$d" rebase origin/main 2>&1
  fi

  # Reset tracked changes — safe since rebase already applied upstream
  git -C "$d" checkout -- . 2>&1

  printf '  ✓ %s @ %s\n' "$d" "$(git -C "$d" rev-parse --short HEAD)"
done

# ── Update parent commit pointers ─────────────────────────────────────
git add .

if git diff --cached --quiet; then
  echo 'Nothing to commit — all submodules already at latest.'
else
  PARENTS=""
  for d in "${ACTIVE[@]}"; do
    rev=$(git -C "$d" rev-parse --short HEAD 2>/dev/null || echo "?")
    PARENTS="${PARENTS:+$PARENTS, }$d@$rev"
  done
  git commit -m "chore: sync submodule pointers ($PARENTS)" 2>&1
fi

# ── Root-level tests ──────────────────────────────────────────────────
if [[ -f package.json ]]; then
  npm test 2>&1
fi

# ── Submodule-level tests ──────────────────────────────────────────────
for d in "${ACTIVE[@]}"; do
  if [[ -f "$d/package.json" ]] && grep -q '"test"' "$d/package.json"; then
    printf '\n=== Running tests in %s ===\n' "$d"
    (cd "$d" && npm test 2>&1) || { echo "  ✗ Tests failed in $d"; exit 1; }
  fi
done

# ── Push ──────────────────────────────────────────────────────────────
if [[ -z "$NO_PUSH" ]]; then
  git push 2>&1
  echo '✓ Pushed.'
else
  echo '⏸  Skipped push (--no-push).'
fi

echo 'Done.'
