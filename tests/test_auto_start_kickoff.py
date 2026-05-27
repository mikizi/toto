#!/usr/bin/env python3
"""Tests for automatic kickoff 0-0 starts."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from scripts.live_state import matches_needing_auto_kickoff_start


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
    broadcast: dict | None = None,
) -> dict:
    data: dict = {"gamesPlayed": 0, "matches": matches}
    if broadcast is not None:
        data["broadcast"] = broadcast
    return data


class TestAutoStartKickoff(unittest.TestCase):
    def test_needs_start_after_kickoff_unplayed(self) -> None:
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        data = _payload([_match(1, kickoff_at=past)])
        self.assertEqual(matches_needing_auto_kickoff_start(data), [1])

    def test_skips_before_kickoff(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        data = _payload([_match(1, kickoff_at=future)])
        self.assertEqual(matches_needing_auto_kickoff_start(data), [])

    def test_skips_when_autopilot_off(self) -> None:
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        data = _payload(
            [_match(1, kickoff_at=past)],
            broadcast={"openMatchIds": [], "autoPilot": False, "mode": "auto"},
        )
        self.assertEqual(matches_needing_auto_kickoff_start(data), [])

    def test_skips_already_played(self) -> None:
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        data = _payload([_match(1, played=True, kickoff_at=past)],)
        self.assertEqual(matches_needing_auto_kickoff_start(data), [])

    def test_only_next_unplayed_after_prior_closed(self) -> None:
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        data = _payload(
            [
                _match(1, played=True, kickoff_at=past),
                _match(2, kickoff_at=past),
                _match(3, kickoff_at=past),
            ],
            broadcast={"openMatchIds": [], "suppressAuto": False, "mode": "auto"},
        )
        self.assertEqual(matches_needing_auto_kickoff_start(data), [2])

    def test_second_match_waits_until_first_is_played(self) -> None:
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        data = _payload([_match(1, kickoff_at=past), _match(2, kickoff_at=past)])
        self.assertEqual(matches_needing_auto_kickoff_start(data), [1])


if __name__ == "__main__":
    unittest.main()
