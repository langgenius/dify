.DEFAULT_GOAL := help

.PHONY: help typecheck test

help:
	@echo "Dify agent targets:"
	@echo "  make typecheck - Run basedpyright for dify-agent src and tests"
	@echo "  make test      - Run dify-agent pytest suite"

typecheck:
	@uv run --project . python -m basedpyright --level error src tests

test:
	@uv run --project . python -m pytest tests
