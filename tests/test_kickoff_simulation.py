#!/usr/bin/env python3
"""Tests for kickoff-based scoreboard visibility and simulation helpers."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from scripts.kickoff_gate import is_scoreboard_live, next_unplayed_match, parse_iso
from scripts.simulate_kickoff import patch_json_kickoff


def _sample_payload(kickoff_at: str | None, *, games_played: int = 0) -> dict:
    return {
        "gamesPlayed": games_played,
        "matches": [
            {
                "id": 1,
                "played": False,
                "kickoffAt": kickoff_at,
            },
            {
                "id": 2,
                "played": False,
                "kickoffAt": "2026-06-12T02:00:00+00:00",
            },
        ],
    }


class TestKickoffGate(unittest.TestCase):
    def test_parse_iso(self) -> None:
        dt = parse_iso("2026-06-11T19:00:00+00:00")
        self.assertIsNotNone(dt)
        assert dt is not None
        self.assertEqual(dt.year, 2026)

    def test_next_unplayed_match(self) -> None:
        match = next_unplayed_match(_sample_payload("2026-06-11T19:00:00+00:00")["matches"])
        self.assertEqual(match["id"], 1)

    def test_coming_soon_before_kickoff(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        data = _sample_payload(future)
        self.assertFalse(is_scoreboard_live(data))

    def test_scoreboard_live_after_kickoff(self) -> None:
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        data = _sample_payload(past)
        self.assertTrue(is_scoreboard_live(data))

    def test_scoreboard_live_when_games_played(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        data = _sample_payload(future, games_played=1)
        self.assertTrue(is_scoreboard_live(data))

    def test_debug_mode_forces_scoreboard(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        data = _sample_payload(future)
        self.assertTrue(is_scoreboard_live(data, debug=True))


class TestSimulateKickoffJson(unittest.TestCase):
    def test_patch_json_kickoff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            latest = Path(tmp) / "latest.json"
            latest.write_text(
                json.dumps(_sample_payload("2026-06-11T19:00:00+00:00"), indent=2) + "\n",
                encoding="utf-8",
            )
            with patch("scripts.simulate_kickoff.LATEST_PATH", latest):
                iso = patch_json_kickoff(minutes=5.0 / 60.0)
            payload = json.loads(latest.read_text(encoding="utf-8"))
            self.assertEqual(payload["matches"][0]["kickoffAt"], iso)
            kickoff = parse_iso(iso)
            assert kickoff is not None
            self.assertGreater(kickoff, datetime.now(timezone.utc))


if __name__ == "__main__":
    unittest.main()
