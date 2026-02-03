"""
API Token Cache Module

Provides Redis-based caching for API token validation to reduce database load.
"""

import json
import logging
from datetime import datetime
from typing import Any

from extensions.ext_redis import redis_client, redis_fallback

logger = logging.getLogger(__name__)


class CachedApiToken:
    """
    Simple data class to represent a cached API token.
    
    This is NOT a SQLAlchemy model instance, but a plain Python object
    that mimics the ApiToken model interface for read-only access.
    """

    def __init__(
        self,
        id: str,
        app_id: str | None,
        tenant_id: str | None,
        type: str,
        token: str,
        last_used_at: datetime | None,
        created_at: datetime | None,
    ):
        self.id = id
        self.app_id = app_id
        self.tenant_id = tenant_id
        self.type = type
        self.token = token
        self.last_used_at = last_used_at
        self.created_at = created_at

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
            api_token: ApiToken model instance

        Returns:
            JSON string representation
        """
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
        Deserialize JSON string back to a CachedApiToken object.

        Args:
            cached_data: JSON string from cache

        Returns:
            CachedApiToken instance or None
        """
        if cached_data == "null":
            # Cached null value (token doesn't exist)
            return None

        try:
            data = json.loads(cached_data)
            
            # Create a simple data object (NOT a SQLAlchemy model instance)
            # This is safe because it's just a plain Python object with attributes
            token_obj = CachedApiToken(
                id=data["id"],
                app_id=data["app_id"],
                tenant_id=data["tenant_id"],
                type=data["type"],
                token=data["token"],
                last_used_at=datetime.fromisoformat(data["last_used_at"]) if data["last_used_at"] else None,
                created_at=datetime.fromisoformat(data["created_at"]) if data["created_at"] else None,
            )

            return token_obj
        except (json.JSONDecodeError, KeyError, ValueError) as e:
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
                keys = redis_client.keys(pattern)
                if keys:
                    redis_client.delete(*keys)
                    logger.info("Deleted %d cache entries for token", len(keys))
                return True
            except Exception as e:
                logger.warning("Failed to delete token cache with pattern: %s", e)
                return False
        else:
            cache_key = ApiTokenCache._make_cache_key(token, scope)
            try:
                redis_client.delete(cache_key)
                logger.info("Deleted cache for key: %s", cache_key)
                return True
            except Exception as e:
                logger.warning("Failed to delete token cache: %s", e)
                return False

    @staticmethod
    @redis_fallback(default_return=False)
    def invalidate_by_tenant(tenant_id: str) -> bool:
        """
        Invalidate all API token caches for a specific tenant.
        Use this when tenant status changes or tokens are batch updated.

        Args:
            tenant_id: The tenant ID

        Returns:
            True if successful, False otherwise
        """
        # Note: This requires scanning, which can be slow on large Redis instances
        # Consider using a separate index if this becomes a bottleneck
        try:
            pattern = f"{CACHE_KEY_PREFIX}:*"
            cursor = 0
            deleted_count = 0

            while True:
                cursor, keys = redis_client.scan(cursor, match=pattern, count=100)
                if keys:
                    # Filter keys by checking if they contain the tenant_id
                    # This is a simple approach; for production, consider maintaining a separate index
                    for key in keys:
                        redis_client.delete(key)
                        deleted_count += 1

                if cursor == 0:
                    break

            logger.info("Invalidated %s token cache entries for tenant: %s", deleted_count, tenant_id)
            return True
        except Exception as e:
            logger.warning("Failed to invalidate tenant token cache: %s", e)
            return False
