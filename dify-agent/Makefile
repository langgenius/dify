.DEFAULT_GOAL := help

PROJECT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

.PHONY: help serve dev check fix typecheck test update-examples docs docs-serve bench-docker-smoke bench-docker-ab

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
	@uv --directory "$(PROJECT_DIR)" run --project . --extra server python -m pytest tests

update-examples:
	@uv --directory "$(PROJECT_DIR)" run --project . python -m pytest --update-examples tests/docs/test_examples.py

docs:
	@uv --directory "$(PROJECT_DIR)" run --project . --group docs python -m mkdocs build --no-strict

docs-serve:
	@uv --directory "$(PROJECT_DIR)" run --project . --group docs python -m mkdocs serve --no-strict

bench-docker-smoke:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator smoke \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,)

bench-docker-ab:
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.orchestrator ab \
		--baseline-ref "$(or $(BASE_REF),origin/main)" \
		$(if $(CANDIDATE_REF),--candidate-ref "$(CANDIDATE_REF)",) \
		$(if $(filter 1,$(KEEP_CONTAINERS)),--keep-containers,) \
		$(if $(filter 1,$(BENCH_QUICK)),--quick,) \
		$(if $(BENCH_SCENARIO),--scenario "$(BENCH_SCENARIO)",)
