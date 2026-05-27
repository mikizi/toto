#!/usr/bin/env python3
"""Patch a match result, recalc xlsx, export JSON, and validate."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scripts.export_summary import (
    build_export,
    write_export,
)
from scripts.libreoffice_recalc import recalc
from scripts.patch_match import clear_match_score, patch_match
from scripts.paths import LATEST_PATH, XLSX_PATH
from scripts.validate_export import validate


def _restore_open_match_ids_from_previous(payload: dict, previous: dict) -> None:
    """Keep live list from before publish (export already does; reinforce for races)."""
    prev_broadcast = previous.get("broadcast")
    if not isinstance(prev_broadcast, dict):
        return
    prev_open = prev_broadcast.get("openMatchIds")
    if not isinstance(prev_open, list):
        return
    broadcast = payload.get("broadcast")
    if not isinstance(broadcast, dict):
        return
    restored: list[int] = []
    for value in prev_open:
        try:
            match_id = int(value)
        except (TypeError, ValueError):
            continue
        if match_id > 0 and match_id not in restored:
            restored.append(match_id)
    broadcast["openMatchIds"] = restored[:2]


def close_live_match(payload: dict, match_id: int) -> None:
    """Remove a finalized match from the live broadcast list."""
    broadcast = payload.get("broadcast")
    if not isinstance(broadcast, dict):
        return
    open_ids = broadcast.get("openMatchIds")
    if not isinstance(open_ids, list):
        return
    kept_ids = []
    for mid in open_ids:
        try:
            if int(mid) != match_id:
                kept_ids.append(mid)
        except (TypeError, ValueError):
            continue
    broadcast["openMatchIds"] = kept_ids


def publish_match(
    match_id: int,
    home_score: int,
    away_score: int,
    xlsx_path: Path = XLSX_PATH,
    *,
    write: bool = True,
    close_live: bool = False,
) -> dict:
    """Apply result to xlsx and export public/data/latest.json.

    Score publish does not stop the live hero by default; use Stop in admin
    (clear_manual) or pass close_live=True to drop this match from openMatchIds.
    """
    teams, home, away = patch_match(match_id, home_score, away_score, xlsx_path)
    recalc(xlsx_path, require_cached=False)
    previous = None
    if LATEST_PATH.exists():
        previous = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
    payload = build_export(xlsx_path, previous)
    if close_live:
        close_live_match(payload, match_id)
    elif previous:
        _restore_open_match_ids_from_previous(payload, previous)
    if write:
        write_export(payload)
    errors = validate(payload)
    if errors:
        raise RuntimeError(f"Export validation failed: {errors}")
    return {
        "matchId": match_id,
        "teams": teams,
        "score": f"{home}-{away}",
        "gamesPlayed": payload["gamesPlayed"],
        "version": payload["version"],
        "leaderboard": payload["leaderboard"],
    }


def restore_match(
    match_id: int,
    xlsx_path: Path = XLSX_PATH,
    *,
    write: bool = True,
) -> dict:
    """Clear a match score from xlsx and export public/data/latest.json."""
    teams = clear_match_score(match_id, xlsx_path)
    recalc(xlsx_path, require_cached=False)
    previous = None
    if LATEST_PATH.exists():
        previous = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
    payload = build_export(xlsx_path, previous)
    close_live_match(payload, match_id)
    if write:
        write_export(payload)
    errors = validate(payload)
    if errors:
        raise RuntimeError(f"Export validation failed: {errors}")
    return {
        "matchId": match_id,
        "teams": teams,
        "gamesPlayed": payload["gamesPlayed"],
        "version": payload["version"],
        "leaderboard": payload["leaderboard"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish match result to xlsx + latest.json")
    parser.add_argument("match_id", type=int, help="Match number (Summary column J)")
    parser.add_argument("home_score", type=int, nargs="?", help="Home team score")
    parser.add_argument("away_score", type=int, nargs="?", help="Away team score")
    parser.add_argument(
        "--xlsx",
        type=Path,
        default=XLSX_PATH,
        help="Path to Master WorldCup26.xlsx",
    )
    parser.add_argument(
        "--restore",
        action="store_true",
        help="Clear the match score instead of publishing a score",
    )
    parser.add_argument(
        "--close-live",
        action="store_true",
        help="Remove this match from broadcast openMatchIds after publish",
    )
    args = parser.parse_args()
    try:
        if args.restore:
            result = restore_match(args.match_id, args.xlsx)
        else:
            if args.home_score is None or args.away_score is None:
                raise ValueError("home_score and away_score are required unless --restore is used")
            result = publish_match(
                args.match_id,
                args.home_score,
                args.away_score,
                args.xlsx,
                close_live=args.close_live,
            )
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 1
    if args.restore:
        print(
            f"Restored match {result['matchId']}: {result['teams']} "
            f"({result['gamesPlayed']} games, version {result['version']})"
        )
    else:
        print(
            f"Published match {result['matchId']}: {result['teams']} → {result['score']} "
            f"({result['gamesPlayed']} games, version {result['version']})"
        )
    top = sorted(result["leaderboard"], key=lambda e: e.get("rank") or 999)[:3]
    for entry in top:
        print(f"  #{entry.get('rank')} {entry['name']}: {entry['points']:.0f} pts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
