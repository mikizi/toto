#!/usr/bin/env python3
"""Patch broadcast controls in public/data/latest.json (admin live open/close)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from scripts.live_state import DEFAULT_BROADCAST, normalize_broadcast
from scripts.paths import LATEST_PATH, VERSION_PATH, VERSIONS_DIR
from scripts.version import bump_payload_version


def apply_broadcast_update(
    payload: dict[str, Any],
    *,
    open_match_ids: list[int] | None = None,
    suppress_auto: bool | None = None,
    auto_pilot: bool | None = None,
    mode: str | None = None,
    clear_manual: bool = False,
) -> dict[str, Any]:
    """Return payload with updated broadcast section."""
    broadcast = normalize_broadcast(payload.get("broadcast"))
    if clear_manual:
        broadcast["openMatchIds"] = []
    if open_match_ids is not None:
        broadcast["openMatchIds"] = open_match_ids[:2]
    if auto_pilot is not None:
        broadcast["autoPilot"] = auto_pilot
        broadcast["suppressAuto"] = not auto_pilot
    elif suppress_auto is not None:
        broadcast["suppressAuto"] = suppress_auto
        broadcast["autoPilot"] = not suppress_auto
    if mode is not None and mode in ("auto", "manual"):
        broadcast["mode"] = mode
    payload["broadcast"] = broadcast
    return payload


def write_latest(payload: dict[str, Any], latest_path: Path = LATEST_PATH) -> None:
    """Write latest.json and version snapshot."""
    latest_path.parent.mkdir(parents=True, exist_ok=True)
    latest_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    VERSION_PATH.write_text(
        json.dumps({"version": payload["version"]}, indent=2) + "\n",
        encoding="utf-8",
    )
    VERSIONS_DIR.mkdir(parents=True, exist_ok=True)
    snapshot = VERSIONS_DIR / f"{payload['version']}.json"
    snapshot.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def update_broadcast(
    *,
    open_match_ids: list[int] | None = None,
    suppress_auto: bool | None = None,
    auto_pilot: bool | None = None,
    mode: str | None = None,
    clear_manual: bool = False,
    latest_path: Path = LATEST_PATH,
) -> dict[str, Any]:
    """Load latest.json, update broadcast controls, and write back."""
    if not latest_path.exists():
        raise FileNotFoundError(f"Missing {latest_path}")
    payload = json.loads(latest_path.read_text(encoding="utf-8"))
    payload = apply_broadcast_update(
        payload,
        open_match_ids=open_match_ids,
        suppress_auto=suppress_auto,
        auto_pilot=auto_pilot,
        mode=mode,
        clear_manual=clear_manual,
    )
    if "broadcast" not in payload:
        payload["broadcast"] = dict(DEFAULT_BROADCAST)
    bump_payload_version(payload)
    write_latest(payload, latest_path)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Update broadcast controls in latest.json")
    parser.add_argument(
        "--open",
        type=int,
        nargs="*",
        dest="open_match_ids",
        help="Match id(s) to show as live (max 2)",
    )
    parser.add_argument(
        "--suppress-auto",
        action="store_true",
        help="Block automatic live detection",
    )
    parser.add_argument(
        "--resume-auto",
        action="store_true",
        help="Clear manual open ids and re-enable auto live",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Clear manual open match ids only",
    )
    parser.add_argument(
        "--path",
        type=Path,
        default=LATEST_PATH,
        help="Path to latest.json",
    )
    args = parser.parse_args()

    suppress = True if args.suppress_auto else None
    open_ids = args.open_match_ids
    clear_manual = args.clear
    mode = None

    if args.resume_auto:
        open_ids = []
        suppress = False
        clear_manual = True
        mode = "auto"

    try:
        payload = update_broadcast(
            open_match_ids=open_ids,
            suppress_auto=suppress,
            mode=mode,
            clear_manual=clear_manual,
            latest_path=args.path,
        )
    except FileNotFoundError as exc:
        print(exc, file=__import__("sys").stderr)
        return 1

    broadcast = normalize_broadcast(payload.get("broadcast"))
    print(
        "Broadcast updated:",
        f"open={broadcast['openMatchIds']}",
        f"autoPilot={broadcast['autoPilot']}",
        f"mode={broadcast['mode']}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
