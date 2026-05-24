#!/usr/bin/env python3
"""Reset tournament actual scores to zero played games (pre-tournament state)."""

from __future__ import annotations

import shutil
from pathlib import Path

import openpyxl

from scripts.paths import BACKUP_PATH, XLSX_PATH

SUMMARY = "Summary"
KNOCKOUT_HEADERS = {"Quarterfinals", "Semi", "Final", "Winner", "Round of 16", "Round of 32"}
MATCH_ROW_START = 4
MATCH_ROW_END = 120


def _is_match_row_summary(ws: openpyxl.worksheet.worksheet.Worksheet, row: int) -> bool:
    teams = ws[f"K{row}"].value
    match_id = ws[f"J{row}"].value
    return match_id is not None and teams is not None and "-" in str(teams)


def _clear_summary(ws: openpyxl.worksheet.worksheet.Worksheet) -> int:
    cleared = 0
    for row in range(MATCH_ROW_START, MATCH_ROW_END):
        if _is_match_row_summary(ws, row):
            ws[f"L{row}"].value = None
            ws[f"M{row}"].value = None
            cleared += 1

        p_val = ws[f"P{row}"].value
        if p_val is not None and str(p_val).strip() not in KNOCKOUT_HEADERS:
            ws[f"P{row}"].value = None

        r_val = ws[f"R{row}"].value
        if r_val is not None and str(r_val).strip() not in KNOCKOUT_HEADERS:
            ws[f"R{row}"].value = None

    return cleared


def reset_scores(xlsx_path: Path = XLSX_PATH, backup: bool = True) -> None:
    """Clear actual results only (Summary L/M and knockout P/R). Keeps predictions."""
    if backup:
        shutil.copy2(xlsx_path, BACKUP_PATH)
        print(f"Backup saved → {BACKUP_PATH}")

    wb = openpyxl.load_workbook(xlsx_path)
    summary_cleared = _clear_summary(wb[SUMMARY])
    wb.save(xlsx_path)
    print(f"Cleared {summary_cleared} Summary match scores (L/M)")
    print("Predictions on user sheets were NOT touched (F/G are picks, not results).")
    print("Run: python scripts/libreoffice_recalc.py && python scripts/export_summary.py")


def main() -> None:
    reset_scores()


if __name__ == "__main__":
    main()
