"""Scoreboard visibility rules (mirrors public/js/live.js)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from scripts.live_state import (  # noqa: F401
    DEFAULT_BROADCAST,
    hero_live_match_ids,
    is_match_in_progress,
    is_scoreboard_live,
    next_unplayed_match,
    normalize_broadcast,
    parse_iso,
)
