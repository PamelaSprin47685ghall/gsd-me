#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

SUBMODULES=(gsd-2 gsd-magic-todo gsd-explicit-reactive gsd-guardian gsd-system-prompt)

# Init all submodules
git submodule update --init 2>&1

# Checkout main, pull latest, remove untracked files
for d in "${SUBMODULES[@]}"; do
  printf '=== %s ===\n' "$d"
  git -C "$d" checkout main 2>&1
  git -C "$d" pull 2>&1
  git -C "$d" clean -df 2>&1
  git -C "$d" checkout -- . 2>&1
done

# Update parent repo pointers
git add .
if git diff --cached --quiet; then
  echo 'Nothing to commit.'
else
  git commit -m 'chore: sync submodule pointers to latest main' 2>&1
  git push 2>&1
  echo 'Done.'
fi
