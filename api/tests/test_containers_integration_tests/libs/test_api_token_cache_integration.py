"""Redis-backed integration coverage for the API-token cache."""

import concurrent.futures
import time
from datetime import datetime, timedelta

import pytest

from extensions.ext_redis import redis_client
from models.enums import ApiTokenType
from models.model import ApiToken
from services.api_token_service import ApiTokenCache, CachedApiToken, record_token_usage

pytestmark = pytest.mark.usefixtures("set_up_containers_and_env")


def _api_token(
    token: str,
    *,
    token_id: str = "test-id",
    app_id: str = "test-app",
    tenant_id: str = "test-tenant",
    last_used_at: datetime | None = None,
    created_at: datetime | None = None,
) -> ApiToken:
    """Build a real mapped token without requiring database persistence for cache-only behavior."""
    api_token = ApiToken()
    api_token.id = token_id
    api_token.app_id = app_id
    api_token.tenant_id = tenant_id
    api_token.type = ApiTokenType.APP
    api_token.token = token
    api_token.last_used_at = last_used_at
    api_token.created_at = created_at or datetime.now()
    return api_token


class TestApiTokenCacheRedisIntegration:
    """Cache semantics that require a real Redis server."""

    test_token = "test-integration-token-123"
    test_scope = "app"

    @property
    def cache_key(self) -> str:
        return f"api_token:{self.test_scope}:{self.test_token}"

    def setup_method(self) -> None:
        self._cleanup()

    def teardown_method(self) -> None:
        self._cleanup()

    def _cleanup(self) -> None:
        redis_client.delete(self.cache_key)
        redis_client.delete(ApiTokenCache._make_tenant_index_key("test-tenant-id"))
        redis_client.delete(ApiTokenCache._make_tenant_index_key("test-tenant"))
        redis_client.delete(ApiTokenCache._make_tenant_index_key("test-tenant-789"))
        redis_client.delete(ApiTokenCache.make_active_key(self.test_token, self.test_scope))
        for index in range(3):
            redis_client.delete(f"api_token:app:test-token-{index}")

    def test_cache_set_and_get_with_real_redis(self) -> None:
        token = _api_token(
            self.test_token,
            token_id="test-id-123",
            app_id="test-app-456",
            tenant_id="test-tenant-789",
            last_used_at=datetime.now(),
            created_at=datetime.now() - timedelta(days=30),
        )

        assert ApiTokenCache.set(self.test_token, self.test_scope, token) is True
        assert redis_client.get(self.cache_key) is not None

        cached_token = ApiTokenCache.get(self.test_token, self.test_scope)
        assert isinstance(cached_token, CachedApiToken)
        assert cached_token.id == "test-id-123"
        assert cached_token.app_id == "test-app-456"
        assert cached_token.tenant_id == "test-tenant-789"
        assert cached_token.type == "app"
        assert cached_token.token == self.test_token

    def test_cache_ttl_with_real_redis(self) -> None:
        ApiTokenCache.set(self.test_token, self.test_scope, _api_token(self.test_token))

        assert 595 <= redis_client.ttl(self.cache_key) <= 600

    def test_cache_null_value_for_invalid_token(self) -> None:
        assert ApiTokenCache.set(self.test_token, self.test_scope, None) is True
        assert redis_client.get(self.cache_key) == b"null"
        assert ApiTokenCache.get(self.test_token, self.test_scope) is None
        assert 55 <= redis_client.ttl(self.cache_key) <= 60

    def test_cache_delete_with_real_redis(self) -> None:
        ApiTokenCache.set(self.test_token, self.test_scope, _api_token(self.test_token))
        assert redis_client.exists(self.cache_key) == 1

        assert ApiTokenCache.delete(self.test_token, self.test_scope) is True
        assert redis_client.exists(self.cache_key) == 0

    def test_tenant_index_creation(self) -> None:
        tenant_id = "test-tenant-id"
        ApiTokenCache.set(self.test_token, self.test_scope, _api_token(self.test_token, tenant_id=tenant_id))

        index_key = ApiTokenCache._make_tenant_index_key(tenant_id)
        assert redis_client.exists(index_key) == 1
        assert self.cache_key.encode() in redis_client.smembers(index_key)

    def test_invalidate_by_tenant_via_index(self) -> None:
        tenant_id = "test-tenant-id"
        for index in range(3):
            token_value = f"test-token-{index}"
            ApiTokenCache.set(
                token_value,
                "app",
                _api_token(token_value, token_id=f"test-id-{index}", tenant_id=tenant_id),
            )

        assert ApiTokenCache.invalidate_by_tenant(tenant_id) is True
        for index in range(3):
            assert redis_client.exists(f"api_token:app:test-token-{index}") == 0
        assert redis_client.exists(ApiTokenCache._make_tenant_index_key(tenant_id)) == 0

    def test_concurrent_cache_access(self) -> None:
        ApiTokenCache.set(self.test_token, self.test_scope, _api_token(self.test_token))

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(ApiTokenCache.get, self.test_token, self.test_scope) for _ in range(50)]
            results = [future.result() for future in concurrent.futures.as_completed(futures)]

        assert len(results) == 50
        assert all(isinstance(result, CachedApiToken) for result in results)


class TestTokenUsageRecording:
    """Active-token recording semantics that require Redis TTL behavior."""

    test_token = "test-usage-token"
    test_scope = "app"

    @property
    def active_key(self) -> str:
        return ApiTokenCache.make_active_key(self.test_token, self.test_scope)

    def teardown_method(self) -> None:
        redis_client.delete(self.active_key)

    def test_record_token_usage_sets_redis_key(self) -> None:
        record_token_usage(self.test_token, self.test_scope)

        assert redis_client.exists(self.active_key) == 1
        value = redis_client.get(self.active_key)
        assert value is not None
        datetime.fromisoformat(value.decode() if isinstance(value, bytes) else value)

    def test_record_token_usage_has_ttl(self) -> None:
        record_token_usage(self.test_token, self.test_scope)

        assert 3595 <= redis_client.ttl(self.active_key) <= 3600

    def test_record_token_usage_overwrites(self) -> None:
        record_token_usage(self.test_token, self.test_scope)
        first_value = redis_client.get(self.active_key)
        time.sleep(0.01)
        record_token_usage(self.test_token, self.test_scope)

        assert redis_client.exists(self.active_key) == 1
        assert redis_client.get(self.active_key) != first_value


class TestEndToEndCacheFlow:
    """Complete Redis cache flows using real mapped tokens."""

    def test_complete_flow_cache_miss_then_hit(self) -> None:
        token_value = "test-e2e-token"
        scope = "app"
        token = _api_token(token_value, token_id="test-e2e-id", tenant_id="test-e2e-tenant")
        cache_key = f"api_token:{scope}:{token_value}"
        index_key = ApiTokenCache._make_tenant_index_key(token.tenant_id)

        try:
            assert ApiTokenCache.set(token_value, scope, token) is True
            assert redis_client.exists(cache_key) == 1

            cached_token = ApiTokenCache.get(token_value, scope)
            assert isinstance(cached_token, CachedApiToken)
            assert cached_token.id == token.id
            assert cached_token.token == token_value
            assert cache_key.encode() in redis_client.smembers(index_key)

            assert ApiTokenCache.delete(token_value, scope) is True
            assert redis_client.exists(cache_key) == 0
            assert cache_key.encode() not in redis_client.smembers(index_key)
        finally:
            redis_client.delete(cache_key)
            redis_client.delete(index_key)

    def test_high_concurrency_simulation(self) -> None:
        token_value = "test-concurrent-token"
        scope = "app"
        token = _api_token(token_value, token_id="concurrent-id")
        index_key = ApiTokenCache._make_tenant_index_key(token.tenant_id)
        ApiTokenCache.set(token_value, scope, token)

        try:
            started_at = time.time()
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                futures = [executor.submit(ApiTokenCache.get, token_value, scope) for _ in range(100)]
                results = [future.result() for future in concurrent.futures.as_completed(futures)]

            assert len(results) == 100
            assert all(isinstance(result, CachedApiToken) for result in results)
            assert time.time() - started_at < 1.0
        finally:
            ApiTokenCache.delete(token_value, scope)
            redis_client.delete(index_key)
