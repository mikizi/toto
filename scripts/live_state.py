"""Live match and scoreboard visibility (mirrors public/js/live.js)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


DEFAULT_BROADCAST: dict[str, Any] = {
    "mode": "auto",
    "openMatchIds": [],
    "suppressAuto": False,
    "autoPilot": True,
}

MAX_HERO_MATCHES = 2


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


def normalize_broadcast(raw: object | None) -> dict[str, Any]:
    """Return a safe broadcast control object."""
    if not isinstance(raw, dict):
        return dict(DEFAULT_BROADCAST)
    open_ids: list[int] = []
    for value in raw.get("openMatchIds") or []:
        try:
            open_ids.append(int(value))
        except (TypeError, ValueError):
            continue
    mode = raw.get("mode")
    if mode not in ("auto", "manual"):
        mode = "auto"
    if "autoPilot" in raw:
        auto_pilot = bool(raw.get("autoPilot"))
    else:
        auto_pilot = not bool(raw.get("suppressAuto"))
    return {
        "mode": mode,
        "openMatchIds": open_ids[:MAX_HERO_MATCHES],
        "suppressAuto": not auto_pilot,
        "autoPilot": auto_pilot,
    }


def is_autopilot_enabled(data: dict[str, Any]) -> bool:
    """Whether automatic kickoff 0-0 and future API score updates are allowed."""
    return bool(normalize_broadcast(data.get("broadcast")).get("autoPilot"))


def _matches_by_id(data: dict[str, Any]) -> dict[int, dict[str, Any]]:
    result: dict[int, dict[str, Any]] = {}
    for match in data.get("matches") or []:
        try:
            result[int(match["id"])] = match
        except (KeyError, TypeError, ValueError):
            continue
    return result


def previous_matches_all_played(matches: list[dict[str, Any]], match_id: int) -> bool:
    """True when every earlier match in schedule order has been closed (played)."""
    for match in matches:
        try:
            mid = int(match["id"])
        except (KeyError, TypeError, ValueError):
            continue
        if mid >= match_id:
            continue
        if not match.get("played"):
            return False
    return True


def kickoff_reached(match: dict[str, Any], moment: datetime) -> bool:
    """True when wall-clock time is at or past the match kickoff."""
    kickoff = parse_iso(match.get("kickoffAt"))
    if kickoff is None:
        return False
    return kickoff <= moment


def match_qualifies_for_auto_live(
    match: dict[str, Any],
    matches: list[dict[str, Any]],
    moment: datetime,
) -> bool:
    """Auto-live: kickoff passed, match open, and all prior matches are closed."""
    if match.get("played"):
        return False
    if not kickoff_reached(match, moment):
        return False
    try:
        match_id = int(match["id"])
    except (KeyError, TypeError, ValueError):
        return False
    return previous_matches_all_played(matches, match_id)


def auto_live_match_ids(
    data: dict[str, Any],
    *,
    now: datetime | None = None,
) -> list[int]:
    """Match ids that should be live under automatic kickoff rules."""
    broadcast = normalize_broadcast(data.get("broadcast"))
    if not broadcast["autoPilot"]:
        return []
    moment = now or datetime.now(timezone.utc)
    matches = data.get("matches") or []
    ids: list[int] = []
    for match in matches:
        if not match_qualifies_for_auto_live(match, matches, moment):
            continue
        try:
            ids.append(int(match["id"]))
        except (KeyError, TypeError, ValueError):
            continue
        if len(ids) >= MAX_HERO_MATCHES:
            break
    return ids


def matches_needing_auto_kickoff_start(
    data: dict[str, Any],
    *,
    now: datetime | None = None,
) -> list[int]:
    """Unplayed matches at kickoff that should get 0-0 written to the xlsx."""
    return auto_live_match_ids(data, now=now)


def manual_live_match_ids(data: dict[str, Any]) -> list[int]:
    """Admin-opened matches (up to two for split hero)."""
    broadcast = normalize_broadcast(data.get("broadcast"))
    by_id = _matches_by_id(data)
    ids: list[int] = []
    for match_id in broadcast["openMatchIds"]:
        if match_id not in by_id:
            continue
        ids.append(match_id)
        if len(ids) >= MAX_HERO_MATCHES:
            break
    return ids


def hero_live_match_ids(
    data: dict[str, Any],
    *,
    now: datetime | None = None,
) -> list[int]:
    """Ids shown in the hero with the live pill (manual overrides auto)."""
    manual = manual_live_match_ids(data)
    if manual:
        return manual
    return auto_live_match_ids(data, now=now)


def hero_live_matches(
    data: dict[str, Any],
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Match rows for the hero live strip."""
    by_id = _matches_by_id(data)
    return [by_id[mid] for mid in hero_live_match_ids(data, now=now) if mid in by_id]


def is_match_in_progress(
    data: dict[str, Any],
    *,
    debug: bool = False,
    now: datetime | None = None,
) -> bool:
    """True when at least one match should show the live indicator."""
    if debug:
        return False
    return len(hero_live_match_ids(data, now=now)) > 0


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

    broadcast = normalize_broadcast(data.get("broadcast"))
    if broadcast["openMatchIds"]:
        return True

    moment = now or datetime.now(timezone.utc)
    matches = data.get("matches") or []
    nxt = next_unplayed_match(matches)
    if not nxt:
        return False
    if not kickoff_reached(nxt, moment):
        return False
    try:
        match_id = int(nxt["id"])
    except (KeyError, TypeError, ValueError):
        return False
    if not previous_matches_all_played(matches, match_id):
        return False
    if not broadcast["autoPilot"] and int(data.get("gamesPlayed") or 0) == 0:
        return False
    return True
