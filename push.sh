#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Init & update all submodules (skip broken nested one in gsd-2)
git submodule update --init 2>&1

# Checkout main & pull latest for each submodule
for d in gsd-2 gsd-context-prune gsd-explicit-reactive gsd-guardian gsd-multi-edit gsd-trueline; do
  printf '=== %s ===\n' "$d"
  git -C "$d" checkout main 2>&1
  git -C "$d" pull 2>&1
done

# Update parent repo pointers
git add . 2>&1
if git diff --cached --quiet; then
  echo 'Nothing to commit.'
else
  git commit -m 'chore: sync submodule pointers to latest main' 2>&1
  git push 2>&1
  echo 'Done.'
fi
