from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from redis import Redis
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

import services.api_token_service as api_token_service_module
from extensions.ext_redis import RedisClientWrapper
from models.engine import db
from models.enums import ApiTokenType
from models.model import ApiToken
from services.api_token_service import (
    CACHE_KEY_PREFIX,
    CACHE_NULL_TTL_SECONDS,
    CACHE_TTL_SECONDS,
    ApiTokenCache,
    CachedApiToken,
)

"""
Unit tests for API Token Cache module.
"""


class TestApiTokenCacheCases:
    class TestApiTokenCache:
        """Test cases for ApiTokenCache class."""

        def setup_method(self) -> None:
            """Setup test fixtures."""
            self.mock_token = ApiToken()
            self.mock_token.id = "test-token-id-123"
            self.mock_token.app_id = "test-app-id-456"
            self.mock_token.tenant_id = "test-tenant-id-789"
            self.mock_token.type = ApiTokenType.APP
            self.mock_token.token = "test-token-value-abc"
            self.mock_token.last_used_at = datetime(2026, 2, 3, 10, 0, 0)
            self.mock_token.created_at = datetime(2026, 1, 1, 0, 0, 0)

        def test_make_cache_key(self) -> None:
            """Test cache key generation."""
            # Test with scope
            key = ApiTokenCache._make_cache_key("my-token", "app")
            assert key == f"{CACHE_KEY_PREFIX}:app:my-token"

            # Test without scope
            key = ApiTokenCache._make_cache_key("my-token", None)
            assert key == f"{CACHE_KEY_PREFIX}:any:my-token"

        def test_serialize_token(self) -> None:
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

        def test_serialize_token_with_nulls(self) -> None:
            """Test token serialization with None values."""
            mock_token = ApiToken()
            mock_token.id = "test-id"
            mock_token.app_id = None
            mock_token.tenant_id = None
            mock_token.type = ApiTokenType.DATASET
            mock_token.token = "test-token"
            mock_token.last_used_at = None
            mock_token.created_at = datetime(2026, 1, 1, 0, 0, 0)

            serialized = ApiTokenCache._serialize_token(mock_token)
            data = json.loads(serialized)

            assert data["app_id"] is None
            assert data["tenant_id"] is None
            assert data["last_used_at"] is None

        def test_deserialize_token(self) -> None:
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

        def test_deserialize_null_token(self) -> None:
            """Test deserialization of null token (cached miss)."""
            result = ApiTokenCache._deserialize_token("null")
            assert result is None

        def test_deserialize_invalid_json(self) -> None:
            """Test deserialization with invalid JSON."""
            result = ApiTokenCache._deserialize_token("invalid-json{")
            assert result is None

        @patch("services.api_token_service.redis_client")
        def test_get_cache_hit(self, mock_redis: MagicMock) -> None:
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
        def test_get_cache_miss(self, mock_redis: MagicMock) -> None:
            """Test cache miss scenario."""
            mock_redis.get.return_value = None

            result = ApiTokenCache.get("test-token", "app")

            assert result is None
            mock_redis.get.assert_called_once()

        @patch("services.api_token_service.redis_client")
        def test_set_valid_token(self, mock_redis: MagicMock) -> None:
            """Test setting a valid token in cache."""
            result = ApiTokenCache.set("test-token", "app", self.mock_token)

            assert result is True
            mock_redis.setex.assert_called_once()
            args = mock_redis.setex.call_args[0]
            assert args[0] == f"{CACHE_KEY_PREFIX}:app:test-token"
            assert args[1] == CACHE_TTL_SECONDS

        @patch("services.api_token_service.redis_client")
        def test_set_null_token(self, mock_redis: MagicMock) -> None:
            """Test setting a null token (cache penetration prevention)."""
            result = ApiTokenCache.set("invalid-token", "app", None)

            assert result is True
            mock_redis.setex.assert_called_once()
            args = mock_redis.setex.call_args[0]
            assert args[0] == f"{CACHE_KEY_PREFIX}:app:invalid-token"
            assert args[1] == CACHE_NULL_TTL_SECONDS
            assert args[2] == b"null"

        @patch("services.api_token_service.redis_client")
        def test_delete_with_scope(self, mock_redis: MagicMock) -> None:
            """Test deleting token cache with specific scope."""
            result = ApiTokenCache.delete("test-token", "app")

            assert result is True
            mock_redis.delete.assert_called_once_with(f"{CACHE_KEY_PREFIX}:app:test-token")

        @patch("services.api_token_service.redis_client")
        def test_delete_without_scope(self, mock_redis: MagicMock) -> None:
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
        def test_redis_fallback_on_exception(self, mock_redis: MagicMock) -> None:
            """Test Redis fallback when Redis is unavailable."""
            from redis import RedisError

            mock_redis.get.side_effect = RedisError("Connection failed")

            result = ApiTokenCache.get("test-token", "app")

            # Should return None (fallback) instead of raising exception
            assert result is None

    class TestApiTokenCacheIntegration:
        """Integration test scenarios."""

        @patch("services.api_token_service.redis_client")
        def test_full_cache_lifecycle(self, mock_redis: MagicMock) -> None:
            """Test complete cache lifecycle: set -> get -> delete."""
            # Use the persisted model's fields for the cache lifecycle.
            mock_token = ApiToken()
            mock_token.id = "id-123"
            mock_token.app_id = "app-456"
            mock_token.tenant_id = "tenant-789"
            mock_token.type = ApiTokenType.APP
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
        def test_cache_penetration_prevention(self, mock_redis: MagicMock) -> None:
            """Test that non-existent tokens are cached as null."""
            # Set null token (cache miss)
            ApiTokenCache.set("non-existent-token", "app", None)

            args = mock_redis.setex.call_args[0]
            assert args[2] == b"null"
            assert args[1] == CACHE_NULL_TTL_SECONDS  # Shorter TTL for null values


"""Unit tests for API token caching and SQLite-backed token lookup."""


def _api_token(
    *,
    token_id: str = "id-123",
    app_id: str = "app-123",
    tenant_id: str = "tenant-123",
    token: str = "token-123",
) -> ApiToken:
    """Create a mapped API token for cache and single-flight behavior tests."""
    return ApiToken(
        id=token_id,
        app_id=app_id,
        tenant_id=tenant_id,
        type=ApiTokenType.APP,
        token=token,
        last_used_at=None,
    )


def _assert_lock_released(commands: list[tuple[object, ...]]) -> None:
    assert len(commands) == 2
    acquire, release = commands
    assert acquire[:2] == ("SET", "api_token_query_lock:app:token-123")
    assert acquire[3:] == ("NX", "PX", 10000)
    assert release[0] == "EVALSHA"
    assert release[2:] == (1, acquire[1], acquire[2])  # Release uses the acquired ownership token.


class TestApiTokenServiceCases:
    @staticmethod
    @pytest.fixture
    def api_token_db() -> Iterator[Session]:
        """Provide the production database extension with an isolated SQLite token table."""
        app = Flask(__name__)
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        db.init_app(app)

        with app.app_context():
            ApiToken.__table__.create(db.engine)
            with Session(db.engine, expire_on_commit=False) as session:
                yield session

    class TestQueryTokenFromDb:
        def test_should_return_api_token_and_cache_when_token_exists(self, api_token_db: Session) -> None:
            tenant_id = str(uuid4())
            app_id = str(uuid4())
            token_value = f"app-test-{uuid4()}"

            api_token = ApiToken()
            api_token.id = str(uuid4())
            api_token.app_id = app_id
            api_token.tenant_id = tenant_id
            api_token.type = "app"
            api_token.token = token_value
            api_token_db.add(api_token)
            api_token_db.commit()

            with (
                patch.object(api_token_service_module.ApiTokenCache, "set") as mock_cache_set,
                patch.object(api_token_service_module, "record_token_usage") as mock_record_usage,
            ):
                result = api_token_service_module.query_token_from_db(token_value, "app")

            assert result.id == api_token.id
            assert result.token == token_value
            mock_cache_set.assert_called_once()
            mock_record_usage.assert_called_once_with(token_value, "app")

        def test_should_cache_null_and_raise_unauthorized_when_token_not_found(self, api_token_db: Session) -> None:
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

    class TestGetEffectiveTokenLastUsedAt:
        def test_should_surface_pending_usage_before_the_batch_flush(self):
            pending = datetime(2026, 8, 11, 12, 30, 0)

            with patch.object(api_token_service_module, "redis_client") as mock_redis:
                mock_redis.get.return_value = pending.isoformat().encode()
                result = api_token_service_module.get_effective_token_last_used_at(
                    "token-123",
                    "dataset",
                    None,
                )

            assert result == pending
            mock_redis.get.assert_called_once_with(ApiTokenCache.make_active_key("token-123", "dataset"))

        def test_should_keep_a_newer_persisted_usage_timestamp(self):
            pending = datetime(2026, 8, 11, 12, 30, 0)
            persisted = datetime(2026, 8, 11, 12, 31, 0)

            with patch.object(api_token_service_module, "redis_client") as mock_redis:
                mock_redis.get.return_value = pending.isoformat()
                result = api_token_service_module.get_effective_token_last_used_at(
                    "token-123",
                    "dataset",
                    persisted,
                )

            assert result == persisted

        @pytest.mark.parametrize("value", [None, b"not-a-timestamp"])
        def test_should_fall_back_to_the_persisted_timestamp(self, value):
            persisted = datetime(2026, 8, 11, 12, 30, 0)

            with patch.object(api_token_service_module, "redis_client") as mock_redis:
                mock_redis.get.return_value = value
                result = api_token_service_module.get_effective_token_last_used_at(
                    "token-123",
                    "dataset",
                    persisted,
                )

            assert result == persisted

    @staticmethod
    @pytest.fixture
    def single_flight_redis(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[Redis, list[tuple[object, ...]]]]:
        """Use the real Redis client, wrapper and lock; isolate only wire commands."""
        commands: list[tuple[object, ...]] = []

        def execute(*args: object, **_kwargs: object) -> object:
            commands.append(args)
            assert args[0] in {"SET", "EVALSHA"}
            return True

        with Redis() as client:
            monkeypatch.setattr(client, "execute_command", execute)
            wrapper = RedisClientWrapper()
            wrapper.initialize(client)
            monkeypatch.setattr(api_token_service_module, "redis_client", wrapper)
            yield client, commands

    class TestFetchTokenWithSingleFlight:
        def test_should_return_cached_token_when_lock_acquired_and_cache_filled(
            self, single_flight_redis: tuple[Redis, list[tuple[object, ...]]]
        ) -> None:
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
            _client, commands = single_flight_redis

            with (
                patch.object(api_token_service_module.ApiTokenCache, "get", return_value=cached_token),
                patch.object(api_token_service_module, "query_token_from_db") as mock_query_db,
            ):
                result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

            assert result == cached_token
            _assert_lock_released(commands)
            mock_query_db.assert_not_called()

        def test_should_query_db_when_lock_acquired_and_cache_missed(
            self, single_flight_redis: tuple[Redis, list[tuple[object, ...]]]
        ) -> None:
            auth_token = "token-123"
            scope = "app"
            db_token = _api_token()
            _client, commands = single_flight_redis

            with (
                patch.object(api_token_service_module.ApiTokenCache, "get", return_value=None),
                patch.object(api_token_service_module, "query_token_from_db", return_value=db_token) as mock_query_db,
            ):
                result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

            assert result == db_token
            mock_query_db.assert_called_once_with(auth_token, scope)
            _assert_lock_released(commands)

        def test_should_query_db_directly_when_lock_not_acquired(
            self, single_flight_redis: tuple[Redis, list[tuple[object, ...]]], monkeypatch: pytest.MonkeyPatch
        ) -> None:
            auth_token = "token-123"
            scope = "app"
            db_token = _api_token()
            client, commands = single_flight_redis

            def contended(*args: object, **_kwargs: object) -> bool:
                commands.append(args)
                assert args[0] == "SET"
                return False

            monkeypatch.setattr(client, "execute_command", contended)

            with (
                patch.object(api_token_service_module.ApiTokenCache, "get") as mock_cache_get,
                patch.object(api_token_service_module, "query_token_from_db", return_value=db_token) as mock_query_db,
            ):
                result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

            assert result == db_token
            mock_cache_get.assert_not_called()
            mock_query_db.assert_called_once_with(auth_token, scope)
            assert commands
            assert all(command[0] == "SET" for command in commands)

        def test_should_reraise_unauthorized_from_db_query(
            self, single_flight_redis: tuple[Redis, list[tuple[object, ...]]]
        ) -> None:
            auth_token = "token-123"
            scope = "app"
            _client, commands = single_flight_redis

            with (
                patch.object(api_token_service_module.ApiTokenCache, "get", return_value=None),
                patch.object(
                    api_token_service_module,
                    "query_token_from_db",
                    side_effect=Unauthorized("Access token is invalid"),
                ),
            ):
                with pytest.raises(Unauthorized, match="Access token is invalid"):
                    api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

            _assert_lock_released(commands)

        def test_should_fallback_to_db_query_when_lock_raises_exception(
            self, single_flight_redis: tuple[Redis, list[tuple[object, ...]]], monkeypatch: pytest.MonkeyPatch
        ) -> None:
            auth_token = "token-123"
            scope = "app"
            db_token = _api_token()
            client, commands = single_flight_redis

            def unavailable(*args: object, **_kwargs: object) -> bool:
                commands.append(args)
                raise RuntimeError("redis lock error")

            monkeypatch.setattr(client, "execute_command", unavailable)

            with (
                patch.object(api_token_service_module, "query_token_from_db", return_value=db_token) as mock_query_db,
            ):
                result = api_token_service_module.fetch_token_with_single_flight(auth_token, scope)

            assert result == db_token
            mock_query_db.assert_called_once_with(auth_token, scope)
            assert len(commands) == 1
            assert commands[0][:2] == ("SET", "api_token_query_lock:app:token-123")

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
            api_token = _api_token()
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
