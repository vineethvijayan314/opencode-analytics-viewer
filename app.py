"""OpenCode analytics API.

Reads ~/.local/share/opencode/opencode.db (real schema: `message` table with
JSON `data` column; token counts live on assistant messages, prompt text lives
in the `part` table attached to the parent user message).

Run: uvicorn app:app --reload --port 8000
"""

import json
import shutil
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

DB_PATH = Path.home() / ".local" / "share" / "opencode" / "opencode.db"

# No cost calculation needed — opencode stores real cost per message in $.cost.
# Models on GitHub Copilot subscription that don't report cost store 0.

app = FastAPI(title="OpenCode Analytics API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MESSAGES_QUERY = """
SELECT
    m.time_created AS ts,
    json_extract(m.data, '$.parentID') AS parent_id,
    COALESCE(json_extract(m.data, '$.tokens.input'), 0)        AS input_tokens,
    COALESCE(json_extract(m.data, '$.tokens.output'), 0)       AS output_tokens,
    COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0)  AS cache_write_tokens,
    COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0)   AS cache_read_tokens,
    COALESCE(json_extract(m.data, '$.tokens.total'), 0)        AS total_tokens,
    COALESCE(json_extract(m.data, '$.cost'), 0)                AS cost,
    COALESCE(json_extract(m.data, '$.providerID'), '')         AS provider,
    COALESCE(json_extract(m.data, '$.modelID'), '')            AS model
FROM message m
WHERE json_extract(m.data, '$.role') = 'assistant'
ORDER BY m.time_created DESC
"""


@app.get("/api/metrics")
def get_metrics():
    if not DB_PATH.exists():
        raise HTTPException(status_code=500, detail=f"Database not found at {DB_PATH}")

    try:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(MESSAGES_QUERY).fetchall()

        # Collect parent IDs and fetch all prompts in one query
        parent_ids = [r["parent_id"] for r in rows if r["parent_id"]]
        prompts: dict[str, str] = {}
        if parent_ids:
            placeholders = ",".join("?" * len(parent_ids))
            part_rows = conn.execute(
                f"""
                SELECT p.message_id, json_extract(p.data, '$.text') AS text
                FROM part p
                WHERE p.message_id IN ({placeholders})
                  AND json_extract(p.data, '$.type') = 'text'
                ORDER BY p.time_created ASC
                """,
                parent_ids,
            ).fetchall()
            # Keep only the first text part per parent message
            for pr in part_rows:
                if pr["message_id"] not in prompts:
                    prompts[pr["message_id"]] = (pr["text"] or "").strip()

        conn.close()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"SQLite error: {exc}") from exc

    entries = []
    for row in rows:
        ts_ms = row["ts"] or 0
        entries.append(
            {
                "timestamp": datetime.fromtimestamp(ts_ms / 1000).strftime(
                    "%Y-%m-%d %H:%M:%S"
                ),
                "date": datetime.fromtimestamp(ts_ms / 1000).strftime("%Y-%m-%d"),
                "prompt": prompts.get(row["parent_id"], ""),
                "provider": row["provider"] or "",
                "model": row["model"] or "",
                "input_tokens": int(row["input_tokens"] or 0),
                "output_tokens": int(row["output_tokens"] or 0),
                "cache_write_tokens": int(row["cache_write_tokens"] or 0),
                "cache_read_tokens": int(row["cache_read_tokens"] or 0),
                "total_tokens": int(row["total_tokens"] or 0),
                "cost": float(row["cost"] or 0),
            }
        )

    return {"count": len(entries), "entries": entries}


PROJECT_SPEND_QUERY = """
SELECT
    s.directory,
    ROUND(SUM(COALESCE(json_extract(m.data, '$.cost'), 0)), 6)         AS total_cost,
    SUM(COALESCE(json_extract(m.data, '$.tokens.input'), 0))           AS input_tokens,
    SUM(COALESCE(json_extract(m.data, '$.tokens.output'), 0))          AS output_tokens,
    SUM(COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0))     AS cache_write_tokens,
    SUM(COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0))      AS cache_read_tokens,
    SUM(COALESCE(json_extract(m.data, '$.tokens.total'), 0))           AS total_tokens,
    COUNT(*)                                                            AS query_count
FROM message m
JOIN session s ON m.session_id = s.id
WHERE json_extract(m.data, '$.role') = 'assistant'
GROUP BY s.directory
ORDER BY total_tokens DESC
"""


@app.get("/api/project-spend")
def get_project_spend():
    if not DB_PATH.exists():
        raise HTTPException(status_code=500, detail=f"Database not found at {DB_PATH}")

    try:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(PROJECT_SPEND_QUERY).fetchall()
        conn.close()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"SQLite error: {exc}") from exc

    projects = []
    for row in rows:
        directory = row["directory"] or ""
        name = directory.rstrip("/").split("/")[-1] if directory else "unknown"
        projects.append({
            "name": name,
            "directory": directory,
            "total_cost": float(row["total_cost"] or 0),
            "input_tokens": int(row["input_tokens"] or 0),
            "output_tokens": int(row["output_tokens"] or 0),
            "cache_write_tokens": int(row["cache_write_tokens"] or 0),
            "cache_read_tokens": int(row["cache_read_tokens"] or 0),
            "total_tokens": int(row["total_tokens"] or 0),
            "query_count": int(row["query_count"] or 0),
        })

    return {"count": len(projects), "projects": projects}


@app.get("/api/rtk-savings")
def get_rtk_savings():
    rtk_bin = shutil.which("rtk")
    if not rtk_bin:
        raise HTTPException(status_code=404, detail="rtk binary not found in PATH")
    try:
        result = subprocess.run(
            [rtk_bin, "gain", "--format", "json", "--all"],
            capture_output=True, text=True, timeout=15,
        )
        data = json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"rtk error: {exc}") from exc
    return data


@app.get("/api/graphify-stats")
def get_graphify_stats():
    graphify_bin = shutil.which("graphify")
    if not graphify_bin:
        raise HTTPException(status_code=404, detail="graphify binary not found in PATH")

    # Find all graph.json files under ~/work (bounded depth)
    home = Path.home()
    graph_files = list(home.glob("work/**/graphify-out/graph.json"))

    if not graph_files:
        return {"graphs": [], "total_graphs": 0}

    graphs = []
    for gf in graph_files:
        try:
            result = subprocess.run(
                [graphify_bin, "benchmark", str(gf)],
                capture_output=True, text=True, timeout=30,
            )
            lines = result.stdout.strip().splitlines()
            entry: dict = {"path": str(gf.parent.parent)}
            for line in lines:
                line = line.strip()
                if "Corpus:" in line:
                    # "306,850 words → ~409,133 tokens (naive)"
                    parts = line.split("~")
                    if len(parts) > 1:
                        tok_part = parts[1].split()[0].replace(",", "")
                        try:
                            entry["corpus_tokens"] = int(tok_part)
                        except ValueError:
                            pass
                elif "Graph:" in line:
                    # "6,137 nodes, 10,189 edges"
                    nums = [p.strip().replace(",", "") for p in line.split("nodes,")]
                    try:
                        entry["nodes"] = int(nums[0].split()[-1])
                        entry["edges"] = int(nums[1].split()[0])
                    except (IndexError, ValueError):
                        pass
                elif "Avg query cost:" in line:
                    tok = line.split("~")[1].split()[0].replace(",", "") if "~" in line else ""
                    try:
                        entry["avg_query_tokens"] = int(tok)
                    except ValueError:
                        pass
                elif "Reduction:" in line:
                    # "16.3x fewer tokens per query"
                    try:
                        entry["reduction_x"] = float(line.split("Reduction:")[1].strip().split("x")[0])
                    except (IndexError, ValueError):
                        pass
            graphs.append(entry)
        except subprocess.TimeoutExpired:
            continue

    return {"graphs": graphs, "total_graphs": len(graphs)}
