#!/usr/bin/env python3
"""Unit tests for export and validation (no LibreOffice required)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.export_summary import _cell_int, _cell_number, _cell_text, build_export, write_export
from scripts.patch_match import find_match_row, patch_match
from scripts.validate_export import validate

from scripts.paths import BACKUP_PATH, XLSX_PATH

REAL_USERS = {"MikiZiso3", "MikiZiso2", "Miki_Ziso", "Nir1", "Nir2", "Nir3"}


class TestCellParsing(unittest.TestCase):
    """Spreadsheet cached-value parsing."""

    def test_cell_number_ignores_excel_errors(self) -> None:
        self.assertIsNone(_cell_number("#N/A"))
        self.assertIsNone(_cell_number("#REF!"))
        self.assertEqual(_cell_number("5"), 5.0)
        self.assertEqual(_cell_number(3), 3.0)

    def test_cell_int_ignores_excel_errors(self) -> None:
        self.assertIsNone(_cell_int("#N/A"))
        self.assertEqual(_cell_int(2.0), 2)

    def test_cell_text_ignores_excel_errors(self) -> None:
        self.assertIsNone(_cell_text("#N/A"))
        self.assertIsNone(_cell_text("#REF!"))
        self.assertEqual(_cell_text("France"), "France")


class TestExportFromXlsx(unittest.TestCase):
    """Read existing xlsx and check export shape."""

    @classmethod
    def setUpClass(cls) -> None:
        if not XLSX_PATH.exists():
            raise unittest.SkipTest("xlsx/Master WorldCup26.xlsx not found")

    def test_build_export_has_leaderboard_and_matches(self) -> None:
        payload = build_export(XLSX_PATH)
        self.assertGreaterEqual(len(payload["leaderboard"]), 6)
        self.assertGreater(len(payload["matches"]), 0)
        self.assertIn("version", payload)
        self.assertIn("gamesPlayed", payload)

    def test_leaderboard_entries_have_required_fields(self) -> None:
        payload = build_export(XLSX_PATH)
        entry = payload["leaderboard"][0]
        for key in ("id", "name", "points", "rank", "movement"):
            self.assertIn(key, entry)

    def test_real_users_have_champion_pick_at_day_zero(self) -> None:
        payload = build_export(XLSX_PATH)
        by_name = {e["name"]: e for e in payload["leaderboard"]}
        for name in REAL_USERS:
            self.assertIn(name, by_name)
            self.assertIsNotNone(by_name[name]["champion"], msg=f"{name} missing champion")

    def test_leaderboard_excludes_test_users(self) -> None:
        payload = build_export(XLSX_PATH)
        names = [e["name"] for e in payload["leaderboard"]]
        self.assertFalse(any(n.lower().startswith("test") for n in names))
        self.assertLessEqual(len(payload["leaderboard"]), 10)

    def test_validate_latest_export(self) -> None:
        payload = build_export(XLSX_PATH)
        errors = validate(payload)
        self.assertEqual(errors, [], msg="; ".join(errors))

    def test_write_export_roundtrip(self) -> None:
        payload = build_export(XLSX_PATH)
        with tempfile.TemporaryDirectory() as tmp:
            latest = Path(tmp) / "latest.json"
            write_export(payload, latest_path=latest, version_path=Path(tmp) / "v.json")
            loaded = json.loads(latest.read_text(encoding="utf-8"))
            self.assertEqual(len(loaded["leaderboard"]), len(payload["leaderboard"]))


class TestPatchMatch(unittest.TestCase):
    """Patch match on a temp copy."""

    @classmethod
    def setUpClass(cls) -> None:
        if not BACKUP_PATH.exists():
            raise unittest.SkipTest("simulation backup not found")

    def test_find_match_row_match_1(self) -> None:
        import openpyxl
        import shutil

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "test.xlsx"
            shutil.copy2(BACKUP_PATH, path)
            wb = openpyxl.load_workbook(path)
            row = find_match_row(wb["Summary"], 1)
            self.assertEqual(wb["Summary"][f"K{row}"].value, "Mexico-South Africa")

    def test_patch_writes_lm_cells(self) -> None:
        import openpyxl
        import shutil

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "test.xlsx"
            shutil.copy2(BACKUP_PATH, path)
            teams, home, away = patch_match(1, 2, 1, path)
            self.assertIn("Mexico", teams)
            self.assertEqual((home, away), (2, 1))
            wb = openpyxl.load_workbook(path, data_only=True)
            row = find_match_row(wb["Summary"], 1)
            self.assertEqual(wb["Summary"][f"L{row}"].value, 2)
            self.assertEqual(wb["Summary"][f"M{row}"].value, 1)

    def test_export_scores_from_picks_without_cached_formulas(self) -> None:
        import openpyxl
        import shutil

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "test.xlsx"
            shutil.copy2(BACKUP_PATH, path)
            patch_match(1, 1, 0, path)

            wb = openpyxl.load_workbook(path)
            ws = wb["Summary"]
            for row in range(79, 85):
                ws[f"E{row}"].value = "#N/A"
                ws[f"F{row}"].value = "#N/A"
                ws[f"G{row}"].value = "#N/A"
            wb.save(path)

            payload = build_export(path)
            by_name = {entry["name"]: entry for entry in payload["leaderboard"]}
            self.assertEqual(by_name["MikiZiso3"]["champion"], "France")
            self.assertEqual(by_name["MikiZiso3"]["points"], 5.0)
            self.assertEqual(by_name["Nir2"]["points"], 0.0)
            self.assertEqual(by_name["Nir3"]["points"], 3.0)


if __name__ == "__main__":
    unittest.main()
