"""
Integration tests for API Token Cache with Redis and Celery.

These tests require:
- Redis server running
- Test database configured
- Celery worker running (for full integration test)
"""

import time
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from extensions.ext_redis import redis_client
from libs.api_token_cache import ApiTokenCache, CachedApiToken
from libs.api_token_updater import update_token_last_used_at
from models.model import ApiToken


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
            # Delete test cache key
            redis_client.delete(self.cache_key)
            # Delete any test tenant index
            redis_client.delete("tenant_tokens:test-tenant-id")
            # Delete any test locks
            redis_client.delete(f"api_token_last_used_lock:{self.test_scope}:{self.test_token}")
        except Exception:
            pass  # Ignore cleanup errors

    def test_cache_set_and_get_with_real_redis(self):
        """Test cache set and get operations with real Redis."""
        # Create a mock token
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

        # Set in cache
        ApiTokenCache.set(self.test_token, self.test_scope, mock_token)

        # Check TTL
        ttl = redis_client.ttl(self.cache_key)
        assert 595 <= ttl <= 600  # Should be around 600 seconds (10 minutes)

    def test_cache_null_value_for_invalid_token(self):
        """Test caching null value for invalid tokens (防穿透)."""
        # Cache null value
        result = ApiTokenCache.set(self.test_token, self.test_scope, None)
        assert result is True

        # Verify in Redis
        cached_data = redis_client.get(self.cache_key)
        assert cached_data == b"null"

        # Get from cache should return None
        cached_token = ApiTokenCache.get(self.test_token, self.test_scope)
        assert cached_token is None

        # Check TTL is shorter for null values
        ttl = redis_client.ttl(self.cache_key)
        assert 55 <= ttl <= 60  # Should be around 60 seconds

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

        # Set in cache
        ApiTokenCache.set(self.test_token, self.test_scope, mock_token)
        assert redis_client.exists(self.cache_key) == 1

        # Delete from cache
        result = ApiTokenCache.delete(self.test_token, self.test_scope)
        assert result is True

        # Verify deleted
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

        # Set in cache
        ApiTokenCache.set(self.test_token, self.test_scope, mock_token)

        # Verify tenant index exists
        index_key = f"tenant_tokens:{tenant_id}"
        assert redis_client.exists(index_key) == 1

        # Verify cache key is in the index
        members = redis_client.smembers(index_key)
        cache_keys = [m.decode('utf-8') if isinstance(m, bytes) else m for m in members]
        assert self.cache_key in cache_keys

    def test_invalidate_by_tenant_via_index(self):
        """Test tenant-wide cache invalidation using index (fast path)."""
        from unittest.mock import MagicMock
        
        tenant_id = "test-tenant-id"
        
        # Create multiple tokens for the same tenant
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

        # Verify all cached
        for i in range(3):
            key = f"api_token:app:test-token-{i}"
            assert redis_client.exists(key) == 1

        # Invalidate by tenant
        result = ApiTokenCache.invalidate_by_tenant(tenant_id)
        assert result is True

        # Verify all deleted
        for i in range(3):
            key = f"api_token:app:test-token-{i}"
            assert redis_client.exists(key) == 0

        # Verify index also deleted
        assert redis_client.exists(f"tenant_tokens:{tenant_id}") == 0

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

        # Set once
        ApiTokenCache.set(self.test_token, self.test_scope, mock_token)

        # Concurrent reads
        def get_from_cache():
            return ApiTokenCache.get(self.test_token, self.test_scope)

        # Execute 50 concurrent reads
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(get_from_cache) for _ in range(50)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        # All should succeed
        assert len(results) == 50
        assert all(r is not None for r in results)
        assert all(isinstance(r, CachedApiToken) for r in results)


class TestApiTokenUpdaterIntegration:
    """Integration tests for unified token updater."""

    @pytest.mark.usefixtures("db_session")
    def test_update_token_last_used_at_with_session(self, db_session):
        """Test unified update method with provided session."""
        # Create a test token in database
        test_token = ApiToken()
        test_token.id = "test-updater-id"
        test_token.token = "test-updater-token"
        test_token.type = "app"
        test_token.app_id = "test-app"
        test_token.tenant_id = "test-tenant"
        test_token.last_used_at = datetime.now() - timedelta(minutes=10)
        test_token.created_at = datetime.now() - timedelta(days=30)
        
        db_session.add(test_token)
        db_session.commit()

        try:
            # Update using unified method
            start_time = datetime.now()
            result = update_token_last_used_at(
                test_token.token,
                test_token.type,
                start_time,
                session=db_session
            )

            # Verify result
            assert result["status"] == "updated"
            assert result["rowcount"] == 1

            # Verify in database
            db_session.refresh(test_token)
            assert test_token.last_used_at >= start_time

        finally:
            # Cleanup
            db_session.delete(test_token)
            db_session.commit()


@pytest.mark.celery_integration
class TestCeleryTaskIntegration:
    """
    Integration tests for Celery task.
    
    Requires Celery worker running with api_token_update queue.
    Run with: pytest -m celery_integration
    """

    @pytest.mark.usefixtures("db_session")
    def test_celery_task_execution(self, db_session):
        """Test Celery task can be executed successfully."""
        from tasks.update_api_token_last_used_task import update_api_token_last_used_task
        
        # Create a test token in database
        test_token = ApiToken()
        test_token.id = "test-celery-id"
        test_token.token = "test-celery-token"
        test_token.type = "app"
        test_token.app_id = "test-app"
        test_token.tenant_id = "test-tenant"
        test_token.last_used_at = datetime.now() - timedelta(minutes=10)
        test_token.created_at = datetime.now() - timedelta(days=30)
        
        db_session.add(test_token)
        db_session.commit()

        try:
            # Send task
            start_time_iso = datetime.now().isoformat()
            result = update_api_token_last_used_task.delay(
                test_token.token,
                test_token.type,
                start_time_iso
            )

            # Wait for task to complete (with timeout)
            task_result = result.get(timeout=10)

            # Verify task executed
            assert task_result["status"] in ["updated", "no_update_needed"]

            # Verify in database
            db_session.refresh(test_token)
            # last_used_at should be updated or already recent
            assert test_token.last_used_at is not None

        finally:
            # Cleanup
            db_session.delete(test_token)
            db_session.commit()

    @pytest.mark.usefixtures("db_session")
    def test_concurrent_celery_tasks_with_redis_lock(self, db_session):
        """Test multiple Celery tasks with Redis lock (防抖)."""
        from tasks.update_api_token_last_used_task import update_api_token_last_used_task
        
        # Create a test token
        test_token = ApiToken()
        test_token.id = "test-concurrent-id"
        test_token.token = "test-concurrent-token"
        test_token.type = "app"
        test_token.app_id = "test-app"
        test_token.tenant_id = "test-tenant"
        test_token.last_used_at = datetime.now() - timedelta(minutes=10)
        test_token.created_at = datetime.now() - timedelta(days=30)
        
        db_session.add(test_token)
        db_session.commit()

        try:
            # Send 10 tasks concurrently
            start_time_iso = datetime.now().isoformat()
            tasks = []
            for _ in range(10):
                result = update_api_token_last_used_task.delay(
                    test_token.token,
                    test_token.type,
                    start_time_iso
                )
                tasks.append(result)

            # Wait for all tasks
            results = [task.get(timeout=15) for task in tasks]

            # Count how many actually updated
            updated_count = sum(1 for r in results if r["status"] == "updated")
            skipped_count = sum(1 for r in results if r["status"] == "skipped")

            # Due to Redis lock, most should be skipped
            assert skipped_count >= 8  # At least 8 out of 10 should be skipped
            assert updated_count <= 2  # At most 2 should actually update

        finally:
            # Cleanup
            db_session.delete(test_token)
            db_session.commit()


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
        
        # Create test token in DB
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

            # Verify cached
            cache_key = f"api_token:{test_scope}:{test_token_value}"
            assert redis_client.exists(cache_key) == 1

            # Step 2: Cache hit - get from cache
            cached_token = ApiTokenCache.get(test_token_value, test_scope)
            assert cached_token is not None
            assert cached_token.id == test_token.id
            assert cached_token.token == test_token_value

            # Step 3: Verify tenant index
            index_key = f"tenant_tokens:{test_token.tenant_id}"
            assert redis_client.exists(index_key) == 1
            assert cache_key.encode() in redis_client.smembers(index_key)

            # Step 4: Delete and verify cleanup
            ApiTokenCache.delete(test_token_value, test_scope)
            assert redis_client.exists(cache_key) == 0
            # Index should be cleaned up
            assert cache_key.encode() not in redis_client.smembers(index_key)

        finally:
            # Cleanup
            db_session.delete(test_token)
            db_session.commit()
            redis_client.delete(f"api_token:{test_scope}:{test_token_value}")
            redis_client.delete(f"tenant_tokens:{test_token.tenant_id}")

    def test_high_concurrency_simulation(self):
        """Simulate high concurrency access to cache."""
        import concurrent.futures
        from unittest.mock import MagicMock
        
        test_token_value = "test-concurrent-token"
        test_scope = "app"
        
        # Setup cache
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
            # Simulate 100 concurrent cache reads
            def read_cache():
                return ApiTokenCache.get(test_token_value, test_scope)

            start_time = time.time()
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                futures = [executor.submit(read_cache) for _ in range(100)]
                results = [f.result() for f in concurrent.futures.as_completed(futures)]
            elapsed = time.time() - start_time

            # All should succeed
            assert len(results) == 100
            assert all(r is not None for r in results)
            
            # Should be fast (< 1 second for 100 reads)
            assert elapsed < 1.0, f"Too slow: {elapsed}s for 100 cache reads"
            
            print(f"\n✓ 100 concurrent cache reads in {elapsed:.3f}s")
            print(f"✓ Average: {(elapsed / 100) * 1000:.2f}ms per read")

        finally:
            # Cleanup
            ApiTokenCache.delete(test_token_value, test_scope)
            redis_client.delete(f"tenant_tokens:{mock_token.tenant_id}")


class TestRedisFailover:
    """Test behavior when Redis is unavailable."""

    @patch("libs.api_token_cache.redis_client")
    def test_graceful_degradation_when_redis_fails(self, mock_redis):
        """Test system degrades gracefully when Redis is unavailable."""
        from redis import RedisError
        
        # Simulate Redis failure
        mock_redis.get.side_effect = RedisError("Connection failed")
        mock_redis.setex.side_effect = RedisError("Connection failed")

        # Cache operations should not raise exceptions
        result_get = ApiTokenCache.get("test-token", "app")
        assert result_get is None  # Returns None (fallback)

        result_set = ApiTokenCache.set("test-token", "app", None)
        assert result_set is False  # Returns False (fallback)

        # Application should continue working (using database directly)


if __name__ == "__main__":
    # Run integration tests
    pytest.main([
        __file__,
        "-v",
        "-s",
        "--tb=short",
        "-m", "not celery_integration"  # Skip Celery tests by default
    ])
