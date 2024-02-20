.PHONY: style test install_local_dev

style:
	ruff check --fix ./api

test:
	pytest api/tests

install_local_dev:
	pip install pre-commit ruff
	pre-commit install
