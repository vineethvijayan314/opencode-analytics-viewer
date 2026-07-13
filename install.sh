#!/usr/bin/env sh
set -eu

python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
npm --prefix frontend install
npm --prefix opencode-analytics-plugin install
