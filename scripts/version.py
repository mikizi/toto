"""Version stamp helpers for public data exports."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def bump_payload_version(payload: dict[str, Any]) -> None:
    """Set a fresh version id and generatedAt on an export payload (in place)."""
    moment = datetime.now(timezone.utc)
    payload["version"] = moment.strftime("%Y-%m-%dT%H%M%SZ")
    payload["generatedAt"] = moment.isoformat()
