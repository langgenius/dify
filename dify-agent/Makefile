.DEFAULT_GOAL := help

PROJECT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

.PHONY: help serve dev check fix typecheck test update-examples docs docs-serve \
	bench-local-runtime bench-local-e2b bench-sizing

help:
	@echo "Dify agent targets:"
	@echo "  make serve          - Run the Dify Agent server"
	@echo "  make dev            - Run the Dify Agent server with reload"
	@echo "  make check           - Run Ruff for dify-agent"
	@echo "  make fix             - Format and fix Ruff issues"
	@echo "  make typecheck       - Run basedpyright for src, examples, tests, and benchmarks"
	@echo "  make test            - Run local tests and docs/example tests"
	@echo "  make update-examples - Rewrite docs example outputs when needed"
	@echo "  make docs            - Build MkDocs documentation"
	@echo "  make docs-serve      - Serve MkDocs documentation locally"
	@echo "  make bench-local-runtime - Measure Agent with the Local Runtime backend"
	@echo "  make bench-local-e2b - Measure Agent with the real E2B backend"
	@echo "  make bench-sizing     - Derive ACU and E2B calculator inputs"

serve:
	@uv --directory "$(PROJECT_DIR)" run --project . --extra server uvicorn dify_agent.server.app:app --host 127.0.0.1 --port 8000

dev:
	@uv --directory "$(PROJECT_DIR)" run --project . --extra server uvicorn dify_agent.server.app:app --host 127.0.0.1 --port 8000 --reload

check:
	@uv --directory "$(PROJECT_DIR)" run --project . python -m ruff check .

fix:
	@uv --directory "$(PROJECT_DIR)" run --project . python -m ruff format .
	@uv --directory "$(PROJECT_DIR)" run --project . python -m ruff check --fix .

typecheck:
	@uv --directory "$(PROJECT_DIR)" run --project . --group benchmark \
		basedpyright --level error src examples tests benchmarks

test:
	@PYTHONPATH="$(PROJECT_DIR)$${PYTHONPATH:+:$${PYTHONPATH}}" \
		uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m pytest --import-mode=importlib tests

update-examples:
	@uv --directory "$(PROJECT_DIR)" run --project . python -m pytest --update-examples tests/docs/test_examples.py

docs:
	@uv --directory "$(PROJECT_DIR)" run --project . --group docs python -m mkdocs build --no-strict

docs-serve:
	@uv --directory "$(PROJECT_DIR)" run --project . --group docs python -m mkdocs serve --no-strict

bench-local-runtime:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator local-runtime \
		$(if $(BENCH_SCENARIO),--scenario "$(BENCH_SCENARIO)",) \
		$(if $(BENCH_CONCURRENCY),--concurrency "$(BENCH_CONCURRENCY)",) \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,)

bench-local-e2b:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator local-e2b \
		$(if $(BENCH_SCENARIO),--scenario "$(BENCH_SCENARIO)",) \
		$(if $(BENCH_CONCURRENCY),--concurrency "$(BENCH_CONCURRENCY)",) \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,)

bench-sizing:
	@test -n "$(CAPACITY_RESULT)" || (echo "CAPACITY_RESULT is required" >&2; exit 2)
	@test -n "$(MONTHLY_RUNS)" || (echo "MONTHLY_RUNS is required" >&2; exit 2)
	@test -n "$(PEAK_RPS)" || (echo "PEAK_RPS is required" >&2; exit 2)
	@test -n "$(E2B_CONCURRENCY)" || (echo "E2B_CONCURRENCY is required" >&2; exit 2)
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --group benchmark \
		python -m benchmarks.sizing \
		--capacity-result "$(CAPACITY_RESULT)" \
		--monthly-runs "$(MONTHLY_RUNS)" \
		--peak-rps "$(PEAK_RPS)" \
		--e2b-concurrency "$(E2B_CONCURRENCY)"
