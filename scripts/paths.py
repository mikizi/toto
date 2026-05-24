"""Shared paths for toto scripts."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT / "public"
XLSX_DIR = ROOT / "xlsx"
XLSX_PATH = XLSX_DIR / "Master WorldCup26.xlsx"
BACKUP_PATH = XLSX_DIR / "Master WorldCup26.simulation-backup.xlsx"
DATA_DIR = PUBLIC_DIR / "data"
LATEST_PATH = DATA_DIR / "latest.json"
VERSION_PATH = DATA_DIR / "version.json"
VERSIONS_DIR = DATA_DIR / "versions"
