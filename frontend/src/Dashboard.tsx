import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ---------- Types (mirror the FastAPI payload) ----------

interface RtkPeriod {
  commands: number;
  saved_tokens: number;
  savings_pct: number;
}

interface RtkMonthly extends RtkPeriod {
  month: string;
}

interface RtkDaily extends RtkPeriod {
  date: string;
}

interface RtkWeekly extends RtkPeriod {
  week_start: string;
  week_end: string;
}

interface RtkSummary {
  total_commands: number;
  total_input: number;
  total_output: number;
  total_saved: number;
  avg_savings_pct: number;
}

interface RtkSavingsResponse {
  summary: RtkSummary;
  daily?: RtkDaily[];
  weekly?: RtkWeekly[];
  monthly?: RtkMonthly[];
}

interface ProjectSpend {
  name: string;
  directory: string;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  query_count: number;
}

interface ProjectSpendResponse {
  count: number;
  projects: ProjectSpend[];
}

interface GraphifyGraph {
  path: string;
  corpus_tokens?: number;
  nodes?: number;
  edges?: number;
  avg_query_tokens?: number;
  reduction_x?: number;
}

interface GraphifyStatsResponse {
  graphs: GraphifyGraph[];
  total_graphs: number;
}

interface MetricEntry {
  timestamp: string;
  date: string;
  prompt: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost: number; // real cost from opencode (0 for models on Copilot subscription)
}

interface MetricsResponse {
  count: number;
  entries: MetricEntry[];
}

interface DailySpend {
  date: string;
  spend: number;
}

interface ModelUsage {
  model: string;
  queries: number;
  cost: number;
}

const MODEL_COLORS = [
  "#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626",
  "#0891b2", "#65a30d", "#9333ea", "#0d9488", "#b45309",
  "#4f46e5", "#be185d", "#047857", "#c2410c", "#1d4ed8", "#6d28d9",
];

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:7123").replace(/\/$/, "");
const API_URL = `${API_BASE_URL}/api/metrics`;
const RTK_URL = `${API_BASE_URL}/api/rtk-savings`;
const GRAPHIFY_URL = `${API_BASE_URL}/api/graphify-stats`;
const PROJECT_SPEND_URL = `${API_BASE_URL}/api/project-spend`;

// ---------- Formatting helpers ----------

const usd = (value: number): string =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  });

const num = (value: number): string => value.toLocaleString("en-US");

// ---------- Small presentational pieces ----------

function MetricCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: { pct: number | null; label: string; comparisonValue?: string };
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {trend && (
        <p
          className={`mt-1 text-xs font-medium ${
            trend.pct === null
              ? "text-slate-400"
              : trend.pct > 0
                ? "text-red-600"
                : trend.pct < 0
                  ? "text-emerald-600"
                  : "text-slate-400"
          }`}
        >
          {trend.pct === null
            ? trend.label
            : `${trend.pct > 0 ? "▲" : trend.pct < 0 ? "▼" : "•"} ${Math.abs(trend.pct).toFixed(0)}% ${trend.label}${trend.comparisonValue ? ` (${trend.comparisonValue})` : ""}`}
        </p>
      )}
    </div>
  );
}

// ---------- Main component ----------

export default function Dashboard() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("opencode-analytics-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [entries, setEntries] = useState<MetricEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [preset, setPreset] = useState<string>("all");
  const [rtkSavings, setRtkSavings] = useState<RtkSummary | null>(null);
  const [rtkMonthly, setRtkMonthly] = useState<RtkMonthly[]>([]);
  const [rtkWeekly, setRtkWeekly] = useState<RtkWeekly[]>([]);
  const [rtkDaily, setRtkDaily] = useState<RtkDaily[]>([]);
  const [rtkView, setRtkView] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [graphifyStats, setGraphifyStats] = useState<GraphifyStatsResponse | null>(null);
  const [projectSpend, setProjectSpend] = useState<ProjectSpend[]>([]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("opencode-analytics-theme", theme);
  }, [theme]);

  const chartColors = theme === "dark"
    ? { grid: "#334155", text: "#94a3b8", tooltip: "#e2e8f0" }
    : { grid: "#e2e8f0", text: "#64748b", tooltip: "#0f172a" };

  function applyPreset(p: string) {
    setPreset(p);
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (p === "all") {
      setStartDate(""); setEndDate("");
    } else if (p === "today") {
      setStartDate(fmt(today)); setEndDate(fmt(today));
    } else if (p === "this_week") {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      setStartDate(fmt(weekStart)); setEndDate(fmt(today));
    } else if (p === "this_month") {
      setStartDate(fmt(new Date(today.getFullYear(), today.getMonth(), 1)));
      setEndDate(fmt(today));
    } else if (p === "last_month") {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      setStartDate(fmt(first)); setEndDate(fmt(last));
    } else if (p === "3months") {
      const from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      setStartDate(fmt(from)); setEndDate(fmt(today));
    } else if (p === "6months") {
      const from = new Date(today.getFullYear(), today.getMonth() - 5, 1);
      setStartDate(fmt(from)); setEndDate(fmt(today));
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [res, rtkRes, projectSpendRes] = await Promise.all([
          fetch(API_URL, { signal: controller.signal }),
          fetch(RTK_URL, { signal: controller.signal }).catch(() => null),
          fetch(PROJECT_SPEND_URL, { signal: controller.signal }).catch(() => null),
        ]);
        if (!res.ok) {
          throw new Error(`API returned ${res.status}`);
        }
        const data: MetricsResponse = await res.json();
        setEntries(data.entries);
        if (rtkRes?.ok) {
          const rtkData: RtkSavingsResponse = await rtkRes.json();
          setRtkSavings(rtkData.summary);
          setRtkMonthly(rtkData.monthly ?? []);
          setRtkWeekly(rtkData.weekly ?? []);
          setRtkDaily(rtkData.daily ?? []);
        }
        if (projectSpendRes?.ok) {
          const pData: ProjectSpendResponse = await projectSpendRes.json();
          setProjectSpend(pData.projects);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(
          `Cannot reach the Python API at ${API_BASE_URL}. Is the FastAPI server running?`,
        );
      } finally {
        setLoading(false);
      }
    }

    load();
    fetch(GRAPHIFY_URL, { signal: controller.signal })
      .then((res) => res.ok ? res.json() as Promise<GraphifyStatsResponse> : null)
      .then((data) => data && setGraphifyStats(data))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  // Entries scoped to the selected date range (used by all downstream memos)
  const dateFiltered = useMemo(() => {
    if (!startDate && !endDate) return entries;
    return entries.filter((e) => {
      if (startDate && e.date < startDate) return false;
      if (endDate && e.date > endDate) return false;
      return true;
    });
  }, [entries, startDate, endDate]);

  // Totals for the metric cards
  const totals = useMemo(() => {
    return dateFiltered.reduce(
      (acc, e) => ({
        spend: acc.spend + e.cost,
        queries: acc.queries + 1,
        input: acc.input + e.input_tokens,
        output: acc.output + e.output_tokens,
      }),
      { spend: 0, queries: 0, input: 0, output: 0 },
    );
  }, [dateFiltered]);

  // Today's spend + trend vs the most recent prior day with usage (ignores filter)
  const today = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    const todayKey = fmt(now);
    const previousUsageDate = entries.reduce<string | undefined>(
      (latest, entry) => entry.date < todayKey && (!latest || entry.date > latest) ? entry.date : latest,
      undefined,
    );
    let todaySpend = 0, previousSpend = 0;
    let todayQueries = 0, previousQueries = 0;
    let todayInput = 0, todayOutput = 0;
    let previousInput = 0, previousOutput = 0;
    let thisWeekSpend = 0, thisMonthSpend = 0, lastMonthSpend = 0;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekStartKey = fmt(weekStart);
    const thisMonthKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthKey = `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}`;
    for (const e of entries) {
      if (e.date === todayKey) {
        todaySpend += e.cost;
        todayQueries += 1;
        todayInput += e.input_tokens;
        todayOutput += e.output_tokens;
      } else if (e.date === previousUsageDate) {
        previousSpend += e.cost;
        previousQueries += 1;
        previousInput += e.input_tokens;
        previousOutput += e.output_tokens;
      }
      if (e.date.startsWith(thisMonthKey)) thisMonthSpend += e.cost;
      if (e.date.startsWith(lastMonthKey)) lastMonthSpend += e.cost;
      if (e.date >= weekStartKey && e.date <= todayKey) thisWeekSpend += e.cost;
    }
    const spendPct = previousSpend > 0 ? ((todaySpend - previousSpend) / previousSpend) * 100 : null;
    const queriesPct = previousQueries > 0 ? ((todayQueries - previousQueries) / previousQueries) * 100 : null;
    const todayTokens = todayInput + todayOutput;
    const previousTokens = previousInput + previousOutput;
    const tokensPct = previousTokens > 0 ? ((todayTokens - previousTokens) / previousTokens) * 100 : null;
    const monthSpendPct = lastMonthSpend > 0 ? ((thisMonthSpend - lastMonthSpend) / lastMonthSpend) * 100 : null;
    return {
      spend: todaySpend, spendPct,
      queries: todayQueries, queriesPct,
      tokens: todayTokens, tokensPct,
      input: todayInput, output: todayOutput,
      thisWeekSpend,
      thisMonthSpend, lastMonthSpend, monthSpendPct,
      previousUsageDate, previousSpend, previousQueries, previousTokens,
    };
  }, [entries]);

  const highlights = useMemo(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);
    const thisWeekStartKey = fmt(thisWeekStart);
    const lastWeekStartKey = fmt(lastWeekStart);
    let thisWeekSpend = 0;
    let lastWeekSpend = 0;
    const models = new Map<string, { queries: number; cost: number }>();

    for (const entry of entries) {
      if (entry.date >= thisWeekStartKey) thisWeekSpend += entry.cost;
      else if (entry.date >= lastWeekStartKey) lastWeekSpend += entry.cost;

      const model = entry.model || "(unknown)";
      const value = models.get(model) ?? { queries: 0, cost: 0 };
      models.set(model, { queries: value.queries + 1, cost: value.cost + entry.cost });
    }

    const topModel = Array.from(models.entries())
      .map(([model, value]) => ({ model, ...value }))
      .sort((a, b) => b.queries - a.queries)[0];
    const topProject = [...projectSpend].sort((a, b) => b.total_cost - a.total_cost)[0];
    const activeDays = new Set(dateFiltered.map((entry) => entry.date)).size;
    const weeklySpendPct = lastWeekSpend > 0 ? ((thisWeekSpend - lastWeekSpend) / lastWeekSpend) * 100 : null;

    return {
      thisWeekSpend,
      weeklySpendPct,
      lastWeekSpend,
      topProject,
      topModel,
      activeDays,
      averageCost: entries.length ? entries.reduce((sum, entry) => sum + entry.cost, 0) / entries.length : 0,
    };
  }, [dateFiltered, entries, projectSpend]);

  // Daily spend series for the line chart (ascending by date)
  const dailySpend: DailySpend[] = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of dateFiltered) {
      byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.cost);
    }
    return Array.from(byDay.entries())
      .map(([date, spend]) => ({ date, spend: Number(spend.toFixed(4)) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [dateFiltered]);

  // Model usage aggregation for bar chart
  const modelUsage: ModelUsage[] = useMemo(() => {
    const byModel = new Map<string, { queries: number; cost: number }>();
    for (const e of dateFiltered) {
      const key = e.model || "(unknown)";
      const existing = byModel.get(key) ?? { queries: 0, cost: 0 };
      byModel.set(key, { queries: existing.queries + 1, cost: existing.cost + e.cost });
    }
    return Array.from(byModel.entries())
      .map(([model, data]) => ({ model, ...data, cost: Number(data.cost.toFixed(4)) }))
      .sort((a, b) => b.queries - a.queries);
  }, [dateFiltered]);

  // Filtered log rows (backend already sorts newest first)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dateFiltered;
    return dateFiltered.filter(
      (e) =>
        e.prompt.toLowerCase().includes(q) ||
        e.timestamp.toLowerCase().includes(q),
    );
  }, [dateFiltered, search]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-600">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
          <span className="text-sm font-medium">Loading analytics…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              OpenCode Analytics
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Query history, token usage, and real cost from your local OpenCode
              database. Cost is stored per message by OpenCode — models on Copilot
              subscription report $0.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="shrink-0 rounded-lg border border-slate-300 bg-white p-2 text-slate-600 transition-colors hover:border-slate-400"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {/* Today section */}
        <div className="mt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Today
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <MetricCard
              label="Spend"
              value={usd(today.spend)}
              trend={{
                pct: today.spendPct,
                label: today.spendPct === null ? "no prior usage" : "vs last used",
                comparisonValue: today.previousSpend > 0 ? `last used: ${usd(today.previousSpend)}` : undefined,
              }}
            />
            <MetricCard
              label="Tokens"
              value={num(today.tokens)}
              trend={{
                pct: today.tokensPct,
                label: today.tokensPct === null ? "no prior usage" : "vs last used",
                comparisonValue: today.previousTokens > 0 ? `last used: ${num(today.previousTokens)}` : undefined,
              }}
            />
            <MetricCard
              label="Queries"
              value={num(today.queries)}
              trend={{
                pct: today.queriesPct,
                label: today.queriesPct === null ? "no prior usage" : "vs last used",
                comparisonValue: today.previousQueries > 0 ? `last used: ${today.previousQueries}` : undefined,
              }}
            />
            <MetricCard
              label="This Week Spend"
              value={usd(today.thisWeekSpend)}
            />
            <MetricCard
              label="This Month Spend"
              value={usd(today.thisMonthSpend)}
              trend={{
                pct: today.monthSpendPct,
                label: today.monthSpendPct === null ? "no spend last month" : "vs last month",
                comparisonValue: today.lastMonthSpend > 0 ? `last month: ${usd(today.lastMonthSpend)}` : undefined,
              }}
            />
          </div>
        </div>

        {/* Date range filter */}
        <div className="mt-6 flex flex-wrap gap-2">
          {[
            { id: "all", label: "All time" },
            { id: "today", label: "Today" },
            { id: "this_week", label: "This week" },
            { id: "this_month", label: "This month" },
            { id: "last_month", label: "Last month" },
            { id: "3months", label: "Last 3 months" },
            { id: "6months", label: "Last 6 months" },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => applyPreset(id)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                preset === id
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Top metric cards */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total Spend" value={usd(totals.spend)} />
          <MetricCard label="Total Queries" value={num(totals.queries)} />
          <MetricCard label="Total Input Tokens" value={num(totals.input)} />
          <MetricCard label="Total Output Tokens" value={num(totals.output)} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            label="This Week Spend"
            value={usd(highlights.thisWeekSpend)}
            trend={{
              pct: highlights.weeklySpendPct,
              label: highlights.weeklySpendPct === null ? "no prior-week spend" : "vs last week",
              comparisonValue: highlights.lastWeekSpend > 0 ? `last week: ${usd(highlights.lastWeekSpend)}` : undefined,
            }}
          />
          <MetricCard
            label="Top Project"
            value={highlights.topProject?.name ?? "—"}
            trend={highlights.topProject ? { pct: null, label: usd(highlights.topProject.total_cost) } : undefined}
          />
          <MetricCard
            label="Most Used Model"
            value={highlights.topModel?.model ?? "—"}
            trend={highlights.topModel ? { pct: null, label: `${num(highlights.topModel.queries)} queries` } : undefined}
          />
          <MetricCard label="Active Days" value={num(highlights.activeDays)} trend={{ pct: null, label: "selected range" }} />
          <MetricCard label="Avg Cost / Response" value={usd(highlights.averageCost)} trend={{ pct: null, label: "all-time responses" }} />
        </div>

        {/* Project spend breakdown */}
        {projectSpend.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Spend by Project
            </h2>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left">
                    <th className="px-4 py-3 font-medium text-slate-500">Project</th>
                    <th className="px-4 py-3 font-medium text-slate-500 text-right">Cost</th>
                    <th className="px-4 py-3 font-medium text-slate-500 text-right">Total Tokens</th>
                    <th className="px-4 py-3 font-medium text-slate-500 text-right">Input</th>
                    <th className="px-4 py-3 font-medium text-slate-500 text-right">Output</th>
                    <th className="px-4 py-3 font-medium text-slate-500 text-right">Queries</th>
                  </tr>
                </thead>
                <tbody>
                  {projectSpend.map((p, i) => (
                    <tr
                      key={p.directory}
                      className={`border-b border-slate-100 last:border-0 ${i % 2 === 0 ? "" : "bg-slate-50/50"}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-800">{p.name}</span>
                        <span className="ml-2 text-xs text-slate-400 truncate max-w-xs hidden sm:inline">{p.directory}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">{usd(p.total_cost)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">{num(p.total_tokens)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-500">{num(p.input_tokens)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-500">{num(p.output_tokens)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{num(p.query_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* RTK + Graphify Savings */}
        {(rtkSavings || graphifyStats) && (
          <div className="mt-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Token Savings
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {rtkSavings && (
                <>
                  <MetricCard
                    label="RTK Tokens Saved"
                    value={num(rtkSavings.total_saved)}
                    trend={{ pct: null, label: `${rtkSavings.avg_savings_pct.toFixed(1)}% avg savings` }}
                  />
                  <MetricCard
                    label="RTK Commands Run"
                    value={num(rtkSavings.total_commands)}
                    trend={{ pct: null, label: "total intercepted" }}
                  />
                </>
              )}
              {graphifyStats && graphifyStats.total_graphs > 0 && (
                <>
                  <MetricCard
                    label="Graphify Graphs"
                    value={num(graphifyStats.total_graphs)}
                    trend={{ pct: null, label: "knowledge graphs built" }}
                  />
                  <MetricCard
                    label="Avg Query Reduction"
                    value={
                      graphifyStats.graphs.some((g) => g.reduction_x)
                        ? `${(
                            graphifyStats.graphs
                              .filter((g) => g.reduction_x)
                              .reduce((s, g) => s + (g.reduction_x ?? 0), 0) /
                            graphifyStats.graphs.filter((g) => g.reduction_x).length
                          ).toFixed(1)}x`
                        : "—"
                    }
                    trend={{ pct: null, label: "fewer tokens per query" }}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* RTK savings chart with toggle */}
        {(rtkMonthly.length > 0 || rtkWeekly.length > 0 || rtkDaily.length > 0) && (() => {
          const rtkData =
            rtkView === "daily" ? rtkDaily.map((r) => ({ ...r, _key: r.date })) :
            rtkView === "weekly" ? rtkWeekly.map((r) => ({ ...r, _key: r.week_start })) :
            rtkMonthly.map((r) => ({ ...r, _key: r.month }));
          return (
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">RTK Token Savings</h2>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
                  {(["daily", "weekly", "monthly"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setRtkView(v)}
                      className={`px-3 py-1.5 capitalize transition-colors ${
                        rtkView === v ? "bg-slate-800 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rtkData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                    <XAxis
                      dataKey="_key"
                      tick={{ fontSize: rtkView === "daily" ? 10 : 12, fill: chartColors.text }}
                      tickMargin={8}
                      interval={rtkView === "daily" ? "preserveStartEnd" : 0}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: chartColors.text }}
                      tickFormatter={(v: number) =>
                        v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : String(v)
                      }
                      width={60}
                    />
                    <Tooltip
                      formatter={(value: number) => [num(value), "Tokens Saved"]}
                      labelFormatter={(label: string) => {
                        if (rtkView === "weekly") {
                          const w = rtkWeekly.find((r) => r.week_start === label);
                          return w ? `${w.week_start} → ${w.week_end}` : label;
                        }
                        return label;
                      }}
                      labelStyle={{ color: chartColors.tooltip, fontWeight: 600 }}
                    />
                    <Bar dataKey="saved_tokens" fill="#059669" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {rtkView !== "daily" && (
                <div className="mt-3 flex gap-6 overflow-x-auto">
                  {rtkData.map((r) => (
                    <div key={r._key} className="shrink-0 text-center">
                      <p className="text-xs text-slate-400">{r._key}</p>
                      <p className="text-sm font-semibold text-emerald-600">{r.savings_pct.toFixed(1)}%</p>
                      <p className="text-xs text-slate-500">{num(r.commands)} cmds</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Daily spend chart */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">
            Daily AI Spend
          </h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={dailySpend}
                margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: chartColors.text }}
                  tickMargin={8}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: chartColors.text }}
                  tickFormatter={(v: number) => `$${v}`}
                  width={70}
                />
                <Tooltip
                  formatter={(value: number) => [usd(value), "Spend"]}
                  labelStyle={{ color: chartColors.tooltip, fontWeight: 600 }}
                />
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Model usage chart */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">
            Queries by Model
          </h2>
          <div className="mt-4" style={{ height: Math.max(200, modelUsage.length * 36) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={modelUsage}
                layout="vertical"
                margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 12, fill: chartColors.text }}
                  tickFormatter={(v: number) => num(v)}
                />
                <YAxis
                  type="category"
                  dataKey="model"
                  tick={{ fontSize: 11, fill: chartColors.text }}
                  width={160}
                />
                <Tooltip
                  formatter={(value: number, name: string) =>
                    name === "queries"
                      ? [num(value), "Queries"]
                      : [usd(value), "Spend"]
                  }
                  labelStyle={{ color: chartColors.tooltip, fontWeight: 600 }}
                />
                <Bar dataKey="queries" radius={[0, 4, 4, 0]}>
                  {modelUsage.map((_, index) => (
                    <Cell key={index} fill={MODEL_COLORS[index % MODEL_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Logs table */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              Query Logs{" "}
              <span className="font-normal text-slate-400">
                ({num(Math.min(filtered.length, 200))} of {num(filtered.length)})
              </span>
            </h2>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-72"
            />
          </div>
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Prompt</th>
                  <th className="px-5 py-3 font-medium">Model</th>
                  <th className="px-5 py-3 font-medium">Provider</th>
                  <th className="px-5 py-3 text-right font-medium">New Input</th>
                  <th className="px-5 py-3 text-right font-medium">Cache Write</th>
                  <th className="px-5 py-3 text-right font-medium">Cache Read</th>
                  <th className="px-5 py-3 text-right font-medium">Output</th>
                  <th className="px-5 py-3 text-right font-medium">Total</th>
                  <th className="px-5 py-3 text-right font-medium">Equiv. Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-5 py-8 text-center text-slate-400"
                    >
                      No matching records.
                    </td>
                  </tr>
                ) : (
                  filtered.slice(0, 200).map((e, i) => (
                    <tr key={`${e.timestamp}-${i}`} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                        {e.timestamp}
                      </td>
                      <td className="max-w-md px-5 py-3 text-slate-800">
                        <span className="line-clamp-2" title={e.prompt}>
                          {e.prompt || (
                            <em className="text-slate-400">(no prompt text)</em>
                          )}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-500">
                        {e.model || <em className="text-slate-300">—</em>}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-400 text-xs">
                        {e.provider || <em className="text-slate-300">—</em>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                        {num(e.input_tokens)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-amber-600">
                        {num(e.cache_write_tokens)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-emerald-600">
                        {num(e.cache_read_tokens)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                        {num(e.output_tokens)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-700 font-medium">
                        {num(e.total_tokens)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-slate-800">
                        {usd(e.cost)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
