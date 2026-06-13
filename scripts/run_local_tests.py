#!/usr/bin/env python3
"""Run all local tests before merging to main."""

from __future__ import annotations

import argparse
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INTEGRATION_MODULES = {
    "test_cleanup_calc",
    "test_pipeline",
}


def _filter_suite(suite: unittest.TestSuite, *, include_integration: bool) -> unittest.TestSuite:
    if include_integration:
        return suite

    filtered = unittest.TestSuite()
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            nested = _filter_suite(item, include_integration=include_integration)
            if nested.countTestCases():
                filtered.addTest(nested)
            continue

        test_id = item.id()
        module_name = test_id.rsplit(".", 2)[0].split(".")[-1]
        if module_name not in INTEGRATION_MODULES:
            filtered.addTest(item)
    return filtered


def main() -> int:
    parser = argparse.ArgumentParser(description="Run local tests.")
    parser.add_argument(
        "--include-integration",
        action="store_true",
        help="Include LibreOffice-backed integration tests.",
    )
    args = parser.parse_args()

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

    include_integration = args.include_integration or os.environ.get("RUN_INTEGRATION") == "1"
    loader = unittest.TestLoader()
    suite = loader.discover(str(ROOT / "tests"), pattern="test_*.py")
    suite = _filter_suite(suite, include_integration=include_integration)
    if not include_integration:
        skipped = ", ".join(sorted(INTEGRATION_MODULES))
        print(
            f"Skipping LibreOffice integration tests ({skipped}). Set RUN_INTEGRATION=1 to include them.",
            flush=True,
        )
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if result.wasSuccessful():
        print("\nAll local tests passed.")
        return 0
    print(f"\nFAILED: {len(result.failures)} failure(s), {len(result.errors)} error(s)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
