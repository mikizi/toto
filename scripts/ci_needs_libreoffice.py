#!/usr/bin/env python3
"""Tell GitHub Actions whether a job needs LibreOffice (skip ~2 min apt install)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scripts.live_state import (
    is_autopilot_enabled,
    matches_needing_auto_kickoff_start,
)
from scripts.paths import LATEST_PATH


def _load_latest() -> dict:
    if not LATEST_PATH.exists():
        return {}
    return json.loads(LATEST_PATH.read_text(encoding="utf-8"))


def _matches_by_id(data: dict) -> dict[int, dict]:
    by_id: dict[int, dict] = {}
    for match in data.get("matches") or []:
        if not isinstance(match, dict):
            continue
        try:
            by_id[int(match["id"])] = match
        except (KeyError, TypeError, ValueError):
            continue
    return by_id


def broadcast_needs_libreoffice(action: str, open_ids: list[int]) -> bool:
    """True when a live match still needs 0-0 written to the xlsx."""
    normalized = action.strip().lower()
    if normalized in ("set_autopilot", "suppress_auto", "clear_manual", "resume_auto"):
        return False
    if normalized != "set" or not open_ids:
        return False
    data = _load_latest()
    broadcast = data.get("broadcast")
    if not isinstance(broadcast, dict):
        broadcast = {}
    current: set[int] = set()
    for value in broadcast.get("openMatchIds") or []:
        try:
            current.add(int(value))
        except (TypeError, ValueError):
            continue
    by_id = _matches_by_id(data)
    for match_id in open_ids:
        if match_id not in current:
            return True
        match = by_id.get(match_id)
        if match is not None and not match.get("played"):
            return True
    return False


def kickoff_schedule_needs_libreoffice() -> bool:
    """True when autopilot is on and at least one match should auto 0-0."""
    data = _load_latest()
    if not is_autopilot_enabled(data):
        return False
    return bool(matches_needing_auto_kickoff_start(data))


def espn_schedule_needs_libreoffice() -> bool:
    """True when autopilot is on (ESPN sync may patch xlsx)."""
    return is_autopilot_enabled(_load_latest())


def _print_bool(value: bool) -> None:
    print("true" if value else "false")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    broadcast = sub.add_parser("broadcast")
    broadcast.add_argument("--action", required=True)
    broadcast.add_argument("--open-json", default="")
    broadcast.add_argument("--open-ids", default="")

    sub.add_parser("publish", help="publish / restore always recalc xlsx")
    sub.add_parser("kickoff-schedule")
    sub.add_parser("espn-schedule")

    args = parser.parse_args()
    if args.command == "broadcast":
        open_ids: list[int] = []
        if args.open_json.strip():
            parsed = json.loads(args.open_json)
            if isinstance(parsed, list):
                open_ids = [int(value) for value in parsed]
        elif args.open_ids.strip():
            open_ids = [int(value) for value in args.open_ids.split(",") if value.strip()]
        _print_bool(broadcast_needs_libreoffice(args.action, open_ids))
    elif args.command == "publish":
        _print_bool(True)
    elif args.command == "kickoff-schedule":
        _print_bool(kickoff_schedule_needs_libreoffice())
    elif args.command == "espn-schedule":
        _print_bool(espn_schedule_needs_libreoffice())
    else:
        parser.error(f"unknown command: {args.command}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
