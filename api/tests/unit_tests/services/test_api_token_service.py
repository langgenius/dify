from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Unauthorized

import services.api_token_service as api_token_service_module
from services.api_token_service import ApiTokenCache, CachedApiToken


@pytest.fixture
def mock_db_session():
    """Fixture providing common DB session mocking for query_token_from_db tests."""
    fake_engine = MagicMock()

    session = MagicMock()
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    session_context.__exit__.return_value = None

    with (
        patch.object(api_token_service_module, "db", new=SimpleNamespace(engine=fake_engine)),
        patch.object(api_token_service_module, "Session", return_value=session_context) as mock_session_class,
        patch.object(api_token_service_module.ApiTokenCache, "set") as mock_cache_set,
        patch.object(api_token_service_module, "record_token_usage") as mock_record_usage,
    ):
        yield {
            "session": session,
            "mock_session_class": mock_session_class,
            "mock_cache_set": mock_cache_set,
            "mock_record_usage": mock_record_usage,
            "fake_engine": fake_engine,
        }


class TestQueryTokenFromDb:
    def test_should_return_api_token_and_cache_when_token_exists(self, mock_db_session):
        """Test DB lookup success path caches token and records usage."""
        # Arrange
        auth_token = "token-123"
        scope = "app"
        api_token = MagicMock()

        mock_db_session["session"].scalar.return_value = api_token

        # Act
        result = api_token_service_module.query_token_from_db(auth_token, scope)

        # Assert
        assert result == api_token
        mock_db_session["mock_session_class"].assert_called_once_with(
            mock_db_session["fake_engine"], expire_on_commit=False
        )
        mock_db_session["mock_cache_set"].assert_called_once_with(auth_token, scope, api_token)
        mock_db_session["mock_record_usage"].assert_called_once_with(auth_token, scope)

    def test_should_cache_null_and_raise_unauthorized_when_token_not_found(self, mock_db_session):
        """Test DB lookup miss path caches null marker and raises Unauthorized."""
        # Arrange
        auth_token = "missing-token"
        scope = "app"

        mock_db_session["session"].scalar.return_value = None

        # Act / Assert
        with pytest.raises(Unauthorized, match="Access token is invalid"):
            api_token_service_module.query_token_from_db(auth_token, scope)

        mock_db_session["mock_cache_set"].assert_called_once_with(auth_token, scope, None)
        mock_db_session["mock_record_usage"].assert_not_called()


class TestRecordTokenUsage:
    def test_should_write_active_key_with_iso_timestamp_and_ttl(self):
        """Test record_token_usage writes usage timestamp with one-hour TTL."""
        # Arrange
        auth_token = "token-123"
        scope = "dataset"
        fixed_time = datetime(2026, 2, 24, 12, 0, 0)
        expected_key = ApiTokenCache.make_active_key(auth_token, scope)

        with (
            patch.object(api_token_service_module, "naive_utc_now", return_value=fixed_time),
            patch.object(api_token_service_module, "redis_client") as mock_redis,
        ):
            # Act
            api_token_service_module.record_token_usage(auth_token, scope)

        # Assert
        mock_redis.set.assert_called_once_with(expected_key, fixed_time.isoformat(), ex=3600)

    def test_should_not_raise_when_redis_write_fails(self):
        """Test record_token_usage swallows Redis errors."""
        # Arrange
        with patch.object(api_token_service_module, "redis_client") as mock_redis:
            mock_redis.set.side_effect = Exception("redis unavailable")

            # Act / Assert
            api_token_service_module.record_token_usage("token-123", "app")


class TestFetchTokenWithSingleFlight:
    def test_should_return_cached_token_when_lock_acquired_and_cache_filled(self):
        """Test single-flight returns cache when another request already populated it."""
        # Arrange
        auth_token = "token-123"
        scope = "app"
        cached_token = CachedApiToken(
            id="id-1",
            app_id="app-1",
            tenant_id="tenant-1",
            type="app",
            token=auth_token,
            last_used_at=None,
            created_at=None,
        )

        lock = MagicMock()
        lock.acquire.return_value = True

        with (
            patch.object(api_token_service_module, "redis_client") as mock_redis,
            patch.object(api_token_service_module.ApiTokenCache, "get", return_value=cached_token) as mock_cache_get,
            patch.object(api_token_service_module, "query_token_from_db") as mock_query_db,
        ):
            mock_redis.lock.return_value = lock

            # Act
            result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

        # Assert
        assert result == cached_token
        mock_redis.lock.assert_called_once_with(
            f"api_token_query_lock:{scope}:{auth_token}",
            timeout=10,
            blocking_timeout=5,
        )
        lock.acquire.assert_called_once_with(blocking=True)
        lock.release.assert_called_once()
        mock_cache_get.assert_called_once_with(auth_token, scope)
        mock_query_db.assert_not_called()

    def test_should_query_db_when_lock_acquired_and_cache_missed(self):
        """Test single-flight queries DB when cache remains empty after lock acquisition."""
        # Arrange
        auth_token = "token-123"
        scope = "app"
        db_token = MagicMock()

        lock = MagicMock()
        lock.acquire.return_value = True

        with (
            patch.object(api_token_service_module, "redis_client") as mock_redis,
            patch.object(api_token_service_module.ApiTokenCache, "get", return_value=None),
            patch.object(api_token_service_module, "query_token_from_db", return_value=db_token) as mock_query_db,
        ):
            mock_redis.lock.return_value = lock

            # Act
            result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

        # Assert
        assert result == db_token
        mock_query_db.assert_called_once_with(auth_token, scope)
        lock.release.assert_called_once()

    def test_should_query_db_directly_when_lock_not_acquired(self):
        """Test lock timeout branch falls back to direct DB query."""
        # Arrange
        auth_token = "token-123"
        scope = "app"
        db_token = MagicMock()

        lock = MagicMock()
        lock.acquire.return_value = False

        with (
            patch.object(api_token_service_module, "redis_client") as mock_redis,
            patch.object(api_token_service_module.ApiTokenCache, "get") as mock_cache_get,
            patch.object(api_token_service_module, "query_token_from_db", return_value=db_token) as mock_query_db,
        ):
            mock_redis.lock.return_value = lock

            # Act
            result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

        # Assert
        assert result == db_token
        mock_cache_get.assert_not_called()
        mock_query_db.assert_called_once_with(auth_token, scope)
        lock.release.assert_not_called()

    def test_should_reraise_unauthorized_from_db_query(self):
        """Test Unauthorized from DB query is propagated unchanged."""
        # Arrange
        auth_token = "token-123"
        scope = "app"
        lock = MagicMock()
        lock.acquire.return_value = True

        with (
            patch.object(api_token_service_module, "redis_client") as mock_redis,
            patch.object(api_token_service_module.ApiTokenCache, "get", return_value=None),
            patch.object(
                api_token_service_module,
                "query_token_from_db",
                side_effect=Unauthorized("Access token is invalid"),
            ),
        ):
            mock_redis.lock.return_value = lock

            # Act / Assert
            with pytest.raises(Unauthorized, match="Access token is invalid"):
                api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

        lock.release.assert_called_once()

    def test_should_fallback_to_db_query_when_lock_raises_exception(self):
        """Test Redis lock errors fall back to direct DB query."""
        # Arrange
        auth_token = "token-123"
        scope = "app"
        db_token = MagicMock()

        lock = MagicMock()
        lock.acquire.side_effect = RuntimeError("redis lock error")

        with (
            patch.object(api_token_service_module, "redis_client") as mock_redis,
            patch.object(api_token_service_module, "query_token_from_db", return_value=db_token) as mock_query_db,
        ):
            mock_redis.lock.return_value = lock

            # Act
            result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

        # Assert
        assert result == db_token
        mock_query_db.assert_called_once_with(auth_token, scope)


class TestApiTokenCacheTenantBranches:
    @patch("services.api_token_service.redis_client")
    def test_delete_with_scope_should_remove_from_tenant_index_when_tenant_found(self, mock_redis):
        """Test scoped delete removes cache key and tenant index membership."""
        # Arrange
        token = "token-123"
        scope = "app"
        cache_key = ApiTokenCache._make_cache_key(token, scope)
        cached_token = CachedApiToken(
            id="id-1",
            app_id="app-1",
            tenant_id="tenant-1",
            type="app",
            token=token,
            last_used_at=None,
            created_at=None,
        )
        mock_redis.get.return_value = cached_token.model_dump_json().encode("utf-8")

        with patch.object(ApiTokenCache, "_remove_from_tenant_index") as mock_remove_index:
            # Act
            result = ApiTokenCache.delete(token, scope)

        # Assert
        assert result is True
        mock_redis.delete.assert_called_once_with(cache_key)
        mock_remove_index.assert_called_once_with("tenant-1", cache_key)

    @patch("services.api_token_service.redis_client")
    def test_invalidate_by_tenant_should_delete_all_indexed_cache_keys(self, mock_redis):
        """Test tenant invalidation deletes indexed cache entries and index key."""
        # Arrange
        tenant_id = "tenant-1"
        index_key = ApiTokenCache._make_tenant_index_key(tenant_id)
        mock_redis.smembers.return_value = {
            b"api_token:app:token-1",
            b"api_token:any:token-2",
        }

        # Act
        result = ApiTokenCache.invalidate_by_tenant(tenant_id)

        # Assert
        assert result is True
        mock_redis.smembers.assert_called_once_with(index_key)
        mock_redis.delete.assert_any_call("api_token:app:token-1")
        mock_redis.delete.assert_any_call("api_token:any:token-2")
        mock_redis.delete.assert_any_call(index_key)


class TestApiTokenCacheCoreBranches:
    def test_cached_api_token_repr_should_include_id_and_type(self):
        """Test CachedApiToken __repr__ includes key identity fields."""
        token = CachedApiToken(
            id="id-123",
            app_id="app-123",
            tenant_id="tenant-123",
            type="app",
            token="token-123",
            last_used_at=None,
            created_at=None,
        )

        assert repr(token) == "<CachedApiToken id=id-123 type=app>"

    def test_serialize_token_should_handle_cached_api_token_instances(self):
        """Test serialization path when input is already a CachedApiToken."""
        token = CachedApiToken(
            id="id-123",
            app_id="app-123",
            tenant_id="tenant-123",
            type="app",
            token="token-123",
            last_used_at=None,
            created_at=None,
        )

        serialized = ApiTokenCache._serialize_token(token)

        assert isinstance(serialized, bytes)
        assert b'"id":"id-123"' in serialized
        assert b'"token":"token-123"' in serialized

    def test_deserialize_token_should_return_none_for_null_markers(self):
        """Test null cache marker deserializes to None."""
        assert ApiTokenCache._deserialize_token("null") is None
        assert ApiTokenCache._deserialize_token(b"null") is None

    def test_deserialize_token_should_return_none_for_invalid_payload(self):
        """Test invalid serialized payload returns None."""
        assert ApiTokenCache._deserialize_token("not-json") is None

    @patch("services.api_token_service.redis_client")
    def test_get_should_return_none_on_cache_miss(self, mock_redis):
        """Test cache miss branch in ApiTokenCache.get."""
        mock_redis.get.return_value = None

        result = ApiTokenCache.get("token-123", "app")

        assert result is None
        mock_redis.get.assert_called_once_with("api_token:app:token-123")

    @patch("services.api_token_service.redis_client")
    def test_get_should_deserialize_cached_payload_on_cache_hit(self, mock_redis):
        """Test cache hit branch in ApiTokenCache.get."""
        token = CachedApiToken(
            id="id-123",
            app_id="app-123",
            tenant_id="tenant-123",
            type="app",
            token="token-123",
            last_used_at=None,
            created_at=None,
        )
        mock_redis.get.return_value = token.model_dump_json().encode("utf-8")

        result = ApiTokenCache.get("token-123", "app")

        assert isinstance(result, CachedApiToken)
        assert result.id == "id-123"

    @patch("services.api_token_service.redis_client")
    def test_add_to_tenant_index_should_skip_when_tenant_id_missing(self, mock_redis):
        """Test tenant index update exits early for missing tenant id."""
        ApiTokenCache._add_to_tenant_index(None, "api_token:app:token-123")

        mock_redis.sadd.assert_not_called()
        mock_redis.expire.assert_not_called()

    @patch("services.api_token_service.redis_client")
    def test_add_to_tenant_index_should_swallow_index_update_errors(self, mock_redis):
        """Test tenant index update handles Redis write errors gracefully."""
        mock_redis.sadd.side_effect = Exception("redis down")

        ApiTokenCache._add_to_tenant_index("tenant-123", "api_token:app:token-123")

        mock_redis.sadd.assert_called_once()

    @patch("services.api_token_service.redis_client")
    def test_remove_from_tenant_index_should_skip_when_tenant_id_missing(self, mock_redis):
        """Test tenant index removal exits early for missing tenant id."""
        ApiTokenCache._remove_from_tenant_index(None, "api_token:app:token-123")

        mock_redis.srem.assert_not_called()

    @patch("services.api_token_service.redis_client")
    def test_remove_from_tenant_index_should_swallow_redis_errors(self, mock_redis):
        """Test tenant index removal handles Redis errors gracefully."""
        mock_redis.srem.side_effect = Exception("redis down")

        ApiTokenCache._remove_from_tenant_index("tenant-123", "api_token:app:token-123")

        mock_redis.srem.assert_called_once()

    @patch("services.api_token_service.redis_client")
    def test_set_should_return_false_when_cache_write_raises_exception(self, mock_redis):
        """Test set returns False when Redis setex fails."""
        mock_redis.setex.side_effect = Exception("redis write failed")
        api_token = MagicMock()
        api_token.id = "id-123"
        api_token.app_id = "app-123"
        api_token.tenant_id = "tenant-123"
        api_token.type = "app"
        api_token.token = "token-123"
        api_token.last_used_at = None
        api_token.created_at = None

        result = ApiTokenCache.set("token-123", "app", api_token)

        assert result is False

    @patch("services.api_token_service.redis_client")
    def test_delete_without_scope_should_return_false_when_scan_fails(self, mock_redis):
        """Test delete(scope=None) returns False when scan_iter raises."""
        mock_redis.scan_iter.side_effect = Exception("scan failed")

        result = ApiTokenCache.delete("token-123", None)

        assert result is False

    @patch("services.api_token_service.redis_client")
    def test_delete_with_scope_should_continue_when_tenant_lookup_raises(self, mock_redis):
        """Test scoped delete still succeeds when tenant lookup from cache fails."""
        token = "token-123"
        scope = "app"
        cache_key = ApiTokenCache._make_cache_key(token, scope)
        mock_redis.get.side_effect = Exception("get failed")

        result = ApiTokenCache.delete(token, scope)

        assert result is True
        mock_redis.delete.assert_called_once_with(cache_key)

    @patch("services.api_token_service.redis_client")
    def test_delete_with_scope_should_return_false_when_delete_raises(self, mock_redis):
        """Test scoped delete returns False when delete operation fails."""
        token = "token-123"
        scope = "app"
        mock_redis.get.return_value = None
        mock_redis.delete.side_effect = Exception("delete failed")

        result = ApiTokenCache.delete(token, scope)

        assert result is False

    @patch("services.api_token_service.redis_client")
    def test_invalidate_by_tenant_should_return_true_when_index_not_found(self, mock_redis):
        """Test tenant invalidation returns True when tenant index is empty."""
        mock_redis.smembers.return_value = set()

        result = ApiTokenCache.invalidate_by_tenant("tenant-123")

        assert result is True
        mock_redis.delete.assert_not_called()

    @patch("services.api_token_service.redis_client")
    def test_invalidate_by_tenant_should_return_false_when_redis_raises(self, mock_redis):
        """Test tenant invalidation returns False when Redis operation fails."""
        mock_redis.smembers.side_effect = Exception("redis failed")

        result = ApiTokenCache.invalidate_by_tenant("tenant-123")

        assert result is False
