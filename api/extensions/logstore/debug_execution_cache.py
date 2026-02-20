"""
Debug Execution Cache for LogStore

This module provides a short-lived in-memory cache for workflow node executions
to bridge the gap between write and index availability in LogStore.

The cache is designed to:
- Cache executions when explicitly requested by the caller (typically SINGLE_STEP)
- Automatically expire entries after a configurable TTL (default: 10 seconds)
- Limit memory usage with a maximum cache size (default: 100 entries)
- Be thread-safe for multi-threaded environments
- Have minimal performance impact on normal workflow runs

"""

import logging
import os
import time
from collections import OrderedDict
from threading import Lock
from typing import ClassVar

from models.workflow import WorkflowNodeExecutionModel

logger = logging.getLogger(__name__)


def _parse_int_env(env_name: str, default: int) -> int:
    """
    Safely parse an integer from environment variable.

    Args:
        env_name: Environment variable name
        default: Default value if parsing fails

    Returns:
        Parsed integer value or default
    """
    value = os.environ.get(env_name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning(
            "Invalid integer value for %s: '%s', using default: %d",
            env_name,
            value,
            default,
        )
        return default


class DebugExecutionCache:
    """
    Thread-safe in-memory cache for workflow node executions.

    This cache is designed to handle LogStore indexing delays, particularly
    during node debugging scenarios where users expect immediate results.
    The caller is responsible for deciding when to cache.

    Configuration (via environment variables):
    - LOGSTORE_DEBUG_CACHE_TTL_SECONDS: Cache entry TTL in seconds (default: 10)
    - LOGSTORE_DEBUG_CACHE_MAX_SIZE: Maximum number of cached entries (default: 100)
    - LOGSTORE_DEBUG_CACHE_ENABLED: Enable/disable cache (default: true)
    """

    # Class-level cache shared across all instances
    _cache: ClassVar[OrderedDict] = OrderedDict()
    _cache_lock: ClassVar[Lock] = Lock()

    # Configuration from environment variables with safe parsing
    _cache_ttl: ClassVar[int] = _parse_int_env("LOGSTORE_DEBUG_CACHE_TTL_SECONDS", 10)
    _cache_max_size: ClassVar[int] = _parse_int_env("LOGSTORE_DEBUG_CACHE_MAX_SIZE", 100)
    _cache_enabled: ClassVar[bool] = os.environ.get("LOGSTORE_DEBUG_CACHE_ENABLED", "true").lower() == "true"

    # Statistics
    _stats_hit_count: ClassVar[int] = 0
    _stats_miss_count: ClassVar[int] = 0
    _stats_put_count: ClassVar[int] = 0

    @classmethod
    def put(
        cls,
        execution_id: str,
        model: WorkflowNodeExecutionModel,
    ) -> None:
        """
        Cache a workflow node execution model.

        Args:
            execution_id: The execution ID as cache key
            model: The WorkflowNodeExecutionModel to cache
        """
        # Skip if cache is disabled
        if not cls._cache_enabled:
            return

        with cls._cache_lock:
            # Remove oldest entries if cache is full (FIFO eviction)
            while len(cls._cache) >= cls._cache_max_size:
                evicted_key, _ = cls._cache.popitem(last=False)
                logger.debug("Evicted oldest cache entry: %s", evicted_key)

            # Add new entry with monotonic timestamp for duration measurement
            # Using time.monotonic() to avoid issues with system time changes (e.g., NTP updates)
            cls._cache[execution_id] = {
                "model": model,
                "timestamp": time.monotonic(),
            }

            cls._stats_put_count += 1

            logger.debug(
                "Cached debug execution: %s, cache_size=%d/%d, ttl=%ds",
                execution_id,
                len(cls._cache),
                cls._cache_max_size,
                cls._cache_ttl,
            )

    @classmethod
    def get(cls, execution_id: str) -> WorkflowNodeExecutionModel | None:
        """
        Retrieve a cached workflow node execution model.

        Args:
            execution_id: The execution ID to look up

        Returns:
            The cached WorkflowNodeExecutionModel if found and not expired,
            None otherwise
        """
        # Skip if cache is disabled
        if not cls._cache_enabled:
            return None

        with cls._cache_lock:
            entry = cls._cache.get(execution_id)

            if entry is None:
                cls._stats_miss_count += 1
                return None

            # Check if entry has expired using monotonic time
            age = time.monotonic() - entry["timestamp"]
            if age > cls._cache_ttl:
                # Remove expired entry
                del cls._cache[execution_id]
                cls._stats_miss_count += 1
                logger.debug("Cache entry expired: %s, age=%.2fs", execution_id, age)
                return None

            # Cache hit
            cls._stats_hit_count += 1
            logger.debug("Cache hit: %s, age=%.2fs", execution_id, age)
            return entry["model"]

    @classmethod
    def cleanup_expired(cls) -> int:
        """
        Remove all expired entries from the cache.

        This method should be called periodically to prevent memory leaks
        from expired but not yet accessed entries.

        Returns:
            Number of entries removed
        """
        if not cls._cache_enabled:
            return 0

        with cls._cache_lock:
            current_time = time.monotonic()
            expired_keys = [
                key for key, entry in cls._cache.items() if current_time - entry["timestamp"] > cls._cache_ttl
            ]

            for key in expired_keys:
                del cls._cache[key]

            if expired_keys:
                logger.debug("Cleaned up %d expired cache entries", len(expired_keys))

            return len(expired_keys)

    @classmethod
    def clear(cls) -> None:
        """
        Clear all cache entries.

        This is mainly useful for testing or manual cache invalidation.
        """
        with cls._cache_lock:
            count = len(cls._cache)
            cls._cache.clear()
            logger.info("Cleared all cache entries: %s entries removed", count)

    @classmethod
    def get_stats(cls) -> dict:
        """
        Get cache statistics.

        Returns:
            Dictionary containing cache statistics:
            - enabled: Whether cache is enabled
            - size: Current number of cached entries
            - max_size: Maximum cache size
            - ttl_seconds: Cache entry TTL
            - hit_count: Total number of cache hits
            - miss_count: Total number of cache misses
            - put_count: Total number of cache puts
            - hit_rate: Cache hit rate (0-1)
        """
        with cls._cache_lock:
            total_requests = cls._stats_hit_count + cls._stats_miss_count
            hit_rate = cls._stats_hit_count / total_requests if total_requests > 0 else 0.0

            return {
                "enabled": cls._cache_enabled,
                "size": len(cls._cache),
                "max_size": cls._cache_max_size,
                "ttl_seconds": cls._cache_ttl,
                "hit_count": cls._stats_hit_count,
                "miss_count": cls._stats_miss_count,
                "put_count": cls._stats_put_count,
                "hit_rate": hit_rate,
            }

    @classmethod
    def reset_stats(cls) -> None:
        """Reset cache statistics counters."""
        with cls._cache_lock:
            cls._stats_hit_count = 0
            cls._stats_miss_count = 0
            cls._stats_put_count = 0
            logger.debug("Reset cache statistics")
