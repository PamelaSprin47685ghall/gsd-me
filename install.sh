#!/usr/bin/env bash

set -e

echo "Installing GSD minimalist extension suite..."

gsd install https://github.com/PamelaSprin47685ghall/gsd-guardian
gsd install https://github.com/PamelaSprin47685ghall/gsd-context-prune
gsd install https://github.com/PamelaSprin47685ghall/gsd-explicit-reactive
gsd install https://github.com/PamelaSprin47685ghall/gsd-multi-edit

echo "All extensions installed successfully."
