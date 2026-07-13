/** @jsxImportSource @opentui/solid */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { createSignal } from "solid-js"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

const dbPath = join(homedir(), ".local", "share", "opencode", "opencode.db")

type Stats = { todayCost: number; weekCost: number; monthCost: number }

function loadStats(): Stats {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.query<Stats, []>(`
      SELECT
        COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', 'start of day') * 1000
          THEN json_extract(m.data, '$.cost') ELSE 0 END), 0) AS todayCost,
        COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', '-6 days', 'weekday 1', 'start of day') * 1000
          THEN json_extract(m.data, '$.cost') ELSE 0 END), 0) AS weekCost,
        COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', 'start of month') * 1000
          THEN json_extract(m.data, '$.cost') ELSE 0 END), 0) AS monthCost
      FROM message m
      WHERE json_extract(m.data, '$.role') = 'assistant'
    `).get()
  } finally {
    db.close()
  }
}

const tui: TuiPlugin = async (api) => {
  if (!existsSync(dbPath)) return

  const [stats, setStats] = createSignal(loadStats())
  const refresh = setInterval(() => setStats(loadStats()), 5_000)
  api.lifecycle.onDispose(() => clearInterval(refresh))

  api.slots.register({
    id: "opencode-analytics-app-footer",
    order: 0,
    slots: {
      sidebar_footer: () => (
        <box flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={api.theme.current.textMuted}>Analytics</text>
          <text>Today: ${stats().todayCost.toFixed(2)}</text>
          <text>This week: ${stats().weekCost.toFixed(2)}</text>
          <text>This month: ${stats().monthCost.toFixed(2)}</text>
        </box>
      ),
      app_bottom: () => (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={api.theme.current.textMuted}>Today: ${stats().todayCost.toFixed(2)}</text>
        </box>
      ),
    },
  })
}

export default { id: "opencode-analytics-sidebar", tui }
