.PHONY: test serve dev export

test:
	python3 scripts/run_local_tests.py

export:
	python3 scripts/libreoffice_recalc.py
	python3 scripts/export_summary.py

serve:
	SKIP_TESTS=1 ./scripts/serve_local.sh

dev:
	./scripts/serve_local.sh
