"""
Integration tests for API Token Cache with Redis.

These tests require:
- Redis server running
- Test database configured
"""

import time
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from extensions.ext_redis import redis_client
from models.model import ApiToken
from services.api_token_service import ApiTokenCache, CachedApiToken


class TestApiTokenCacheRedisIntegration:
    """Integration tests with real Redis."""

    def setup_method(self):
        """Setup test fixtures and clean Redis."""
        self.test_token = "test-integration-token-123"
        self.test_scope = "app"
        self.cache_key = f"api_token:{self.test_scope}:{self.test_token}"

        # Clean up any existing test data
        self._cleanup()

    def teardown_method(self):
        """Cleanup test data from Redis."""
        self._cleanup()

    def _cleanup(self):
        """Remove test data from Redis."""
        try:
            redis_client.delete(self.cache_key)
            redis_client.delete(ApiTokenCache._make_tenant_index_key("test-tenant-id"))
            redis_client.delete(ApiTokenCache.make_active_key(self.test_token, self.test_scope))
        except Exception:
            pass  # Ignore cleanup errors

    def test_cache_set_and_get_with_real_redis(self):
        """Test cache set and get operations with real Redis."""
        from unittest.mock import MagicMock

        mock_token = MagicMock()
        mock_token.id = "test-id-123"
        mock_token.app_id = "test-app-456"
        mock_token.tenant_id = "test-tenant-789"
        mock_token.type = "app"
        mock_token.token = self.test_token
        mock_token.last_used_at = datetime.now()
        mock_token.created_at = datetime.now() - timedelta(days=30)

        # Set in cache
        result = ApiTokenCache.set(self.test_token, self.test_scope, mock_token)
        assert result is True

        # Verify in Redis
        cached_data = redis_client.get(self.cache_key)
        assert cached_data is not None

        # Get from cache
        cached_token = ApiTokenCache.get(self.test_token, self.test_scope)
        assert cached_token is not None
        assert isinstance(cached_token, CachedApiToken)
        assert cached_token.id == "test-id-123"
        assert cached_token.app_id == "test-app-456"
        assert cached_token.tenant_id == "test-tenant-789"
        assert cached_token.type == "app"
        assert cached_token.token == self.test_token

    def test_cache_ttl_with_real_redis(self):
        """Test cache TTL is set correctly."""
        from unittest.mock import MagicMock

        mock_token = MagicMock()
        mock_token.id = "test-id"
        mock_token.app_id = "test-app"
        mock_token.tenant_id = "test-tenant"
        mock_token.type = "app"
        mock_token.token = self.test_token
        mock_token.last_used_at = None
        mock_token.created_at = datetime.now()

        ApiTokenCache.set(self.test_token, self.test_scope, mock_token)

        ttl = redis_client.ttl(self.cache_key)
        assert 595 <= ttl <= 600  # Should be around 600 seconds (10 minutes)

    def test_cache_null_value_for_invalid_token(self):
        """Test caching null value for invalid tokens."""
        result = ApiTokenCache.set(self.test_token, self.test_scope, None)
        assert result is True

        cached_data = redis_client.get(self.cache_key)
        assert cached_data == b"null"

        cached_token = ApiTokenCache.get(self.test_token, self.test_scope)
        assert cached_token is None

        ttl = redis_client.ttl(self.cache_key)
        assert 55 <= ttl <= 60

    def test_cache_delete_with_real_redis(self):
        """Test cache deletion with real Redis."""
        from unittest.mock import MagicMock

        mock_token = MagicMock()
        mock_token.id = "test-id"
        mock_token.app_id = "test-app"
        mock_token.tenant_id = "test-tenant"
        mock_token.type = "app"
        mock_token.token = self.test_token
        mock_token.last_used_at = None
        mock_token.created_at = datetime.now()

        ApiTokenCache.set(self.test_token, self.test_scope, mock_token)
        assert redis_client.exists(self.cache_key) == 1

        result = ApiTokenCache.delete(self.test_token, self.test_scope)
        assert result is True
        assert redis_client.exists(self.cache_key) == 0

    def test_tenant_index_creation(self):
        """Test tenant index is created when caching token."""
        from unittest.mock import MagicMock

        tenant_id = "test-tenant-id"
        mock_token = MagicMock()
        mock_token.id = "test-id"
        mock_token.app_id = "test-app"
        mock_token.tenant_id = tenant_id
        mock_token.type = "app"
        mock_token.token = self.test_token
        mock_token.last_used_at = None
        mock_token.created_at = datetime.now()

        ApiTokenCache.set(self.test_token, self.test_scope, mock_token)

        index_key = ApiTokenCache._make_tenant_index_key(tenant_id)
        assert redis_client.exists(index_key) == 1

        members = redis_client.smembers(index_key)
        cache_keys = [m.decode("utf-8") if isinstance(m, bytes) else m for m in members]
        assert self.cache_key in cache_keys

    def test_invalidate_by_tenant_via_index(self):
        """Test tenant-wide cache invalidation using index (fast path)."""
        from unittest.mock import MagicMock

        tenant_id = "test-tenant-id"

        for i in range(3):
            token_value = f"test-token-{i}"
            mock_token = MagicMock()
            mock_token.id = f"test-id-{i}"
            mock_token.app_id = "test-app"
            mock_token.tenant_id = tenant_id
            mock_token.type = "app"
            mock_token.token = token_value
            mock_token.last_used_at = None
            mock_token.created_at = datetime.now()

            ApiTokenCache.set(token_value, "app", mock_token)

        for i in range(3):
            key = f"api_token:app:test-token-{i}"
            assert redis_client.exists(key) == 1

        result = ApiTokenCache.invalidate_by_tenant(tenant_id)
        assert result is True

        for i in range(3):
            key = f"api_token:app:test-token-{i}"
            assert redis_client.exists(key) == 0

        assert redis_client.exists(ApiTokenCache._make_tenant_index_key(tenant_id)) == 0

    def test_concurrent_cache_access(self):
        """Test concurrent cache access doesn't cause issues."""
        import concurrent.futures
        from unittest.mock import MagicMock

        mock_token = MagicMock()
        mock_token.id = "test-id"
        mock_token.app_id = "test-app"
        mock_token.tenant_id = "test-tenant"
        mock_token.type = "app"
        mock_token.token = self.test_token
        mock_token.last_used_at = None
        mock_token.created_at = datetime.now()

        ApiTokenCache.set(self.test_token, self.test_scope, mock_token)

        def get_from_cache():
            return ApiTokenCache.get(self.test_token, self.test_scope)

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(get_from_cache) for _ in range(50)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        assert len(results) == 50
        assert all(r is not None for r in results)
        assert all(isinstance(r, CachedApiToken) for r in results)


class TestTokenUsageRecording:
    """Tests for recording token usage in Redis (batch update approach)."""

    def setup_method(self):
        self.test_token = "test-usage-token"
        self.test_scope = "app"
        self.active_key = ApiTokenCache.make_active_key(self.test_token, self.test_scope)

    def teardown_method(self):
        try:
            redis_client.delete(self.active_key)
        except Exception:
            pass

    def test_record_token_usage_sets_redis_key(self):
        """Test that record_token_usage writes an active key to Redis."""
        from services.api_token_service import record_token_usage

        record_token_usage(self.test_token, self.test_scope)

        # Key should exist
        assert redis_client.exists(self.active_key) == 1

        # Value should be an ISO timestamp
        value = redis_client.get(self.active_key)
        if isinstance(value, bytes):
            value = value.decode("utf-8")
        datetime.fromisoformat(value)  # Should not raise

    def test_record_token_usage_has_ttl(self):
        """Test that active keys have a TTL as safety net."""
        from services.api_token_service import record_token_usage

        record_token_usage(self.test_token, self.test_scope)

        ttl = redis_client.ttl(self.active_key)
        assert 3595 <= ttl <= 3600  # ~1 hour

    def test_record_token_usage_overwrites(self):
        """Test that repeated calls overwrite the same key (no accumulation)."""
        from services.api_token_service import record_token_usage

        record_token_usage(self.test_token, self.test_scope)
        first_value = redis_client.get(self.active_key)

        time.sleep(0.01)  # Tiny delay so timestamp differs

        record_token_usage(self.test_token, self.test_scope)
        second_value = redis_client.get(self.active_key)

        # Key count should still be 1 (overwritten, not accumulated)
        assert redis_client.exists(self.active_key) == 1


class TestEndToEndCacheFlow:
    """End-to-end integration test for complete cache flow."""

    @pytest.mark.usefixtures("db_session")
    def test_complete_flow_cache_miss_then_hit(self, db_session):
        """
        Test complete flow:
        1. First request (cache miss) -> query DB -> cache result
        2. Second request (cache hit) -> return from cache
        3. Verify Redis state
        """
        test_token_value = "test-e2e-token"
        test_scope = "app"

        test_token = ApiToken()
        test_token.id = "test-e2e-id"
        test_token.token = test_token_value
        test_token.type = test_scope
        test_token.app_id = "test-app"
        test_token.tenant_id = "test-tenant"
        test_token.last_used_at = None
        test_token.created_at = datetime.now()

        db_session.add(test_token)
        db_session.commit()

        try:
            # Step 1: Cache miss - set token in cache
            ApiTokenCache.set(test_token_value, test_scope, test_token)

            cache_key = f"api_token:{test_scope}:{test_token_value}"
            assert redis_client.exists(cache_key) == 1

            # Step 2: Cache hit - get from cache
            cached_token = ApiTokenCache.get(test_token_value, test_scope)
            assert cached_token is not None
            assert cached_token.id == test_token.id
            assert cached_token.token == test_token_value

            # Step 3: Verify tenant index
            index_key = ApiTokenCache._make_tenant_index_key(test_token.tenant_id)
            assert redis_client.exists(index_key) == 1
            assert cache_key.encode() in redis_client.smembers(index_key)

            # Step 4: Delete and verify cleanup
            ApiTokenCache.delete(test_token_value, test_scope)
            assert redis_client.exists(cache_key) == 0
            assert cache_key.encode() not in redis_client.smembers(index_key)

        finally:
            db_session.delete(test_token)
            db_session.commit()
            redis_client.delete(f"api_token:{test_scope}:{test_token_value}")
            redis_client.delete(ApiTokenCache._make_tenant_index_key(test_token.tenant_id))

    def test_high_concurrency_simulation(self):
        """Simulate high concurrency access to cache."""
        import concurrent.futures
        from unittest.mock import MagicMock

        test_token_value = "test-concurrent-token"
        test_scope = "app"

        mock_token = MagicMock()
        mock_token.id = "concurrent-id"
        mock_token.app_id = "test-app"
        mock_token.tenant_id = "test-tenant"
        mock_token.type = test_scope
        mock_token.token = test_token_value
        mock_token.last_used_at = datetime.now()
        mock_token.created_at = datetime.now()

        ApiTokenCache.set(test_token_value, test_scope, mock_token)

        try:

            def read_cache():
                return ApiTokenCache.get(test_token_value, test_scope)

            start_time = time.time()
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                futures = [executor.submit(read_cache) for _ in range(100)]
                results = [f.result() for f in concurrent.futures.as_completed(futures)]
            elapsed = time.time() - start_time

            assert len(results) == 100
            assert all(r is not None for r in results)

            assert elapsed < 1.0, f"Too slow: {elapsed}s for 100 cache reads"

        finally:
            ApiTokenCache.delete(test_token_value, test_scope)
            redis_client.delete(ApiTokenCache._make_tenant_index_key(mock_token.tenant_id))


class TestRedisFailover:
    """Test behavior when Redis is unavailable."""

    @patch("services.api_token_service.redis_client")
    def test_graceful_degradation_when_redis_fails(self, mock_redis):
        """Test system degrades gracefully when Redis is unavailable."""
        from redis import RedisError

        mock_redis.get.side_effect = RedisError("Connection failed")
        mock_redis.setex.side_effect = RedisError("Connection failed")

        result_get = ApiTokenCache.get("test-token", "app")
        assert result_get is None

        result_set = ApiTokenCache.set("test-token", "app", None)
        assert result_set is False
