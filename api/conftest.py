"""Global pytest hooks for Dify backend tests.

This root conftest is loaded before package-specific conftests, which lets tests opt
into Docker-backed middleware before application modules read environment config.
It intentionally lives at the API root because pytest applies conftest.py files to
tests below their directory, and this setup is shared by api/tests and api/providers.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.pytest_dify import (
    DEFAULT_MIDDLEWARE_SERVICES,
    DEFAULT_VDB_SERVICES,
    DockerComposeStack,
    build_middleware_stack,
    build_vdb_stack,
    ensure_backend_test_environment,
    ensure_compose_env_files,
    parse_services,
)

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DIFY_COMPOSE_STACKS_KEY = pytest.StashKey[list[DockerComposeStack]]()

# This must run at import time because package-specific conftests can import the
# Flask app before pytest_configure hooks from this file are called.
ensure_backend_test_environment(_REPO_ROOT)


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("dify")
    group.addoption(
        "--start-middleware",
        action="store_true",
        default=False,
        help="Start the Docker middleware services needed by API integration tests.",
    )
    group.addoption(
        "--middleware-services",
        default=",".join(DEFAULT_MIDDLEWARE_SERVICES),
        help="Comma-separated services from docker/docker-compose.middleware.yaml to start.",
    )
    group.addoption(
        "--start-vdb",
        action="store_true",
        default=False,
        help="Start vector-store Docker services for VDB integration tests.",
    )
    group.addoption(
        "--vdb-services",
        default=",".join(DEFAULT_VDB_SERVICES),
        help="Comma-separated services from docker/docker-compose.yaml to start for VDB tests.",
    )


def pytest_configure(config: pytest.Config) -> None:
    config.stash[_DIFY_COMPOSE_STACKS_KEY] = []


def pytest_sessionstart(session: pytest.Session) -> None:
    config = session.config
    if hasattr(config, "workerinput"):
        return

    stacks: list[DockerComposeStack] = []
    if config.getoption("start_middleware"):
        ensure_compose_env_files(_REPO_ROOT)
        stack = build_middleware_stack(_REPO_ROOT, parse_services(config.getoption("middleware_services")))
        stack.up()
        stacks.append(stack)

    if config.getoption("start_vdb"):
        ensure_compose_env_files(_REPO_ROOT)
        stack = build_vdb_stack(_REPO_ROOT, parse_services(config.getoption("vdb_services")))
        stack.up()
        stacks.append(stack)

    config.stash[_DIFY_COMPOSE_STACKS_KEY] = stacks


def pytest_unconfigure(config: pytest.Config) -> None:
    if hasattr(config, "workerinput"):
        return

    stacks = config.stash.get(_DIFY_COMPOSE_STACKS_KEY, [])
    for stack in reversed(stacks):
        stack.down()
