import json
from unittest.mock import patch

import pytest
from redis.exceptions import RedisError

from core.helper.tool_provider_cache import ToolProviderListCache
from core.tools.entities.api_entities import ToolProviderTypeApiLiteral


@pytest.fixture
def mock_redis_client():
    """Fixture: Mock Redis client"""
    with patch("core.helper.tool_provider_cache.redis_client") as mock:
        yield mock


class TestToolProviderListCache:
    """Test class for ToolProviderListCache"""

    def test_generate_cache_key(self):
        """Test cache key generation logic"""
        # Scenario 1: Specify typ (valid literal value)
        tenant_id = "tenant_123"
        typ: ToolProviderTypeApiLiteral = "builtin"
        expected_key = f"tool_providers:tenant_id:{tenant_id}:type:{typ}"
        assert ToolProviderListCache._generate_cache_key(tenant_id, typ) == expected_key

        # Scenario 2: typ is None (defaults to "all")
        expected_key_all = f"tool_providers:tenant_id:{tenant_id}:type:all"
        assert ToolProviderListCache._generate_cache_key(tenant_id) == expected_key_all

    def test_get_cached_providers_hit(self, mock_redis_client):
        """Test get cached providers - cache hit and successful decoding"""
        tenant_id = "tenant_123"
        typ: ToolProviderTypeApiLiteral = "api"
        mock_providers = [{"id": "tool", "name": "test_provider"}]
        mock_redis_client.get.return_value = json.dumps(mock_providers).encode("utf-8")

        result = ToolProviderListCache.get_cached_providers(tenant_id, typ)

        mock_redis_client.get.assert_called_once_with(ToolProviderListCache._generate_cache_key(tenant_id, typ))
        assert result == mock_providers

    def test_get_cached_providers_decode_error(self, mock_redis_client):
        """Test get cached providers - cache hit but decoding failed"""
        tenant_id = "tenant_123"
        mock_redis_client.get.return_value = b"invalid_json_data"

        result = ToolProviderListCache.get_cached_providers(tenant_id)

        assert result is None
        mock_redis_client.get.assert_called_once()

    def test_get_cached_providers_miss(self, mock_redis_client):
        """Test get cached providers - cache miss"""
        tenant_id = "tenant_123"
        mock_redis_client.get.return_value = None

        result = ToolProviderListCache.get_cached_providers(tenant_id)

        assert result is None
        mock_redis_client.get.assert_called_once()

    def test_set_cached_providers(self, mock_redis_client):
        """Test set cached providers"""
        tenant_id = "tenant_123"
        typ: ToolProviderTypeApiLiteral = "builtin"
        mock_providers = [{"id": "tool", "name": "test_provider"}]
        cache_key = ToolProviderListCache._generate_cache_key(tenant_id, typ)

        ToolProviderListCache.set_cached_providers(tenant_id, typ, mock_providers)

        mock_redis_client.setex.assert_called_once_with(
            cache_key, ToolProviderListCache.CACHE_TTL, json.dumps(mock_providers)
        )

    def test_invalidate_cache_specific_type(self, mock_redis_client):
        """Test invalidate cache - specific type"""
        tenant_id = "tenant_123"
        typ: ToolProviderTypeApiLiteral = "workflow"
        cache_key = ToolProviderListCache._generate_cache_key(tenant_id, typ)

        ToolProviderListCache.invalidate_cache(tenant_id, typ)

        mock_redis_client.delete.assert_called_once_with(cache_key)

    def test_invalidate_cache_all_types(self, mock_redis_client):
        """Test invalidate cache - clear all tenant cache"""
        tenant_id = "tenant_123"
        mock_keys = [
            b"tool_providers:tenant_id:tenant_123:type:all",
            b"tool_providers:tenant_id:tenant_123:type:builtin",
        ]
        mock_redis_client.scan_iter.return_value = mock_keys

        ToolProviderListCache.invalidate_cache(tenant_id)

        mock_redis_client.scan_iter.assert_called_once_with(f"tool_providers:tenant_id:{tenant_id}:*")
        mock_redis_client.delete.assert_called_once_with(*mock_keys)

    def test_invalidate_cache_no_keys(self, mock_redis_client):
        """Test invalidate cache - no cache keys for tenant"""
        tenant_id = "tenant_123"
        mock_redis_client.scan_iter.return_value = []

        ToolProviderListCache.invalidate_cache(tenant_id)

        mock_redis_client.delete.assert_not_called()

    def test_redis_fallback_default_return(self, mock_redis_client):
        """Test redis_fallback decorator - default return value (Redis error)"""
        mock_redis_client.get.side_effect = RedisError("Redis connection error")

        result = ToolProviderListCache.get_cached_providers("tenant_123")

        assert result is None
        mock_redis_client.get.assert_called_once()

    def test_redis_fallback_no_default(self, mock_redis_client):
        """Test redis_fallback decorator - no default return value (Redis error)"""
        mock_redis_client.setex.side_effect = RedisError("Redis connection error")

        try:
            ToolProviderListCache.set_cached_providers("tenant_123", "mcp", [])
        except RedisError:
            pytest.fail("set_cached_providers should not raise RedisError (handled by fallback)")

        mock_redis_client.setex.assert_called_once()
