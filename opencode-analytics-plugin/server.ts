import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { tool, type Plugin } from "@opencode-ai/plugin"

const dbPath = join(homedir(), ".local", "share", "opencode", "opencode.db")

type Analytics = {
  todayTokens: number
  todayCost: number
  todayMessages: number
  weekTokens: number
  weekCost: number
  weekMessages: number
  monthTokens: number
  monthCost: number
  monthMessages: number
}

function stats(): Analytics | undefined {
  if (!existsSync(dbPath)) return
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.query<Analytics, []>(`
      SELECT
        COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', 'start of day') * 1000
          THEN json_extract(m.data, '$.tokens.total') ELSE 0 END), 0) AS todayTokens,
        COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', 'start of day') * 1000
          THEN json_extract(m.data, '$.cost') ELSE 0 END), 0) AS todayCost,
        COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', 'start of day') * 1000
          THEN 1 ELSE 0 END), 0) AS todayMessages
        , COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', '-6 days', 'weekday 1', 'start of day') * 1000
          THEN json_extract(m.data, '$.tokens.total') ELSE 0 END), 0) AS weekTokens
        , COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', '-6 days', 'weekday 1', 'start of day') * 1000
          THEN json_extract(m.data, '$.cost') ELSE 0 END), 0) AS weekCost
        , COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', '-6 days', 'weekday 1', 'start of day') * 1000
          THEN 1 ELSE 0 END), 0) AS weekMessages
        , COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', 'start of month') * 1000
          THEN json_extract(m.data, '$.tokens.total') ELSE 0 END), 0) AS monthTokens
        , COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', 'start of month') * 1000
          THEN json_extract(m.data, '$.cost') ELSE 0 END), 0) AS monthCost
        , COALESCE(SUM(CASE WHEN m.time_created >= unixepoch('now', 'start of month') * 1000
          THEN 1 ELSE 0 END), 0) AS monthMessages
      FROM message m
      WHERE json_extract(m.data, '$.role') = 'assistant'
    `).get()
  } finally {
    db.close()
  }
}

function formatTokens(tokens: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(tokens)
}

const server: Plugin = async () => ({
  tool: {
    analytics: tool({
      description: "Show OpenCode token usage and recorded cost for the current project.",
      args: {},
      async execute(_, context) {
        const value = stats()
        if (!value) return "OpenCode database not found."
        return `Today: ${formatTokens(value.todayTokens)} tokens, ${value.todayMessages} responses, $${value.todayCost.toFixed(2)}\nThis week: ${formatTokens(value.weekTokens)} tokens, ${value.weekMessages} responses, $${value.weekCost.toFixed(2)}\nThis month: ${formatTokens(value.monthTokens)} tokens, ${value.monthMessages} responses, $${value.monthCost.toFixed(2)}`
      },
    }),
  },
})

export default { id: "opencode-analytics-sidebar", server }
