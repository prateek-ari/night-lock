#!/usr/bin/env bash
set -euo pipefail

journalctl --user -f -o cat | grep --line-buffered '\[NightLock\]'
