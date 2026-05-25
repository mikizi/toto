#!/usr/bin/env python3
"""Update registered players list in public/data/latest.json."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from scripts.paths import LATEST_PATH, VERSION_PATH, VERSIONS_DIR
from scripts.registration import normalize_registration
from scripts.version import bump_payload_version


def apply_registration_update(
    payload: dict[str, Any],
    users: list[str],
) -> dict[str, Any]:
    """Return payload with updated registration section."""
    matches = payload.get("matches") if isinstance(payload.get("matches"), list) else []
    current = payload.get("registration") if isinstance(payload.get("registration"), dict) else {}
    merged = {**current, "users": users}
    payload["registration"] = normalize_registration(merged, matches)
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


def update_registration(
    users: list[str],
    *,
    latest_path: Path = LATEST_PATH,
) -> dict[str, Any]:
    """Load latest.json, update registration users, and write back."""
    if not latest_path.exists():
        raise FileNotFoundError(f"Missing {latest_path}")
    payload = json.loads(latest_path.read_text(encoding="utf-8"))
    payload = apply_registration_update(payload, users)
    bump_payload_version(payload)
    write_latest(payload, latest_path)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Update registration users in latest.json")
    parser.add_argument(
        "--users-file",
        type=Path,
        help="Text file with one player name per line",
    )
    parser.add_argument(
        "--users",
        nargs="*",
        help="Player names as CLI arguments",
    )
    parser.add_argument(
        "--path",
        type=Path,
        default=LATEST_PATH,
        help="Path to latest.json",
    )
    args = parser.parse_args()

    users: list[str] = list(args.users or [])
    if args.users_file:
        users.extend(args.users_file.read_text(encoding="utf-8").splitlines())

    try:
        payload = update_registration(users, latest_path=args.path)
    except FileNotFoundError as exc:
        print(exc, file=__import__("sys").stderr)
        return 1

    reg = payload["registration"]
    print(
        f"Registration updated: {reg['count']} player(s), "
        f"{reg['prizePool']:,}₪ prize pool (closes {reg.get('closesAt') or '—'})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
