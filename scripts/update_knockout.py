#!/usr/bin/env python3
"""Update knockout fixture/live state and confirmed XLSX qualifiers."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from scripts.export_summary import build_export, write_export
from scripts.knockout import (
    KNOCKOUT_ROUNDS,
    KNOCKOUT_SCHEDULE,
    NEXT_MATCH_SIDES,
    is_placeholder_fixture_team,
    normalize_knockout_state,
    qualifier_target_for_match,
    set_actual_qualifier,
    state_timestamp,
    sync_knockout_fixtures_from_espn,
    update_scoring_constants,
    validate_knockout_fixture_lock,
)
from scripts.libreoffice_recalc import recalc
from scripts.paths import LATEST_PATH, XLSX_PATH
from scripts.validate_export import validate


def _load_previous(latest_path: Path = LATEST_PATH) -> dict[str, Any]:
    if latest_path.exists():
        return json.loads(latest_path.read_text(encoding="utf-8"))
    return {}


def _find_match(knockout: dict[str, Any], match_id: int) -> dict[str, Any]:
    for match in knockout.get("matches", []):
        if int(match.get("id") or -1) == match_id:
            return match
    raise ValueError(f"Knockout match {match_id} not found")


def _propagate_winner(knockout: dict[str, Any], match: dict[str, Any], winner: str) -> None:
    next_id = match.get("nextMatchId")
    if not next_id:
        return
    side = NEXT_MATCH_SIDES.get(int(match["id"]))
    if side not in ("home", "away"):
        return
    next_match = _find_match(knockout, int(next_id))
    next_match[side] = winner
    next_match["isLocked"] = bool(
        next_match.get("home")
        and next_match.get("away")
        and not is_placeholder_fixture_team(next_match.get("home"))
        and not is_placeholder_fixture_team(next_match.get("away"))
    )


def _locked_round_of_32_matches(knockout: dict[str, Any]) -> list[dict[str, Any]]:
    schedule_ids = [int(item["id"]) for item in KNOCKOUT_SCHEDULE if item["roundId"] == "r32_match"]
    by_id = {
        int(match.get("id")): match
        for match in knockout.get("matches", [])
        if match.get("id") is not None
    }
    return [by_id[match_id] for match_id in schedule_ids if match_id in by_id]


def _apply_round_of_32_scoring(knockout: dict[str, Any], xlsx_path: Path) -> None:
    matches = _locked_round_of_32_matches(knockout)
    incomplete = [
        match
        for match in matches
        if not match.get("isLocked") or not match.get("home") or not match.get("away")
    ]
    if len(matches) != 16 or incomplete:
        raise ValueError("All 16 Round-of-32 fixtures must be locked before applying R32 points")
    index = 0
    for match in matches:
        set_actual_qualifier(str(match["home"]), "r32", index, xlsx_path)
        set_actual_qualifier(str(match["away"]), "r32", index + 1, xlsx_path)
        index += 2
    scoring_applied = knockout.get("scoringApplied")
    if not isinstance(scoring_applied, dict):
        scoring_applied = {}
    scoring_applied["r32"] = True
    knockout["scoringApplied"] = scoring_applied


def _normalize_eliminated_payload(value: Any) -> dict[str, list[str]]:
    valid_rounds = {str(round_def["id"]) for round_def in KNOCKOUT_ROUNDS}
    if value is None:
        return {}
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {}
        value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("eliminated must be a round-to-teams object")
    normalized: dict[str, list[str]] = {}
    for round_id, teams in value.items():
        round_key = str(round_id)
        if round_key not in valid_rounds:
            raise ValueError(f"Unknown knockout round for eliminated teams: {round_key}")
        if not isinstance(teams, list):
            raise ValueError(f"Eliminated teams for {round_key} must be a list")
        seen: set[str] = set()
        clean: list[str] = []
        for raw_team in teams:
            team = str(raw_team or "").strip()
            if not team or team in seen:
                continue
            seen.add(team)
            clean.append(team)
        if clean:
            normalized[round_key] = clean
    return normalized


def _group_stage_teams(payload: dict[str, Any]) -> set[str]:
    teams: set[str] = set()
    for match in payload.get("matches") or []:
        if not isinstance(match, dict):
            continue
        try:
            match_id = int(match.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if match_id > 72:
            continue
        for side in ("home", "away"):
            team = str(match.get(side) or "").strip()
            if team and not is_placeholder_fixture_team(team):
                teams.add(team)
    return teams


def _filter_eliminated_to_group_stage_teams(
    eliminated: dict[str, list[str]],
    valid_teams: set[str],
) -> dict[str, list[str]]:
    if not valid_teams:
        return eliminated
    return {
        round_id: [team for team in teams if team in valid_teams]
        for round_id, teams in eliminated.items()
        if [team for team in teams if team in valid_teams]
    }


def _write_payload(payload: dict[str, Any], *, xlsx_path: Path = XLSX_PATH) -> dict[str, Any]:
    recalc(xlsx_path, require_cached=False)
    rebuilt = build_export(xlsx_path, payload)
    errors = validate(rebuilt)
    if errors:
        raise RuntimeError(f"Export validation failed: {errors}")
    write_export(rebuilt)
    return rebuilt


def update_knockout(
    action: str,
    *,
    match_id: int | None = None,
    home: str | None = None,
    away: str | None = None,
    home_score: int | None = None,
    away_score: int | None = None,
    winner: str | None = None,
    eliminated: Any = None,
    xlsx_path: Path = XLSX_PATH,
) -> dict[str, Any]:
    previous = _load_previous()
    knockout = normalize_knockout_state(previous.get("knockout"))
    previous["knockout"] = knockout
    knockout["lastUpdatedAt"] = state_timestamp()

    if action == "migrate_scoring":
        update_scoring_constants(xlsx_path)
        return _write_payload(previous, xlsx_path=xlsx_path)

    if action == "apply_r32_scoring":
        _apply_round_of_32_scoring(knockout, xlsx_path)
        return _write_payload(previous, xlsx_path=xlsx_path)

    if action == "sync_fixtures":
        knockout["apiSync"] = sync_knockout_fixtures_from_espn(knockout)
        return _write_payload(previous, xlsx_path=xlsx_path)

    if action == "set_eliminated":
        knockout["eliminated"] = _filter_eliminated_to_group_stage_teams(
            _normalize_eliminated_payload(eliminated),
            _group_stage_teams(previous),
        )
        return _write_payload(previous, xlsx_path=xlsx_path)

    if match_id is None:
        raise ValueError("match_id is required")
    match = _find_match(knockout, match_id)

    if action == "lock_fixture":
        if not home or not away:
            raise ValueError("home and away are required to lock a fixture")
        validate_knockout_fixture_lock(match, home, away)
        match["home"] = home.strip()
        match["away"] = away.strip()
        match["isLocked"] = True
        return _write_payload(previous, xlsx_path=xlsx_path)

    if action == "live_score":
        if home_score is None:
            home_score = int(match.get("homeScore")) if match.get("homeScore") is not None else 0
        if away_score is None:
            away_score = int(match.get("awayScore")) if match.get("awayScore") is not None else 0
        match["homeScore"] = int(home_score)
        match["awayScore"] = int(away_score)
        match["isLive"] = True
        if home:
            match["home"] = home.strip()
        if away:
            match["away"] = away.strip()
        if match.get("home") and match.get("away"):
            match["isLocked"] = bool(match.get("isLocked"))
        return _write_payload(previous, xlsx_path=xlsx_path)

    if action == "stop_live":
        match["isLive"] = False
        return _write_payload(previous, xlsx_path=xlsx_path)

    if action == "confirm_winner":
        if not winner:
            raise ValueError("winner is required")
        winner = winner.strip()
        if winner not in {match.get("home"), match.get("away")}:
            raise ValueError("winner must be one of the locked fixture teams")
        if home_score is not None:
            match["homeScore"] = int(home_score)
        if away_score is not None:
            match["awayScore"] = int(away_score)
        match["winner"] = winner
        match["isLive"] = False
        target = qualifier_target_for_match(match_id)
        if target is not None:
            round_id, index = target
            set_actual_qualifier(winner, round_id, index, xlsx_path)
        _propagate_winner(knockout, match, winner)
        return _write_payload(previous, xlsx_path=xlsx_path)

    raise ValueError(f"Unknown knockout action: {action}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Update knockout state")
    parser.add_argument("action", choices=["migrate_scoring", "apply_r32_scoring", "sync_fixtures", "set_eliminated", "lock_fixture", "live_score", "stop_live", "confirm_winner"])
    parser.add_argument("--match-id", type=int)
    parser.add_argument("--home")
    parser.add_argument("--away")
    parser.add_argument("--home-score", type=int)
    parser.add_argument("--away-score", type=int)
    parser.add_argument("--winner")
    parser.add_argument("--eliminated-json")
    parser.add_argument("--xlsx", type=Path, default=XLSX_PATH)
    args = parser.parse_args()
    payload = update_knockout(
        args.action,
        match_id=args.match_id,
        home=args.home,
        away=args.away,
        home_score=args.home_score,
        away_score=args.away_score,
        winner=args.winner,
        eliminated=args.eliminated_json,
        xlsx_path=args.xlsx,
    )
    print(f"Updated knockout ({args.action}) · version {payload['version']}")


if __name__ == "__main__":
    main()
