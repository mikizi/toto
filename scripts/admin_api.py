#!/usr/bin/env python3
"""Local admin API — publish match results when testing on localhost."""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.publish_match import publish_match

DEFAULT_PORT = 8090
ALLOWED_ORIGINS = {
    "http://localhost:8080",
    "http://127.0.0.1:8080",
}


class AdminApiHandler(BaseHTTPRequestHandler):
    """Handle POST /publish for local admin testing."""

    server_version = "WC26AdminAPI/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write(f"[admin-api] {self.address_string()} - {fmt % args}\n")

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin not in ALLOWED_ORIGINS:
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/publish":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        origin = self.headers.get("Origin", "")
        if origin and origin not in ALLOWED_ORIGINS:
            self._send_json(403, {"ok": False, "error": "Origin not allowed"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8")
            data = json.loads(raw)
            match_id = int(data["match_id"])
            home_score = int(data["home_score"])
            away_score = int(data["away_score"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            self._send_json(400, {"ok": False, "error": f"Invalid request: {exc}"})
            return

        try:
            result = publish_match(match_id, home_score, away_score)
        except Exception as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})
            return

        self._send_json(
            200,
            {
                "ok": True,
                "matchId": result["matchId"],
                "teams": result["teams"],
                "score": result["score"],
                "gamesPlayed": result["gamesPlayed"],
                "version": result["version"],
            },
        )


def main() -> None:
    import os

    port = int(os.environ.get("ADMIN_API_PORT", DEFAULT_PORT))
    host = "127.0.0.1"
    server = ThreadingHTTPServer((host, port), AdminApiHandler)
    print(f"Admin API listening on http://{host}:{port}/publish")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nAdmin API stopped.")


if __name__ == "__main__":
    main()
