#!/usr/bin/env python3
"""Export Summary sheet from recalculated xlsx to data/latest.json."""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import openpyxl

from scripts.paths import DATA_DIR, LATEST_PATH, VERSION_PATH, VERSIONS_DIR, XLSX_PATH

DEFAULT_XLSX = XLSX_PATH

SUMMARY = "Summary"
USER_ROW_START = 79
USER_ROW_END = 200
MATCH_ROW_START = 4
MATCH_ROW_END = 120
CHAMPION_CELL = "CM47"
SCHEDULE_ROW_START = 7
SCHEDULE_MATCH_ID_COL = 1
SCHEDULE_KICKOFF_COL = 18


def _kickoff_to_iso(value: object) -> str | None:
    """Convert Excel kickoff cell to UTC ISO-8601 string."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)):
        from datetime import timedelta

        base = datetime(1899, 12, 30)
        days = int(value)
        frac = value - days
        dt = base + timedelta(days=days, seconds=round(frac * 86400))
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _read_match_kickoffs(wb: openpyxl.Workbook) -> dict[int, str]:
    """Read kickoff times from the first user sheet schedule (col A + col R)."""
    kickoffs: dict[int, str] = {}
    schedule_sheet = next((name for name in wb.sheetnames if name.startswith("001_")), None)
    if not schedule_sheet:
        return kickoffs

    ws = wb[schedule_sheet]
    for row in range(SCHEDULE_ROW_START, 200):
        match_id = ws.cell(row, SCHEDULE_MATCH_ID_COL).value
        kickoff = ws.cell(row, SCHEDULE_KICKOFF_COL).value
        if match_id is None or kickoff is None:
            continue
        try:
            mid = int(match_id)
        except (TypeError, ValueError):
            continue
        iso = _kickoff_to_iso(kickoff)
        if iso:
            kickoffs[mid] = iso
    return kickoffs


def _user_sheet_name(uid: object, name: str) -> str:
    """Build user sheet name from Summary id + display name."""
    uid_text = str(uid).strip().zfill(3)
    return f"{uid_text}_{name}"


def _read_champion(
    wb: openpyxl.Workbook,
    ws: openpyxl.worksheet.worksheet.Worksheet,
    row: int,
) -> str | None:
    """Read champion pick from Summary E, falling back to user sheet CM47."""
    champion = ws[f"E{row}"].value
    if champion:
        return str(champion)

    uid = ws[f"C{row}"].value
    name = ws[f"D{row}"].value
    if not uid or not name:
        return None

    sheet_name = _user_sheet_name(uid, str(name))
    if sheet_name not in wb.sheetnames:
        return None

    pick = wb[sheet_name][CHAMPION_CELL].value
    return str(pick) if pick else None


def _split_teams(teams: str) -> tuple[str, str]:
    home, away = teams.split("-", 1)
    return home.strip(), away.strip()


def _is_match_row(ws: openpyxl.worksheet.worksheet.Worksheet, row: int) -> bool:
    match_id = ws[f"J{row}"].value
    teams = ws[f"K{row}"].value
    return match_id is not None and teams is not None and "-" in str(teams)


def _read_matches(
    ws: openpyxl.worksheet.worksheet.Worksheet,
    kickoffs: dict[int, str] | None = None,
) -> list[dict[str, Any]]:
    kickoffs = kickoffs or {}
    matches: list[dict[str, Any]] = []
    for row in range(MATCH_ROW_START, MATCH_ROW_END):
        if not _is_match_row(ws, row):
            continue
        teams = str(ws[f"K{row}"].value)
        home, away = _split_teams(teams)
        home_score = ws[f"L{row}"].value
        away_score = ws[f"M{row}"].value
        played = home_score is not None and away_score is not None
        match_id = int(ws[f"J{row}"].value)
        matches.append(
            {
                "id": match_id,
                "teams": teams,
                "home": home,
                "away": away,
                "homeScore": int(home_score) if played else None,
                "awayScore": int(away_score) if played else None,
                "played": played,
                "kickoffAt": kickoffs.get(match_id),
            }
        )
    return matches


def _read_leaderboard(
    wb: openpyxl.Workbook, ws: openpyxl.worksheet.worksheet.Worksheet
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in range(USER_ROW_START, USER_ROW_END):
        name = ws[f"D{row}"].value
        if not name or name == "Name":
            continue
        points = ws[f"F{row}"].value
        rank = ws[f"G{row}"].value
        champion = _read_champion(wb, ws, row)
        rows.append(
            {
                "id": str(ws[f"C{row}"].value or ""),
                "name": str(name),
                "points": round(float(points), 2) if points is not None else 0.0,
                "rank": int(rank) if rank is not None else None,
                "champion": champion,
            }
        )
    return rows


def _movement(
    current: list[dict[str, Any]], previous: dict[str, Any] | None
) -> list[dict[str, Any]]:
    prev_ranks: dict[str, int | None] = {}
    if previous:
        for entry in previous.get("leaderboard", []):
            prev_ranks[str(entry.get("name"))] = entry.get("rank")

    result: list[dict[str, Any]] = []
    for entry in current:
        name = entry["name"]
        rank = entry.get("rank")
        prev = prev_ranks.get(name)
        if prev is None or rank is None:
            move = "same"
        elif rank < prev:
            move = "up"
        elif rank > prev:
            move = "down"
        else:
            move = "same"
        result.append({**entry, "movement": move})
    return result


def _last_result(matches: list[dict[str, Any]]) -> dict[str, Any] | None:
    played = [m for m in matches if m["played"]]
    if not played:
        return None
    last = max(played, key=lambda m: m["id"])
    return {
        "matchId": last["id"],
        "teams": last["teams"],
        "home": last["home"],
        "away": last["away"],
        "homeScore": last["homeScore"],
        "awayScore": last["awayScore"],
    }


def build_export(xlsx_path: Path, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    """Read recalculated xlsx and build export payload."""
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb[SUMMARY]
    kickoffs = _read_match_kickoffs(wb)
    matches = _read_matches(ws, kickoffs)
    leaderboard = _movement(_read_leaderboard(wb, ws), previous)
    version = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    played_count = sum(1 for m in matches if m["played"])
    return {
        "version": version,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "gamesPlayed": played_count,
        "lastResult": _last_result(matches),
        "leaderboard": leaderboard,
        "matches": matches,
    }


def write_export(
    payload: dict[str, Any],
    latest_path: Path = LATEST_PATH,
    version_path: Path = VERSION_PATH,
    versions_dir: Path = VERSIONS_DIR,
) -> Path:
    """Write latest.json, version.json, and a version snapshot."""
    latest_path.parent.mkdir(parents=True, exist_ok=True)
    versions_dir.mkdir(parents=True, exist_ok=True)

    latest_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    version_path.write_text(
        json.dumps({"version": payload["version"]}, indent=2) + "\n",
        encoding="utf-8",
    )
    snapshot = versions_dir / f"{payload['version']}.json"
    shutil.copy2(latest_path, snapshot)
    return snapshot


def export(xlsx_path: Path = DEFAULT_XLSX) -> dict[str, Any]:
    """Export xlsx to data/latest.json with movement vs previous snapshot."""
    previous: dict[str, Any] | None = None
    if LATEST_PATH.exists():
        previous = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
    payload = build_export(xlsx_path, previous)
    snapshot = write_export(payload)
    print(f"Exported {len(payload['leaderboard'])} users, {payload['gamesPlayed']} games played")
    print(f"→ {LATEST_PATH}")
    print(f"→ {snapshot}")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Export xlsx Summary to data/latest.json")
    parser.add_argument(
        "--xlsx",
        type=Path,
        default=DEFAULT_XLSX,
        help="Path to Master WorldCup26.xlsx",
    )
    args = parser.parse_args()
    export(args.xlsx)


if __name__ == "__main__":
    main()
