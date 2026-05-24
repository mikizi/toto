#!/usr/bin/env bash
# Run local tests (optional), admin API, and serve public/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8080}"
ADMIN_API_PORT="${ADMIN_API_PORT:-8090}"
SKIP_TESTS="${SKIP_TESTS:-0}"
PUBLIC="$ROOT/public"

echo "==> World Cup 2026 Toto — local dev"
echo "    Root: $ROOT"
echo ""

if [[ "$SKIP_TESTS" != "1" ]]; then
  echo "==> Running local tests..."
  PYTHONPATH=. python3 scripts/run_local_tests.py
  echo ""
fi

if ! python3 -c "import json; json.load(open('$PUBLIC/data/latest.json'))" 2>/dev/null; then
  echo "==> public/data/latest.json missing — exporting from xlsx..."
  PYTHONPATH=. python3 scripts/libreoffice_recalc.py 2>/dev/null || true
  PYTHONPATH=. python3 scripts/export_summary.py
  echo ""
fi

if ! command -v soffice >/dev/null 2>&1; then
  echo "WARNING: LibreOffice (soffice) not found — admin local publish will fail."
  echo ""
fi

echo "==> Starting admin API on http://127.0.0.1:${ADMIN_API_PORT}"
ADMIN_API_PORT="$ADMIN_API_PORT" PYTHONPATH=. python3 scripts/admin_api.py &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Starting site on http://localhost:${PORT}"
echo ""
echo "    Scoreboard: http://localhost:${PORT}/"
echo "    Admin:      http://localhost:${PORT}/admin/"
echo ""
echo "    Admin publishes: patch xlsx → recalc → export latest.json"
echo "    Stop with Ctrl+C"
echo "    Skip tests: SKIP_TESTS=1 $0"
echo ""

python3 -m http.server "$PORT" --directory "$PUBLIC"
