"""Regression tests for side-effect-free scheduled-task imports."""

import importlib
import logging
import sys

import pytest

from extensions import ext_redis


@pytest.mark.parametrize(
    ("module_name", "queue"),
    [
        ("schedule.check_upgradable_plugin_task", "plugin"),
        ("schedule.clean_embedding_cache_task", "dataset"),
        ("schedule.clean_oauth_access_tokens_task", "retention"),
        ("schedule.create_tidb_serverless_task", "dataset"),
        ("schedule.queue_monitor_task", "monitor"),
        ("schedule.update_tidb_serverless_status_task", "dataset"),
    ],
)
def test_task_module_import_does_not_initialize_application(
    module_name: str,
    queue: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Importing a task must not configure process-wide logging or Redis.

    Pytest-xdist imports every collected test module in each worker. Importing
    ``app`` from a task module would therefore initialize the full Flask app in
    every worker and leak its logging filters and real Redis client into
    unrelated unit tests.
    """
    root_handlers = tuple(logging.root.handlers)
    redis_backing_client = ext_redis.redis_client._client

    monkeypatch.delitem(sys.modules, "app", raising=False)
    monkeypatch.delitem(sys.modules, module_name, raising=False)

    task_module = importlib.import_module(module_name)
    task_name = module_name.rsplit(".", maxsplit=1)[-1]
    task = getattr(task_module, task_name)

    assert "app" not in sys.modules
    assert tuple(logging.root.handlers) == root_handlers
    assert ext_redis.redis_client._client is redis_backing_client
    assert getattr(task, "queue", None) == queue
