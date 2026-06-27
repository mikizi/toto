#!/usr/bin/env python3
"""Local admin API — publish match results when testing on localhost."""

from __future__ import annotations

import json
import re
import shutil
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.export_summary import build_export, write_export
from scripts.espn_scores import (
    espn_dates_param,
    fetch_scoreboard,
    match_espn_to_sheet_id,
    parse_espn_events,
    plan_score_updates,
)
from scripts.libreoffice_recalc import recalc
from scripts.live_state import normalize_broadcast
from scripts.paths import LATEST_PATH, XLSX_PATH
from scripts.publish_match import publish_match, restore_match
from scripts.update_broadcast import update_broadcast
from scripts.update_knockout import update_knockout
from scripts.update_registration import update_registration
from scripts.validate_export import validate

DEFAULT_PORT = 8090
XLSX_DOWNLOAD_NAME = "Master WorldCup26.xlsx"
MAX_XLSX_UPLOAD_BYTES = 30 * 1024 * 1024
PRESENCE_TTL_SECONDS = 600
PRESENCE_ID_RE = re.compile(r"^[a-zA-Z0-9._:-]{8,80}$")
VIEWER_PRESENCE: dict[str, float] = {}
VIEWER_PRESENCE_LOCK = threading.Lock()
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Password, X-File-Name")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/presence":
            origin = self.headers.get("Origin", "")
            if origin and origin not in ALLOWED_ORIGINS:
                self._send_json(403, {"ok": False, "error": "Origin not allowed"})
                return
            self._handle_presence()
            return

        if path == "/api-scores":
            origin = self.headers.get("Origin", "")
            if origin and origin not in ALLOWED_ORIGINS:
                self._send_json(403, {"ok": False, "error": "Origin not allowed"})
                return
            self._handle_api_scores()
            return

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
        if path not in ("/publish", "/broadcast", "/registration", "/restore", "/xlsx", "/presence", "/knockout"):
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        origin = self.headers.get("Origin", "")
        if origin and origin not in ALLOWED_ORIGINS:
            self._send_json(403, {"ok": False, "error": "Origin not allowed"})
            return

        if path == "/xlsx":
            self._handle_xlsx_upload()
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8")
            data = json.loads(raw)
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            self._send_json(400, {"ok": False, "error": f"Invalid request: {exc}"})
            return

        if path == "/presence":
            self._handle_presence(data)
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
                    latest_matches: dict[int, dict] = {}
                    if latest_path.exists():
                        for row in json.loads(latest_path.read_text(encoding="utf-8")).get(
                            "matches"
                        ) or []:
                            if isinstance(row, dict) and row.get("id") is not None:
                                latest_matches[int(row["id"])] = row
                    for match_id in open_ids:
                        row = latest_matches.get(match_id)
                        needs_kickoff = match_id not in current_open_ids or (
                            isinstance(row, dict) and not row.get("played")
                        )
                        if needs_kickoff:
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

        if path == "/knockout":
            action = str(data.get("action") or "").strip()
            try:
                payload = update_knockout(
                    action,
                    match_id=int(data["matchId"]) if data.get("matchId") is not None else None,
                    home=str(data["home"]).strip() if data.get("home") is not None else None,
                    away=str(data["away"]).strip() if data.get("away") is not None else None,
                    home_score=int(data["homeScore"]) if data.get("homeScore") is not None else None,
                    away_score=int(data["awayScore"]) if data.get("awayScore") is not None else None,
                    winner=str(data["winner"]).strip() if data.get("winner") is not None else None,
                    eliminated=data.get("eliminated"),
                )
            except Exception as exc:
                self._send_json(500, {"ok": False, "error": str(exc)})
                return
            self._send_json(
                200,
                {
                    "ok": True,
                    "version": payload.get("version"),
                    "knockout": payload.get("knockout"),
                    "leaderboard": payload.get("leaderboard", [])[:5],
                },
            )
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
            result = publish_match(
                match_id, home_score, away_score, close_live=False
            )
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

    def _handle_api_scores(self) -> None:
        """Return read-only ESPN/API scoreboard data matched to local fixture ids."""
        try:
            if not LATEST_PATH.exists():
                self._send_json(404, {"ok": False, "error": "Missing latest.json"})
                return

            latest = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
            sheet_matches = latest.get("matches") if isinstance(latest.get("matches"), list) else []
            dates = espn_dates_param(sheet_matches=sheet_matches)
            payload = fetch_scoreboard(dates=dates)
            espn_events = parse_espn_events(payload)
            broadcast = normalize_broadcast(latest.get("broadcast"))
            open_ids = {int(value) for value in broadcast["openMatchIds"]}
            updates = plan_score_updates(sheet_matches, espn_events, open_match_ids=open_ids)
            updates_by_id = {item.match_id: item for item in updates}
            sheet_by_id = {
                int(match["id"]): match
                for match in sheet_matches
                if isinstance(match, dict) and match.get("id") is not None
            }

            rows: list[dict[str, Any]] = []
            for event in espn_events:
                match_id = match_espn_to_sheet_id(event, sheet_matches)
                sheet = sheet_by_id.get(match_id) if match_id is not None else None
                update = updates_by_id.get(match_id) if match_id is not None else None
                rows.append(
                    {
                        "matchId": match_id,
                        "espnEventId": event.espn_event_id,
                        "home": sheet.get("home") if sheet else event.home,
                        "away": sheet.get("away") if sheet else event.away,
                        "apiHome": event.home,
                        "apiAway": event.away,
                        "apiHomeScore": event.home_score,
                        "apiAwayScore": event.away_score,
                        "apiState": event.state,
                        "kickoffAt": event.kickoff_at,
                        "currentHomeScore": sheet.get("homeScore") if sheet else None,
                        "currentAwayScore": sheet.get("awayScore") if sheet else None,
                        "currentPlayed": bool(sheet.get("played")) if sheet else False,
                        "isMatched": match_id is not None,
                        "wouldUpdate": update is not None,
                        "wouldCloseLive": bool(update.close_live) if update else False,
                    }
                )

            rows.sort(
                key=lambda row: (
                    row.get("kickoffAt") or "",
                    int(row.get("matchId") or 9999),
                    str(row.get("espnEventId") or ""),
                )
            )
            self._send_json(
                200,
                {
                    "ok": True,
                    "source": "ESPN",
                    "dates": dates,
                    "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "eventsCount": len(espn_events),
                    "updatesCount": len(updates),
                    "rows": rows,
                },
            )
        except Exception as exc:
            self._send_json(500, {"ok": False, "error": str(exc)})

    def _handle_presence(self, data: dict[str, Any] | None = None) -> None:
        now = time.time()
        cutoff = now - PRESENCE_TTL_SECONDS
        viewer_id = str((data or {}).get("id", "")).strip()

        with VIEWER_PRESENCE_LOCK:
            stale_ids = [
                stored_id
                for stored_id, seen_at in VIEWER_PRESENCE.items()
                if seen_at < cutoff
            ]
            for stored_id in stale_ids:
                VIEWER_PRESENCE.pop(stored_id, None)

            if data is not None:
                if not PRESENCE_ID_RE.fullmatch(viewer_id):
                    self._send_json(400, {"ok": False, "error": "Invalid viewer id"})
                    return
                VIEWER_PRESENCE[viewer_id] = now

            viewers = len(VIEWER_PRESENCE)

        self._send_json(
            200,
            {
                "ok": True,
                "viewers": viewers,
                "ttlSeconds": PRESENCE_TTL_SECONDS,
            },
        )

    def _handle_xlsx_upload(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"ok": False, "error": "Invalid Content-Length"})
            return

        if length <= 0:
            self._send_json(400, {"ok": False, "error": "Upload is empty"})
            return
        if length > MAX_XLSX_UPLOAD_BYTES:
            self._send_json(413, {"ok": False, "error": "Workbook is too large"})
            return

        raw = self.rfile.read(length)
        if not raw.startswith(b"PK"):
            self._send_json(400, {"ok": False, "error": "Upload must be an .xlsx workbook"})
            return

        backup_path: Path | None = None
        XLSX_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as handle:
                temp_path = Path(handle.name)
                handle.write(raw)

            try:
                wb = openpyxl.load_workbook(temp_path, read_only=True)
                wb.close()
            except Exception as exc:
                temp_path.unlink(missing_ok=True)
                self._send_json(400, {"ok": False, "error": f"Invalid workbook: {exc}"})
                return

            if XLSX_PATH.exists():
                backup_path = XLSX_PATH.with_suffix(".upload-backup.xlsx")
                shutil.copy2(XLSX_PATH, backup_path)
            shutil.move(str(temp_path), XLSX_PATH)

            recalc(XLSX_PATH, require_cached=False)
            previous = json.loads(LATEST_PATH.read_text(encoding="utf-8")) if LATEST_PATH.exists() else None
            payload = build_export(XLSX_PATH, previous)
            errors = validate(payload)
            if errors:
                raise RuntimeError(f"Export validation failed: {errors}")
            write_export(payload)
            if backup_path:
                backup_path.unlink(missing_ok=True)
        except Exception as exc:
            if backup_path and backup_path.exists():
                shutil.copy2(backup_path, XLSX_PATH)
                backup_path.unlink(missing_ok=True)
            self._send_json(500, {"ok": False, "error": str(exc)})
            return

        self._send_json(
            200,
            {
                "ok": True,
                "message": "Workbook uploaded and latest.json regenerated",
                "version": payload["version"],
                "gamesPlayed": payload["gamesPlayed"],
                "players": len(payload["leaderboard"]),
            },
        )


def main() -> None:
    import os

    port = int(os.environ.get("ADMIN_API_PORT", DEFAULT_PORT))
    host = "127.0.0.1"
    server = ThreadingHTTPServer((host, port), AdminApiHandler)
    print(f"Admin API listening on http://{host}:{port} (publish, /xlsx, /presence)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nAdmin API stopped.")


if __name__ == "__main__":
    main()
