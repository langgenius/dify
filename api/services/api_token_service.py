"""
API Token Service

Handles all API token caching, validation, and usage recording.
Includes Redis cache operations, database queries, and single-flight concurrency control.
"""

import logging
from datetime import datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

from extensions.ext_database import db
from extensions.ext_redis import redis_client, redis_fallback
from libs.datetime_utils import naive_utc_now
from models.model import ApiToken

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------
# Pydantic DTO
# ---------------------------------------------------------------------


class CachedApiToken(BaseModel):
    """
    Pydantic model for cached API token data.

    This is NOT a SQLAlchemy model instance, but a plain Pydantic model
    that mimics the ApiToken model interface for read-only access.
    """

    id: str
    app_id: str | None
    tenant_id: str | None
    type: str
    token: str
    last_used_at: datetime | None
    created_at: datetime | None

    def __repr__(self) -> str:
        return f"<CachedApiToken id={self.id} type={self.type}>"


# ---------------------------------------------------------------------
# Cache configuration
# ---------------------------------------------------------------------

CACHE_KEY_PREFIX = "api_token"
CACHE_TTL_SECONDS = 600  # 10 minutes
CACHE_NULL_TTL_SECONDS = 60  # 1 minute for non-existent tokens
ACTIVE_TOKEN_KEY_PREFIX = "api_token_active:"


# ---------------------------------------------------------------------
# Cache class
# ---------------------------------------------------------------------


class ApiTokenCache:
    """
    Redis cache wrapper for API tokens.
    Handles serialization, deserialization, and cache invalidation.
    """

    @staticmethod
    def make_active_key(token: str, scope: str | None = None) -> str:
        """Generate Redis key for recording token usage."""
        return f"{ACTIVE_TOKEN_KEY_PREFIX}{scope}:{token}"

    @staticmethod
    def _make_tenant_index_key(tenant_id: str) -> str:
        """Generate Redis key for tenant token index."""
        return f"tenant_tokens:{tenant_id}"

    @staticmethod
    def _make_cache_key(token: str, scope: str | None = None) -> str:
        """Generate cache key for the given token and scope."""
        scope_str = scope or "any"
        return f"{CACHE_KEY_PREFIX}:{scope_str}:{token}"

    @staticmethod
    def _serialize_token(api_token: Any) -> bytes:
        """Serialize ApiToken object to JSON bytes."""
        if isinstance(api_token, CachedApiToken):
            return api_token.model_dump_json().encode("utf-8")

        cached = CachedApiToken(
            id=str(api_token.id),
            app_id=str(api_token.app_id) if api_token.app_id else None,
            tenant_id=str(api_token.tenant_id) if api_token.tenant_id else None,
            type=api_token.type,
            token=api_token.token,
            last_used_at=api_token.last_used_at,
            created_at=api_token.created_at,
        )
        return cached.model_dump_json().encode("utf-8")

    @staticmethod
    def _deserialize_token(cached_data: bytes | str) -> Any:
        """Deserialize JSON bytes/string back to a CachedApiToken Pydantic model."""
        if cached_data in {b"null", "null"}:
            return None

        try:
            if isinstance(cached_data, bytes):
                cached_data = cached_data.decode("utf-8")
            return CachedApiToken.model_validate_json(cached_data)
        except (ValueError, Exception) as e:
            logger.warning("Failed to deserialize token from cache: %s", e)
            return None

    @staticmethod
    @redis_fallback(default_return=None)
    def get(token: str, scope: str | None) -> Any | None:
        """Get API token from cache."""
        cache_key = ApiTokenCache._make_cache_key(token, scope)
        cached_data = redis_client.get(cache_key)

        if cached_data is None:
            logger.debug("Cache miss for token key: %s", cache_key)
            return None

        logger.debug("Cache hit for token key: %s", cache_key)
        return ApiTokenCache._deserialize_token(cached_data)

    @staticmethod
    def _add_to_tenant_index(tenant_id: str | None, cache_key: str) -> None:
        """Add cache key to tenant index for efficient invalidation."""
        if not tenant_id:
            return

        try:
            index_key = ApiTokenCache._make_tenant_index_key(tenant_id)
            redis_client.sadd(index_key, cache_key)
            redis_client.expire(index_key, CACHE_TTL_SECONDS + 60)
        except Exception as e:
            logger.warning("Failed to update tenant index: %s", e)

    @staticmethod
    def _remove_from_tenant_index(tenant_id: str | None, cache_key: str) -> None:
        """Remove cache key from tenant index."""
        if not tenant_id:
            return

        try:
            index_key = ApiTokenCache._make_tenant_index_key(tenant_id)
            redis_client.srem(index_key, cache_key)
        except Exception as e:
            logger.warning("Failed to remove from tenant index: %s", e)

    @staticmethod
    @redis_fallback(default_return=False)
    def set(token: str, scope: str | None, api_token: Any | None, ttl: int = CACHE_TTL_SECONDS) -> bool:
        """Set API token in cache."""
        cache_key = ApiTokenCache._make_cache_key(token, scope)

        if api_token is None:
            cached_value = b"null"
            ttl = CACHE_NULL_TTL_SECONDS
        else:
            cached_value = ApiTokenCache._serialize_token(api_token)

        try:
            redis_client.setex(cache_key, ttl, cached_value)

            if api_token is not None and hasattr(api_token, "tenant_id"):
                ApiTokenCache._add_to_tenant_index(api_token.tenant_id, cache_key)

            logger.debug("Cached token with key: %s, ttl: %ss", cache_key, ttl)
            return True
        except Exception as e:
            logger.warning("Failed to cache token: %s", e)
            return False

    @staticmethod
    @redis_fallback(default_return=False)
    def delete(token: str, scope: str | None = None) -> bool:
        """Delete API token from cache."""
        if scope is None:
            pattern = f"{CACHE_KEY_PREFIX}:*:{token}"
            try:
                keys_to_delete = list(redis_client.scan_iter(match=pattern))
                if keys_to_delete:
                    redis_client.delete(*keys_to_delete)
                    logger.info("Deleted %d cache entries for token", len(keys_to_delete))
                return True
            except Exception as e:
                logger.warning("Failed to delete token cache with pattern: %s", e)
                return False
        else:
            cache_key = ApiTokenCache._make_cache_key(token, scope)
            try:
                tenant_id = None
                try:
                    cached_data = redis_client.get(cache_key)
                    if cached_data and cached_data != b"null":
                        cached_token = ApiTokenCache._deserialize_token(cached_data)
                        if cached_token:
                            tenant_id = cached_token.tenant_id
                except Exception as e:
                    logger.debug("Failed to get tenant_id for cache cleanup: %s", e)

                redis_client.delete(cache_key)

                if tenant_id:
                    ApiTokenCache._remove_from_tenant_index(tenant_id, cache_key)

                logger.info("Deleted cache for key: %s", cache_key)
                return True
            except Exception as e:
                logger.warning("Failed to delete token cache: %s", e)
                return False

    @staticmethod
    @redis_fallback(default_return=False)
    def invalidate_by_tenant(tenant_id: str) -> bool:
        """Invalidate all API token caches for a specific tenant via tenant index."""
        try:
            index_key = ApiTokenCache._make_tenant_index_key(tenant_id)
            cache_keys = redis_client.smembers(index_key)

            if cache_keys:
                deleted_count = 0
                for cache_key in cache_keys:
                    if isinstance(cache_key, bytes):
                        cache_key = cache_key.decode("utf-8")
                    redis_client.delete(cache_key)
                    deleted_count += 1

                redis_client.delete(index_key)

                logger.info(
                    "Invalidated %d token cache entries for tenant: %s",
                    deleted_count,
                    tenant_id,
                )
            else:
                logger.info(
                    "No tenant index found for %s, relying on TTL expiration",
                    tenant_id,
                )

            return True

        except Exception as e:
            logger.warning("Failed to invalidate tenant token cache: %s", e)
            return False


# ---------------------------------------------------------------------
# Token usage recording (for batch update)
# ---------------------------------------------------------------------


def record_token_usage(auth_token: str, scope: str | None) -> None:
    """
    Record token usage in Redis for later batch update by a scheduled job.

    Instead of dispatching a Celery task per request, we simply SET a key in Redis.
    A Celery Beat scheduled task will periodically scan these keys and batch-update
    last_used_at in the database.
    """
    try:
        key = ApiTokenCache.make_active_key(auth_token, scope)
        redis_client.set(key, naive_utc_now().isoformat(), ex=3600)
    except Exception as e:
        logger.warning("Failed to record token usage: %s", e)


# ---------------------------------------------------------------------
# Database query + single-flight
# ---------------------------------------------------------------------


def query_token_from_db(auth_token: str, scope: str | None) -> ApiToken:
    """
    Query API token from database and cache the result.

    Raises Unauthorized if token is invalid.
    """
    with Session(db.engine, expire_on_commit=False) as session:
        stmt = select(ApiToken).where(ApiToken.token == auth_token, ApiToken.type == scope)
        api_token = session.scalar(stmt)

        if not api_token:
            ApiTokenCache.set(auth_token, scope, None)
            raise Unauthorized("Access token is invalid")

        ApiTokenCache.set(auth_token, scope, api_token)
        record_token_usage(auth_token, scope)
        return api_token


def fetch_token_with_single_flight(auth_token: str, scope: str | None) -> ApiToken | Any:
    """
    Fetch token from DB with single-flight pattern using Redis lock.

    Ensures only one concurrent request queries the database for the same token.
    Falls back to direct query if lock acquisition fails.
    """
    logger.debug("Token cache miss, attempting to acquire query lock for scope: %s", scope)

    lock_key = f"api_token_query_lock:{scope}:{auth_token}"
    lock = redis_client.lock(lock_key, timeout=10, blocking_timeout=5)

    try:
        if lock.acquire(blocking=True):
            try:
                cached_token = ApiTokenCache.get(auth_token, scope)
                if cached_token is not None:
                    logger.debug("Token cached by concurrent request, using cached version")
                    return cached_token

                return query_token_from_db(auth_token, scope)
            finally:
                lock.release()
        else:
            logger.warning("Lock timeout for token: %s, proceeding with direct query", auth_token[:10])
            return query_token_from_db(auth_token, scope)
    except Unauthorized:
        raise
    except Exception as e:
        logger.warning("Redis lock failed for token query: %s, proceeding anyway", e)
        return query_token_from_db(auth_token, scope)
