#!/usr/bin/env bash

set -e

echo "Removing GSD minimalist extension suite..."

gsd remove https://github.com/PamelaSprin47685ghall/gsd-guardian || true
gsd remove https://github.com/PamelaSprin47685ghall/gsd-magic-todo || true
gsd remove https://github.com/PamelaSprin47685ghall/gsd-explicit-reactive || true
gsd remove https://github.com/PamelaSprin47685ghall/gsd-system-prompt || true
gsd remove https://github.com/PamelaSprin47685ghall/gsd-agent-loop || true

echo "All extensions removed."
