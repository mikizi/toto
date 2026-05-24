#!/usr/bin/env python3
"""Run all local tests before merging to main."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    loader = unittest.TestLoader()
    suite = loader.discover(str(ROOT / "tests"), pattern="test_*.py")
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if result.wasSuccessful():
        print("\nAll local tests passed.")
        return 0
    print(f"\nFAILED: {len(result.failures)} failure(s), {len(result.errors)} error(s)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
