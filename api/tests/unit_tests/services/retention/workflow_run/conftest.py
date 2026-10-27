import threading
from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest

from extensions.ext_redis import RedisClientWrapper
from services.retention.workflow_run.archive_month_lock import _MonthLease


@pytest.fixture
def month_lease(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> Generator[_MonthLease]:
    redis, _commands = redis_transport
    lock = redis.lock("archive-test", timeout=120, thread_local=False)
    with patch.object(lock, "owned", return_value=True):
        yield _MonthLease(lock, threading.Event())
