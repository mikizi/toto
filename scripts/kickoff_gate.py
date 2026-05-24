"""Scoreboard visibility rules (mirrors public/js/app.js)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def parse_iso(value: str | None) -> datetime | None:
    """Parse ISO-8601 kickoff string to UTC datetime."""
    if not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def next_unplayed_match(matches: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the first unplayed match in schedule order."""
    for match in matches:
        if not match.get("played"):
            return match
    return None


def is_scoreboard_live(
    data: dict[str, Any],
    *,
    debug: bool = False,
    now: datetime | None = None,
) -> bool:
    """True when the public scoreboard should replace the coming-soon view."""
    if debug:
        return True
    if int(data.get("gamesPlayed") or 0) > 0:
        return True
    nxt = next_unplayed_match(data.get("matches") or [])
    if not nxt:
        return False
    kickoff = parse_iso(nxt.get("kickoffAt"))
    if kickoff is None:
        return False
    moment = now or datetime.now(timezone.utc)
    return kickoff <= moment
