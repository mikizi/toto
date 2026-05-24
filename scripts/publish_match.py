#!/usr/bin/env python3
"""Patch a match result, recalc xlsx, export JSON, and validate."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scripts.export_summary import build_export, export, write_export
from scripts.libreoffice_recalc import recalc
from scripts.patch_match import patch_match
from scripts.paths import LATEST_PATH, XLSX_PATH
from scripts.validate_export import validate


def publish_match(
    match_id: int,
    home_score: int,
    away_score: int,
    xlsx_path: Path = XLSX_PATH,
    *,
    write: bool = True,
) -> dict:
    """Apply result to xlsx and export public/data/latest.json."""
    teams, home, away = patch_match(match_id, home_score, away_score, xlsx_path)
    recalc(xlsx_path)
    if write:
        payload = export(xlsx_path)
    else:
        previous = None
        if LATEST_PATH.exists():
            previous = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
        payload = build_export(xlsx_path, previous)
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish match result to xlsx + latest.json")
    parser.add_argument("match_id", type=int, help="Match number (Summary column J)")
    parser.add_argument("home_score", type=int, help="Home team score")
    parser.add_argument("away_score", type=int, help="Away team score")
    parser.add_argument(
        "--xlsx",
        type=Path,
        default=XLSX_PATH,
        help="Path to Master WorldCup26.xlsx",
    )
    args = parser.parse_args()
    try:
        result = publish_match(
            args.match_id,
            args.home_score,
            args.away_score,
            args.xlsx,
        )
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 1
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
