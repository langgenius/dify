.DEFAULT_GOAL := help

PROJECT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

.PHONY: help check fix typecheck test update-examples docs docs-serve

help:
	@echo "Dify agent targets:"
	@echo "  make check           - Run Ruff for dify-agent"
	@echo "  make fix             - Format and fix Ruff issues"
	@echo "  make typecheck       - Run basedpyright for src, examples, and tests"
	@echo "  make test            - Run local tests and docs/example tests"
	@echo "  make update-examples - Rewrite docs example outputs when needed"
	@echo "  make docs            - Build MkDocs documentation"
	@echo "  make docs-serve      - Serve MkDocs documentation locally"

check:
	@uv --directory "$(PROJECT_DIR)" run --project . python -m ruff check .

fix:
	@uv --directory "$(PROJECT_DIR)" run --project . python -m ruff format .
	@uv --directory "$(PROJECT_DIR)" run --project . python -m ruff check --fix .

typecheck:
	@uv --directory "$(PROJECT_DIR)" run --project . basedpyright --level error src examples tests

test:
	@uv --directory "$(PROJECT_DIR)" run --project . python -m pytest tests

update-examples:
	@uv --directory "$(PROJECT_DIR)" run --project . python -m pytest --update-examples tests/docs/test_examples.py

docs:
	@uv --directory "$(PROJECT_DIR)" run --project . --group docs python -m mkdocs build --no-strict

docs-serve:
	@uv --directory "$(PROJECT_DIR)" run --project . --group docs python -m mkdocs serve --no-strict
