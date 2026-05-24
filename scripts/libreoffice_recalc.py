#!/usr/bin/env python3
"""Recalculate xlsx formulas using headless LibreOffice."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from scripts.paths import XLSX_PATH

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLSX = XLSX_PATH
_MAX_ATTEMPTS = 3


def _run_soffice(source: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "soffice",
            "--headless",
            "--invisible",
            "--convert-to",
            "xlsx",
            "--outdir",
            str(source.parent),
            str(source),
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )


def recalc(xlsx_path: Path = DEFAULT_XLSX) -> None:
    """Open xlsx in LibreOffice, recalculate formulas, and save in place."""
    xlsx_path = xlsx_path.resolve()
    if not xlsx_path.exists():
        raise FileNotFoundError(xlsx_path)

    temp_path = Path(tempfile.gettempdir()) / f"wc26_recalc_{uuid.uuid4().hex}.xlsx"
    shutil.copy2(xlsx_path, temp_path)

    last_error = ""
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        result = _run_soffice(temp_path)
        stderr = result.stderr or ""
        if result.returncode == 0 and "failed:" not in stderr.lower():
            shutil.copy2(temp_path, xlsx_path)
            temp_path.unlink(missing_ok=True)
            return
        last_error = stderr or f"exit {result.returncode}"
        if attempt < _MAX_ATTEMPTS:
            time.sleep(1.5)

    temp_path.unlink(missing_ok=True)
    raise RuntimeError(f"LibreOffice recalc failed after {_MAX_ATTEMPTS} attempts: {last_error}")


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    recalc(path)
    print(f"Recalculated → {path}")


if __name__ == "__main__":
    main()
