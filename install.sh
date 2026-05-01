#!/usr/bin/env bash

set -e

echo "Installing GSD minimalist extension suite..."

gsd install https://github.com/PamelaSprin47685ghall/gsd-guardian
gsd install https://github.com/PamelaSprin47685ghall/gsd-magic-todo
gsd install https://github.com/PamelaSprin47685ghall/gsd-explicit-reactive

echo "All extensions installed successfully."
