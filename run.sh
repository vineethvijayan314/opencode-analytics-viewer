#!/usr/bin/env sh
set -eu

.venv/bin/python -m uvicorn app:app --port 7123 &
api_pid=$!
trap 'kill "$api_pid"' EXIT INT TERM
npm --prefix frontend run dev
