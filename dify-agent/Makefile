.DEFAULT_GOAL := help

PROJECT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
STAGING_BUILD_DIR ?= $(PROJECT_DIR)/benchmarks/build/staging
STAGING_FIXTURE_DIR ?= $(STAGING_BUILD_DIR)/config-fixtures
STAGING_PLUGIN_DIR := $(PROJECT_DIR)/benchmarks/staging_plugin
STAGING_PLUGIN_PACKAGE ?= $(STAGING_BUILD_DIR)/dify-agent-benchmark-model-0.1.2.difypkg
DIFY_PLUGIN_CLI ?= dify

.PHONY: help serve dev check fix typecheck test update-examples docs docs-serve \
	bench-local-runtime bench-local-e2b bench-sizing \
	bench-staging-fixtures bench-staging-plugin-package \
	bench-staging-public-smoke bench-staging-public-scaling-stage \
	bench-staging-public-scaling-report

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
	@echo "  make bench-staging-fixtures - Build deterministic Staging Config fixtures locally"
	@echo "  make bench-staging-plugin-package - Package the deterministic model plugin locally"
	@echo "  make bench-staging-public-smoke - Run one confirmed local-to-public c1 smoke"
	@echo "  make bench-staging-public-scaling-stage - Run one confirmed 1/2/4-replica public scaling stage"
	@echo "  make bench-staging-public-scaling-report - Aggregate three validated replica-stage results"

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
	@test -n "$(E2B_TEMPLATE_VCPUS)" || (echo "E2B_TEMPLATE_VCPUS is required" >&2; exit 2)
	@test -n "$(E2B_TEMPLATE_RAM_GB)" || (echo "E2B_TEMPLATE_RAM_GB is required" >&2; exit 2)
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --group benchmark \
		python -m benchmarks.sizing \
		--capacity-result "$(CAPACITY_RESULT)" \
		--monthly-runs "$(MONTHLY_RUNS)" \
		--peak-rps "$(PEAK_RPS)" \
		--e2b-concurrency "$(E2B_CONCURRENCY)" \
		--e2b-template-vcpus "$(E2B_TEMPLATE_VCPUS)" \
		--e2b-template-ram-gb "$(E2B_TEMPLATE_RAM_GB)"

bench-staging-fixtures:
	@test ! -e "$(STAGING_FIXTURE_DIR)" || \
		(echo "STAGING_FIXTURE_DIR already exists; choose an empty path: $(STAGING_FIXTURE_DIR)" >&2; exit 2)
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --group benchmark \
		python -m benchmarks.staging_fixtures --output "$(STAGING_FIXTURE_DIR)"

bench-staging-plugin-package:
	@command -v "$(DIFY_PLUGIN_CLI)" >/dev/null 2>&1 || \
		(echo "Dify CLI is required (set DIFY_PLUGIN_CLI or verify with: dify version)" >&2; exit 2)
	@test ! -e "$(STAGING_PLUGIN_PACKAGE)" || \
		(echo "STAGING_PLUGIN_PACKAGE already exists: $(STAGING_PLUGIN_PACKAGE)" >&2; exit 2)
	@mkdir -p "$(dir $(STAGING_PLUGIN_PACKAGE))"
	@"$(DIFY_PLUGIN_CLI)" plugin package "$(STAGING_PLUGIN_DIR)" -o "$(STAGING_PLUGIN_PACKAGE)"

bench-staging-public-smoke:
	@test "$(BENCH_CONFIRM_STAGING_RUN)" = "RUN_STAGING_BENCHMARK" || \
		(echo "refusing Staging execution: set BENCH_CONFIRM_STAGING_RUN=RUN_STAGING_BENCHMARK" >&2; exit 2)
	@test -n "$${BENCH_STAGING_API_KEY:-}" || \
		(echo "BENCH_STAGING_API_KEY must be provided through the environment" >&2; exit 2)
	@BENCH_CONFIRM_STAGING_RUN="$(BENCH_CONFIRM_STAGING_RUN)" \
		UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.staging_public_cli \
		--service-api-base-url "$(or $(BENCH_STAGING_BASE_URL),https://api-staging.dify.dev/v1/)" \
		$(if $(BENCH_STAGING_PLUGIN_PACKAGE),--plugin-package "$(BENCH_STAGING_PLUGIN_PACKAGE)",) \
		$(if $(BENCH_CONFIG_EXPECTED_SHA256),--config-expected-sha256 "$(BENCH_CONFIG_EXPECTED_SHA256)",) \
		$(if $(BENCH_RUN_ID),--run-id "$(BENCH_RUN_ID)",) \
		$(if $(BENCH_RESULTS_ROOT),--results-root "$(BENCH_RESULTS_ROOT)",)

bench-staging-public-scaling-stage:
	@test "$(BENCH_CONFIRM_STAGING_RUN)" = "RUN_STAGING_BENCHMARK" || \
		(echo "refusing Staging execution: set BENCH_CONFIRM_STAGING_RUN=RUN_STAGING_BENCHMARK" >&2; exit 2)
	@test -n "$${BENCH_STAGING_API_KEY:-}" || \
		(echo "BENCH_STAGING_API_KEY must be provided through the environment" >&2; exit 2)
	@test -n "$${BENCH_E2B_API_KEY:-}" || \
		(echo "BENCH_E2B_API_KEY must be provided through the environment" >&2; exit 2)
	@case "$(BACKEND_REPLICAS)" in 1|2|4) ;; *) \
		echo "BACKEND_REPLICAS must be 1, 2, or 4" >&2; exit 2 ;; esac
	@test -n "$(BENCH_TENANT_ID)" || (echo "BENCH_TENANT_ID is required" >&2; exit 2)
	@test -n "$(BENCH_AGENT_ID)" || (echo "BENCH_AGENT_ID is required" >&2; exit 2)
	@BENCH_CONFIRM_STAGING_RUN="$(BENCH_CONFIRM_STAGING_RUN)" \
		UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.staging_public_capacity_cli \
		--backend-replicas "$(BACKEND_REPLICAS)" \
		--service-api-base-url "$(or $(BENCH_STAGING_BASE_URL),https://api-staging.dify.dev/v1/)" \
		$(if $(BENCH_STAGING_PLUGIN_PACKAGE),--plugin-package "$(BENCH_STAGING_PLUGIN_PACKAGE)",) \
		$(if $(BENCH_CONFIG_EXPECTED_SHA256),--config-expected-sha256 "$(BENCH_CONFIG_EXPECTED_SHA256)",) \
		$(if $(BENCH_STAGING_SCENARIO),--scenario "$(BENCH_STAGING_SCENARIO)",) \
		$(if $(BENCH_CONCURRENCY),--concurrency "$(BENCH_CONCURRENCY)",) \
		$(if $(BENCH_RUN_ID),--run-id "$(BENCH_RUN_ID)",) \
		$(if $(BENCH_RESULTS_ROOT),--results-root "$(BENCH_RESULTS_ROOT)",) \
		$(if $(BENCH_PRIVATE_RECOVERY_ROOT),--private-recovery-root "$(BENCH_PRIVATE_RECOVERY_ROOT)",) \
		--kube-context "$(or $(BENCH_STAGING_KUBE_CONTEXT),staging-main)" \
		--namespace "$(or $(BENCH_STAGING_NAMESPACE),dify-staging)" \
		--benchmark-tenant-id "$(BENCH_TENANT_ID)" \
		--benchmark-agent-id "$(BENCH_AGENT_ID)"

bench-staging-public-scaling-report:
	@test -n "$(R1_RESULT)" || (echo "R1_RESULT is required" >&2; exit 2)
	@test -n "$(R2_RESULT)" || (echo "R2_RESULT is required" >&2; exit 2)
	@test -n "$(R4_RESULT)" || (echo "R4_RESULT is required" >&2; exit 2)
	@UV_PYTHON=3.12.13 uv --directory "$(PROJECT_DIR)" run --project . --extra server --group benchmark \
		python -m benchmarks.staging_public_scaling_report_cli \
		--replica-1-result "$(R1_RESULT)" \
		--replica-2-result "$(R2_RESULT)" \
		--replica-4-result "$(R4_RESULT)" \
		$(if $(BENCH_SCALING_OUTPUT_DIR),--output-dir "$(BENCH_SCALING_OUTPUT_DIR)",)
