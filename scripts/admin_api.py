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

from scripts.paths import XLSX_PATH
from scripts.publish_match import publish_match, restore_match
from scripts.update_broadcast import update_broadcast
from scripts.update_registration import update_registration

DEFAULT_PORT = 8090
XLSX_DOWNLOAD_NAME = "Master WorldCup26.xlsx"
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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Password")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path != "/xlsx":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        origin = self.headers.get("Origin", "")
        if origin and origin not in ALLOWED_ORIGINS:
            self._send_json(403, {"ok": False, "error": "Origin not allowed"})
            return

        if not XLSX_PATH.is_file():
            self._send_json(404, {"ok": False, "error": "Workbook not found"})
            return

        body = XLSX_PATH.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.send_header("Content-Length", str(len(body)))
        self.send_header(
            "Content-Disposition",
            f'attachment; filename="{XLSX_DOWNLOAD_NAME}"',
        )
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path not in ("/publish", "/broadcast", "/registration", "/restore"):
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
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            self._send_json(400, {"ok": False, "error": f"Invalid request: {exc}"})
            return

        if path == "/broadcast":
            try:
                action = str(data.get("action", "set")).strip().lower()
                open_ids = data.get("openMatchIds")
                if open_ids is not None:
                    open_ids = [int(value) for value in open_ids]
                suppress_auto = data.get("suppressAuto")
                if suppress_auto is not None:
                    suppress_auto = bool(suppress_auto)
            except (KeyError, TypeError, ValueError) as exc:
                self._send_json(400, {"ok": False, "error": f"Invalid broadcast request: {exc}"})
                return

            try:
                if action == "set" and open_ids is not None:
                    current_open_ids: set[int] = set()
                    latest_path = ROOT / "public" / "data" / "latest.json"
                    if latest_path.exists():
                        latest = json.loads(latest_path.read_text(encoding="utf-8"))
                        broadcast = latest.get("broadcast")
                        if isinstance(broadcast, dict):
                            for value in broadcast.get("openMatchIds") or []:
                                try:
                                    current_open_ids.add(int(value))
                                except (TypeError, ValueError):
                                    continue
                    for match_id in open_ids:
                        if match_id not in current_open_ids:
                            publish_match(match_id, 0, 0, close_live=False)
                if action == "resume_auto":
                    payload = update_broadcast(
                        open_match_ids=[],
                        suppress_auto=False,
                        mode="auto",
                        clear_manual=True,
                    )
                elif action == "suppress_auto":
                    payload = update_broadcast(suppress_auto=True)
                elif action == "set_autopilot":
                    auto_pilot = data.get("autoPilot")
                    if auto_pilot is None:
                        raise ValueError("autoPilot is required for set_autopilot")
                    payload = update_broadcast(auto_pilot=bool(auto_pilot), mode="auto")
                elif action == "clear_manual":
                    payload = update_broadcast(clear_manual=True)
                else:
                    payload = update_broadcast(
                        open_match_ids=open_ids,
                        suppress_auto=suppress_auto,
                    )
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
                return

            self._send_json(200, {"ok": True, "broadcast": payload.get("broadcast")})
            return

        if path == "/registration":
            users_raw = data.get("users")
            if not isinstance(users_raw, list):
                self._send_json(400, {"ok": False, "error": "users must be a list of names"})
                return
            users = [str(name).strip() for name in users_raw if str(name).strip()]
            try:
                payload = update_registration(users)
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
                return
            self._send_json(200, {"ok": True, "registration": payload.get("registration")})
            return

        if path == "/restore":
            try:
                match_id = int(data["match_id"])
            except (KeyError, TypeError, ValueError) as exc:
                self._send_json(400, {"ok": False, "error": f"Invalid request: {exc}"})
                return

            try:
                result = restore_match(match_id)
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
                return

            self._send_json(
                200,
                {
                    "ok": True,
                    "matchId": result["matchId"],
                    "teams": result["teams"],
                    "gamesPlayed": result["gamesPlayed"],
                    "version": result["version"],
                },
            )
            return

        try:
            match_id = int(data["match_id"])
            home_score = int(data["home_score"])
            away_score = int(data["away_score"])
        except (KeyError, TypeError, ValueError) as exc:
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
    print(f"Admin API listening on http://{host}:{port} (publish, /xlsx)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nAdmin API stopped.")


if __name__ == "__main__":
    main()
