#!/usr/bin/env python3
"""Tests for ESPN scoreboard parsing and match mapping."""

from __future__ import annotations

import unittest

from scripts.espn_scores import (
    EspnMatch,
    espn_dates_param,
    match_espn_to_sheet_id,
    normalize_team_name,
    parse_espn_events,
    plan_score_updates,
)


def _sheet_match(
    match_id: int,
    home: str,
    away: str,
    *,
    kickoff_at: str = "2026-06-12T02:00:00+00:00",
    played: bool = False,
    home_score: int | None = None,
    away_score: int | None = None,
) -> dict:
    return {
        "id": match_id,
        "home": home,
        "away": away,
        "kickoffAt": kickoff_at,
        "played": played,
        "homeScore": home_score,
        "awayScore": away_score,
    }


class TestEspnScores(unittest.TestCase):
    def test_normalize_team_aliases(self) -> None:
        self.assertEqual(normalize_team_name("Korea Republic"), "south korea")
        self.assertEqual(normalize_team_name("South Korea"), "south korea")
        self.assertEqual(normalize_team_name("Czech Republic"), "czechia")
        self.assertEqual(normalize_team_name("Bosnia and Herzegovina"), "bosnia-herzegovina")
        self.assertEqual(normalize_team_name("Bosnia-Herzegovina"), "bosnia-herzegovina")
        self.assertEqual(normalize_team_name("Turkey"), "turkey")
        self.assertEqual(normalize_team_name("Türkiye"), "turkey")
        self.assertEqual(normalize_team_name("Curaçao"), "curacao")

    def test_match_korea_czechia(self) -> None:
        espn = EspnMatch(
            espn_event_id="1",
            home="South Korea",
            away="Czechia",
            home_score=1,
            away_score=0,
            state="in",
            kickoff_at="2026-06-12T02:00Z",
        )
        sheet = [_sheet_match(2, "Korea Republic", "Czech Republic")]
        self.assertEqual(match_espn_to_sheet_id(espn, sheet), 2)

    def test_parse_espn_events_from_payload(self) -> None:
        payload = {
            "events": [
                {
                    "id": "760415",
                    "date": "2026-06-11T19:00Z",
                    "status": {"type": {"state": "pre", "name": "STATUS_SCHEDULED"}},
                    "competitions": [
                        {
                            "competitors": [
                                {
                                    "homeAway": "home",
                                    "score": "0",
                                    "team": {"displayName": "Mexico"},
                                },
                                {
                                    "homeAway": "away",
                                    "score": "0",
                                    "team": {"displayName": "South Africa"},
                                },
                            ]
                        }
                    ],
                }
            ]
        }
        events = parse_espn_events(payload)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].home, "Mexico")
        self.assertEqual(events[0].state, "pre")

    def test_plan_skips_pre_match(self) -> None:
        espn = [
            EspnMatch(
                espn_event_id="1",
                home="Mexico",
                away="South Africa",
                home_score=0,
                away_score=0,
                state="pre",
                kickoff_at="2026-06-11T19:00Z",
            )
        ]
        sheet = [_sheet_match(1, "Mexico", "South Africa", kickoff_at="2026-06-11T19:00:00+00:00")]
        self.assertEqual(plan_score_updates(sheet, espn), [])

    def test_plan_live_update(self) -> None:
        espn = [
            EspnMatch(
                espn_event_id="1",
                home="Mexico",
                away="South Africa",
                home_score=2,
                away_score=1,
                state="in",
                kickoff_at="2026-06-11T19:00Z",
            )
        ]
        sheet = [
            _sheet_match(
                1,
                "Mexico",
                "South Africa",
                kickoff_at="2026-06-11T19:00:00+00:00",
                played=True,
                home_score=0,
                away_score=0,
            )
        ]
        updates = plan_score_updates(sheet, espn, open_match_ids={1})
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0].match_id, 1)
        self.assertEqual(updates[0].home_score, 2)
        self.assertFalse(updates[0].close_live)

    def test_espn_dates_span_sheet_kickoffs(self) -> None:
        sheet = [
            _sheet_match(1, "Mexico", "South Africa", kickoff_at="2026-06-11T19:00:00+00:00"),
            _sheet_match(72, "Brazil", "Morocco", kickoff_at="2026-07-19T20:00:00+00:00"),
        ]
        dates = espn_dates_param(sheet_matches=sheet)
        self.assertTrue(dates.startswith("20260610"))
        self.assertTrue(dates.endswith("20260720"))

    def test_plan_final_closes_live(self) -> None:
        espn = [
            EspnMatch(
                espn_event_id="1",
                home="Mexico",
                away="South Africa",
                home_score=1,
                away_score=0,
                state="post",
                kickoff_at="2026-06-11T19:00Z",
            )
        ]
        sheet = [
            _sheet_match(
                1,
                "Mexico",
                "South Africa",
                kickoff_at="2026-06-11T19:00:00+00:00",
                played=True,
                home_score=1,
                away_score=0,
            )
        ]
        updates = plan_score_updates(sheet, espn, open_match_ids={1})
        self.assertEqual(len(updates), 1)
        self.assertTrue(updates[0].close_live)


if __name__ == "__main__":
    unittest.main()
