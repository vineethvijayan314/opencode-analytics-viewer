import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def test_database_path_uses_windows_local_app_data(self):
        with (
            patch.dict(os.environ, {"LOCALAPPDATA": "C:/Users/test/AppData/Local"}, clear=True),
            patch.object(app.sys, "platform", "win32"),
        ):
            path = app.opencode_db_path()

        self.assertEqual(path, Path("C:/Users/test/AppData/Local/opencode/opencode.db"))

    def test_windows_scripts_use_equals_form_for_npm_prefix(self):
        root = Path(__file__).parent.parent
        for script in (root / "install.ps1", root / "run.ps1"):
            content = script.read_text()
            self.assertNotIn("npm --prefix ", content)
            self.assertIn("npm --prefix=", content)


if __name__ == "__main__":
    unittest.main()
