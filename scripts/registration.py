"""Registration pool stats (players + prize pool before kickoff)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

ENTRY_FEE = 100
GOAL_USERS = 100
GOAL_PRIZE = 10_000
CLOSE_BEFORE_KICKOFF = timedelta(hours=1)

DEFAULT_REGISTRATION: dict[str, Any] = {
    "users": [],
    "entryFee": ENTRY_FEE,
    "goalUsers": GOAL_USERS,
    "goalPrize": GOAL_PRIZE,
    "closesAt": None,
}


def _parse_iso(value: object) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def first_kickoff_iso(matches: list[dict[str, Any]]) -> str | None:
    """Earliest kickoff among all matches."""
    kickoffs: list[datetime] = []
    for match in matches:
        dt = _parse_iso(match.get("kickoffAt"))
        if dt is not None:
            kickoffs.append(dt)
    if not kickoffs:
        return None
    return min(kickoffs).isoformat()


def registration_closes_at(matches: list[dict[str, Any]]) -> str | None:
    """Registration closes one hour before the first match kickoff."""
    first = _parse_iso(first_kickoff_iso(matches))
    if first is None:
        return None
    return (first - CLOSE_BEFORE_KICKOFF).isoformat()


def _clean_users(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    users: list[str] = []
    for item in raw:
        name = str(item).strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        users.append(name)
    return users


def normalize_registration(
    raw: object,
    matches: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a registration block with derived closesAt and counts."""
    base = dict(DEFAULT_REGISTRATION)
    if isinstance(raw, dict):
        base["users"] = _clean_users(raw.get("users"))
        for key in ("entryFee", "goalUsers", "goalPrize"):
            value = raw.get(key)
            if isinstance(value, (int, float)) and value > 0:
                base[key] = int(value)
        if raw.get("closesAt"):
            base["closesAt"] = str(raw["closesAt"])

    users = base["users"]
    entry_fee = int(base["entryFee"])
    goal_users = int(base["goalUsers"])
    goal_prize = int(base["goalPrize"])
    closes_at = base.get("closesAt")
    if matches and not closes_at:
        closes_at = registration_closes_at(matches)

    return {
        "users": users,
        "count": len(users),
        "entryFee": entry_fee,
        "goalUsers": goal_users,
        "goalPrize": goal_prize,
        "prizePool": len(users) * entry_fee,
        "closesAt": closes_at,
    }


def is_registration_open(
    registration: dict[str, Any],
    *,
    now: datetime | None = None,
) -> bool:
    """True while registration is still open (before closesAt)."""
    closes_at = _parse_iso(registration.get("closesAt"))
    if closes_at is None:
        return True
    current = now or datetime.now(timezone.utc)
    return current < closes_at
