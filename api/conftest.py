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
from tests.pytest_sharding import DurationRecorder, assign_shards, load_durations

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DIFY_COMPOSE_STACKS_KEY = pytest.StashKey[list[DockerComposeStack]]()
_SHARD_DURATIONS_KEY = pytest.StashKey[dict[str, float]]()

# This must run at import time because package-specific conftests can import the
# Flask app before pytest_configure hooks from this file are called.
ensure_backend_test_environment(_REPO_ROOT)


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("dify")
    group.addoption(
        "--shard-index",
        type=int,
        default=1,
        help="One-based index of the test shard to run.",
    )
    group.addoption(
        "--shard-total",
        type=int,
        default=1,
        help="Total number of test shards.",
    )
    group.addoption("--shard-durations", type=Path, help="Shared JSON duration history for balanced sharding.")
    group.addoption("--write-test-durations", type=Path, help="Write successful test phase totals as JSON.")
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
    shard_index = config.getoption("shard_index")
    shard_total = config.getoption("shard_total")
    if shard_total < 1:
        raise pytest.UsageError("--shard-total must be at least 1")
    if not 1 <= shard_index <= shard_total:
        raise pytest.UsageError("--shard-index must be between 1 and --shard-total")

    config.stash[_DIFY_COMPOSE_STACKS_KEY] = []
    history_path = config.getoption("shard_durations")
    try:
        config.stash[_SHARD_DURATIONS_KEY] = load_durations(history_path) if history_path else {}
    except (OSError, ValueError) as error:
        raise pytest.UsageError(f"Cannot read shard duration history: {error}") from error

    output_path = config.getoption("write_test_durations")
    if output_path and not hasattr(config, "workerinput"):
        config.pluginmanager.register(DurationRecorder(output_path), "dify-duration-recorder")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Select a deterministic shard while retaining the original collection order."""
    shard_index = config.getoption("shard_index")
    shard_total = config.getoption("shard_total")
    if shard_total == 1:
        return

    assignments = assign_shards([item.nodeid for item in items], shard_total, config.stash[_SHARD_DURATIONS_KEY])
    selected: list[pytest.Item] = []
    deselected: list[pytest.Item] = []
    for item in items:
        target = selected if assignments[item.nodeid] == shard_index - 1 else deselected
        target.append(item)

    config.hook.pytest_deselected(items=deselected)
    items[:] = selected


def pytest_report_header(config: pytest.Config) -> str | None:
    if config.getoption("shard_durations"):
        count = len(config.stash[_SHARD_DURATIONS_KEY])
        return f"Dify shard duration history: {count} recorded tests"
    return None


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
