import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Dashboard from "./Dashboard";

const entries = [
  {
    timestamp: "2026-07-15 10:00:00",
    date: "2026-07-15",
    prompt: "Current prompt",
    provider: "copilot",
    model: "gpt-current",
    input_tokens: 100,
    output_tokens: 20,
    cache_write_tokens: 5,
    cache_read_tokens: 10,
    total_tokens: 135,
    cost: 1.25,
  },
  {
    timestamp: "2026-06-10 10:00:00",
    date: "2026-06-10",
    prompt: "Older prompt",
    provider: "copilot",
    model: "gpt-old",
    input_tokens: 40,
    output_tokens: 10,
    cache_write_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 50,
    cost: 0.5,
  },
];

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

describe("Dashboard", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/metrics")) return response({ count: 2, entries });
      if (url.endsWith("/api/project-spend")) return response({ count: 0, projects: [] });
      if (url.endsWith("/api/rtk-savings")) return response({}, false);
      return response({ graphs: [], total_graphs: 0 });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders fetched totals and filters query logs", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    expect(await screen.findByText("$1.75")).toBeInTheDocument();
    expect(screen.getByText("Current prompt")).toBeInTheDocument();
    expect(screen.getByText("Older prompt")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search prompts…"), "older");

    expect(screen.queryByText("Current prompt")).not.toBeInTheDocument();
    expect(screen.getByText("Older prompt")).toBeInTheDocument();
  });

  it("applies the last-month date preset", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T12:00:00"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Dashboard />);
    await screen.findByText("Current prompt");

    await user.click(screen.getByRole("button", { name: "Last month" }));

    expect(screen.queryByText("Current prompt")).not.toBeInTheDocument();
    expect(screen.getByText("Older prompt")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("persists a theme change", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findByText("Current prompt");

    await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("opencode-analytics-theme")).toBe("dark");
  });

  it("shows an API error", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/api/metrics") ? response({}, false) : response({}, false),
    );

    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText(/Cannot reach the Python API/)).toBeInTheDocument());
  });
});
