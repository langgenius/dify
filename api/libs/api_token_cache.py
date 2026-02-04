"""
API Token Cache Module

Provides Redis-based caching for API token validation to reduce database load.
"""

import json
import logging
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from extensions.ext_redis import redis_client, redis_fallback

logger = logging.getLogger(__name__)


class CachedApiToken(BaseModel):
    """
    Pydantic model for cached API token data.

    This is NOT a SQLAlchemy model instance, but a plain Pydantic model
    that mimics the ApiToken model interface for read-only access.

    Using Pydantic provides:
    - Automatic type validation
    - Better IDE support
    - Built-in serialization/deserialization
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


# Cache configuration
CACHE_KEY_PREFIX = "api_token"
CACHE_TTL_SECONDS = 600  # 10 minutes
CACHE_NULL_TTL_SECONDS = 60  # 1 minute for non-existent tokens (防穿透)


class ApiTokenCache:
    """
    Redis cache wrapper for API tokens.
    Handles serialization, deserialization, and cache invalidation.
    """

    @staticmethod
    def _make_cache_key(token: str, scope: str | None = None) -> str:
        """
        Generate cache key for the given token and scope.

        Args:
            token: The API token string
            scope: The token type/scope (e.g., 'app', 'dataset')

        Returns:
            Cache key string
        """
        scope_str = scope or "any"
        return f"{CACHE_KEY_PREFIX}:{scope_str}:{token}"

    @staticmethod
    def _serialize_token(api_token: Any) -> str:
        """
        Serialize ApiToken object to JSON string.

        Args:
            api_token: ApiToken model instance or CachedApiToken

        Returns:
            JSON string representation
        """
        # If it's already a Pydantic model, use model_dump_json
        if isinstance(api_token, CachedApiToken):
            return api_token.model_dump_json()

        # Otherwise, convert from SQLAlchemy model
        data = {
            "id": str(api_token.id),
            "app_id": str(api_token.app_id) if api_token.app_id else None,
            "tenant_id": str(api_token.tenant_id) if api_token.tenant_id else None,
            "type": api_token.type,
            "token": api_token.token,
            "last_used_at": api_token.last_used_at.isoformat() if api_token.last_used_at else None,
            "created_at": api_token.created_at.isoformat() if api_token.created_at else None,
        }
        return json.dumps(data)

    @staticmethod
    def _deserialize_token(cached_data: str) -> Any:
        """
        Deserialize JSON string back to a CachedApiToken Pydantic model.

        Args:
            cached_data: JSON string from cache

        Returns:
            CachedApiToken instance or None
        """
        if cached_data == "null":
            # Cached null value (token doesn't exist)
            return None

        try:
            # Use Pydantic's model_validate_json for automatic validation
            token_obj = CachedApiToken.model_validate_json(cached_data)
            return token_obj
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("Failed to deserialize token from cache: %s", e)
            return None

    @staticmethod
    @redis_fallback(default_return=None)
    def get(token: str, scope: str | None) -> Any | None:
        """
        Get API token from cache.

        Args:
            token: The API token string
            scope: The token type/scope

        Returns:
            CachedApiToken instance if found in cache, None if not cached or cache miss
        """
        cache_key = ApiTokenCache._make_cache_key(token, scope)
        cached_data = redis_client.get(cache_key)

        if cached_data is None:
            logger.debug("Cache miss for token key: %s", cache_key)
            return None

        # Decode bytes to string
        if isinstance(cached_data, bytes):
            cached_data = cached_data.decode("utf-8")

        logger.debug("Cache hit for token key: %s", cache_key)
        return ApiTokenCache._deserialize_token(cached_data)

    @staticmethod
    def _add_to_tenant_index(tenant_id: str | None, cache_key: str) -> None:
        """
        Add cache key to tenant index for efficient invalidation.

        Maintains a Redis SET: tenant_tokens:{tenant_id} containing all cache keys
        for that tenant. This allows O(1) tenant-wide invalidation.

        Args:
            tenant_id: The tenant ID
            cache_key: The cache key to add to the index
        """
        if not tenant_id:
            return

        try:
            index_key = f"tenant_tokens:{tenant_id}"
            redis_client.sadd(index_key, cache_key)
            # Set TTL on the index itself (slightly longer than cache TTL)
            redis_client.expire(index_key, CACHE_TTL_SECONDS + 60)
        except Exception as e:
            # Don't fail if index update fails
            logger.warning("Failed to update tenant index: %s", e)

    @staticmethod
    def _remove_from_tenant_index(tenant_id: str | None, cache_key: str) -> None:
        """
        Remove cache key from tenant index.

        Args:
            tenant_id: The tenant ID
            cache_key: The cache key to remove from the index
        """
        if not tenant_id:
            return

        try:
            index_key = f"tenant_tokens:{tenant_id}"
            redis_client.srem(index_key, cache_key)
        except Exception as e:
            # Don't fail if index update fails
            logger.warning("Failed to remove from tenant index: %s", e)

    @staticmethod
    @redis_fallback(default_return=False)
    def set(token: str, scope: str | None, api_token: Any | None, ttl: int = CACHE_TTL_SECONDS) -> bool:
        """
        Set API token in cache.

        Args:
            token: The API token string
            scope: The token type/scope
            api_token: ApiToken instance to cache (None for non-existent tokens)
            ttl: Time to live in seconds

        Returns:
            True if successful, False otherwise
        """
        cache_key = ApiTokenCache._make_cache_key(token, scope)

        if api_token is None:
            # Cache null value to prevent cache penetration
            cached_value = "null"
            ttl = CACHE_NULL_TTL_SECONDS
        else:
            cached_value = ApiTokenCache._serialize_token(api_token)

        try:
            redis_client.setex(cache_key, ttl, cached_value)

            # Add to tenant index for efficient tenant-wide invalidation
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
        """
        Delete API token from cache.

        Args:
            token: The API token string
            scope: The token type/scope (None to delete all scopes)

        Returns:
            True if successful, False otherwise
        """
        if scope is None:
            # Delete all possible scopes for this token
            # This is a safer approach when scope is unknown
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
                # Try to get tenant_id before deleting (for index cleanup)
                tenant_id = None
                try:
                    cached_data = redis_client.get(cache_key)
                    if cached_data and cached_data != b"null":
                        if isinstance(cached_data, bytes):
                            cached_data = cached_data.decode("utf-8")
                        data = json.loads(cached_data)
                        tenant_id = data.get("tenant_id")
                except Exception as e:
                    # If we can't get tenant_id, just delete the key without index cleanup
                    logger.debug("Failed to get tenant_id for cache cleanup: %s", e)

                # Delete the cache key
                redis_client.delete(cache_key)

                # Remove from tenant index
                if tenant_id:
                    ApiTokenCache._remove_from_tenant_index(tenant_id, cache_key)

                logger.info("Deleted cache for key: %s", cache_key)
                return True
            except Exception as e:
                logger.warning("Failed to delete token cache: %s", e)
                return False
