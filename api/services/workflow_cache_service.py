"""
Workflow Cache Service

This service provides intelligent caching for workflow node results,
with TTL management, invalidation strategies, and performance tracking.
"""

import hashlib
import json
import logging
from datetime import timedelta
from typing import Any, Optional

from sqlalchemy import and_, delete, func, select
from sqlalchemy.dialects.postgresql import insert

from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.workflow_performance import WorkflowCacheEntry

logger = logging.getLogger(__name__)


class WorkflowCacheService:
    """Service for managing workflow node result caching."""

    # Default TTL values by node type (in hours)
    DEFAULT_TTL_HOURS = {
        "llm": 24,  # 24 hours for LLM results
        "code": 168,  # 7 days for code execution
        "http_request": 1,  # 1 hour for HTTP requests
        "knowledge_retrieval": 12,  # 12 hours for knowledge retrieval
        "question_classifier": 24,  # 24 hours for classification
        "if_else": 168,  # 7 days for conditional logic
        "variable_assigner": 168,  # 7 days for variable assignment
        "parameter_extractor": 24,  # 24 hours for parameter extraction
        "iteration": 24,  # 24 hours for iteration results
        "tool": 1,  # 1 hour for tool calls
    }

    @staticmethod
    def _generate_cache_key(
        node_id: str,
        node_config_hash: str,
        input_hash: str,
    ) -> str:
        """
        Generate a unique cache key for a node execution.

        Args:
            node_id: Node ID
            node_config_hash: Hash of node configuration
            input_hash: Hash of input data

        Returns:
            Unique cache key
        """
        key_data = f"{node_id}:{node_config_hash}:{input_hash}"
        return hashlib.sha256(key_data.encode()).hexdigest()

    @staticmethod
    def _hash_data(data: Any) -> str:
        """
        Generate a hash for arbitrary data.

        Args:
            data: Data to hash

        Returns:
            SHA256 hash of the data
        """
        json_str = json.dumps(data, sort_keys=True, default=str)
        return hashlib.sha256(json_str.encode()).hexdigest()

    @staticmethod
    def get_cached_result(
        node_id: str,
        node_config: dict[str, Any],
        input_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """
        Retrieve cached result for a node execution.

        Args:
            node_id: Node ID
            node_config: Node configuration
            input_data: Input data for the node

        Returns:
            Cached output data or None if not found/expired
        """
        node_config_hash = WorkflowCacheService._hash_data(node_config)
        input_hash = WorkflowCacheService._hash_data(input_data)
        cache_key = WorkflowCacheService._generate_cache_key(node_id, node_config_hash, input_hash)

        # Query cache entry
        stmt = select(WorkflowCacheEntry).where(
            and_(
                WorkflowCacheEntry.cache_key == cache_key,
                WorkflowCacheEntry.expires_at > naive_utc_now(),
            )
        )

        cache_entry = db.session.execute(stmt).scalar_one_or_none()

        if not cache_entry:
            logger.debug("Cache miss: key=%s", cache_key)
            return None

        # Update access statistics
        cache_entry.last_accessed_at = naive_utc_now()
        cache_entry.hit_count += 1
        db.session.commit()

        logger.info(
            "Cache hit: key=%s, hits=%d, time_saved=%.2fs",
            cache_key,
            cache_entry.hit_count,
            cache_entry.original_execution_time,
        )

        return cache_entry.output_data

    @staticmethod
    def store_cached_result(
        node_id: str,
        node_type: str,
        node_config: dict[str, Any],
        input_data: dict[str, Any],
        output_data: dict[str, Any],
        execution_time: float,
        ttl_hours: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> WorkflowCacheEntry:
        """
        Store a node execution result in cache.

        Args:
            node_id: Node ID
            node_type: Node type
            node_config: Node configuration
            input_data: Input data
            output_data: Output data to cache
            execution_time: Original execution time in seconds
            ttl_hours: Time-to-live in hours (uses default if not specified)
            metadata: Additional metadata

        Returns:
            Created or updated cache entry
        """
        node_config_hash = WorkflowCacheService._hash_data(node_config)
        input_hash = WorkflowCacheService._hash_data(input_data)
        cache_key = WorkflowCacheService._generate_cache_key(node_id, node_config_hash, input_hash)

        # Determine TTL
        if ttl_hours is None:
            ttl_hours = WorkflowCacheService.DEFAULT_TTL_HOURS.get(node_type, 24)

        expires_at = naive_utc_now() + timedelta(hours=ttl_hours)
        output_size_bytes = len(json.dumps(output_data, default=str).encode())

        now = naive_utc_now()

        # Use PostgreSQL's INSERT ... ON CONFLICT for atomic upsert
        stmt = (
            insert(WorkflowCacheEntry)
            .values(
                cache_key=cache_key,
                node_type=node_type,
                node_config_hash=node_config_hash,
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
        workflow_id: str | None = None,
        node_id: str | None = None,
        node_type: str | None = None,
    ) -> int:
        """
        Invalidate cache entries based on filters.

        Args:
            workflow_id: Invalidate all entries for a workflow (not implemented yet)
            node_id: Invalidate entries for a specific node
            node_type: Invalidate entries for a node type

        Returns:
            Number of entries invalidated
        """
        conditions = []

        # Note: workflow_id filtering would require additional metadata in cache entries
        # For now, we support node_id and node_type filtering

        if node_type:
            conditions.append(WorkflowCacheEntry.node_type == node_type)

        if not conditions:
            logger.warning("No invalidation criteria provided")
            return 0

        stmt = delete(WorkflowCacheEntry).where(and_(*conditions))
        result = db.session.execute(stmt)
        db.session.commit()

        count = result.rowcount
        logger.info("Invalidated %d cache entries: node_type=%s", count, node_type)

        return count

    @staticmethod
    def cleanup_expired_entries() -> int:
        """
        Remove expired cache entries.

        Returns:
            Number of entries removed
        """
        now = naive_utc_now()

        stmt = delete(WorkflowCacheEntry).where(WorkflowCacheEntry.expires_at < now)

        result = db.session.execute(stmt)
        db.session.commit()

        count = result.rowcount
        logger.info("Cleaned up %d expired cache entries", count)

        return count

    @staticmethod
    def get_cache_statistics(
        workflow_id: str | None = None,
        days: int = 7,
    ) -> dict[str, Any]:
        """
        Get cache performance statistics.

        Args:
            workflow_id: Workflow ID (not used yet, for future enhancement)
            days: Number of days to analyze

        Returns:
            Dictionary containing cache statistics
        """
        cutoff_date = naive_utc_now() - timedelta(days=days)

        # Get overall statistics
        stmt = select(
            func.count(WorkflowCacheEntry.id).label("total_entries"),
            func.sum(WorkflowCacheEntry.hit_count).label("total_hits"),
            func.sum(WorkflowCacheEntry.total_time_saved).label("total_time_saved"),
            func.avg(WorkflowCacheEntry.hit_count).label("avg_hits_per_entry"),
            func.sum(WorkflowCacheEntry.output_size_bytes).label("total_size_bytes"),
        ).where(WorkflowCacheEntry.created_at >= cutoff_date)

        result = db.session.execute(stmt).first()

        # Get statistics by node type
        stmt_by_type = (
            select(
                WorkflowCacheEntry.node_type,
                func.count(WorkflowCacheEntry.id).label("entry_count"),
                func.sum(WorkflowCacheEntry.hit_count).label("hit_count"),
                func.avg(WorkflowCacheEntry.original_execution_time).label("avg_execution_time"),
            )
            .where(WorkflowCacheEntry.created_at >= cutoff_date)
            .group_by(WorkflowCacheEntry.node_type)
            .order_by(func.sum(WorkflowCacheEntry.hit_count).desc())
        )

        by_type_results = db.session.execute(stmt_by_type).fetchall()

        by_type = [
            {
                "node_type": row.node_type,
                "entry_count": row.entry_count,
                "hit_count": row.hit_count,
                "avg_execution_time": float(row.avg_execution_time or 0.0),
            }
            for row in by_type_results
        ]

        return {
            "total_entries": result.total_entries or 0,
            "total_hits": int(result.total_hits or 0),
            "total_time_saved": float(result.total_time_saved or 0.0),
            "avg_hits_per_entry": float(result.avg_hits_per_entry or 0.0),
            "total_size_bytes": int(result.total_size_bytes or 0),
            "total_size_mb": round((result.total_size_bytes or 0) / 1024 / 1024, 2),
            "by_node_type": by_type,
        }

    @staticmethod
    def get_top_cached_nodes(
        workflow_id: str | None = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """
        Get top cached nodes by hit count.

        Args:
            workflow_id: Workflow ID (not used yet, for future enhancement)
            limit: Maximum number of results

        Returns:
            List of top cached nodes
        """
        stmt = (
            select(
                WorkflowCacheEntry.node_type,
                WorkflowCacheEntry.cache_key,
                WorkflowCacheEntry.hit_count,
                WorkflowCacheEntry.original_execution_time,
                WorkflowCacheEntry.total_time_saved,
                WorkflowCacheEntry.last_accessed_at,
            )
            .order_by(WorkflowCacheEntry.hit_count.desc())
            .limit(limit)
        )

        results = db.session.execute(stmt).fetchall()

        return [
            {
                "node_type": row.node_type,
                "cache_key": row.cache_key,
                "hit_count": row.hit_count,
                "original_execution_time": float(row.original_execution_time),
                "total_time_saved": float(row.total_time_saved),
                "last_accessed_at": row.last_accessed_at.isoformat() if row.last_accessed_at else None,
            }
            for row in results
        ]

    @staticmethod
    def update_time_saved(
        cache_key: str,
        execution_time: float,
    ) -> None:
        """
        Update the total time saved for a cache entry.

        Args:
            cache_key: Cache key
            execution_time: Time that would have been spent without cache
        """
        stmt = select(WorkflowCacheEntry).where(WorkflowCacheEntry.cache_key == cache_key)

        cache_entry = db.session.execute(stmt).scalar_one_or_none()

        if cache_entry:
            cache_entry.total_time_saved += execution_time
            db.session.commit()

            logger.debug(
                "Updated time saved: key=%s, added=%.2fs, total=%.2fs",
                cache_key,
                execution_time,
                cache_entry.total_time_saved,
            )
