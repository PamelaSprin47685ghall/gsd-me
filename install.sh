#!/usr/bin/env bash

set -e

echo "Installing GSD minimalist extension suite..."

gsd install https://github.com/PamelaSprin47685ghall/gsd-guardian
gsd install https://github.com/PamelaSprin47685ghall/gsd-magic-todo
gsd install https://github.com/PamelaSprin47685ghall/gsd-explicit-reactive
gsd install https://github.com/PamelaSprin47685ghall/gsd-system-prompt
gsd install https://github.com/PamelaSprin47685ghall/gsd-agent-loop

echo "All extensions installed successfully."
