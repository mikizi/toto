#!/usr/bin/env python3
"""At kickoff, write 0-0 to the xlsx for matches that qualify for auto live."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scripts.export_summary import build_export, write_export
from scripts.live_state import MAX_HERO_MATCHES, matches_needing_auto_kickoff_start
from scripts.paths import LATEST_PATH, XLSX_PATH
from scripts.publish_match import publish_match
from scripts.update_broadcast import apply_broadcast_update
from scripts.validate_export import validate


def _merge_open_match_ids(existing: list[int], new_ids: list[int]) -> list[int]:
    """Combine manual and auto-started ids, preserving order, max two."""
    merged: list[int] = []
    seen: set[int] = set()
    for match_id in [*existing, *new_ids]:
        if match_id in seen:
            continue
        seen.add(match_id)
        merged.append(match_id)
        if len(merged) >= MAX_HERO_MATCHES:
            break
    return merged


def auto_start_kickoff_matches(
    *,
    now: datetime | None = None,
    xlsx_path: Path = XLSX_PATH,
    latest_path: Path = LATEST_PATH,
    dry_run: bool = False,
) -> dict[str, Any]:
    """
    For each match past kickoff with no score yet, publish 0-0 and open live broadcast.

    Respects broadcast.suppressAuto (admin can block automatic starts).
    """
    if not latest_path.exists():
        return {"started": [], "reason": "missing latest.json"}

    data = json.loads(latest_path.read_text(encoding="utf-8"))
    to_start = matches_needing_auto_kickoff_start(data, now=now)
    if not to_start:
        return {"started": []}

    if dry_run:
        return {"started": to_start, "dryRun": True}

    for match_id in to_start:
        publish_match(match_id, 0, 0, xlsx_path, close_live=False, write=False)

    previous = json.loads(latest_path.read_text(encoding="utf-8"))
    payload = build_export(xlsx_path, previous)
    broadcast = payload.get("broadcast")
    existing_open: list[int] = []
    if isinstance(broadcast, dict):
        for value in broadcast.get("openMatchIds") or []:
            try:
                existing_open.append(int(value))
            except (TypeError, ValueError):
                continue

    merged_open = _merge_open_match_ids(existing_open, to_start)
    payload = apply_broadcast_update(
        payload,
        open_match_ids=merged_open,
        suppress_auto=False,
        mode="auto",
    )
    write_export(payload, latest_path)
    errors = validate(payload)
    if errors:
        raise RuntimeError(f"Export validation failed: {errors}")

    return {
        "started": to_start,
        "openMatchIds": merged_open,
        "version": payload["version"],
        "gamesPlayed": payload["gamesPlayed"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Write 0-0 to xlsx for matches that reached kickoff (auto live)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List match ids that would start without writing",
    )
    parser.add_argument("--xlsx", type=Path, default=XLSX_PATH)
    parser.add_argument("--latest", type=Path, default=LATEST_PATH)
    args = parser.parse_args()
    try:
        result = auto_start_kickoff_matches(
            xlsx_path=args.xlsx,
            latest_path=args.latest,
            dry_run=args.dry_run,
        )
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 1

    started = result.get("started") or []
    if not started:
        print("No matches need auto kickoff start")
        return 0

    if result.get("dryRun"):
        print(f"Would auto-start: {started}")
        return 0

    print(
        f"Auto-started {started} with 0-0 "
        f"(open={result.get('openMatchIds')}, version {result.get('version')})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
