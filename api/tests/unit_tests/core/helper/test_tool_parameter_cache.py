import json
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from redis.exceptions import ConnectionError

from core.helper.tool_parameter_cache import ToolParameterCache, ToolParameterCacheType
from extensions.ext_redis import RedisClientWrapper


def test_tool_parameter_cache_get_returns_decoded_dict(mocker: MockerFixture) -> None:
    redis_client_mock = mocker.patch("core.helper.tool_parameter_cache.redis_client")
    cache = ToolParameterCache(
        tenant_id="tenant",
        provider="provider",
        tool_name="tool",
        cache_type=ToolParameterCacheType.PARAMETER,
        identity_id="identity",
    )
    payload = {"k": "v", "n": 1}
    cache_key = cache.cache_key

    redis_client_mock.get.return_value = json.dumps(payload).encode("utf-8")

    assert cache.get() == payload
    redis_client_mock.get.assert_called_once_with(cache_key)


def test_tool_parameter_cache_get_returns_none_for_invalid_json(mocker: MockerFixture) -> None:
    redis_client_mock = mocker.patch("core.helper.tool_parameter_cache.redis_client")
    cache = ToolParameterCache(
        tenant_id="tenant",
        provider="provider",
        tool_name="tool",
        cache_type=ToolParameterCacheType.PARAMETER,
        identity_id="identity",
    )

    redis_client_mock.get.return_value = b"{invalid-json"

    assert cache.get() is None


def test_tool_parameter_cache_get_returns_none_for_invalid_utf8(mocker: MockerFixture) -> None:
    redis_client_mock = mocker.patch("core.helper.tool_parameter_cache.redis_client")
    cache = ToolParameterCache(
        tenant_id="tenant",
        provider="provider",
        tool_name="tool",
        cache_type=ToolParameterCacheType.PARAMETER,
        identity_id="identity",
    )

    redis_client_mock.get.return_value = b"\xff"

    assert cache.get() is None


def test_tool_parameter_cache_get_returns_none_when_key_is_missing(mocker: MockerFixture) -> None:
    redis_client_mock = mocker.patch("core.helper.tool_parameter_cache.redis_client")
    cache = ToolParameterCache(
        tenant_id="tenant",
        provider="provider",
        tool_name="tool",
        cache_type=ToolParameterCacheType.PARAMETER,
        identity_id="identity",
    )

    redis_client_mock.get.return_value = None

    assert cache.get() is None


def test_tool_parameter_cache_set_and_delete(mocker: MockerFixture) -> None:
    redis_client_mock = mocker.patch("core.helper.tool_parameter_cache.redis_client")
    cache = ToolParameterCache(
        tenant_id="tenant",
        provider="provider",
        tool_name="tool",
        cache_type=ToolParameterCacheType.PARAMETER,
        identity_id="identity",
    )

    params = {"a": "b"}
    cache.set(params)
    cache.delete()

    redis_client_mock.setex.assert_called_once_with(cache.cache_key, 86400, json.dumps(params))
    redis_client_mock.delete.assert_called_once_with(cache.cache_key)


@pytest.mark.parametrize(
    "payload",
    [
        None,
        b"",
        b"{invalid-json",
        b"\xff",
        b"null",
        b"true",
        b"42",
        b"1.5",
        b'"secret"',
        b"[]",
        b'[["api_key", "secret"]]',
        b'["ab"]',
    ],
)
def test_get_treats_invalid_entries_as_cache_misses(
    payload: bytes | None,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Given missing or invalid cached data, return a miss without mutating it."""
    redis, commands = redis_transport
    monkeypatch.setattr("core.helper.tool_parameter_cache.redis_client", redis)
    cache = ToolParameterCache(
        tenant_id="tenant",
        provider="provider",
        tool_name="tool",
        cache_type=ToolParameterCacheType.PARAMETER,
        identity_id="identity",
    )
    commands.return_value = payload

    assert cache.get() is None
    commands.assert_called_once_with("GET", cache.cache_key, keys=[cache.cache_key])


@pytest.mark.parametrize("payload", [{}, {"api_key": "密钥", "options": [1, True, None, {"nested": "value"}]}])
def test_get_preserves_json_object_values(
    payload: dict[str, object],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Given a JSON object, preserve its keys and arbitrary nested values."""
    redis, commands = redis_transport
    monkeypatch.setattr("core.helper.tool_parameter_cache.redis_client", redis)
    cache = ToolParameterCache(
        tenant_id="tenant",
        provider="provider",
        tool_name="tool",
        cache_type=ToolParameterCacheType.PARAMETER,
        identity_id="identity",
    )
    commands.return_value = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    assert cache.get() == payload


def test_get_propagates_redis_failures(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Given a Redis outage, propagate it rather than report a cache miss."""
    redis, commands = redis_transport
    monkeypatch.setattr("core.helper.tool_parameter_cache.redis_client", redis)
    cache = ToolParameterCache(
        tenant_id="tenant",
        provider="provider",
        tool_name="tool",
        cache_type=ToolParameterCacheType.PARAMETER,
        identity_id="identity",
    )
    commands.side_effect = ConnectionError("Redis unavailable")

    with pytest.raises(ConnectionError, match="Redis unavailable"):
        cache.get()
