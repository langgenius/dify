.DEFAULT_GOAL := help

.PHONY: help lint typecheck test

help:
	@echo "Dify agent targets:"
	@echo "  make lint      - Run Ruff for dify-agent"
	@echo "  make typecheck - Run basedpyright for dify-agent src and tests"
	@echo "  make test      - Run dify-agent pytest suite"

lint:
	@uv run --project . python -m ruff check .

typecheck:
	@uv run --project . python -m basedpyright --level error src tests

test:
	@uv run --project . python -m pytest tests
