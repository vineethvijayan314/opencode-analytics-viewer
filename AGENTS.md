# OpenCode Analytics Viewer

## Run

- Backend: `.venv/bin/uvicorn app:app --reload --port 8000`.
- Frontend: `npm --prefix frontend run dev` serves Vite on `http://localhost:5173`.
- `frontend/src/Dashboard.tsx` currently requests the API on port `7123`, while `app.py` documents port `8000`. Keep these ports aligned when changing startup/configuration.

## Architecture

- `app.py` is a read-only FastAPI adapter over `~/.local/share/opencode/opencode.db`. Assistant message costs/tokens are JSON fields in `message.data`; user prompt text comes from `part` rows linked to the parent message.
- `frontend/src/Dashboard.tsx` is the React dashboard and aggregates `/api/metrics` client-side. Its cost cards are global across all OpenCode projects.
- `opencode-analytics-plugin/server.ts` supplies the agent `analytics` tool. `tui.tsx` supplies the sidebar footer. Both intentionally aggregate global assistant-message data; retain matching calendar boundaries (day, Monday-start week, month).

## Plugin

- Requires OpenCode `>=1.17.18` and uses separate package exports: `./server` and `./tui`.
- Register the package in both OpenCode configs: server plugin list in `opencode.jsonc`, TUI plugin list in `tui.json`. TUI changes require an OpenCode restart.
- Verify plugin sources with: `npx tsc --noEmit --jsx preserve --module nodenext --moduleResolution nodenext --target esnext --types node --skipLibCheck server.ts tui.tsx` from `opencode-analytics-plugin/`.

## Verify

- Frontend: `npm --prefix frontend run build`.
- The application reads a user-local database; do not add sample data or write migrations against it.
