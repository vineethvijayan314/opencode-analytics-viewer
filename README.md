# OpenCode Analytics Viewer

[![Tests](https://github.com/vineethvijayan314/opencode-analytics-viewer/actions/workflows/windows.yml/badge.svg)](https://github.com/vineethvijayan314/opencode-analytics-viewer/actions/workflows/windows.yml)
![Backend tests](https://img.shields.io/badge/backend-unittest-3776AB?logo=python&logoColor=white)
![Frontend tests](https://img.shields.io/badge/frontend-Vitest-6E9F18?logo=vitest&logoColor=white)
![Plugin tests](https://img.shields.io/badge/plugin-Bun%20Test-FBF0DF?logo=bun&logoColor=black)

A local, read-only dashboard and OpenCode TUI plugin for usage, cost, projects, RTK savings, and Graphify statistics.

Current version: `0.1.0`, the first release. See [CHANGELOG.md](CHANGELOG.md) for release notes.

The dashboard reads the OpenCode database on your machine. It does not upload prompts, token data, costs, or database contents.

## What You Get

- Browser dashboard at `http://localhost:5174`
- Cost, token, model, project, and query-history views
- Date filters for today, this week, month, and longer ranges
- Optional RTK and Graphify sections when those tools are installed
- OpenCode sidebar costs for the current session, today, the last prior day used, this Monday-start week, and month
- OpenCode footer costs for the current session and today
- `analytics` tool for agent cost, token, and response totals

## Requirements

- OpenCode `>=1.17.18` for the optional TUI plugin
- Node.js `>=20` and npm
- Python `>=3.10`
- Git, if cloning from a repository

Docker Desktop is an alternative to the Node.js and Python requirements for the dashboard.

RTK and Graphify are optional. The dashboard works without either; their sections are simply hidden.

These integrations require the commands to be installed in the same environment as the API. Host-installed RTK and Graphify commands are not available inside the default Docker API image, so their dashboard sections remain hidden when using Compose.

## Install

Clone the repository using its URL from your Git host, then enter it:

```bash
git clone REPOSITORY_URL opencode-analytics-viewer
cd opencode-analytics-viewer
```

### macOS and Linux

Make the helper scripts executable once, then install dependencies:

```bash
chmod +x install.sh run.sh
./install.sh
```

### Windows PowerShell

Run:

```powershell
.\install.ps1
```

If PowerShell blocks local scripts, allow scripts only for the current terminal and run the installer again:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

The installer creates `.venv`, installs FastAPI/Uvicorn, and installs frontend and plugin Node dependencies.

## Update

Updates require a Git clone of this repository. Stop the dashboard and OpenCode first, then run:

### macOS and Linux

```bash
./update.sh
```

### Windows PowerShell

```powershell
.\update.ps1
```

The update script fast-forwards to the latest release on the current branch and reruns dependency installation. Restart the dashboard and OpenCode afterward.

## Start the Dashboard

### Docker (macOS, Linux, and Windows)

Install and start Docker Desktop, then point Compose at the directory that contains `opencode.db`:

macOS/Linux:

```bash
export OPENCODE_DATA_DIR="$HOME/.local/share/opencode"
docker compose up --build
```

Windows PowerShell:

```powershell
$env:OPENCODE_DATA_DIR = "$env:LOCALAPPDATA\opencode"
docker compose up --build
```

Open `http://localhost:5174`. The dashboard API remains available at `http://localhost:7123`.

Compose mounts the OpenCode data directory read-only rather than copying it into an image. New sessions and usage data appear after refreshing the dashboard; no image rebuild is needed. Mounting the directory also includes SQLite's `opencode.db-wal` and `opencode.db-shm` files, which keeps active data visible.

On Docker Desktop, allow access to your user home directory if it is not already shared. Stop the services with `Ctrl+C`; add `-d` to run them in the background.

### Native

#### macOS and Linux

```bash
./run.sh
```

#### Windows PowerShell

```powershell
.\run.ps1
```

Then open `http://localhost:5174`.

The helper starts:

- FastAPI API: `http://localhost:7123`
- Vite dashboard: `http://localhost:5174`

Stop both processes with `Ctrl+C`.

## Enable the OpenCode Plugin

The dashboard does not require the plugin. Install this only to show analytics in OpenCode’s sidebar/footer and expose the `analytics` tool.

The config files are usually:

- macOS/Linux server config: `~/.config/opencode/opencode.jsonc`
- macOS/Linux TUI config: `~/.config/opencode/tui.json`

Add the plugin entries to your existing config. Do not replace other plugins or configuration fields.

### Server Plugin

Add the server source file to `plugin` in `opencode.jsonc`:

```jsonc
{
  "plugin": [
    "file:///absolute/path/to/opencode-analytics-viewer/opencode-analytics-plugin/server.ts"
  ]
}
```

### TUI Plugin

Add the TUI source file to `plugin` in `tui.json`, then enable its ID:

```json
{
  "plugin": [
    "file:///absolute/path/to/opencode-analytics-viewer/opencode-analytics-plugin/tui.tsx"
  ],
  "plugin_enabled": {
    "opencode-analytics-sidebar": true
  }
}
```

On Windows, use your OpenCode configuration directory and file URLs with forward slashes:

```text
file:///C:/Users/your-name/path/to/opencode-analytics-viewer/opencode-analytics-plugin/server.ts
file:///C:/Users/your-name/path/to/opencode-analytics-viewer/opencode-analytics-plugin/tui.tsx
```

The TUI plugin supports the Windows OpenCode data directory. The server plugin currently reads `~/.local/share/opencode/opencode.db`, so its `analytics` tool is available only when the database exists at that path.

Quit and restart OpenCode after editing its config. The TUI plugin refreshes displayed costs every five seconds.

## Optional Tools

### RTK

If `rtk` is on your `PATH`, the dashboard displays RTK token-savings data. If it is absent, the rest of the dashboard remains available.

### Graphify

If `graphify` is on your `PATH`, the dashboard searches for `graphify-out/graph.json` beneath `~/work` and shows graph statistics. If it is absent or no graphs exist, that section is hidden.

## Configuration

The frontend expects the API at `http://localhost:7123` by default. To use a different API address, set `VITE_API_URL` before starting the frontend.

macOS/Linux example:

```bash
VITE_API_URL=http://localhost:9000 npm --prefix=frontend run dev
```

Windows PowerShell example:

```powershell
$env:VITE_API_URL = "http://localhost:9000"
npm --prefix=frontend run dev
```

## Troubleshooting

| Problem | Check |
| --- | --- |
| Dashboard says it cannot reach the API | Run `./run.sh` or `.\run.ps1`; confirm `http://localhost:7123/api/metrics` responds. |
| Dashboard has no data | OpenCode must have created its local database by running at least one session. |
| Compose says `OPENCODE_DATA_DIR` is required | Set it to the directory containing `opencode.db`, then rerun `docker compose up --build`. |
| Sidebar/footer not visible | Verify both plugin config entries, then completely quit and restart OpenCode. |
| RTK or Graphify section missing | This is expected unless the corresponding command is installed and available on `PATH`. |
| Port `7123` is already in use | Stop the process using it or set `VITE_API_URL` and start Uvicorn on another matching port. |

## Verify Changes

```bash
.venv/bin/python -m unittest discover -s tests -v
npm --prefix=frontend run build
npx tsc --noEmit --jsx preserve --module nodenext --moduleResolution nodenext --target esnext --types node --skipLibCheck opencode-analytics-plugin/server.ts opencode-analytics-plugin/tui.tsx
```

On Windows, replace `.venv/bin/python` with `.\.venv\Scripts\python.exe`. GitHub Actions runs the installer, API tests, frontend build, and plugin type-check on `windows-latest` for every push and pull request. This validates installation and builds, but does not exercise the plugin inside a running OpenCode TUI.

## Privacy

All dashboard calls target `localhost`. The app opens the OpenCode SQLite database in read-only mode and does not add data, run migrations, or transmit analytics externally.
