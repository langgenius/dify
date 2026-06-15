import json

from pytest_mock import MockerFixture

from core.helper.tool_parameter_cache import ToolParameterCache, ToolParameterCacheType


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
