#!/usr/bin/env python3
"""Browser check: coming soon before kickoff, scoreboard after."""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent


def wait_for_server(base_url: str, timeout_sec: float = 15.0) -> None:
    """Poll until the local server responds."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with urlopen(f"{base_url}/", timeout=2):
                return
        except OSError:
            time.sleep(0.25)
    raise TimeoutError(f"Server did not start at {base_url}")


def run_ui_check(base_url: str, wait_seconds: float, buffer_seconds: float) -> None:
    """Use Playwright to verify view mode switches at kickoff."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError(
            "Playwright is required: pip install playwright && playwright install chromium"
        ) from exc

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(f"{base_url}/", wait_until="networkidle")

        coming_soon = page.locator("#comingSoon")
        scoreboard = page.locator("#scoreboardApp")

        if not coming_soon.is_visible():
            raise AssertionError("Expected coming-soon view before kickoff")
        if scoreboard.is_visible():
            raise AssertionError("Scoreboard should be hidden before kickoff")

        sleep_for = max(0.0, wait_seconds + buffer_seconds)
        print(f"Waiting {sleep_for:.1f}s for kickoff…")
        time.sleep(sleep_for)

        page.reload(wait_until="networkidle")
        deadline = time.time() + 10.0
        while time.time() < deadline:
            if scoreboard.is_visible() and not coming_soon.is_visible():
                rows = page.locator("#betsTable .lb-row").count()
                if rows > 0:
                    print(f"Scoreboard live with {rows} leaderboard rows")
                    browser.close()
                    return
            time.sleep(0.5)

        browser.close()
        raise AssertionError("Scoreboard did not appear after kickoff")


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify kickoff UI transition in browser")
    parser.add_argument("--url", default="http://localhost:8080", help="App base URL")
    parser.add_argument(
        "--wait-seconds",
        type=float,
        required=True,
        help="Kickoff delay that was configured (seconds until kickoff)",
    )
    parser.add_argument(
        "--buffer-seconds",
        type=float,
        default=3.0,
        help="Extra wait after kickoff before asserting (default: 3)",
    )
    parser.add_argument(
        "--start-server",
        action="store_true",
        help="Start python http.server on public/ before checking",
    )
    args = parser.parse_args()

    server: subprocess.Popen[bytes] | None = None
    if args.start_server:
        server = subprocess.Popen(
            [sys.executable, "-m", "http.server", "8080", "--directory", str(ROOT / "public")],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            wait_for_server(args.url)
            run_ui_check(args.url, args.wait_seconds, args.buffer_seconds)
        finally:
            server.terminate()
            server.wait(timeout=5)
        return

    wait_for_server(args.url)
    run_ui_check(args.url, args.wait_seconds, args.buffer_seconds)


if __name__ == "__main__":
    main()
