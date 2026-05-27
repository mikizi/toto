#!/usr/bin/env python3
"""Tests for CI LibreOffice skip helper."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.ci_needs_libreoffice import broadcast_needs_libreoffice


class TestBroadcastNeedsLibreoffice(unittest.TestCase):
    def test_autopilot_toggle_never_needs_lo(self) -> None:
        self.assertFalse(broadcast_needs_libreoffice("set_autopilot", []))
        self.assertFalse(broadcast_needs_libreoffice("clear_manual", [1]))

    def test_stop_live_without_new_match(self) -> None:
        self.assertFalse(broadcast_needs_libreoffice("set", []))

    def test_new_live_match_needs_lo(self) -> None:
        self.assertTrue(broadcast_needs_libreoffice("set", [99]))

    def test_open_but_unplayed_match_needs_lo(self) -> None:
        previous = {
            "matches": [
                {
                    "id": 2,
                    "played": False,
                    "homeScore": None,
                    "awayScore": None,
                }
            ],
            "broadcast": {"openMatchIds": [2], "mode": "manual", "autoPilot": False},
        }
        from scripts import ci_needs_libreoffice as mod

        original = mod.LATEST_PATH
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "latest.json"
                path.write_text(json.dumps(previous), encoding="utf-8")
                mod.LATEST_PATH = path
                self.assertTrue(broadcast_needs_libreoffice("set", [2]))
        finally:
            mod.LATEST_PATH = original


if __name__ == "__main__":
    unittest.main()
