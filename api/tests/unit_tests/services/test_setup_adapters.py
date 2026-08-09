from contextlib import nullcontext
from unittest.mock import ANY, MagicMock, patch

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import LockError
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from services.setup_adapters import RedisSetupLock, RegisterServiceAccountProvisioner
from services.setup_service import SetupInput


def test_provision_delegates_to_register_service_with_managed_session(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    provisioner = RegisterServiceAccountProvisioner(client=sqlite_session_factory)
    setup = SetupInput(
        email="admin@example.com",
        name="Admin",
        password="Passw0rd1",
        ip_address="203.0.113.7",
        language="en-US",
    )

    with patch("services.setup_adapters.RegisterService.setup") as register:
        provisioner.provision(setup)

    register.assert_called_once_with(
        email="admin@example.com",
        name="Admin",
        password="Passw0rd1",
        ip_address="203.0.113.7",
        language="en-US",
        session=ANY,
    )
    assert isinstance(register.call_args.kwargs["session"], Session)


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
