#!/usr/bin/env bash
# Run local tests (optional) and serve the public/ client app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8080}"
SKIP_TESTS="${SKIP_TESTS:-0}"
PUBLIC="$ROOT/public"

echo "==> World Cup 2026 Toto — local dev"
echo "    Root: $ROOT"
echo ""

if [[ "$SKIP_TESTS" != "1" ]]; then
  echo "==> Running local tests..."
  python3 scripts/run_local_tests.py
  echo ""
fi

if ! python3 -c "import json; json.load(open('$PUBLIC/data/latest.json'))" 2>/dev/null; then
  echo "==> public/data/latest.json missing — exporting from xlsx..."
  python3 scripts/libreoffice_recalc.py 2>/dev/null || true
  python3 scripts/export_summary.py
  echo ""
fi

echo "==> Starting server on http://localhost:${PORT}"
echo ""
echo "    Scoreboard: http://localhost:${PORT}/index.html"
echo "    Admin:      http://localhost:${PORT}/admin/"
echo ""
echo "    Stop with Ctrl+C"
echo "    Skip tests next time: SKIP_TESTS=1 $0"
echo ""

exec python3 -m http.server "$PORT" --directory "$PUBLIC"
