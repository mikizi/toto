#!/usr/bin/env python3
"""Recalculate xlsx formulas using headless LibreOffice."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from scripts.paths import XLSX_PATH

# Lazy import — avoid circular import at module load
_assert_recalc_cached = None


def _verify_recalc_cached(xlsx_path: Path) -> bool:
    global _assert_recalc_cached
    if _assert_recalc_cached is None:
        from scripts.export_summary import assert_recalc_cached

        _assert_recalc_cached = assert_recalc_cached

    try:
        from scripts.export_summary import count_played_matches

        played = count_played_matches(xlsx_path)
        if played == 0:
            return True
        _assert_recalc_cached(xlsx_path, games_played=played)
        return True
    except RuntimeError:
        return False

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLSX = XLSX_PATH
_MAX_ATTEMPTS = 3


def _soffice_binary() -> str:
    for candidate in ("soffice", "libreoffice"):
        path = shutil.which(candidate)
        if path:
            return path
    raise RuntimeError("LibreOffice not found (install soffice or libreoffice)")


def _conversion_succeeded(result: subprocess.CompletedProcess[str], output_path: Path) -> bool:
    if result.returncode != 0 or not output_path.exists():
        return False
    combined = f"{result.stdout or ''}\n{result.stderr or ''}".lower()
    return "error:" not in combined and "failed:" not in combined


def _run_soffice(
    source: Path, out_dir: Path, profile_dir: Path
) -> subprocess.CompletedProcess[str]:
    profile_uri = profile_dir.resolve().as_uri()
    env = os.environ.copy()
    env.setdefault("HOME", str(Path(tempfile.gettempdir())))
    env.setdefault("SAL_USE_VCLPLUGIN", "svp")
    env.setdefault("SAL_DISABLE_OPENCL", "1")
    env.setdefault("LANG", "C.UTF-8")

    command = [
        _soffice_binary(),
        "--headless",
        "--invisible",
        "--norestore",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        f"-env:UserInstallation={profile_uri}",
        "--convert-to",
        "xlsx",
        "--outdir",
        str(out_dir),
        str(source),
    ]
    xvfb = shutil.which("xvfb-run")
    if xvfb:
        command = [xvfb, "-a", *command]
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=600,
        env=env,
    )


def recalc(xlsx_path: Path = DEFAULT_XLSX) -> None:
    """Open xlsx in LibreOffice, recalculate formulas, and save in place."""
    xlsx_path = xlsx_path.resolve()
    if not xlsx_path.exists():
        raise FileNotFoundError(xlsx_path)

    temp_path = Path(tempfile.gettempdir()) / f"wc26_recalc_{uuid.uuid4().hex}.xlsx"
    out_dir = Path(tempfile.gettempdir()) / f"lo_out_{uuid.uuid4().hex}"
    profile_dir = Path(tempfile.gettempdir()) / f"lo_profile_{uuid.uuid4().hex}"
    profile_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(xlsx_path, temp_path)

    last_error = ""
    try:
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            shutil.rmtree(out_dir, ignore_errors=True)
            out_dir.mkdir(parents=True, exist_ok=True)
            result = _run_soffice(temp_path, out_dir, profile_dir)
            converted = out_dir / temp_path.name
            stderr = result.stderr or ""
            stdout = result.stdout or ""
            if _conversion_succeeded(result, converted):
                shutil.copy2(converted, xlsx_path)
                if _verify_recalc_cached(xlsx_path):
                    return
                last_error = "LibreOffice saved the file but formula results were not cached"
            else:
                last_error = "\n".join(
                    part
                    for part in [stderr.strip(), stdout.strip(), f"exit {result.returncode}"]
                    if part
                )
            print(last_error, file=sys.stderr)
            if attempt < _MAX_ATTEMPTS:
                time.sleep(1.5)
    finally:
        temp_path.unlink(missing_ok=True)
        shutil.rmtree(out_dir, ignore_errors=True)
        shutil.rmtree(profile_dir, ignore_errors=True)

    raise RuntimeError(f"LibreOffice recalc failed after {_MAX_ATTEMPTS} attempts: {last_error}")


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    recalc(path)
    print(f"Recalculated → {path}")


if __name__ == "__main__":
    main()
