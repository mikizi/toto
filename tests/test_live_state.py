#!/usr/bin/env python3
"""Tests for live match and scoreboard visibility rules."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from scripts.live_state import (
    auto_live_match_ids,
    hero_live_match_ids,
    is_match_in_progress,
    is_scoreboard_live,
    manual_live_match_ids,
    match_qualifies_for_auto_live,
    previous_matches_all_played,
)


def _match(
    match_id: int,
    *,
    played: bool = False,
    kickoff_at: str | None = "2026-06-11T19:00:00+00:00",
) -> dict:
    return {
        "id": match_id,
        "played": played,
        "kickoffAt": kickoff_at,
        "home": "A",
        "away": "B",
    }


def _payload(
    matches: list[dict],
    *,
    games_played: int = 0,
    broadcast: dict | None = None,
) -> dict:
    data = {"gamesPlayed": games_played, "matches": matches}
    if broadcast is not None:
        data["broadcast"] = broadcast
    return data


class TestLiveState(unittest.TestCase):
    def test_previous_matches_all_played(self) -> None:
        matches = [_match(1, played=True), _match(2), _match(3)]
        self.assertTrue(previous_matches_all_played(matches, 2))
        self.assertFalse(previous_matches_all_played(matches, 3))

    def test_auto_live_requires_kickoff_and_prior_closed(self) -> None:
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        matches = [_match(1, kickoff_at=past), _match(2, kickoff_at=past)]
        self.assertTrue(match_qualifies_for_auto_live(matches[0], matches, datetime.now(timezone.utc)))
        self.assertFalse(match_qualifies_for_auto_live(matches[1], matches, datetime.now(timezone.utc)))

    def test_no_auto_live_before_kickoff(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        data = _payload([_match(1, kickoff_at=future)])
        self.assertEqual(auto_live_match_ids(data), [])
        self.assertFalse(is_match_in_progress(data))

    def test_scoreboard_hidden_before_kickoff(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        data = _payload([_match(1, kickoff_at=future)])
        self.assertFalse(is_scoreboard_live(data))

    def test_scoreboard_opens_after_kickoff_when_prior_closed(self) -> None:
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        data = _payload([_match(1, kickoff_at=past)])
        self.assertTrue(is_scoreboard_live(data))
        self.assertEqual(hero_live_match_ids(data), [1])

    def test_scoreboard_stays_after_first_publish(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        data = _payload([_match(1, played=True), _match(2, kickoff_at=future)], games_played=1)
        self.assertTrue(is_scoreboard_live(data))
        self.assertFalse(is_match_in_progress(data))

    def test_manual_open_overrides_suppress(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        data = _payload(
            [_match(1, kickoff_at=future)],
            broadcast={"openMatchIds": [1], "suppressAuto": True, "mode": "manual"},
        )
        self.assertTrue(is_scoreboard_live(data))
        self.assertEqual(manual_live_match_ids(data), [1])
        self.assertEqual(hero_live_match_ids(data), [1])

    def test_suppress_auto_blocks_first_kickoff(self) -> None:
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        data = _payload(
            [_match(1, kickoff_at=past)],
            broadcast={"openMatchIds": [], "suppressAuto": True, "mode": "auto"},
        )
        self.assertFalse(is_scoreboard_live(data))
        self.assertEqual(hero_live_match_ids(data), [])

    def test_dual_manual_open(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        data = _payload(
            [_match(1, kickoff_at=future), _match(2, kickoff_at=future)],
            broadcast={"openMatchIds": [1, 2], "suppressAuto": False, "mode": "manual"},
        )
        self.assertEqual(hero_live_match_ids(data), [1, 2])

    def test_manual_open_can_show_started_score_match(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        data = _payload(
            [_match(1, played=True, kickoff_at=future), _match(2, kickoff_at=future)],
            games_played=1,
            broadcast={"openMatchIds": [1, 2], "suppressAuto": False, "mode": "manual"},
        )
        self.assertEqual(hero_live_match_ids(data), [1, 2])


if __name__ == "__main__":
    unittest.main()
