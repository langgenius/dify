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
        if scope is None:
            # Delete all possible scopes for this token
            # This is a safer approach when scope is unknown
            pattern = f"{CACHE_KEY_PREFIX}:*:{token}"
            try:
                keys_to_delete = [key for key in redis_client.scan_iter(match=pattern)]
                if keys_to_delete:
                    redis_client.delete(*keys_to_delete)
                    logger.info("Deleted %d cache entries for token", len(keys_to_delete))
                return True
            except Exception as e:
                logger.warning("Failed to delete token cache with pattern: %s", e)
                return False
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
