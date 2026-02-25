import json

from core.helper.tool_parameter_cache import ToolParameterCache, ToolParameterCacheType


def test_tool_parameter_cache_get_returns_decoded_dict() -> None:
    cache = ToolParameterCache(
        tenant_id="tenant",
        provider="provider",
        tool_name="tool",
        cache_type=ToolParameterCacheType.PARAMETER,
        identity_id="identity",
    )
    payload = {"k": "v", "n": 1}
    cache_key = cache.cache_key

    from extensions.ext_redis import redis_client

    redis_client.get.return_value = json.dumps(payload).encode("utf-8")

    assert cache.get() == payload
    redis_client.get.assert_called_once_with(cache_key)


def test_tool_parameter_cache_get_returns_none_for_invalid_json() -> None:
    cache = ToolParameterCache(
        tenant_id="tenant",
        provider="provider",
        tool_name="tool",
        cache_type=ToolParameterCacheType.PARAMETER,
        identity_id="identity",
    )

    from extensions.ext_redis import redis_client

    redis_client.get.return_value = b"{invalid-json"

    assert cache.get() is None


def test_tool_parameter_cache_set_and_delete() -> None:
    cache = ToolParameterCache(
        tenant_id="tenant",
        provider="provider",
        tool_name="tool",
        cache_type=ToolParameterCacheType.PARAMETER,
        identity_id="identity",
    )

    from extensions.ext_redis import redis_client

    params = {"a": "b"}
    cache.set(params)
    cache.delete()

    redis_client.setex.assert_called_once_with(cache.cache_key, 86400, json.dumps(params))
    redis_client.delete.assert_called_once_with(cache.cache_key)

