#!/usr/bin/env bash

set -e

echo "Removing GSD minimalist extension suite..."

gsd remove https://github.com/PamelaSprin47685ghall/gsd-guardian || true
gsd remove https://github.com/PamelaSprin47685ghall/gsd-context-prune || true
gsd remove https://github.com/PamelaSprin47685ghall/gsd-explicit-reactive || true
gsd remove https://github.com/PamelaSprin47685ghall/gsd-multi-edit || true
gsd remove https://github.com/PamelaSprin47685ghall/editplus || true

echo "All extensions removed."
