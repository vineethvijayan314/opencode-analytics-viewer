/** @jsxImportSource @opentui/solid */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { createSignal } from "solid-js"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

const dataHome = process.platform === "win32"
  ? process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
  : process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
const dbPath = join(dataHome, "opencode", "opencode.db")

type Stats = { sessionCost: number; todayCost: number; weekCost: number; monthCost: number }

function loadStats(sessionID?: string): Stats {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.query<Stats, [string]>(`
      SELECT
        COALESCE(SUM(CASE WHEN m.session_id = ?
          THEN json_extract(m.data, '$.cost') ELSE 0 END), 0) AS sessionCost,
        COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', 'start of day') * 1000
          THEN json_extract(m.data, '$.cost') ELSE 0 END), 0) AS todayCost,
        COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', '-6 days', 'weekday 1', 'start of day') * 1000
          THEN json_extract(m.data, '$.cost') ELSE 0 END), 0) AS weekCost,
        COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', 'start of month') * 1000
          THEN json_extract(m.data, '$.cost') ELSE 0 END), 0) AS monthCost
      FROM message m
      WHERE json_extract(m.data, '$.role') = 'assistant'
    `).get(sessionID ?? "")
  } finally {
    db.close()
  }
}

const tui: TuiPlugin = async (api) => {
  if (!existsSync(dbPath)) return

  const currentSessionID = () =>
    api.route.current.name === "session" ? api.route.current.params.sessionID : undefined
  const [stats, setStats] = createSignal(loadStats(currentSessionID()))
  const refresh = setInterval(() => setStats(loadStats(currentSessionID())), 5_000)
  api.lifecycle.onDispose(() => clearInterval(refresh))

  api.slots.register({
    id: "opencode-analytics-app-footer",
    order: 0,
    slots: {
      sidebar_footer: () => (
        <box flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={api.theme.current.textMuted}>Analytics</text>
          <text>Session: ${stats().sessionCost.toFixed(2)}</text>
          <text>Today: ${stats().todayCost.toFixed(2)}</text>
          <text>This week: ${stats().weekCost.toFixed(2)}</text>
          <text>This month: ${stats().monthCost.toFixed(2)}</text>
        </box>
      ),
      app_bottom: () => (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={api.theme.current.textMuted}>Session: ${stats().sessionCost.toFixed(2)} | Today: ${stats().todayCost.toFixed(2)}</text>
        </box>
      ),
    },
  })
}

export default { id: "opencode-analytics-sidebar", tui }
