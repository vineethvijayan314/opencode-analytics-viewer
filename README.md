# OpenCode Analytics

Read-only analytics for the local OpenCode database.

- Browser dashboard: usage, cost, project spend, RTK, and Graphify data.
- OpenCode plugin: global cost totals in the sidebar and an `analytics` agent tool.

## Requirements

- OpenCode `>=1.17.18` for the sidebar plugin.
- Python environment with FastAPI and Uvicorn for the dashboard API.
- Node.js dependencies installed in `frontend/` and `opencode-analytics-plugin/`.

The application reads `~/.local/share/opencode/opencode.db` in read-only mode. Costs and sidebar totals aggregate all OpenCode projects.

## Dashboard

Start the API:

```bash
.venv/bin/uvicorn app:app --reload --port 8000
```

Start the frontend:

```bash
npm --prefix frontend run dev
```

Vite serves the dashboard at `http://localhost:5173`.

The frontend currently requests the API at port `7123`; change `API_URL`, `RTK_URL`, `GRAPHIFY_URL`, and `PROJECT_SPEND_URL` in `frontend/src/Dashboard.tsx` to port `8000`, or run the API on `7123` instead.

## OpenCode Sidebar Plugin

Install plugin dependencies:

```bash
npm --prefix opencode-analytics-plugin install
```

Register the package in `~/.config/opencode/opencode.jsonc` for the server tool:

```jsonc
{
  "plugin": [
    "file:///absolute/path/to/opencode-analytics-plugin"
  ]
}
```

Register the same package in `~/.config/opencode/tui.json` for the sidebar:

```json
{
  "plugin": [
    "file:///absolute/path/to/opencode-analytics-plugin"
  ],
  "plugin_enabled": {
    "opencode-analytics-sidebar": true
  }
}
```

Quit and restart OpenCode. The sidebar shows global cost for today, this Monday-start week, and this month. The agent can call the `analytics` tool for matching cost, token, and response totals.

## Verify

```bash
npm --prefix frontend run build
npx tsc --noEmit --jsx preserve --module nodenext --moduleResolution nodenext --target esnext --types node --skipLibCheck opencode-analytics-plugin/server.ts opencode-analytics-plugin/tui.tsx
```
