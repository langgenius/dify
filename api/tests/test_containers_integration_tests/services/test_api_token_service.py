from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from werkzeug.exceptions import Unauthorized

import services.api_token_service as api_token_service_module
from models.model import ApiToken
from services.api_token_service import ApiTokenCache, CachedApiToken


class TestQueryTokenFromDb:
    def test_should_return_api_token_and_cache_when_token_exists(
        self, flask_app_with_containers, db_session_with_containers
    ):
        tenant_id = str(uuid4())
        app_id = str(uuid4())
        token_value = f"app-test-{uuid4()}"

        api_token = ApiToken()
        api_token.id = str(uuid4())
        api_token.app_id = app_id
        api_token.tenant_id = tenant_id
        api_token.type = "app"
        api_token.token = token_value
        db_session_with_containers.add(api_token)
        db_session_with_containers.commit()

        with (
            patch.object(api_token_service_module.ApiTokenCache, "set") as mock_cache_set,
            patch.object(api_token_service_module, "record_token_usage") as mock_record_usage,
        ):
            result = api_token_service_module.query_token_from_db(token_value, "app")

        assert result.id == api_token.id
        assert result.token == token_value
        mock_cache_set.assert_called_once()
        mock_record_usage.assert_called_once_with(token_value, "app")

    def test_should_cache_null_and_raise_unauthorized_when_token_not_found(
        self, flask_app_with_containers, db_session_with_containers
    ):
        with (
            patch.object(api_token_service_module.ApiTokenCache, "set") as mock_cache_set,
            patch.object(api_token_service_module, "record_token_usage") as mock_record_usage,
        ):
            with pytest.raises(Unauthorized, match="Access token is invalid"):
                api_token_service_module.query_token_from_db(f"missing-{uuid4()}", "app")

        mock_cache_set.assert_called_once()
        call_args = mock_cache_set.call_args[0]
        assert call_args[2] is None  # cached None
        mock_record_usage.assert_not_called()


class TestRecordTokenUsage:
    def test_should_write_active_key_with_iso_timestamp_and_ttl(self):
        auth_token = "token-123"
        scope = "dataset"
        fixed_time = datetime(2026, 2, 24, 12, 0, 0)
        expected_key = ApiTokenCache.make_active_key(auth_token, scope)

        with (
            patch.object(api_token_service_module, "naive_utc_now", return_value=fixed_time),
            patch.object(api_token_service_module, "redis_client") as mock_redis,
        ):
            api_token_service_module.record_token_usage(auth_token, scope)

        mock_redis.set.assert_called_once_with(expected_key, fixed_time.isoformat(), ex=3600)

    def test_should_not_raise_when_redis_write_fails(self):
        with patch.object(api_token_service_module, "redis_client") as mock_redis:
            mock_redis.set.side_effect = Exception("redis unavailable")
            api_token_service_module.record_token_usage("token-123", "app")


class TestFetchTokenWithSingleFlight:
    def test_should_return_cached_token_when_lock_acquired_and_cache_filled(self):
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
            patch.object(api_token_service_module.ApiTokenCache, "get", return_value=cached_token),
            patch.object(api_token_service_module, "query_token_from_db") as mock_query_db,
        ):
            mock_redis.lock.return_value = lock
            result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

        assert result == cached_token
        lock.acquire.assert_called_once_with(blocking=True)
        lock.release.assert_called_once()
        mock_query_db.assert_not_called()

    def test_should_query_db_when_lock_acquired_and_cache_missed(self):
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
            result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

        assert result == db_token
        mock_query_db.assert_called_once_with(auth_token, scope)
        lock.release.assert_called_once()

    def test_should_query_db_directly_when_lock_not_acquired(self):
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
            result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

        assert result == db_token
        mock_cache_get.assert_not_called()
        mock_query_db.assert_called_once_with(auth_token, scope)
        lock.release.assert_not_called()

    def test_should_reraise_unauthorized_from_db_query(self):
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
            with pytest.raises(Unauthorized, match="Access token is invalid"):
                api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

        lock.release.assert_called_once()

    def test_should_fallback_to_db_query_when_lock_raises_exception(self):
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
            result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

        assert result == db_token
        mock_query_db.assert_called_once_with(auth_token, scope)


class TestApiTokenCacheTenantBranches:
    @patch("services.api_token_service.redis_client")
    def test_delete_with_scope_should_remove_from_tenant_index_when_tenant_found(self, mock_redis):
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
            result = ApiTokenCache.delete(token, scope)

        assert result is True
        mock_redis.delete.assert_called_once_with(cache_key)
        mock_remove_index.assert_called_once_with("tenant-1", cache_key)

    @patch("services.api_token_service.redis_client")
    def test_invalidate_by_tenant_should_delete_all_indexed_cache_keys(self, mock_redis):
        tenant_id = "tenant-1"
        index_key = ApiTokenCache._make_tenant_index_key(tenant_id)
        mock_redis.smembers.return_value = {
            b"api_token:app:token-1",
            b"api_token:any:token-2",
        }

        result = ApiTokenCache.invalidate_by_tenant(tenant_id)

        assert result is True
        mock_redis.smembers.assert_called_once_with(index_key)
        mock_redis.delete.assert_any_call("api_token:app:token-1")
        mock_redis.delete.assert_any_call("api_token:any:token-2")
        mock_redis.delete.assert_any_call(index_key)


class TestApiTokenCacheCoreBranches:
    def test_cached_api_token_repr_should_include_id_and_type(self):
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

    def test_deserialize_token_should_return_none_for_null_markers(self):
        assert ApiTokenCache._deserialize_token("null") is None
        assert ApiTokenCache._deserialize_token(b"null") is None

    def test_deserialize_token_should_return_none_for_invalid_payload(self):
        assert ApiTokenCache._deserialize_token("not-json") is None

    @patch("services.api_token_service.redis_client")
    def test_get_should_return_none_on_cache_miss(self, mock_redis):
        mock_redis.get.return_value = None
        result = ApiTokenCache.get("token-123", "app")
        assert result is None

    @patch("services.api_token_service.redis_client")
    def test_get_should_deserialize_cached_payload_on_cache_hit(self, mock_redis):
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
        ApiTokenCache._add_to_tenant_index(None, "api_token:app:token-123")
        mock_redis.sadd.assert_not_called()

    @patch("services.api_token_service.redis_client")
    def test_add_to_tenant_index_should_swallow_index_update_errors(self, mock_redis):
        mock_redis.sadd.side_effect = Exception("redis down")
        ApiTokenCache._add_to_tenant_index("tenant-123", "api_token:app:token-123")
        mock_redis.sadd.assert_called_once()

    @patch("services.api_token_service.redis_client")
    def test_remove_from_tenant_index_should_skip_when_tenant_id_missing(self, mock_redis):
        ApiTokenCache._remove_from_tenant_index(None, "api_token:app:token-123")
        mock_redis.srem.assert_not_called()

    @patch("services.api_token_service.redis_client")
    def test_remove_from_tenant_index_should_swallow_redis_errors(self, mock_redis):
        mock_redis.srem.side_effect = Exception("redis down")
        ApiTokenCache._remove_from_tenant_index("tenant-123", "api_token:app:token-123")
        mock_redis.srem.assert_called_once()

    @patch("services.api_token_service.redis_client")
    def test_set_should_return_false_when_cache_write_raises_exception(self, mock_redis):
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
        mock_redis.scan_iter.side_effect = Exception("scan failed")
        result = ApiTokenCache.delete("token-123", None)
        assert result is False

    @patch("services.api_token_service.redis_client")
    def test_delete_with_scope_should_continue_when_tenant_lookup_raises(self, mock_redis):
        token = "token-123"
        scope = "app"
        cache_key = ApiTokenCache._make_cache_key(token, scope)
        mock_redis.get.side_effect = Exception("get failed")
        result = ApiTokenCache.delete(token, scope)
        assert result is True
        mock_redis.delete.assert_called_once_with(cache_key)

    @patch("services.api_token_service.redis_client")
    def test_delete_with_scope_should_return_false_when_delete_raises(self, mock_redis):
        mock_redis.get.return_value = None
        mock_redis.delete.side_effect = Exception("delete failed")
        result = ApiTokenCache.delete("token-123", "app")
        assert result is False

    @patch("services.api_token_service.redis_client")
    def test_invalidate_by_tenant_should_return_true_when_index_not_found(self, mock_redis):
        mock_redis.smembers.return_value = set()
        result = ApiTokenCache.invalidate_by_tenant("tenant-123")
        assert result is True
        mock_redis.delete.assert_not_called()

    @patch("services.api_token_service.redis_client")
    def test_invalidate_by_tenant_should_return_false_when_redis_raises(self, mock_redis):
        mock_redis.smembers.side_effect = Exception("redis failed")
        result = ApiTokenCache.invalidate_by_tenant("tenant-123")
        assert result is False
