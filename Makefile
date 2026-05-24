.PHONY: test serve dev export simulate simulate-restore simulate-ci simulate-scores

test:
	python3 scripts/run_local_tests.py

export:
	python3 scripts/libreoffice_recalc.py
	python3 scripts/export_summary.py

serve:
	SKIP_TESTS=1 ./scripts/serve_local.sh

dev:
	./scripts/serve_local.sh

simulate:
	python3 scripts/simulate_kickoff.py --minutes 5

simulate-restore:
	python3 scripts/simulate_kickoff.py --restore

simulate-scores:
	python3 scripts/score_simulation.py

simulate-scores-apply:
	python3 scripts/score_simulation.py --apply-result 0-1

simulate-ci:
	python3 scripts/score_simulation.py
	python3 scripts/simulate_kickoff.py --json-only --seconds 20
	python3 scripts/verify_kickoff_ui.py --start-server --wait-seconds 20
