#!/usr/bin/env python3
"""Sync live/final scores from ESPN into xlsx + latest.json when autopilot is on."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scripts.espn_scores import (
    espn_dates_param,
    fetch_scoreboard,
    parse_espn_events,
    plan_score_updates,
)
from scripts.export_summary import build_export, write_export
from scripts.live_state import is_autopilot_enabled, normalize_broadcast
from scripts.paths import LATEST_PATH, XLSX_PATH
from scripts.publish_match import close_live_match, publish_match
from scripts.validate_export import validate


def sync_scores_espn(
    *,
    xlsx_path: Path = XLSX_PATH,
    latest_path: Path = LATEST_PATH,
    dry_run: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Fetch ESPN World Cup scoreboard and publish changed scores."""
    if not latest_path.exists():
        return {"updated": [], "reason": "missing latest.json"}

    data = json.loads(latest_path.read_text(encoding="utf-8"))
    if not is_autopilot_enabled(data):
        return {"updated": [], "reason": "autopilot off"}

    sheet_matches = data.get("matches") or []
    if not isinstance(sheet_matches, list):
        sheet_matches = []

    dates = espn_dates_param(now, sheet_matches)
    payload = fetch_scoreboard(dates=dates)
    espn_events = parse_espn_events(payload)

    broadcast = normalize_broadcast(data.get("broadcast"))
    open_ids = {int(value) for value in broadcast["openMatchIds"]}
    updates = plan_score_updates(sheet_matches, espn_events, open_match_ids=open_ids)

    if not updates:
        return {"updated": [], "espnEvents": len(espn_events), "dates": dates}

    if dry_run:
        return {
            "updated": [
                {
                    "matchId": item.match_id,
                    "score": f"{item.home_score}-{item.away_score}",
                    "closeLive": item.close_live,
                    "espnState": item.espn_state,
                }
                for item in updates
            ],
            "dryRun": True,
            "dates": dates,
        }

    for item in updates:
        publish_match(
            item.match_id,
            item.home_score,
            item.away_score,
            xlsx_path,
            close_live=False,
            write=False,
        )

    previous = json.loads(latest_path.read_text(encoding="utf-8"))
    export_payload = build_export(xlsx_path, previous)
    for item in updates:
        if item.close_live:
            close_live_match(export_payload, item.match_id)

    write_export(export_payload, latest_path)
    errors = validate(export_payload)
    if errors:
        raise RuntimeError(f"Export validation failed: {errors}")

    return {
        "updated": [
            {
                "matchId": item.match_id,
                "score": f"{item.home_score}-{item.away_score}",
                "closeLive": item.close_live,
                "espnState": item.espn_state,
            }
            for item in updates
        ],
        "version": export_payload["version"],
        "dates": dates,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync World Cup scores from ESPN when autopilot is enabled",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show planned updates without writing",
    )
    parser.add_argument("--xlsx", type=Path, default=XLSX_PATH)
    parser.add_argument("--latest", type=Path, default=LATEST_PATH)
    args = parser.parse_args()

    try:
        result = sync_scores_espn(
            xlsx_path=args.xlsx,
            latest_path=args.latest,
            dry_run=args.dry_run,
        )
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 1

    reason = result.get("reason")
    if reason:
        print(f"No sync: {reason}")
        return 0

    updated = result.get("updated") or []
    if not updated:
        print(
            f"No score changes (ESPN events: {result.get('espnEvents', '?')}, "
            f"dates={result.get('dates', '')})"
        )
        return 0

    if result.get("dryRun"):
        print(f"Would update {len(updated)} match(es): {updated}")
        return 0

    print(f"Updated {len(updated)} match(es): {updated}")
    print(f"version {result.get('version')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
