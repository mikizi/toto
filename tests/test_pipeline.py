#!/usr/bin/env python3
"""Integration tests: reset → recalc → patch → recalc → export (needs LibreOffice)."""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

import openpyxl

from scripts.libreoffice_recalc import recalc
from scripts.paths import BACKUP_PATH
from scripts.score_simulation import (
    EXPECTED_MATCH_1,
    apply_match_result,
    read_real_user_points,
    run_score_simulation,
)

KNOCKOUT_HEADERS = {"Quarterfinals", "Semi", "Final", "Winner", "Round of 16", "Round of 32"}


def _soffice_available() -> bool:
    return shutil.which("soffice") is not None


def _reset_day_zero(path: Path) -> None:
    wb = openpyxl.load_workbook(path)
    ws = wb["Summary"]
    for row in range(4, 120):
        if ws[f"J{row}"].value and ws[f"K{row}"].value and "-" in str(ws[f"K{row}"].value):
            ws[f"L{row}"].value = None
            ws[f"M{row}"].value = None
        for col in "PR":
            val = ws[f"{col}{row}"].value
            if val is not None and str(val).strip() not in KNOCKOUT_HEADERS:
                ws[f"{col}{row}"].value = None
    wb.save(path)


def _predictions_intact(path: Path) -> bool:
    wb = openpyxl.load_workbook(path, data_only=True)
    u = wb["001_MikiZiso3"]
    return u["F7"].value == 1 and u["G7"].value == 0


class TestPipelineIntegration(unittest.TestCase):
    """End-to-end pipeline on a temp copy of the backup xlsx."""

    @classmethod
    def setUpClass(cls) -> None:
        if not BACKUP_PATH.exists():
            raise unittest.SkipTest("xlsx/Master WorldCup26.simulation-backup.xlsx not found")
        if not _soffice_available():
            raise unittest.SkipTest("soffice (LibreOffice) not installed")

    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.work = Path(self._tmpdir.name) / "pipeline.xlsx"
        shutil.copy2(BACKUP_PATH, self.work)

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_day_zero_real_users_all_zero(self) -> None:
        _reset_day_zero(self.work)
        self.assertTrue(_predictions_intact(self.work))
        recalc(self.work)
        pts = read_real_user_points(self.work)
        self.assertEqual(len(pts), 6)
        for name, score in pts.items():
            self.assertEqual(score, 0.0, msg=f"{name} should be 0 at day zero")

    def test_patch_match_1_updates_scoreboard(self) -> None:
        _reset_day_zero(self.work)
        recalc(self.work)
        before = read_real_user_points(self.work)

        after = apply_match_result(self.work, 1, 1, 0)

        self.assertEqual(before["MikiZiso3"], 0.0)
        self.assertAlmostEqual(after["MikiZiso3"], 5.0, places=2)
        self.assertEqual(after["Nir2"], 0.0)
        self.assertAlmostEqual(after["Nir3"], 3.0, places=2)

    def test_patch_match_1_south_africa_win(self) -> None:
        _reset_day_zero(self.work)
        recalc(self.work)
        after = apply_match_result(self.work, 1, 0, 1)
        expected = EXPECTED_MATCH_1[(0, 1)]
        for name, want in expected.items():
            self.assertAlmostEqual(after[name], want, places=2, msg=name)

    def test_score_change_overwrites_previous_result(self) -> None:
        _reset_day_zero(self.work)
        recalc(self.work)
        apply_match_result(self.work, 1, 1, 0)
        after_sa = apply_match_result(self.work, 1, 0, 1)
        self.assertAlmostEqual(after_sa["Nir2"], 5.0, places=2)
        self.assertAlmostEqual(after_sa["MikiZiso3"], 0.0, places=2)

    def test_full_score_simulation(self) -> None:
        results = run_score_simulation()
        self.assertTrue(all(step.passed for step in results), msg=results)

    def test_export_after_patch_passes_validation(self) -> None:
        from scripts.export_summary import build_export
        from scripts.validate_export import validate

        _reset_day_zero(self.work)
        apply_match_result(self.work, 1, 1, 0)
        payload = build_export(self.work)
        errors = validate(payload)
        self.assertEqual(errors, [])
        self.assertEqual(payload["gamesPlayed"], 1)
        self.assertIsNotNone(payload["lastResult"])
        self.assertEqual(payload["lastResult"]["matchId"], 1)


if __name__ == "__main__":
    unittest.main()
