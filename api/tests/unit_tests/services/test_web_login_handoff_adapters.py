from collections.abc import Callable
from unittest.mock import MagicMock

import pytest
from redis import RedisError

from extensions.ext_redis import RedisClientWrapper
from services.web_login_handoff import WebLoginGrant, WebLoginUnavailableError
from services.web_login_handoff_adapters import RedisWebLoginGrantStore


def test_grants_are_prefixed_short_lived_and_consumed_once(
    redis_transport: tuple[RedisClientWrapper, MagicMock], config_overrides: Callable[..., None]
) -> None:
    redis, commands = redis_transport
    config_overrides(REDIS_KEY_PREFIX="deployment-a")
    records: dict[str, str] = {}

    def execute(command: str, *args: object, **kwargs: object) -> object:
        del kwargs
        key = str(args[0])
        assert key == "deployment-a:webapp:login-grant:code-digest"
        if command == "SET":
            assert "NX" in args
            assert "EX" in args
            assert 60 in args
            records[key] = str(args[1])
            return True
        if command == "GET":
            return records.get(key)
        if command == "GETDEL":
            return records.pop(key, None)
        raise AssertionError(command)

    commands.side_effect = execute
    store = RedisWebLoginGrantStore(redis=redis)
    grant = WebLoginGrant(
        tenant_id="tenant",
        app_id="app",
        app_code="code",
        account_id="account",
        expires_at=10,
        login_expires_at=100,
        code_challenge="challenge",
    )
    store.put("code-digest", grant)
    assert store.get("code-digest") == grant
    assert store.consume("code-digest") == grant
    assert store.consume("code-digest") is None


@pytest.mark.parametrize("method", ["get", "consume"])
def test_storage_failures_are_not_reported_as_bad_login_codes(
    redis_transport: tuple[RedisClientWrapper, MagicMock], method: str
) -> None:
    redis, commands = redis_transport
    commands.side_effect = RedisError("unavailable")
    with pytest.raises(WebLoginUnavailableError):
        getattr(RedisWebLoginGrantStore(redis=redis), method)("code-digest")
