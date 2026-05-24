#!/usr/bin/env python3
"""Fix Calc sheet score column (F) — test users had stale values and rank formulas."""

from __future__ import annotations

import argparse
from pathlib import Path

import openpyxl

from scripts.paths import XLSX_PATH

SUMMARY = "Summary"
CALC = "Calc"
USER_ROW_START = 79
USER_ROW_END = 149
CALC_SCORE_ROW_START = 238
HLOOKUP_SCORE = "=HLOOKUP($A{row},$3:$8,6,0)"


def _user_sheet_name(uid: object, name: str) -> str:
    """Build expected user sheet name from Summary id + display name."""
    uid_text = str(uid).strip().zfill(3)
    return f"{uid_text}_{name}"


def cleanup_calc(wb: openpyxl.Workbook) -> tuple[int, int]:
    """
    Reset Calc column F for every Summary player row.

    Real users (with a user sheet) get the HLOOKUP score formula.
    Test-only rows (no sheet) get 0 so stale hardcoded points disappear.

    Returns (sheet_users_fixed, test_rows_zeroed).
    """
    summary = wb[SUMMARY]
    calc = wb[CALC]
    sheet_users = 0
    test_rows = 0

    for row in range(USER_ROW_START, USER_ROW_END):
        name = summary[f"D{row}"].value
        uid = summary[f"C{row}"].value
        if not name or name == "Name":
            continue

        calc_row = row - USER_ROW_START + CALC_SCORE_ROW_START
        sheet_name = _user_sheet_name(uid, str(name))

        if sheet_name in wb.sheetnames:
            calc[f"F{calc_row}"] = HLOOKUP_SCORE.format(row=calc_row)
            sheet_users += 1
        else:
            calc[f"F{calc_row}"] = 0
            test_rows += 1

    return sheet_users, test_rows


def cleanup_calc_file(xlsx_path: Path = XLSX_PATH) -> tuple[int, int]:
    """Load xlsx, clean Calc F column, save."""
    xlsx_path = xlsx_path.resolve()
    wb = openpyxl.load_workbook(xlsx_path)
    counts = cleanup_calc(wb)
    wb.save(xlsx_path)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean Calc score column in Master WorldCup26.xlsx")
    parser.add_argument(
        "--xlsx",
        type=Path,
        default=XLSX_PATH,
        help="Path to Master WorldCup26.xlsx",
    )
    args = parser.parse_args()
    sheet_users, test_rows = cleanup_calc_file(args.xlsx)
    print(f"Calc cleanup → {args.xlsx}")
    print(f"  {sheet_users} user-sheet rows: HLOOKUP score formula")
    print(f"  {test_rows} test rows: score set to 0")
    print("Run: python scripts/libreoffice_recalc.py && python scripts/export_summary.py")


if __name__ == "__main__":
    main()
