from unittest.mock import MagicMock, patch

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import LockError
from redis.lock import Lock

from extensions.ext_redis import RedisClientWrapper
from services.setup_adapters import RedisSetupLock


def test_acquire_uses_bounded_distributed_lock(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> None:
    redis, commands = redis_transport
    lock_context = RedisSetupLock(client=redis).acquire()
    assert isinstance(lock_context, Lock)
    assert lock_context.name == "setup:initialize"
    assert lock_context.timeout == 300
    assert lock_context.blocking_timeout == 300

    with (
        patch.object(lock_context, "acquire", return_value=True) as acquire,
        patch.object(lock_context, "release") as release,
    ):
        with lock_context:
            acquire.assert_called_once()
            release.assert_not_called()
        release.assert_called_once()
    commands.assert_not_called()


@pytest.mark.parametrize(
    "error",
    [
        pytest.param(LockError("lock acquisition timed out"), id="timeout"),
        pytest.param(RedisConnectionError("redis unavailable"), id="connection"),
    ],
)
def test_acquire_propagates_distributed_lock_failure(
    redis_transport: tuple[RedisClientWrapper, MagicMock], error: Exception
) -> None:
    redis, commands = redis_transport
    lock_context = RedisSetupLock(client=redis).acquire()
    assert isinstance(lock_context, Lock)

    with patch.object(lock_context, "acquire", side_effect=error), patch.object(lock_context, "release") as release:
        with pytest.raises(type(error), match=str(error)) as raised:
            with lock_context:
                pytest.fail("lock body must not run")
        release.assert_not_called()

    assert raised.value is error
    commands.assert_not_called()
