"""Global pytest hooks for Dify backend tests.

This root conftest is loaded before package-specific conftests, which lets tests opt
into Docker-backed middleware before application modules read environment config.
It intentionally lives at the API root because pytest applies conftest.py files to
tests below their directory, and this setup is shared by api/tests and api/providers.
"""

from __future__ import annotations

from dataclasses import replace
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
    group.addoption("--file-shard-plan", type=Path, help="Shared pre-collection file/partition assignment.")
    group.addoption("--write-test-durations", type=Path, help="Write successful-run file durations for CI history.")
    group.addoption(
        "--middleware-stop-timeout",
        type=int,
        default=None,
        help="Override the shutdown grace period in seconds for pytest-started middleware only.",
    )
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
    stop_timeout = config.getoption("middleware_stop_timeout")
    if stop_timeout is not None and stop_timeout < 0:
        raise pytest.UsageError("--middleware-stop-timeout must be nonnegative")

    durations_path = config.getoption("write_test_durations")
    if durations_path is not None and not hasattr(config, "workerinput"):
        from tests.pytest_timing import TestDurationsPlugin

        config.pluginmanager.register(TestDurationsPlugin(durations_path), "dify-test-durations")

    config.stash[_DIFY_COMPOSE_STACKS_KEY] = []


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Apply the shared file plan, or the legacy round-robin testcase shard."""
    shard_index = config.getoption("shard_index")
    shard_total = config.getoption("shard_total")
    if plan_path := config.getoption("file_shard_plan"):
        import json

        from dev.pytest_sharding import case_shard

        plan = json.loads(plan_path.read_text())
        selected_items: list[pytest.Item] = []
        deselected_items: list[pytest.Item] = []
        for item in items:
            filename = item.path.relative_to(_REPO_ROOT).as_posix()
            # Missing files are a broken plan, not an excuse to silently drop tests.
            targets = plan[filename]
            case = item.nodeid.split("::", 1)[1]
            destination = selected_items if case_shard(case, targets) == shard_index else deselected_items
            destination.append(item)
        config.hook.pytest_deselected(items=deselected_items)
        items[:] = selected_items
        return
    if shard_total == 1:
        return

    selected: list[pytest.Item] = []
    deselected: list[pytest.Item] = []
    for item_index, item in enumerate(items):
        target = selected if item_index % shard_total == shard_index - 1 else deselected
        target.append(item)

    config.hook.pytest_deselected(items=deselected)
    items[:] = selected


def pytest_sessionstart(session: pytest.Session) -> None:
    config = session.config
    if hasattr(config, "workerinput"):
        return

    stacks: list[DockerComposeStack] = []
    if config.getoption("start_middleware"):
        ensure_compose_env_files(_REPO_ROOT)
        stack = build_middleware_stack(_REPO_ROOT, parse_services(config.getoption("middleware_services")))
        stack = replace(
            stack,
            shutdown_timeout_seconds=config.getoption("middleware_stop_timeout"),
        )
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
