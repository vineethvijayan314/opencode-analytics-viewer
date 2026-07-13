# OpenCode Analytics

Read-only local analytics for OpenCode usage, cost, projects, RTK, and Graphify.

Works on macOS, Linux, and Windows with OpenCode `>=1.17.18`. It reads your own local OpenCode database and does not send its contents anywhere.

## Requirements

- OpenCode `>=1.17.18`
- Node.js `>=20`
- Python `>=3.10`

## Install

Clone this repository, then run one command from its root.

macOS/Linux:

```bash
./install.sh
```

Windows PowerShell:

```powershell
.\install.ps1
```

If PowerShell blocks local scripts, run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

## Start Dashboard

macOS/Linux:

```bash
./run.sh
```

Windows PowerShell:

```powershell
.\run.ps1
```

Open `http://localhost:5173`. The API runs on `http://localhost:8000`.

To use another API address, set `VITE_API_URL` before starting Vite.

## Enable OpenCode Plugin

Add the server plugin to your OpenCode config (`~/.config/opencode/opencode.jsonc` on macOS/Linux):

```jsonc
{
  "plugin": [
    "file:///absolute/path/to/opencode-analytics-viewer/opencode-analytics-plugin"
  ]
}
```

Add the TUI plugin to your OpenCode TUI config (`~/.config/opencode/tui.json` on macOS/Linux):

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

On Windows, use the equivalent paths under your OpenCode config directory and a valid file URL, such as `file:///C:/Users/name/path/to/opencode-analytics-plugin/tui.tsx`.

Quit and restart OpenCode. The plugin shows global costs in the sidebar and footer, refreshing every five seconds. The `analytics` tool returns matching cost, token, and response totals.

## Verify

```bash
npm --prefix frontend run build
npx tsc --noEmit --jsx preserve --module nodenext --moduleResolution nodenext --target esnext --types node --skipLibCheck opencode-analytics-plugin/server.ts opencode-analytics-plugin/tui.tsx
```
