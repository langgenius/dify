"""
Workflow Cache Service

This service provides intelligent caching for workflow node executions to improve
performance and reduce costs. It implements cache key generation, TTL management,
and cache invalidation strategies.
"""

import hashlib
import json
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import and_, case, delete, desc, func, select
from sqlalchemy.dialects.postgresql import insert

from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.workflow_performance import WorkflowCacheEntry

logger = logging.getLogger(__name__)


class WorkflowCacheService:
    """
    Service for managing workflow node result caching.

    This service provides methods for:
    - Generating cache keys
    - Storing and retrieving cached results
    - Managing cache TTL and invalidation
    - Tracking cache performance
    """

    # Default cache TTL in hours for different node types
    DEFAULT_TTL_HOURS = {
        "llm": 24,  # LLM results cached for 24 hours
        "http_request": 6,  # HTTP requests cached for 6 hours
        "code": 48,  # Code execution cached for 48 hours
        "tool": 12,  # Tool results cached for 12 hours
        "knowledge_retrieval": 24,  # Knowledge retrieval cached for 24 hours
        "template_transform": 72,  # Template transforms cached for 72 hours
        "default": 24,  # Default TTL for other node types
    }

    @staticmethod
    def generate_cache_key(
        node_type: str,
        node_config: dict[str, Any],
        input_data: dict[str, Any],
    ) -> str:
        """
        Generate a unique cache key for a node execution.

        The cache key is based on:
        - Node type
        - Node configuration (hashed)
        - Input data (hashed)

        Args:
            node_type: Type of the node
            node_config: Node configuration dictionary
            input_data: Input data dictionary

        Returns:
            Cache key string
        """
        # Create a deterministic string representation
        config_str = json.dumps(node_config, sort_keys=True, ensure_ascii=True)
        input_str = json.dumps(input_data, sort_keys=True, ensure_ascii=True)

        # Generate hash
        combined = f"{node_type}:{config_str}:{input_str}"
        cache_key = hashlib.sha256(combined.encode()).hexdigest()

        return f"wf_node_{node_type}_{cache_key[:32]}"

    @staticmethod
    def generate_config_hash(node_config: dict[str, Any]) -> str:
        """
        Generate a hash of node configuration.

        Args:
            node_config: Node configuration dictionary

        Returns:
            Configuration hash
        """
        config_str = json.dumps(node_config, sort_keys=True, ensure_ascii=True)
        return hashlib.sha256(config_str.encode()).hexdigest()

    @staticmethod
    def generate_input_hash(input_data: dict[str, Any]) -> str:
        """
        Generate a hash of input data.

        Args:
            input_data: Input data dictionary

        Returns:
            Input hash
        """
        input_str = json.dumps(input_data, sort_keys=True, ensure_ascii=True)
        return hashlib.sha256(input_str.encode()).hexdigest()

    @staticmethod
    def get_cached_result(
        cache_key: str,
    ) -> dict[str, Any] | None:
        """
        Retrieve a cached result if it exists and is not expired.

        Args:
            cache_key: Cache key to look up

        Returns:
            Cached output data if found and valid, None otherwise
        """
        stmt = select(WorkflowCacheEntry).where(
            and_(
                WorkflowCacheEntry.cache_key == cache_key,
                WorkflowCacheEntry.expires_at > naive_utc_now(),
            )
        )

        cache_entry = db.session.execute(stmt).scalar_one_or_none()

        if cache_entry:
            # Update access statistics
            cache_entry.hit_count += 1
            cache_entry.last_accessed_at = naive_utc_now()
            db.session.commit()

            logger.info(
                "Cache hit for key %s: hit_count=%s, time_saved=%.2fs",
                cache_key,
                cache_entry.hit_count,
                cache_entry.original_execution_time,
            )

            return cache_entry.output_data

        logger.debug("Cache miss for key %s", cache_key)
        return None

    @staticmethod
    def store_cached_result(
        *,
        cache_key: str,
        node_type: str,
        node_config: dict[str, Any],
        input_data: dict[str, Any],
        output_data: dict[str, Any],
        execution_time: float,
        ttl_hours: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> WorkflowCacheEntry:
        """
        Store a node execution result in the cache.

        Args:
            cache_key: Cache key
            node_type: Type of the node
            node_config: Node configuration
            input_data: Input data
            output_data: Output data to cache
            execution_time: Original execution time in seconds
            ttl_hours: Time-to-live in hours (uses default if not specified)
            metadata: Additional metadata

        Returns:
            Created WorkflowCacheEntry instance
        """
        # Determine TTL
        if ttl_hours is None:
            ttl_hours = WorkflowCacheService.DEFAULT_TTL_HOURS.get(
                node_type, WorkflowCacheService.DEFAULT_TTL_HOURS["default"]
            )

        expires_at = naive_utc_now() + timedelta(hours=ttl_hours)

        # Calculate output size
        output_json = json.dumps(output_data, ensure_ascii=True)
        output_size_bytes = len(output_json.encode())

        # Generate hashes
        config_hash = WorkflowCacheService.generate_config_hash(node_config)
        input_hash = WorkflowCacheService.generate_input_hash(input_data)

        now = naive_utc_now()

        # Use PostgreSQL's INSERT ... ON CONFLICT for atomic upsert
        stmt = (
            insert(WorkflowCacheEntry)
            .values(
                cache_key=cache_key,
                node_type=node_type,
                node_config_hash=config_hash,
                input_hash=input_hash,
                output_data=output_data,
                output_size_bytes=output_size_bytes,
                expires_at=expires_at,
                original_execution_time=execution_time,
                total_time_saved=0.0,
                extra_info=metadata or {},
                last_accessed_at=now,
            )
            .on_conflict_do_update(
                index_elements=["cache_key"],
                set_={
                    "output_data": output_data,
                    "output_size_bytes": output_size_bytes,
                    "expires_at": expires_at,
                    "last_accessed_at": now,
                    "extra_info": metadata or {},
                    "updated_at": now,
                },
            )
            .returning(WorkflowCacheEntry)
        )

        result = db.session.execute(stmt)
        cache_entry = result.scalar_one()
        db.session.commit()

        logger.info(
            "Stored cache entry: key=%s, node_type=%s, ttl=%sh, size=%s bytes",
            cache_key,
            node_type,
            ttl_hours,
            output_size_bytes,
        )

        return cache_entry

    @staticmethod
    def invalidate_cache(
        cache_key: str | None = None,
        node_type: str | None = None,
        older_than_hours: int | None = None,
    ) -> int:
        """
        Invalidate cache entries based on criteria.

        Args:
            cache_key: Specific cache key to invalidate
            node_type: Invalidate all entries for a node type
            older_than_hours: Invalidate entries older than specified hours

        Returns:
            Number of cache entries invalidated
        """
        filters = []

        if cache_key:
            filters.append(WorkflowCacheEntry.cache_key == cache_key)

        if node_type:
            filters.append(WorkflowCacheEntry.node_type == node_type)

        if older_than_hours:
            cutoff_date = naive_utc_now() - timedelta(hours=older_than_hours)
            filters.append(WorkflowCacheEntry.created_at < cutoff_date)

        if not filters:
            logger.warning("No invalidation criteria specified")
            return 0

        stmt = delete(WorkflowCacheEntry).where(and_(*filters))
        result = db.session.execute(stmt)
        db.session.commit()

        count = result.rowcount
        logger.info("Invalidated %s cache entries", count)

        return count

    @staticmethod
    def cleanup_expired_cache() -> int:
        """
        Remove expired cache entries.

        Returns:
            Number of entries removed
        """
        stmt = delete(WorkflowCacheEntry).where(WorkflowCacheEntry.expires_at <= naive_utc_now())

        result = db.session.execute(stmt)
        db.session.commit()

        count = result.rowcount
        logger.info("Cleaned up %s expired cache entries", count)

        return count

    @staticmethod
    def get_cache_statistics(
        node_type: str | None = None,
        days: int = 7,
    ) -> dict[str, Any]:
        """
        Get cache performance statistics.

        Args:
            node_type: Filter by node type
            days: Number of days to analyze

        Returns:
            Dictionary containing cache statistics
        """
        cutoff_date = naive_utc_now() - timedelta(days=days)

        filters = [WorkflowCacheEntry.created_at >= cutoff_date]

        if node_type:
            filters.append(WorkflowCacheEntry.node_type == node_type)

        # Query cache statistics
        stmt = select(
            func.count(WorkflowCacheEntry.id).label("total_entries"),
            func.sum(WorkflowCacheEntry.hit_count).label("total_hits"),
            func.avg(WorkflowCacheEntry.hit_count).label("avg_hits_per_entry"),
            func.sum(WorkflowCacheEntry.total_time_saved).label("total_time_saved"),
            func.avg(WorkflowCacheEntry.original_execution_time).label("avg_execution_time"),
            func.sum(WorkflowCacheEntry.output_size_bytes).label("total_cache_size"),
            func.count(case((WorkflowCacheEntry.expires_at > naive_utc_now(), 1), else_=None)).label("active_entries"),
        ).where(and_(*filters))

        result = db.session.execute(stmt).first()

        if not result or result.total_entries == 0:
            return {
                "total_entries": 0,
                "active_entries": 0,
                "total_hits": 0,
                "avg_hits_per_entry": 0.0,
                "total_time_saved": 0.0,
                "avg_execution_time": 0.0,
                "total_cache_size_mb": 0.0,
                "cache_efficiency": 0.0,
            }

        # Calculate cache efficiency (hits / total entries)
        cache_efficiency = (result.total_hits / result.total_entries * 100) if result.total_entries > 0 else 0.0

        return {
            "total_entries": result.total_entries,
            "active_entries": result.active_entries,
            "total_hits": int(result.total_hits or 0),
            "avg_hits_per_entry": float(result.avg_hits_per_entry or 0.0),
            "total_time_saved": float(result.total_time_saved or 0.0),
            "avg_execution_time": float(result.avg_execution_time or 0.0),
            "total_cache_size_mb": float(result.total_cache_size or 0) / (1024 * 1024),
            "cache_efficiency": cache_efficiency,
        }

    @staticmethod
    def get_top_cached_nodes(
        limit: int = 10,
        days: int = 7,
    ) -> list[dict[str, Any]]:
        """
        Get the most frequently cached nodes.

        Args:
            limit: Maximum number of results
            days: Number of days to analyze

        Returns:
            List of top cached nodes with statistics
        """
        cutoff_date = naive_utc_now() - timedelta(days=days)

        stmt = (
            select(
                WorkflowCacheEntry.node_type,
                func.count(WorkflowCacheEntry.id).label("entry_count"),
                func.sum(WorkflowCacheEntry.hit_count).label("total_hits"),
                func.sum(WorkflowCacheEntry.total_time_saved).label("total_time_saved"),
                func.avg(WorkflowCacheEntry.original_execution_time).label("avg_execution_time"),
            )
            .where(WorkflowCacheEntry.created_at >= cutoff_date)
            .group_by(WorkflowCacheEntry.node_type)
            .order_by(desc("total_hits"))
            .limit(limit)
        )

        results = db.session.execute(stmt).fetchall()

        top_nodes = []
        for row in results:
            top_nodes.append(
                {
                    "node_type": row.node_type,
                    "entry_count": row.entry_count,
                    "total_hits": int(row.total_hits or 0),
                    "total_time_saved": float(row.total_time_saved or 0.0),
                    "avg_execution_time": float(row.avg_execution_time or 0.0),
                }
            )

        return top_nodes

    @staticmethod
    def should_cache_node(
        node_type: str,
        node_config: dict[str, Any],
        execution_time: float,
    ) -> bool:
        """
        Determine if a node execution should be cached.

        Args:
            node_type: Type of the node
            node_config: Node configuration
            execution_time: Execution time in seconds

        Returns:
            True if the node should be cached, False otherwise
        """
        # Don't cache very fast operations (< 0.1 seconds)
        if execution_time < 0.1:
            return False

        # Don't cache certain node types
        non_cacheable_types = {"start", "end", "answer", "human_input"}
        if node_type.lower() in non_cacheable_types:
            return False

        # Check if node configuration explicitly disables caching
        if node_config.get("disable_cache", False):
            return False

        # Cache by default for other node types
        return True
