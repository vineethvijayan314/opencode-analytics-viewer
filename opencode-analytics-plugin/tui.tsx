/** @jsxImportSource @opentui/solid */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

const dbPath = join(homedir(), ".local", "share", "opencode", "opencode.db")

const tui: TuiPlugin = async (api) => {
  if (!existsSync(dbPath)) return

  const db = new Database(dbPath, { readonly: true })
  const stats = db.query<{ todayCost: number; weekCost: number; monthCost: number }, []>(`
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
  db.close()

  api.slots.register({
    id: "opencode-analytics-sidebar-footer",
    order: 0,
    slots: {
      sidebar_footer: () => (
        <box flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={api.theme.current.textMuted}>Analytics</text>
          <text>Today: ${stats.todayCost.toFixed(2)}</text>
          <text>This week: ${stats.weekCost.toFixed(2)}</text>
          <text>This month: ${stats.monthCost.toFixed(2)}</text>
        </box>
      ),
    },
  })
}

export default { id: "opencode-analytics-sidebar", tui }
