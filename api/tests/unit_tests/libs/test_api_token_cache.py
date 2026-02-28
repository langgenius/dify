"""
Unit tests for API Token Cache module.
"""

import json
from datetime import datetime
from unittest.mock import MagicMock, patch

from services.api_token_service import (
    CACHE_KEY_PREFIX,
    CACHE_NULL_TTL_SECONDS,
    CACHE_TTL_SECONDS,
    ApiTokenCache,
    CachedApiToken,
)


class TestApiTokenCache:
    """Test cases for ApiTokenCache class."""

    def setup_method(self):
        """Setup test fixtures."""
        self.mock_token = MagicMock()
        self.mock_token.id = "test-token-id-123"
        self.mock_token.app_id = "test-app-id-456"
        self.mock_token.tenant_id = "test-tenant-id-789"
        self.mock_token.type = "app"
        self.mock_token.token = "test-token-value-abc"
        self.mock_token.last_used_at = datetime(2026, 2, 3, 10, 0, 0)
        self.mock_token.created_at = datetime(2026, 1, 1, 0, 0, 0)

    def test_make_cache_key(self):
        """Test cache key generation."""
        # Test with scope
        key = ApiTokenCache._make_cache_key("my-token", "app")
        assert key == f"{CACHE_KEY_PREFIX}:app:my-token"

        # Test without scope
        key = ApiTokenCache._make_cache_key("my-token", None)
        assert key == f"{CACHE_KEY_PREFIX}:any:my-token"

    def test_serialize_token(self):
        """Test token serialization."""
        serialized = ApiTokenCache._serialize_token(self.mock_token)
        data = json.loads(serialized)

        assert data["id"] == "test-token-id-123"
        assert data["app_id"] == "test-app-id-456"
        assert data["tenant_id"] == "test-tenant-id-789"
        assert data["type"] == "app"
        assert data["token"] == "test-token-value-abc"
        assert data["last_used_at"] == "2026-02-03T10:00:00"
        assert data["created_at"] == "2026-01-01T00:00:00"

    def test_serialize_token_with_nulls(self):
        """Test token serialization with None values."""
        mock_token = MagicMock()
        mock_token.id = "test-id"
        mock_token.app_id = None
        mock_token.tenant_id = None
        mock_token.type = "dataset"
        mock_token.token = "test-token"
        mock_token.last_used_at = None
        mock_token.created_at = datetime(2026, 1, 1, 0, 0, 0)

        serialized = ApiTokenCache._serialize_token(mock_token)
        data = json.loads(serialized)

        assert data["app_id"] is None
        assert data["tenant_id"] is None
        assert data["last_used_at"] is None

    def test_deserialize_token(self):
        """Test token deserialization."""
        cached_data = json.dumps(
            {
                "id": "test-id",
                "app_id": "test-app",
                "tenant_id": "test-tenant",
                "type": "app",
                "token": "test-token",
                "last_used_at": "2026-02-03T10:00:00",
                "created_at": "2026-01-01T00:00:00",
            }
        )

        result = ApiTokenCache._deserialize_token(cached_data)

        assert isinstance(result, CachedApiToken)
        assert result.id == "test-id"
        assert result.app_id == "test-app"
        assert result.tenant_id == "test-tenant"
        assert result.type == "app"
        assert result.token == "test-token"
        assert result.last_used_at == datetime(2026, 2, 3, 10, 0, 0)
        assert result.created_at == datetime(2026, 1, 1, 0, 0, 0)

    def test_deserialize_null_token(self):
        """Test deserialization of null token (cached miss)."""
        result = ApiTokenCache._deserialize_token("null")
        assert result is None

    def test_deserialize_invalid_json(self):
        """Test deserialization with invalid JSON."""
        result = ApiTokenCache._deserialize_token("invalid-json{")
        assert result is None

    @patch("services.api_token_service.redis_client")
    def test_get_cache_hit(self, mock_redis):
        """Test cache hit scenario."""
        cached_data = json.dumps(
            {
                "id": "test-id",
                "app_id": "test-app",
                "tenant_id": "test-tenant",
                "type": "app",
                "token": "test-token",
                "last_used_at": "2026-02-03T10:00:00",
                "created_at": "2026-01-01T00:00:00",
            }
        ).encode("utf-8")
        mock_redis.get.return_value = cached_data

        result = ApiTokenCache.get("test-token", "app")

        assert result is not None
        assert isinstance(result, CachedApiToken)
        assert result.app_id == "test-app"
        mock_redis.get.assert_called_once_with(f"{CACHE_KEY_PREFIX}:app:test-token")

    @patch("services.api_token_service.redis_client")
    def test_get_cache_miss(self, mock_redis):
        """Test cache miss scenario."""
        mock_redis.get.return_value = None

        result = ApiTokenCache.get("test-token", "app")

        assert result is None
        mock_redis.get.assert_called_once()

    @patch("services.api_token_service.redis_client")
    def test_set_valid_token(self, mock_redis):
        """Test setting a valid token in cache."""
        result = ApiTokenCache.set("test-token", "app", self.mock_token)

        assert result is True
        mock_redis.setex.assert_called_once()
        args = mock_redis.setex.call_args[0]
        assert args[0] == f"{CACHE_KEY_PREFIX}:app:test-token"
        assert args[1] == CACHE_TTL_SECONDS

    @patch("services.api_token_service.redis_client")
    def test_set_null_token(self, mock_redis):
        """Test setting a null token (cache penetration prevention)."""
        result = ApiTokenCache.set("invalid-token", "app", None)

        assert result is True
        mock_redis.setex.assert_called_once()
        args = mock_redis.setex.call_args[0]
        assert args[0] == f"{CACHE_KEY_PREFIX}:app:invalid-token"
        assert args[1] == CACHE_NULL_TTL_SECONDS
        assert args[2] == b"null"

    @patch("services.api_token_service.redis_client")
    def test_delete_with_scope(self, mock_redis):
        """Test deleting token cache with specific scope."""
        result = ApiTokenCache.delete("test-token", "app")

        assert result is True
        mock_redis.delete.assert_called_once_with(f"{CACHE_KEY_PREFIX}:app:test-token")

    @patch("services.api_token_service.redis_client")
    def test_delete_without_scope(self, mock_redis):
        """Test deleting token cache without scope (delete all)."""
        # Mock scan_iter to return an iterator of keys
        mock_redis.scan_iter.return_value = iter(
            [
                b"api_token:app:test-token",
                b"api_token:dataset:test-token",
            ]
        )

        result = ApiTokenCache.delete("test-token", None)

        assert result is True
        # Verify scan_iter was called with the correct pattern
        mock_redis.scan_iter.assert_called_once()
        call_args = mock_redis.scan_iter.call_args
        assert call_args[1]["match"] == f"{CACHE_KEY_PREFIX}:*:test-token"

        # Verify delete was called with all matched keys
        mock_redis.delete.assert_called_once_with(
            b"api_token:app:test-token",
            b"api_token:dataset:test-token",
        )

    @patch("services.api_token_service.redis_client")
    def test_redis_fallback_on_exception(self, mock_redis):
        """Test Redis fallback when Redis is unavailable."""
        from redis import RedisError

        mock_redis.get.side_effect = RedisError("Connection failed")

        result = ApiTokenCache.get("test-token", "app")

        # Should return None (fallback) instead of raising exception
        assert result is None


class TestApiTokenCacheIntegration:
    """Integration test scenarios."""

    @patch("services.api_token_service.redis_client")
    def test_full_cache_lifecycle(self, mock_redis):
        """Test complete cache lifecycle: set -> get -> delete."""
        # Setup mock token
        mock_token = MagicMock()
        mock_token.id = "id-123"
        mock_token.app_id = "app-456"
        mock_token.tenant_id = "tenant-789"
        mock_token.type = "app"
        mock_token.token = "token-abc"
        mock_token.last_used_at = datetime(2026, 2, 3, 10, 0, 0)
        mock_token.created_at = datetime(2026, 1, 1, 0, 0, 0)

        # 1. Set token in cache
        ApiTokenCache.set("token-abc", "app", mock_token)
        assert mock_redis.setex.called

        # 2. Simulate cache hit
        cached_data = ApiTokenCache._serialize_token(mock_token)
        mock_redis.get.return_value = cached_data  # bytes from model_dump_json().encode()

        retrieved = ApiTokenCache.get("token-abc", "app")
        assert retrieved is not None
        assert isinstance(retrieved, CachedApiToken)

        # 3. Delete from cache
        ApiTokenCache.delete("token-abc", "app")
        assert mock_redis.delete.called

    @patch("services.api_token_service.redis_client")
    def test_cache_penetration_prevention(self, mock_redis):
        """Test that non-existent tokens are cached as null."""
        # Set null token (cache miss)
        ApiTokenCache.set("non-existent-token", "app", None)

        args = mock_redis.setex.call_args[0]
        assert args[2] == b"null"
        assert args[1] == CACHE_NULL_TTL_SECONDS  # Shorter TTL for null values
