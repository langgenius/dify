import threading
from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest
from redis import Redis

from extensions.ext_redis import RedisClientWrapper
from services.retention.workflow_run.archive_month_lock import _MonthLease
from tests.unit_tests.config_override import apply_config_overrides


@pytest.fixture
def redis_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[tuple[RedisClientWrapper, MagicMock]]:
    apply_config_overrides(monkeypatch, REDIS_KEY_PREFIX="")
    with Redis() as client, patch.object(client, "execute_command", return_value=None) as commands:
        wrapper = RedisClientWrapper()
        wrapper.initialize(client)
        yield wrapper, commands


@pytest.fixture
def month_lease(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> Generator[_MonthLease]:
    redis, _commands = redis_transport
    lock = redis.lock("archive-test", timeout=120, thread_local=False)
    with patch.object(lock, "owned", return_value=True):
        yield _MonthLease(lock, threading.Event())
