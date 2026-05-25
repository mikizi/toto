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

from scripts.live_state import DEFAULT_BROADCAST, normalize_broadcast
from scripts.paths import DATA_DIR, LATEST_PATH, VERSION_PATH, VERSIONS_DIR, XLSX_PATH
from scripts.registration import normalize_registration

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
PICK_HOME_COL = 6
PICK_AWAY_COL = 7
MATCH_RESULT_POINTS = 3.0
EXACT_SCORE_POINTS = 2.0


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


def _cell_text(value: object) -> str | None:
    """Parse a cached spreadsheet cell as text, ignoring Excel error strings."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.startswith("#"):
        return None
    return text


def _read_champion(
    wb: openpyxl.Workbook,
    ws: openpyxl.worksheet.worksheet.Worksheet,
    row: int,
) -> str | None:
    """Read champion pick from Summary E, falling back to user sheet CM47."""
    champion = _cell_text(ws[f"E{row}"].value)
    if champion:
        return champion

    uid = ws[f"C{row}"].value
    name = ws[f"D{row}"].value
    if not uid or not name:
        return None

    sheet_name = _user_sheet_name(uid, str(name))
    if sheet_name not in wb.sheetnames:
        return None

    return _cell_text(wb[sheet_name][CHAMPION_CELL].value)


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


def _is_test_user(name: str) -> bool:
    """Test sheets use names like test1, test54 — hide from public scoreboard."""
    return name.lower().startswith("test")


def _public_leaderboard(
    raw: list[dict[str, Any]], previous: dict[str, Any] | None
) -> list[dict[str, Any]]:
    """Pool-only leaderboard with ranks 1..n (excludes test users)."""
    pool = [entry for entry in raw if not _is_test_user(entry["name"])]
    pool.sort(key=lambda e: (-e["points"], e["name"].lower()))
    ranked: list[dict[str, Any]] = []
    for index, entry in enumerate(pool, start=1):
        ranked.append({**entry, "rank": index})
    return _movement(ranked, previous)


def _cell_number(value: object) -> float | None:
    """Parse a cached spreadsheet cell value, ignoring Excel error strings."""
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text or text.startswith("#"):
            return None
        try:
            return float(text)
        except ValueError:
            return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _cell_int(value: object) -> int | None:
    """Parse a cached spreadsheet cell as an integer rank."""
    number = _cell_number(value)
    if number is None:
        return None
    return int(round(number))


def _result_key(home: float, away: float) -> str:
    if home > away:
        return "I"
    if home < away:
        return "II"
    return "X"


def _score_prediction(
    actual_home: int,
    actual_away: int,
    pick_home: object,
    pick_away: object,
) -> float:
    home = _cell_number(pick_home)
    away = _cell_number(pick_away)
    if home is None or away is None:
        return 0.0

    points = 0.0
    if _result_key(home, away) == _result_key(actual_home, actual_away):
        points += MATCH_RESULT_POINTS
    if int(home) == actual_home and int(away) == actual_away:
        points += EXACT_SCORE_POINTS
    return points


def _score_from_user_sheet(
    wb: openpyxl.Workbook,
    ws_summary: openpyxl.worksheet.worksheet.Worksheet,
    row: int,
    matches: list[dict[str, Any]],
) -> float | None:
    """Compute group-stage points from user picks when cached formulas are missing."""
    uid = ws_summary[f"C{row}"].value
    name = ws_summary[f"D{row}"].value
    if not uid or not name:
        return None

    sheet_name = _user_sheet_name(uid, str(name))
    if sheet_name not in wb.sheetnames:
        return None

    ws_user = wb[sheet_name]
    pick_rows: dict[int, int] = {}
    for user_row in range(SCHEDULE_ROW_START, 200):
        match_id = ws_user.cell(user_row, SCHEDULE_MATCH_ID_COL).value
        try:
            pick_rows[int(match_id)] = user_row
        except (TypeError, ValueError):
            continue

    total = 0.0
    for match in matches:
        if not match["played"]:
            continue
        pick_row = pick_rows.get(int(match["id"]))
        if pick_row is None:
            continue
        total += _score_prediction(
            int(match["homeScore"]),
            int(match["awayScore"]),
            ws_user.cell(pick_row, PICK_HOME_COL).value,
            ws_user.cell(pick_row, PICK_AWAY_COL).value,
        )
    return round(total, 2)


def _read_user_points(
    wb_data: openpyxl.Workbook,
    wb_formulas: openpyxl.Workbook,
    ws_data: openpyxl.worksheet.worksheet.Worksheet,
    row: int,
    matches: list[dict[str, Any]] | None = None,
) -> float:
    """Read cached Summary points, falling back to Calc when Summary F is empty."""
    cached = _cell_number(ws_data[f"F{row}"].value)
    if cached is not None:
        return round(cached, 2)

    formula = wb_formulas[SUMMARY][f"F{row}"].value
    if isinstance(formula, str) and formula.upper().startswith("=CALC!"):
        calc_ref = formula.split("!", 1)[1].strip()
        calc_val = _cell_number(wb_data["Calc"][calc_ref].value)
        if calc_val is not None:
            return round(calc_val, 2)
    if matches is not None:
        computed = _score_from_user_sheet(wb_formulas, ws_data, row, matches)
        if computed is not None:
            return computed
    return 0.0


def count_played_matches(xlsx_path: Path) -> int:
    """Count Summary rows with both home and away scores filled in."""
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb[SUMMARY]
    return sum(
        1
        for row in range(MATCH_ROW_START, MATCH_ROW_END)
        if _is_match_row(ws, row)
        and ws[f"L{row}"].value is not None
        and ws[f"M{row}"].value is not None
    )


def assert_recalc_cached(xlsx_path: Path, *, games_played: int) -> None:
    """Fail fast when LibreOffice did not cache formula results."""
    if games_played <= 0:
        return

    wb_data = openpyxl.load_workbook(xlsx_path, data_only=True)
    wb_formulas = openpyxl.load_workbook(xlsx_path, data_only=False)
    ws = wb_data[SUMMARY]
    missing: list[str] = []
    for row in range(USER_ROW_START, USER_ROW_END):
        name = ws[f"D{row}"].value
        if not name or name == "Name" or _is_test_user(str(name)):
            continue
        raw = ws[f"F{row}"].value
        if isinstance(raw, str) and raw.strip().startswith("#"):
            missing.append(str(name))
            continue
        if _cell_number(raw) is None and _read_user_points(
            wb_data, wb_formulas, ws, row
        ) == 0.0:
            missing.append(str(name))

    if missing:
        names = ", ".join(missing[:5])
        extra = f" (+{len(missing) - 5} more)" if len(missing) > 5 else ""
        raise RuntimeError(
            f"Leaderboard points not cached after recalc ({names}{extra}). "
            "LibreOffice did not refresh the workbook."
        )


def _read_leaderboard(
    wb_data: openpyxl.Workbook,
    ws_data: openpyxl.worksheet.worksheet.Worksheet,
    wb_formulas: openpyxl.Workbook,
    matches: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in range(USER_ROW_START, USER_ROW_END):
        name = ws_data[f"D{row}"].value
        if not name or name == "Name":
            continue
        points = _read_user_points(wb_data, wb_formulas, ws_data, row, matches)
        rank = _cell_int(ws_data[f"G{row}"].value)
        champion = _read_champion(wb_data, ws_data, row)
        rows.append(
            {
                "id": str(ws_data[f"C{row}"].value or ""),
                "name": str(name),
                "points": points,
                "rank": rank,
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
    wb_data = openpyxl.load_workbook(xlsx_path, data_only=True)
    wb_formulas = openpyxl.load_workbook(xlsx_path, data_only=False)
    ws = wb_data[SUMMARY]
    kickoffs = _read_match_kickoffs(wb_data)
    matches = _read_matches(ws, kickoffs)
    raw_leaderboard = _read_leaderboard(wb_data, ws, wb_formulas, matches)
    leaderboard = _public_leaderboard(raw_leaderboard, previous)
    version = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    played_count = sum(1 for m in matches if m["played"])
    broadcast = normalize_broadcast(
        previous.get("broadcast") if previous else DEFAULT_BROADCAST
    )
    played_ids = {m["id"] for m in matches if m["played"]}
    broadcast["openMatchIds"] = [
        mid for mid in broadcast["openMatchIds"] if mid not in played_ids
    ]
    previous_registration = (previous or {}).get("registration")
    if not isinstance(previous_registration, dict):
        previous_registration = {
            "users": [entry["name"] for entry in leaderboard if entry.get("name")]
        }
    registration = normalize_registration(previous_registration, matches)
    return {
        "version": version,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "gamesPlayed": played_count,
        "lastResult": _last_result(matches),
        "leaderboard": leaderboard,
        "matches": matches,
        "broadcast": broadcast,
        "registration": registration,
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
