import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import app
from fastapi import HTTPException


class AppTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "opencode.db"
        self._create_database()
        self.db_patch = patch.object(app, "DB_PATH", self.db_path)
        self.db_patch.start()

    def tearDown(self):
        self.db_patch.stop()
        self.temp_dir.cleanup()

    def _create_database(self):
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);
            CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                time_created INTEGER,
                data TEXT
            );
            CREATE TABLE part (
                id TEXT PRIMARY KEY,
                message_id TEXT,
                time_created INTEGER,
                data TEXT
            );
            """
        )
        conn.execute("INSERT INTO session VALUES (?, ?)", ("session-1", "/work/demo"))
        conn.execute(
            "INSERT INTO message VALUES (?, ?, ?, ?)",
            (
                "user-1",
                "session-1",
                1_700_000_000_000,
                json.dumps({"role": "user"}),
            ),
        )
        conn.execute(
            "INSERT INTO message VALUES (?, ?, ?, ?)",
            (
                "assistant-1",
                "session-1",
                1_700_000_001_000,
                json.dumps(
                    {
                        "role": "assistant",
                        "parentID": "user-1",
                        "providerID": "github-copilot",
                        "modelID": "test-model",
                        "tokens": {
                            "input": 10,
                            "output": 5,
                            "cache": {"write": 2, "read": 3},
                            "total": 20,
                        },
                        "cost": 0.25,
                    }
                ),
            ),
        )
        conn.execute(
            "INSERT INTO part VALUES (?, ?, ?, ?)",
            (
                "part-1",
                "user-1",
                1_700_000_000_100,
                json.dumps({"type": "text", "text": "  Test prompt  "}),
            ),
        )
        conn.commit()
        conn.close()

    def test_metrics_reads_prompt_tokens_and_cost(self):
        result = app.get_metrics()

        self.assertEqual(result["count"], 1)
        entry = result["entries"][0]
        self.assertEqual(entry["prompt"], "Test prompt")
        self.assertEqual(entry["provider"], "github-copilot")
        self.assertEqual(entry["model"], "test-model")
        self.assertEqual(entry["input_tokens"], 10)
        self.assertEqual(entry["output_tokens"], 5)
        self.assertEqual(entry["cache_write_tokens"], 2)
        self.assertEqual(entry["cache_read_tokens"], 3)
        self.assertEqual(entry["total_tokens"], 20)
        self.assertEqual(entry["cost"], 0.25)

    def test_project_spend_aggregates_by_session_directory(self):
        result = app.get_project_spend()

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["projects"][0]["name"], "demo")
        self.assertEqual(result["projects"][0]["total_tokens"], 20)
        self.assertEqual(result["projects"][0]["total_cost"], 0.25)
        self.assertEqual(result["projects"][0]["query_count"], 1)

    def test_metrics_reports_missing_database(self):
        with patch.object(app, "DB_PATH", self.db_path.with_name("missing.db")):
            with self.assertRaises(HTTPException) as raised:
                app.get_metrics()

        self.assertEqual(raised.exception.status_code, 500)
        self.assertIn("Database not found", raised.exception.detail)

    def test_rtk_savings_returns_cli_report(self):
        report = {"summary": {"total_saved": 123}}
        completed = MagicMock(stdout=json.dumps(report))

        with (
            patch.object(app.shutil, "which", return_value="/usr/local/bin/rtk"),
            patch.object(app.subprocess, "run", return_value=completed) as run,
        ):
            result = app.get_rtk_savings()

        self.assertEqual(result, report)
        run.assert_called_once_with(
            ["/usr/local/bin/rtk", "gain", "--format", "json", "--all"],
            capture_output=True,
            text=True,
            timeout=15,
        )

    def test_rtk_savings_reports_missing_binary(self):
        with patch.object(app.shutil, "which", return_value=None):
            with self.assertRaises(HTTPException) as raised:
                app.get_rtk_savings()

        self.assertEqual(raised.exception.status_code, 404)

    def test_rtk_savings_reports_invalid_output(self):
        with (
            patch.object(app.shutil, "which", return_value="rtk"),
            patch.object(app.subprocess, "run", return_value=MagicMock(stdout="not json")),
        ):
            with self.assertRaises(HTTPException) as raised:
                app.get_rtk_savings()

        self.assertEqual(raised.exception.status_code, 500)
        self.assertIn("rtk error", raised.exception.detail)

    def test_graphify_stats_returns_empty_report_without_graphs(self):
        home = MagicMock()
        home.glob.return_value = []

        with (
            patch.object(app.shutil, "which", return_value="graphify"),
            patch.object(app.Path, "home", return_value=home),
        ):
            result = app.get_graphify_stats()

        self.assertEqual(result, {"graphs": [], "total_graphs": 0})

    def test_graphify_stats_parses_benchmark_report(self):
        graph_file = self.db_path.parent / "work" / "demo" / "graphify-out" / "graph.json"
        home = MagicMock()
        home.glob.return_value = [graph_file]
        output = """Corpus: 306,850 words → ~409,133 tokens (naive)
Graph: 6,137 nodes, 10,189 edges
Avg query cost: ~25,100 tokens
Reduction: 16.3x fewer tokens per query"""

        with (
            patch.object(app.shutil, "which", return_value="graphify"),
            patch.object(app.Path, "home", return_value=home),
            patch.object(app.subprocess, "run", return_value=MagicMock(stdout=output)),
        ):
            result = app.get_graphify_stats()

        self.assertEqual(result["total_graphs"], 1)
        self.assertEqual(
            result["graphs"][0],
            {
                "path": str(graph_file.parent.parent),
                "corpus_tokens": 409133,
                "nodes": 6137,
                "edges": 10189,
                "avg_query_tokens": 25100,
                "reduction_x": 16.3,
            },
        )

    def test_database_path_uses_windows_local_app_data(self):
        with (
            patch.dict(os.environ, {"LOCALAPPDATA": "C:/Users/test/AppData/Local"}, clear=True),
            patch.object(app.sys, "platform", "win32"),
        ):
            path = app.opencode_db_path()

        self.assertEqual(path, Path("C:/Users/test/AppData/Local/opencode/opencode.db"))

    def test_windows_scripts_run_npm_in_each_package_directory(self):
        root = Path(__file__).parent.parent
        install_script = (root / "install.ps1").read_text()
        self.assertIn("Push-Location frontend", install_script)
        self.assertIn("Push-Location opencode-analytics-plugin", install_script)
        self.assertNotIn("npm --prefix", install_script)

        run_script = (root / "run.ps1").read_text()
        self.assertIn("Push-Location frontend", run_script)
        self.assertIn("npm run dev", run_script)

        workflow = (root / ".github" / "workflows" / "windows.yml").read_text()
        self.assertIn("--types node,bun", workflow)


if __name__ == "__main__":
    unittest.main()
