#!/usr/bin/env python3
"""Validate exported JSON before commit."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scripts.paths import LATEST_PATH
MIN_USERS = 1


def validate(payload: dict) -> list[str]:
    """Return list of validation errors (empty if ok)."""
    errors: list[str] = []
    leaderboard = payload.get("leaderboard")
    if not isinstance(leaderboard, list) or len(leaderboard) < MIN_USERS:
        errors.append(f"leaderboard must have at least {MIN_USERS} user(s)")

    matches = payload.get("matches")
    if not isinstance(matches, list) or len(matches) == 0:
        errors.append("matches must be a non-empty list")

    if not payload.get("version"):
        errors.append("version is required")

    games_played = int(payload.get("gamesPlayed") or 0)
    for entry in leaderboard or []:
        if entry.get("rank") is None and games_played > 0:
            errors.append(f"rank missing for {entry.get('name')} after games played")
            break

    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate data/latest.json")
    parser.add_argument(
        "--path",
        type=Path,
        default=LATEST_PATH,
        help="Path to latest.json",
    )
    args = parser.parse_args()
    payload = json.loads(args.path.read_text(encoding="utf-8"))
    errors = validate(payload)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(1)
    print(f"OK: {len(payload['leaderboard'])} users, {payload['gamesPlayed']} games played")


if __name__ == "__main__":
    main()
