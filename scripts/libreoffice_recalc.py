#!/usr/bin/env python3
"""Recalculate xlsx formulas using headless LibreOffice."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from scripts.paths import XLSX_PATH

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLSX = XLSX_PATH


def recalc(xlsx_path: Path = DEFAULT_XLSX) -> None:
    """Open xlsx in LibreOffice, recalculate formulas, and save in place."""
    xlsx_path = xlsx_path.resolve()
    if not xlsx_path.exists():
        raise FileNotFoundError(xlsx_path)

    result = subprocess.run(
        [
            "soffice",
            "--headless",
            "--invisible",
            "--nodefault",
            "--nologo",
            "--norestore",
            "--convert-to",
            "xlsx",
            "--outdir",
            str(xlsx_path.parent),
            str(xlsx_path),
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"LibreOffice recalc failed (exit {result.returncode}): {result.stderr}"
        )


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    recalc(path)
    print(f"Recalculated → {path}")


if __name__ == "__main__":
    main()
