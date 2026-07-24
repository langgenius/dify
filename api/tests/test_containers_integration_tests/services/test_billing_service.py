import json
from unittest.mock import patch

import pytest

from extensions.ext_redis import redis_client
from services.billing_service import BillingService


class TestBillingServiceGetPlanBulkWithCache:
    """
    Comprehensive integration tests for get_plan_bulk_with_cache using testcontainers.

    This test class covers all major scenarios:
    - Cache hit/miss scenarios
    - Redis operation failures and fallback behavior
    - Invalid cache data handling
    - TTL expiration handling
    - Error recovery and logging
    """

    @pytest.fixture(autouse=True)
    def setup_redis_cleanup(self, flask_app_with_containers):
        """Clean up Redis cache before and after each test."""
        with flask_app_with_containers.app_context():
            # Clean up before test
            yield
            # Clean up after test
            # Delete all test cache keys
            pattern = f"{BillingService._PLAN_CACHE_KEY_PREFIX}*"
            keys = redis_client.keys(pattern)
            if keys:
                redis_client.delete(*keys)

    def _create_test_plan_data(self, plan: str = "sandbox", expiration_date: int = 1735689600):
        """Helper to create test SubscriptionPlan data."""
        return {"plan": plan, "expiration_date": expiration_date}

    def _set_cache(self, tenant_id: str, plan_data: dict, ttl: int = 600):
        """Helper to set cache data in Redis."""
        cache_key = BillingService._make_plan_cache_key(tenant_id)
        json_str = json.dumps(plan_data)
        redis_client.setex(cache_key, ttl, json_str)

    def _get_cache(self, tenant_id: str):
        """Helper to get cache data from Redis."""
        cache_key = BillingService._make_plan_cache_key(tenant_id)
        value = redis_client.get(cache_key)
        if value:
            if isinstance(value, bytes):
                return value.decode("utf-8")
            return value
        return None

    def test_get_plan_bulk_with_cache_all_cache_hit(self, flask_app_with_containers):
        """Test bulk plan retrieval when all tenants are in cache."""
        with flask_app_with_containers.app_context():
            # Arrange
            tenant_ids = ["tenant-1", "tenant-2", "tenant-3"]
            expected_plans = {
                "tenant-1": self._create_test_plan_data("sandbox", 1735689600),
                "tenant-2": self._create_test_plan_data("professional", 1767225600),
                "tenant-3": self._create_test_plan_data("team", 1798761600),
            }

            # Pre-populate cache
            for tenant_id, plan_data in expected_plans.items():
                self._set_cache(tenant_id, plan_data)

            # Act
            with patch.object(BillingService, "get_plan_bulk") as mock_get_plan_bulk:
                result = BillingService.get_plan_bulk_with_cache(tenant_ids)

            # Assert
            assert len(result) == 3
            assert result["tenant-1"]["plan"] == "sandbox"
            assert result["tenant-1"]["expiration_date"] == 1735689600
            assert result["tenant-2"]["plan"] == "professional"
            assert result["tenant-2"]["expiration_date"] == 1767225600
            assert result["tenant-3"]["plan"] == "team"
            assert result["tenant-3"]["expiration_date"] == 1798761600

            # Verify API was not called
            mock_get_plan_bulk.assert_not_called()

    def test_get_plan_bulk_with_cache_all_cache_miss(self, flask_app_with_containers):
        """Test bulk plan retrieval when all tenants are not in cache."""
        with flask_app_with_containers.app_context():
            # Arrange
            tenant_ids = ["tenant-1", "tenant-2"]
            expected_plans = {
                "tenant-1": self._create_test_plan_data("sandbox", 1735689600),
                "tenant-2": self._create_test_plan_data("professional", 1767225600),
            }

            # Act
            with patch.object(BillingService, "get_plan_bulk", return_value=expected_plans) as mock_get_plan_bulk:
                result = BillingService.get_plan_bulk_with_cache(tenant_ids)

            # Assert
            assert len(result) == 2
            assert result["tenant-1"]["plan"] == "sandbox"
            assert result["tenant-2"]["plan"] == "professional"

            # Verify API was called with correct tenant_ids
            mock_get_plan_bulk.assert_called_once_with(tenant_ids)

            # Verify data was written to cache
            cached_1 = self._get_cache("tenant-1")
            cached_2 = self._get_cache("tenant-2")
            assert cached_1 is not None
            assert cached_2 is not None

            # Verify cache content
            cached_data_1 = json.loads(cached_1)
            cached_data_2 = json.loads(cached_2)
            assert cached_data_1 == expected_plans["tenant-1"]
            assert cached_data_2 == expected_plans["tenant-2"]

            # Verify TTL is set
            cache_key_1 = BillingService._make_plan_cache_key("tenant-1")
            ttl_1 = redis_client.ttl(cache_key_1)
            assert ttl_1 > 0
            assert ttl_1 <= 600  # Should be <= 600 seconds

    def test_get_plan_bulk_with_cache_partial_cache_hit(self, flask_app_with_containers):
        """Test bulk plan retrieval when some tenants are in cache, some are not."""
        with flask_app_with_containers.app_context():
            # Arrange
            tenant_ids = ["tenant-1", "tenant-2", "tenant-3"]
            # Pre-populate cache for tenant-1 and tenant-2
            self._set_cache("tenant-1", self._create_test_plan_data("sandbox", 1735689600))
            self._set_cache("tenant-2", self._create_test_plan_data("professional", 1767225600))

            # tenant-3 is not in cache
            missing_plan = {"tenant-3": self._create_test_plan_data("team", 1798761600)}

            # Act
            with patch.object(BillingService, "get_plan_bulk", return_value=missing_plan) as mock_get_plan_bulk:
                result = BillingService.get_plan_bulk_with_cache(tenant_ids)

            # Assert
            assert len(result) == 3
            assert result["tenant-1"]["plan"] == "sandbox"
            assert result["tenant-2"]["plan"] == "professional"
            assert result["tenant-3"]["plan"] == "team"

            # Verify API was called only for missing tenant
            mock_get_plan_bulk.assert_called_once_with(["tenant-3"])

            # Verify tenant-3 data was written to cache
            cached_3 = self._get_cache("tenant-3")
            assert cached_3 is not None
            cached_data_3 = json.loads(cached_3)
            assert cached_data_3 == missing_plan["tenant-3"]

    def test_get_plan_bulk_with_cache_redis_mget_failure(self, flask_app_with_containers):
        """Test fallback to API when Redis mget fails."""
        with flask_app_with_containers.app_context():
            # Arrange
            tenant_ids = ["tenant-1", "tenant-2"]
            expected_plans = {
                "tenant-1": self._create_test_plan_data("sandbox", 1735689600),
                "tenant-2": self._create_test_plan_data("professional", 1767225600),
            }

            # Act
            with (
                patch.object(redis_client, "mget", side_effect=Exception("Redis connection error")),
                patch.object(BillingService, "get_plan_bulk", return_value=expected_plans) as mock_get_plan_bulk,
            ):
                result = BillingService.get_plan_bulk_with_cache(tenant_ids)

            # Assert
            assert len(result) == 2
            assert result["tenant-1"]["plan"] == "sandbox"
            assert result["tenant-2"]["plan"] == "professional"

            # Verify API was called for all tenants (fallback)
            mock_get_plan_bulk.assert_called_once_with(tenant_ids)

            # Verify data was written to cache after fallback
            cached_1 = self._get_cache("tenant-1")
            cached_2 = self._get_cache("tenant-2")
            assert cached_1 is not None
            assert cached_2 is not None

    def test_get_plan_bulk_with_cache_invalid_json_in_cache(self, flask_app_with_containers):
        """Test fallback to API when cache contains invalid JSON."""
        with flask_app_with_containers.app_context():
            # Arrange
            tenant_ids = ["tenant-1", "tenant-2", "tenant-3"]

            # Set valid cache for tenant-1
            self._set_cache("tenant-1", self._create_test_plan_data("sandbox", 1735689600))

            # Set invalid JSON for tenant-2
            cache_key_2 = BillingService._make_plan_cache_key("tenant-2")
            redis_client.setex(cache_key_2, 600, "invalid json {")

            # tenant-3 is not in cache
            expected_plans = {
                "tenant-2": self._create_test_plan_data("professional", 1767225600),
                "tenant-3": self._create_test_plan_data("team", 1798761600),
            }

            # Act
            with patch.object(BillingService, "get_plan_bulk", return_value=expected_plans) as mock_get_plan_bulk:
                result = BillingService.get_plan_bulk_with_cache(tenant_ids)

            # Assert
            assert len(result) == 3
            assert result["tenant-1"]["plan"] == "sandbox"  # From cache
            assert result["tenant-2"]["plan"] == "professional"  # From API (fallback)
            assert result["tenant-3"]["plan"] == "team"  # From API

            # Verify API was called for tenant-2 and tenant-3
            mock_get_plan_bulk.assert_called_once_with(["tenant-2", "tenant-3"])

            # Verify tenant-2's invalid JSON was replaced with correct data in cache
            cached_2 = self._get_cache("tenant-2")
            assert cached_2 is not None
            cached_data_2 = json.loads(cached_2)
            assert cached_data_2 == expected_plans["tenant-2"]
            assert cached_data_2["plan"] == "professional"
            assert cached_data_2["expiration_date"] == 1767225600

            # Verify tenant-2 cache has correct TTL
            cache_key_2_new = BillingService._make_plan_cache_key("tenant-2")
            ttl_2 = redis_client.ttl(cache_key_2_new)
            assert ttl_2 > 0
            assert ttl_2 <= 600

            # Verify tenant-3 data was also written to cache
            cached_3 = self._get_cache("tenant-3")
            assert cached_3 is not None
            cached_data_3 = json.loads(cached_3)
            assert cached_data_3 == expected_plans["tenant-3"]

    def test_get_plan_bulk_with_cache_invalid_plan_data_in_cache(self, flask_app_with_containers):
        """Test fallback to API when cache data doesn't match SubscriptionPlan schema."""
        with flask_app_with_containers.app_context():
            # Arrange
            tenant_ids = ["tenant-1", "tenant-2", "tenant-3"]

            # Set valid cache for tenant-1
            self._set_cache("tenant-1", self._create_test_plan_data("sandbox", 1735689600))

            # Set invalid plan data for tenant-2 (missing expiration_date)
            cache_key_2 = BillingService._make_plan_cache_key("tenant-2")
            invalid_data = json.dumps({"plan": "professional"})  # Missing expiration_date
            redis_client.setex(cache_key_2, 600, invalid_data)

            # tenant-3 is not in cache
            expected_plans = {
                "tenant-2": self._create_test_plan_data("professional", 1767225600),
                "tenant-3": self._create_test_plan_data("team", 1798761600),
            }

            # Act
            with patch.object(BillingService, "get_plan_bulk", return_value=expected_plans) as mock_get_plan_bulk:
                result = BillingService.get_plan_bulk_with_cache(tenant_ids)

            # Assert
            assert len(result) == 3
            assert result["tenant-1"]["plan"] == "sandbox"  # From cache
            assert result["tenant-2"]["plan"] == "professional"  # From API (fallback)
            assert result["tenant-3"]["plan"] == "team"  # From API

            # Verify API was called for tenant-2 and tenant-3
            mock_get_plan_bulk.assert_called_once_with(["tenant-2", "tenant-3"])

    def test_get_plan_bulk_with_cache_redis_pipeline_failure(self, flask_app_with_containers):
        """Test that pipeline failure doesn't affect return value."""
        with flask_app_with_containers.app_context():
            # Arrange
            tenant_ids = ["tenant-1", "tenant-2"]
            expected_plans = {
                "tenant-1": self._create_test_plan_data("sandbox", 1735689600),
                "tenant-2": self._create_test_plan_data("professional", 1767225600),
            }

            # Act
            with (
                patch.object(BillingService, "get_plan_bulk", return_value=expected_plans),
                patch.object(redis_client, "pipeline") as mock_pipeline,
            ):
                # Create a mock pipeline that fails on execute
                mock_pipe = mock_pipeline.return_value
                mock_pipe.execute.side_effect = Exception("Pipeline execution failed")

                result = BillingService.get_plan_bulk_with_cache(tenant_ids)

            # Assert - Function should still return correct result despite pipeline failure
            assert len(result) == 2
            assert result["tenant-1"]["plan"] == "sandbox"
            assert result["tenant-2"]["plan"] == "professional"

            # Verify pipeline was attempted
            mock_pipeline.assert_called_once()

    def test_get_plan_bulk_with_cache_empty_tenant_ids(self, flask_app_with_containers):
        """Test with empty tenant_ids list."""
        with flask_app_with_containers.app_context():
            # Act
            with patch.object(BillingService, "get_plan_bulk") as mock_get_plan_bulk:
                result = BillingService.get_plan_bulk_with_cache([])

            # Assert
            assert result == {}
            assert len(result) == 0

            # Verify no API calls
            mock_get_plan_bulk.assert_not_called()

            # Verify no Redis operations (mget with empty list would return empty list)
            # But we should check that mget was not called at all
            # Since we can't easily verify this without more mocking, we just verify the result

    def test_get_plan_bulk_with_cache_ttl_expired(self, flask_app_with_containers):
        """Test that expired cache keys are treated as cache misses."""
        with flask_app_with_containers.app_context():
            # Arrange
            tenant_ids = ["tenant-1", "tenant-2"]

            # Set cache for tenant-1 with very short TTL (1 second) to simulate expiration
            self._set_cache("tenant-1", self._create_test_plan_data("sandbox", 1735689600), ttl=1)

            # Wait for TTL to expire (key will be deleted by Redis)
            import time

            time.sleep(2)

            # Verify cache is expired (key doesn't exist)
            cache_key_1 = BillingService._make_plan_cache_key("tenant-1")
            exists = redis_client.exists(cache_key_1)
            assert exists == 0  # Key doesn't exist (expired)

            # tenant-2 is not in cache
            expected_plans = {
                "tenant-1": self._create_test_plan_data("sandbox", 1735689600),
                "tenant-2": self._create_test_plan_data("professional", 1767225600),
            }

            # Act
            with patch.object(BillingService, "get_plan_bulk", return_value=expected_plans) as mock_get_plan_bulk:
                result = BillingService.get_plan_bulk_with_cache(tenant_ids)

            # Assert
            assert len(result) == 2
            assert result["tenant-1"]["plan"] == "sandbox"
            assert result["tenant-2"]["plan"] == "professional"

            # Verify API was called for both tenants (tenant-1 expired, tenant-2 missing)
            mock_get_plan_bulk.assert_called_once_with(tenant_ids)

            # Verify both were written to cache with correct TTL
            cache_key_1_new = BillingService._make_plan_cache_key("tenant-1")
            cache_key_2 = BillingService._make_plan_cache_key("tenant-2")
            ttl_1_new = redis_client.ttl(cache_key_1_new)
            ttl_2 = redis_client.ttl(cache_key_2)
            assert ttl_1_new > 0
            assert ttl_1_new <= 600
            assert ttl_2 > 0
            assert ttl_2 <= 600
