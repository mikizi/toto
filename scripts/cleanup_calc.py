#!/usr/bin/env python3
"""Normalize Calc formulas for reliable reset/recalc behavior."""

from __future__ import annotations

import argparse
from pathlib import Path

import openpyxl

from scripts.libreoffice_recalc import recalc
from scripts.paths import XLSX_PATH

SUMMARY = "Summary"
CALC = "Calc"
USER_ROW_START = 79
USER_ROW_END = 149
CALC_SCORE_ROW_START = 238
CALC_MATCH_ROW_START = 21
CALC_MATCH_ROW_END = 93
SUMMARY_MATCH_ROW_START = 4
HLOOKUP_SCORE = "=HLOOKUP($A{row},$3:$8,6,0)"


def _user_sheet_name(uid: object, name: str) -> str:
    """Build expected user sheet name from Summary id + display name."""
    uid_text = str(uid).strip().zfill(3)
    return f"{uid_text}_{name}"


def cleanup_calc(wb: openpyxl.Workbook) -> tuple[int, int]:
    """
    Reset Calc formulas that can keep stale or Numbers-specific scores.

    Real users (with a user sheet) get the HLOOKUP score formula.
    Test-only rows (no sheet) get 0 so stale hardcoded points disappear.
    Actual score references preserve blanks so Numbers does not score blank games as 0-0.

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

    for calc_row in range(CALC_MATCH_ROW_START, CALC_MATCH_ROW_END):
        summary_row = SUMMARY_MATCH_ROW_START + (calc_row - CALC_MATCH_ROW_START)
        calc[f"C{calc_row}"] = f'=IF(Summary!L{summary_row}="","",Summary!L{summary_row})'
        calc[f"D{calc_row}"] = f'=IF(Summary!M{summary_row}="","",Summary!M{summary_row})'

    return sheet_users, test_rows


def cleanup_calc_file(
    xlsx_path: Path = XLSX_PATH,
    recalc_after: bool = True,
) -> tuple[int, int]:
    """Load xlsx, clean Calc F column, save, and optionally recalculate."""
    xlsx_path = xlsx_path.resolve()
    wb = openpyxl.load_workbook(xlsx_path)
    counts = cleanup_calc(wb)
    wb.save(xlsx_path)
    if recalc_after:
        recalc(xlsx_path)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean Calc score column in Master WorldCup26.xlsx")
    parser.add_argument(
        "--xlsx",
        type=Path,
        default=XLSX_PATH,
        help="Path to Master WorldCup26.xlsx",
    )
    parser.add_argument(
        "--no-recalc",
        action="store_true",
        help="Skip LibreOffice recalc (not recommended for Numbers/Excel)",
    )
    args = parser.parse_args()
    sheet_users, test_rows = cleanup_calc_file(args.xlsx, recalc_after=not args.no_recalc)
    print(f"Calc cleanup → {args.xlsx}")
    print(f"  {sheet_users} user-sheet rows: HLOOKUP score formula")
    print(f"  {test_rows} test rows: score set to 0")
    if args.no_recalc:
        print("Run: python scripts/libreoffice_recalc.py && python scripts/export_summary.py")
    else:
        print(f"Recalculated → {args.xlsx}")


if __name__ == "__main__":
    main()
