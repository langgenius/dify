.DEFAULT_GOAL := help

PROJECT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

.PHONY: help serve dev check fix typecheck test update-examples docs docs-serve \
	bench-docker-smoke bench-docker-ab \
	bench-docker-runtime-smoke bench-docker-runtime-ab \
	bench-docker-capability-smoke bench-docker-capability-ab \
	bench-docker-capacity bench-e2b-capacity

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
	@echo "  make bench-docker-smoke - Check the local Docker benchmark harness"
	@echo "  make bench-docker-ab - Compare origin/main (or BASE_REF) with the worktree (or CANDIDATE_REF)"
	@echo "  make bench-docker-runtime-smoke - Check direct shellctl Runtime benchmark wiring"
	@echo "  make bench-docker-runtime-ab - Compare Runtime baseline and candidate"
	@echo "  make bench-docker-capability-smoke - Check Agent to Runtime capability wiring"
	@echo "  make bench-docker-capability-ab - Compare capability baseline and candidate"
	@echo "  make bench-docker-capacity - Build a single-target Local capacity curve"
	@echo "  make bench-e2b-capacity - Add real E2B calibration and launch quota guidance"

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
	@uv --directory "$(PROJECT_DIR)" run --project . basedpyright --level error src examples tests benchmarks

test:
	@uv --directory "$(PROJECT_DIR)" run --project . --extra server python -m pytest --import-mode=importlib tests

update-examples:
	@uv --directory "$(PROJECT_DIR)" run --project . python -m pytest --update-examples tests/docs/test_examples.py

docs:
	@uv --directory "$(PROJECT_DIR)" run --project . --group docs python -m mkdocs build --no-strict

docs-serve:
	@uv --directory "$(PROJECT_DIR)" run --project . --group docs python -m mkdocs serve --no-strict

bench-docker-smoke:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator smoke \
		$(if $(BENCH_SCENARIO),--scenario "$(BENCH_SCENARIO)",) \
		$(if $(filter 1,$(FULL_SMOKE)),--full,) \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,)

bench-docker-ab:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator ab \
		--baseline-ref "$(or $(BASE_REF),origin/main)" \
		$(if $(CANDIDATE_REF),--candidate-ref "$(CANDIDATE_REF)",) \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,) \
		$(if $(filter 1,$(BENCH_QUICK)),--quick,) \
		$(if $(BENCH_SCENARIO),--scenario "$(BENCH_SCENARIO)",)

bench-docker-runtime-smoke:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator smoke \
		--profile runtime \
		$(if $(BENCH_SCENARIO),--scenario "$(BENCH_SCENARIO)",) \
		$(if $(filter 1,$(FULL_SMOKE)),--full,) \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,)

bench-docker-runtime-ab:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator ab \
		--profile runtime \
		--baseline-ref "$(or $(BASE_REF),origin/main)" \
		$(if $(CANDIDATE_REF),--candidate-ref "$(CANDIDATE_REF)",) \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,) \
		$(if $(filter 1,$(BENCH_QUICK)),--quick,) \
		$(if $(BENCH_SCENARIO),--scenario "$(BENCH_SCENARIO)",)

bench-docker-capability-smoke:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator smoke \
		--profile capability \
		$(if $(BENCH_SCENARIO),--scenario "$(BENCH_SCENARIO)",) \
		$(if $(filter 1,$(FULL_SMOKE)),--full,) \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,)

bench-docker-capability-ab:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator ab \
		--profile capability \
		--baseline-ref "$(or $(BASE_REF),origin/main)" \
		$(if $(CANDIDATE_REF),--candidate-ref "$(CANDIDATE_REF)",) \
		$(if $(PIN_AGENT_REF),--pin-agent-ref "$(PIN_AGENT_REF)",) \
		$(if $(PIN_RUNTIME_REF),--pin-runtime-ref "$(PIN_RUNTIME_REF)",) \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,) \
		$(if $(filter 1,$(BENCH_QUICK)),--quick,) \
		$(if $(BENCH_SCENARIO),--scenario "$(BENCH_SCENARIO)",)

bench-docker-capacity:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator capacity \
		--target-ref "$(or $(TARGET_REF),1.16.1)" \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,) \
		$(if $(filter 1,$(BENCH_QUICK)),--quick,)

bench-e2b-capacity:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator e2b-capacity \
		--target-ref "$(or $(TARGET_REF),1.16.1)" \
		$(if $(CAPACITY_RESULTS_DIR),--capacity-results-dir "$(CAPACITY_RESULTS_DIR)",) \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,) \
		$(if $(filter 1,$(BENCH_QUICK)),--quick,)
