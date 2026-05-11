.DEFAULT_GOAL := help

.PHONY: help lint format typecheck test update-examples docs docs-serve

help:
	@echo "Dify agent targets:"
	@echo "  make lint            - Run Ruff for dify-agent"
	@echo "  make format          - Format and fix Ruff issues"
	@echo "  make typecheck       - Run basedpyright for src, examples, and tests"
	@echo "  make test            - Run local tests and docs/example tests"
	@echo "  make update-examples - Rewrite docs example outputs when needed"
	@echo "  make docs            - Build MkDocs documentation"
	@echo "  make docs-serve      - Serve MkDocs documentation locally"

lint:
	@uv run --project . python -m ruff check .

format:
	@uv run --project . python -m ruff format .
	@uv run --project . python -m ruff check --fix .

typecheck:
	@uv run --project . python -m basedpyright --level error src examples tests

test:
	@uv run --project . python -m pytest tests

update-examples:
	@uv run --project . python -m pytest --update-examples tests/docs/test_examples.py

docs:
	@uv run --project . --group docs python -m mkdocs build --no-strict

docs-serve:
	@uv run --project . --group docs python -m mkdocs serve --no-strict
