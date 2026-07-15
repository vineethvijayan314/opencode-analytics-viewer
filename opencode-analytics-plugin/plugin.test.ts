import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = join(tmpdir(), `opencode-analytics-plugin-${process.pid}`)
const dataHome = join(home, ".local", "share")
const dbPath = join(dataHome, "opencode", "opencode.db")

process.env.HOME = home
process.env.XDG_DATA_HOME = dataHome
process.env.OPENCODE_DB_PATH = dbPath

function insertMessage(db: Database, sessionID: string, age: string, cost: number, tokens: number) {
  db.run(
    `INSERT INTO message (session_id, time_created, data)
     VALUES (?, unixepoch('now', ?) * 1000, json(?))`,
    [sessionID, age, JSON.stringify({ role: "assistant", cost, tokens: { total: tokens } })],
  )
}

function createDatabase() {
  mkdirSync(join(dataHome, "opencode"), { recursive: true })
  const db = new Database(dbPath)
  db.run("CREATE TABLE message (session_id TEXT, time_created INTEGER, data TEXT)")
  insertMessage(db, "session-current", "-1 hour", 1.25, 100)
  insertMessage(db, "session-other", "-2 hours", 0.75, 50)
  insertMessage(db, "session-old", "-8 days", 2, 200)
  db.close()
}

beforeAll(createDatabase)

afterAll(() => rmSync(home, { recursive: true, force: true }))

describe("server plugin", () => {
  test("reports calendar totals from the OpenCode database", async () => {
    const plugin = (await import("./server.js")).default
    const hooks = await plugin.server({} as never)
    const output = await hooks.tool?.analytics.execute({}, {} as never)

    expect(output).toContain("Today: 150 tokens, 2 responses, $2.00")
    expect(output).toContain("This month:")
  })

  test("reports a missing database", async () => {
    const plugin = (await import("./server.js")).default
    rmSync(dbPath)
    const hooks = await plugin.server({} as never)

    expect(await hooks.tool?.analytics.execute({}, {} as never)).toBe("OpenCode database not found.")

    createDatabase()
  })
})

describe("TUI plugin", () => {
  test("reads the active session and calendar costs", async () => {
    const { loadStats, sessionIDFromRoute } = await import("./tui.jsx")

    expect(sessionIDFromRoute({ name: "session", params: { sessionID: "session-current" } })).toBe("session-current")
    expect(sessionIDFromRoute({ name: "home" })).toBeUndefined()
    expect(loadStats("session-current").sessionCost).toBe(1.25)
    expect(loadStats("session-current").todayCost).toBe(2)
  })

  test("registers cost slots and cleans up refresh", async () => {
    const plugin = (await import("./tui.jsx")).default
    let slots: Record<string, () => unknown> | undefined
    let dispose: (() => void) | undefined
    const api = {
      route: { current: { name: "session", params: { sessionID: "session-current" } } },
      lifecycle: { onDispose: (callback: () => void) => { dispose = callback } },
      slots: { register: (value: { slots: Record<string, () => unknown> }) => { slots = value.slots } },
      theme: { current: { textMuted: "gray" } },
    }

    await plugin.tui(api as never, undefined as never, undefined as never)

    expect(slots).toBeDefined()
    expect(slots?.sidebar_footer).toBeFunction()
    expect(slots?.app_bottom).toBeFunction()
    expect(dispose).toBeDefined()
    dispose?.()
  })

  test("does not register slots when the database is absent", async () => {
    const plugin = (await import("./tui.jsx")).default
    rmSync(dbPath, { force: true })
    let registered = false

    await plugin.tui(
      { slots: { register: () => { registered = true } } } as never,
      undefined as never,
      undefined as never,
    )

    expect(registered).toBeFalse()
  })
})
