from contextlib import nullcontext
from unittest.mock import MagicMock

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import LockError

from extensions.ext_redis import RedisClientWrapper
from services.setup_adapters import RedisSetupLock


def test_acquire_uses_bounded_distributed_lock() -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    redis.lock.return_value = nullcontext()
    lock = RedisSetupLock(client=redis)

    with lock.acquire():
        pass

    redis.lock.assert_called_once_with(
        "setup:initialize",
        timeout=300,
        blocking_timeout=300,
    )


@pytest.mark.parametrize(
    "error",
    [
        pytest.param(LockError("lock acquisition timed out"), id="timeout"),
        pytest.param(RedisConnectionError("redis unavailable"), id="connection"),
    ],
)
def test_acquire_propagates_distributed_lock_failure(error: Exception) -> None:
    redis = MagicMock(spec=RedisClientWrapper)
    lock_context = MagicMock()
    lock_context.__enter__.side_effect = error
    redis.lock.return_value = lock_context
    lock = RedisSetupLock(client=redis)

    with pytest.raises(type(error), match=str(error)) as raised:
        with lock.acquire():
            pytest.fail("lock body must not run")

    assert raised.value is error
    lock_context.__exit__.assert_not_called()
