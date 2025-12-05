import json
import logging
from typing import Any

from core.tools.entities.api_entities import ToolProviderTypeApiLiteral
from extensions.ext_redis import redis_client, redis_fallback

logger = logging.getLogger(__name__)


class ToolProviderListCache:
    """Cache for tool provider lists"""

    CACHE_TTL = 300  # 5 minutes

    @staticmethod
    def _generate_cache_key(tenant_id: str, typ: ToolProviderTypeApiLiteral = None) -> str:
        """Generate cache key for tool providers list"""
        type_filter = typ or "all"
        return f"tool_providers:tenant_id:{tenant_id}:type:{type_filter}"

    @staticmethod
    @redis_fallback(default_return=None)
    def get_cached_providers(tenant_id: str, typ: ToolProviderTypeApiLiteral = None) -> list[dict[str, Any]] | None:
        """Get cached tool providers"""
        cache_key = ToolProviderListCache._generate_cache_key(tenant_id, typ)
        cached_data = redis_client.get(cache_key)
        if cached_data:
            try:
                return json.loads(cached_data.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                logger.warning("Failed to decode cached tool providers data")
                return None
        return None

    @staticmethod
    @redis_fallback()
    def set_cached_providers(tenant_id: str, typ: ToolProviderTypeApiLiteral, providers: list[dict[str, Any]]):
        """Cache tool providers"""
        cache_key = ToolProviderListCache._generate_cache_key(tenant_id, typ)
        redis_client.setex(cache_key, ToolProviderListCache.CACHE_TTL, json.dumps(providers))

    @staticmethod
    @redis_fallback()
    def invalidate_cache(tenant_id: str, typ: ToolProviderTypeApiLiteral = None):
        """Invalidate cache for tool providers"""
        if typ:
            # Invalidate specific type cache
            cache_key = ToolProviderListCache._generate_cache_key(tenant_id, typ)
            redis_client.delete(cache_key)
        else:
            # Invalidate all caches for this tenant
            pattern = f"tool_providers:tenant_id:{tenant_id}:*"
            keys = list(redis_client.scan_iter(pattern))
            if keys:
                redis_client.delete(*keys)
