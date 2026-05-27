"""Parse ESPN World Cup scoreboard and match events to internal match ids."""

from __future__ import annotations

import json
import re
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from scripts.live_state import parse_iso

ESPN_SCOREBOARD_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
)
USER_AGENT = "wc26-toto/1.0 (github.com/mikizi/toto)"

# Sheet label -> ESPN-style canonical key (lowercase ASCII)
TEAM_ALIASES: dict[str, str] = {
    "bosnia and herzegovina": "bosnia-herzegovina",
    "bosnia-herzegovina": "bosnia-herzegovina",
    "korea republic": "south korea",
    "south korea": "south korea",
    "czech republic": "czechia",
    "czechia": "czechia",
    "turkey": "turkey",
    "turkiye": "turkey",
    "türkiye": "turkey",
    "curaçao": "curacao",
    "curacao": "curacao",
    "dr congo": "congo dr",
    "congo dr": "congo dr",
    "ivory coast": "ivory coast",
    "united states": "united states",
    "usa": "united states",
}


@dataclass(frozen=True)
class EspnMatch:
    """One fixture from ESPN scoreboard."""

    espn_event_id: str
    home: str
    away: str
    home_score: int
    away_score: int
    state: str
    kickoff_at: str | None


@dataclass(frozen=True)
class ScoreUpdate:
    """Pending publish for an internal match id."""

    match_id: int
    home_score: int
    away_score: int
    close_live: bool
    espn_event_id: str
    espn_state: str


def normalize_team_name(name: str) -> str:
    """Lowercase ASCII key for matching sheet names to ESPN."""
    text = name.strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"\s+", " ", text).strip()
    return TEAM_ALIASES.get(text, text)


def espn_dates_param(
    moment: datetime | None = None,
    sheet_matches: list[dict[str, Any]] | None = None,
) -> str:
    """
    ESPN `dates` query (YYYYMMDD or YYYYMMDD-YYYYMMDD).

    Prefer the kickoff span from the sheet so June matches are included before
  the tournament starts; fall back to yesterday–day after tomorrow (UTC).
    """
    kickoffs: list[datetime] = []
    for match in sheet_matches or []:
        kickoff = parse_iso(match.get("kickoffAt"))
        if kickoff is not None:
            kickoffs.append(kickoff)

    if kickoffs:
        start = (min(kickoffs) - timedelta(days=1)).strftime("%Y%m%d")
        end = (max(kickoffs) + timedelta(days=1)).strftime("%Y%m%d")
        return f"{start}-{end}"

    now = moment or datetime.now(timezone.utc)
    start = (now - timedelta(days=1)).strftime("%Y%m%d")
    end = (now + timedelta(days=2)).strftime("%Y%m%d")
    return f"{start}-{end}"


def fetch_scoreboard(
    *,
    dates: str | None = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    """GET FIFA World Cup scoreboard JSON from ESPN."""
    url = ESPN_SCOREBOARD_URL
    if dates:
        url = f"{url}?dates={dates}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"ESPN scoreboard request failed: {exc}") from exc


def parse_espn_events(payload: dict[str, Any]) -> list[EspnMatch]:
    """Extract matches from ESPN scoreboard payload."""
    events: list[EspnMatch] = []
    for raw in payload.get("events") or []:
        if not isinstance(raw, dict):
            continue
        parsed = _parse_single_event(raw)
        if parsed is not None:
            events.append(parsed)
    return events


def _parse_single_event(event: dict[str, Any]) -> EspnMatch | None:
    competitions = event.get("competitions")
    if not isinstance(competitions, list) or not competitions:
        return None
    competition = competitions[0]
    if not isinstance(competition, dict):
        return None

    home_name = away_name = None
    home_score = away_score = 0
    for competitor in competition.get("competitors") or []:
        if not isinstance(competitor, dict):
            continue
        team = competitor.get("team")
        display = ""
        if isinstance(team, dict):
            display = str(team.get("displayName") or team.get("shortDisplayName") or "")
        side = competitor.get("homeAway")
        score = _parse_score(competitor.get("score"))
        if side == "home":
            home_name = display
            home_score = score
        elif side == "away":
            away_name = display
            away_score = score

    if not home_name or not away_name:
        return None

    status = event.get("status")
    state = ""
    if isinstance(status, dict):
        status_type = status.get("type")
        if isinstance(status_type, dict):
            state = str(status_type.get("state") or "").lower()

    event_id = str(event.get("id") or "")
    kickoff = event.get("date")
    kickoff_at = str(kickoff) if kickoff else None
    return EspnMatch(
        espn_event_id=event_id,
        home=home_name,
        away=away_name,
        home_score=home_score,
        away_score=away_score,
        state=state,
        kickoff_at=kickoff_at,
    )


def _parse_score(value: object) -> int:
    if value is None:
        return 0
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def match_espn_to_sheet_id(
    espn: EspnMatch,
    sheet_matches: list[dict[str, Any]],
    *,
    kickoff_tolerance_seconds: int = 900,
) -> int | None:
    """Map an ESPN event to internal match id (Summary column J)."""
    target_home = normalize_team_name(espn.home)
    target_away = normalize_team_name(espn.away)
    espn_kickoff = parse_iso(espn.kickoff_at)

    candidates: list[dict[str, Any]] = []
    for match in sheet_matches:
        if normalize_team_name(str(match.get("home") or "")) != target_home:
            continue
        if normalize_team_name(str(match.get("away") or "")) != target_away:
            continue
        candidates.append(match)

    if not candidates:
        return None
    if len(candidates) == 1:
        return int(candidates[0]["id"])

    if espn_kickoff is None:
        return None
    for match in candidates:
        sheet_kickoff = parse_iso(match.get("kickoffAt"))
        if sheet_kickoff is None:
            continue
        delta = abs((espn_kickoff - sheet_kickoff).total_seconds())
        if delta <= kickoff_tolerance_seconds:
            return int(match["id"])
    return None


def _is_placeholder_fixture(home: str, away: str) -> bool:
    """Knockout TBD rows on ESPN (e.g. Group A 2nd Place) are not in our sheet."""
    text = f"{home} {away}".lower()
    markers = ("group ", " winner", "2nd place", "third place")
    return any(marker in text for marker in markers)


def plan_score_updates(
    sheet_matches: list[dict[str, Any]],
    espn_events: list[EspnMatch],
    *,
    open_match_ids: set[int] | None = None,
) -> list[ScoreUpdate]:
    """Decide which sheet matches should be published from ESPN data."""
    open_ids = open_match_ids or set()
    by_id = {int(m["id"]): m for m in sheet_matches if "id" in m}
    updates: list[ScoreUpdate] = []

    for espn in espn_events:
        if _is_placeholder_fixture(espn.home, espn.away):
            continue
        if espn.state not in ("in", "post"):
            continue

        match_id = match_espn_to_sheet_id(espn, sheet_matches)
        if match_id is None:
            continue

        sheet = by_id.get(match_id)
        if sheet is None:
            continue

        home_score = espn.home_score
        away_score = espn.away_score
        close_live = espn.state == "post"
        played = bool(sheet.get("played"))
        current_home = sheet.get("homeScore")
        current_away = sheet.get("awayScore")

        scores_unchanged = (
            played
            and current_home is not None
            and current_away is not None
            and int(current_home) == home_score
            and int(current_away) == away_score
        )

        if scores_unchanged and not close_live:
            continue
        if scores_unchanged and close_live and match_id not in open_ids:
            continue

        updates.append(
            ScoreUpdate(
                match_id=match_id,
                home_score=home_score,
                away_score=away_score,
                close_live=close_live,
                espn_event_id=espn.espn_event_id,
                espn_state=espn.state,
            )
        )

    return updates
