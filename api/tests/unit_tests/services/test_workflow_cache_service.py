"""
Unit tests for WorkflowCacheService

Comprehensive test coverage for workflow caching functionality.
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from models.workflow_performance import WorkflowCacheEntry
from services.workflow_cache_service import WorkflowCacheService


class TestWorkflowCacheService:
    """Test suite for WorkflowCacheService."""

    def test_generate_cache_key(self):
        """Test cache key generation."""
        # Arrange
        node_id = "test-node"
        node_config_hash = "config-hash-123"
        input_hash = "input-hash-456"

        # Act
        cache_key = WorkflowCacheService._generate_cache_key(
            node_id=node_id,
            node_config_hash=node_config_hash,
            input_hash=input_hash,
        )

        # Assert
        assert isinstance(cache_key, str)
        assert len(cache_key) == 64  # SHA256 hash length

    def test_hash_data(self):
        """Test data hashing."""
        # Arrange
        data = {"key": "value", "number": 123}

        # Act
        hash1 = WorkflowCacheService._hash_data(data)
        hash2 = WorkflowCacheService._hash_data(data)

        # Assert
        assert hash1 == hash2  # Same data should produce same hash
        assert isinstance(hash1, str)
        assert len(hash1) == 64  # SHA256 hash length

    def test_hash_data_order_independent(self):
        """Test that hash is order-independent."""
        # Arrange
        data1 = {"a": 1, "b": 2}
        data2 = {"b": 2, "a": 1}

        # Act
        hash1 = WorkflowCacheService._hash_data(data1)
        hash2 = WorkflowCacheService._hash_data(data2)

        # Assert
        assert hash1 == hash2  # Order shouldn't matter

    @patch("services.workflow_cache_service.db.session")
    @patch("services.workflow_cache_service.naive_utc_now")
    def test_get_cached_result_hit(self, mock_now, mock_session):
        """Test successful cache hit."""
        # Arrange
        now = datetime.utcnow()
        mock_now.return_value = now

        mock_cache_entry = MagicMock(spec=WorkflowCacheEntry)
        mock_cache_entry.output_data = {"result": "cached_value"}
        mock_cache_entry.hit_count = 5
        mock_cache_entry.original_execution_time = 2.5

        mock_session.execute.return_value.scalar_one_or_none.return_value = mock_cache_entry

        # Act
        result = WorkflowCacheService.get_cached_result(
            node_id="test-node",
            node_config={"param": "value"},
            input_data={"input": "data"},
        )

        # Assert
        assert result == {"result": "cached_value"}
        assert mock_cache_entry.hit_count == 6  # Incremented
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    @patch("services.workflow_cache_service.naive_utc_now")
    def test_get_cached_result_miss(self, mock_now, mock_session):
        """Test cache miss."""
        # Arrange
        mock_session.execute.return_value.scalar_one_or_none.return_value = None

        # Act
        result = WorkflowCacheService.get_cached_result(
            node_id="test-node",
            node_config={"param": "value"},
            input_data={"input": "data"},
        )

        # Assert
        assert result is None
        mock_session.commit.assert_not_called()

    @patch("services.workflow_cache_service.db.session")
    @patch("services.workflow_cache_service.naive_utc_now")
    def test_store_cached_result_new_entry(self, mock_now, mock_session):
        """Test storing a new cache entry."""
        # Arrange
        now = datetime.utcnow()
        mock_now.return_value = now

        mock_cache_entry = MagicMock(spec=WorkflowCacheEntry)
        mock_cache_entry.cache_key = "test-cache-key"
        mock_cache_entry.node_type = "llm"
        mock_cache_entry.output_data = {"result": "value"}
        mock_cache_entry.original_execution_time = 3.0

        mock_session.execute.return_value.scalar_one.return_value = mock_cache_entry

        # Act
        cache_entry = WorkflowCacheService.store_cached_result(
            node_id="test-node",
            node_type="llm",
            node_config={"param": "value"},
            input_data={"input": "data"},
            output_data={"result": "value"},
            execution_time=3.0,
        )

        # Assert
        assert cache_entry.node_type == "llm"
        assert cache_entry.output_data == {"result": "value"}
        mock_session.execute.assert_called_once()
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    @patch("services.workflow_cache_service.naive_utc_now")
    def test_store_cached_result_update_existing(self, mock_now, mock_session):
        """Test updating an existing cache entry."""
        # Arrange
        now = datetime.utcnow()
        mock_now.return_value = now

        mock_updated_entry = MagicMock(spec=WorkflowCacheEntry)
        mock_updated_entry.cache_key = "test-cache-key"
        mock_updated_entry.node_type = "llm"
        mock_updated_entry.output_data = {"result": "updated_value"}

        mock_session.execute.return_value.scalar_one.return_value = mock_updated_entry

        # Act
        cache_entry = WorkflowCacheService.store_cached_result(
            node_id="test-node",
            node_type="llm",
            node_config={"param": "value"},
            input_data={"input": "data"},
            output_data={"result": "updated_value"},
            execution_time=2.5,
        )

        # Assert
        assert cache_entry.cache_key == "test-cache-key"
        assert cache_entry.output_data == {"result": "updated_value"}
        mock_session.execute.assert_called_once()
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    @patch("services.workflow_cache_service.naive_utc_now")
    def test_store_cached_result_default_ttl(self, mock_now, mock_session):
        """Test storing cache entry with default TTL."""
        # Arrange
        now = datetime.utcnow()
        mock_now.return_value = now

        mock_cache_entry = MagicMock(spec=WorkflowCacheEntry)
        mock_cache_entry.cache_key = "test-cache-key"
        mock_cache_entry.expires_at = now + timedelta(hours=24)

        mock_session.execute.return_value.scalar_one.return_value = mock_cache_entry

        # Act
        cache_entry = WorkflowCacheService.store_cached_result(
            node_id="test-node",
            node_type="llm",
            node_config={"param": "value"},
            input_data={"input": "data"},
            output_data={"result": "value"},
            execution_time=2.0,
            ttl_hours=None,  # Use default
        )

        # Assert
        assert cache_entry.expires_at == now + timedelta(hours=24)
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    def test_invalidate_cache_by_node_type(self, mock_session):
        """Test invalidating cache by node type."""
        # Arrange
        mock_session.execute.return_value.rowcount = 5

        # Act
        count = WorkflowCacheService.invalidate_cache(node_type="llm")

        # Assert
        assert count == 5
        mock_session.execute.assert_called_once()
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    def test_invalidate_cache_no_criteria(self, mock_session):
        """Test invalidating cache with no criteria."""
        # Act
        count = WorkflowCacheService.invalidate_cache()

        # Assert
        assert count == 0
        mock_session.execute.assert_not_called()

    @patch("services.workflow_cache_service.db.session")
    @patch("services.workflow_cache_service.naive_utc_now")
    def test_cleanup_expired_entries(self, mock_now, mock_session):
        """Test cleaning up expired cache entries."""
        # Arrange
        now = datetime.utcnow()
        mock_now.return_value = now
        mock_session.execute.return_value.rowcount = 10

        # Act
        count = WorkflowCacheService.cleanup_expired_entries()

        # Assert
        assert count == 10
        mock_session.execute.assert_called_once()
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    @patch("services.workflow_cache_service.naive_utc_now")
    def test_get_cache_statistics(self, mock_now, mock_session):
        """Test getting cache statistics."""
        # Arrange
        now = datetime.utcnow()
        mock_now.return_value = now

        mock_overall = MagicMock(
            total_entries=100,
            total_hits=500,
            total_time_saved=1000.0,
            avg_hits_per_entry=5.0,
            total_size_bytes=1024000,
        )

        mock_by_type = [
            MagicMock(
                node_type="llm",
                entry_count=50,
                hit_count=300,
                avg_execution_time=2.5,
            ),
            MagicMock(
                node_type="code",
                entry_count=50,
                hit_count=200,
                avg_execution_time=1.0,
            ),
        ]

        mock_session.execute.side_effect = [
            MagicMock(first=lambda: mock_overall),
            MagicMock(fetchall=lambda: mock_by_type),
        ]

        # Act
        stats = WorkflowCacheService.get_cache_statistics(days=7)

        # Assert
        assert stats["total_entries"] == 100
        assert stats["total_hits"] == 500
        assert stats["total_time_saved"] == 1000.0
        assert stats["total_size_mb"] == 0.98  # 1024000 / 1024 / 1024
        assert len(stats["by_node_type"]) == 2

    @patch("services.workflow_cache_service.db.session")
    def test_get_top_cached_nodes(self, mock_session):
        """Test getting top cached nodes."""
        # Arrange
        mock_nodes = [
            MagicMock(
                node_type="llm",
                cache_key="key-1",
                hit_count=100,
                original_execution_time=5.0,
                total_time_saved=500.0,
                last_accessed_at=datetime.utcnow(),
            ),
            MagicMock(
                node_type="code",
                cache_key="key-2",
                hit_count=50,
                original_execution_time=1.0,
                total_time_saved=50.0,
                last_accessed_at=datetime.utcnow(),
            ),
        ]

        mock_session.execute.return_value.fetchall.return_value = mock_nodes

        # Act
        top_nodes = WorkflowCacheService.get_top_cached_nodes(limit=10)

        # Assert
        assert len(top_nodes) == 2
        assert top_nodes[0]["hit_count"] == 100
        assert top_nodes[1]["hit_count"] == 50

    @patch("services.workflow_cache_service.db.session")
    def test_update_time_saved(self, mock_session):
        """Test updating time saved for a cache entry."""
        # Arrange
        cache_key = "test-cache-key"
        mock_cache_entry = MagicMock(spec=WorkflowCacheEntry)
        mock_cache_entry.total_time_saved = 10.0

        mock_session.execute.return_value.scalar_one_or_none.return_value = mock_cache_entry

        # Act
        WorkflowCacheService.update_time_saved(
            cache_key=cache_key,
            execution_time=5.0,
        )

        # Assert
        assert mock_cache_entry.total_time_saved == 15.0
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    def test_update_time_saved_entry_not_found(self, mock_session):
        """Test updating time saved when entry doesn't exist."""
        # Arrange
        mock_session.execute.return_value.scalar_one_or_none.return_value = None

        # Act
        WorkflowCacheService.update_time_saved(
            cache_key="non-existent-key",
            execution_time=5.0,
        )

        # Assert
        mock_session.commit.assert_not_called()

    def test_default_ttl_values(self):
        """Test that default TTL values are defined for common node types."""
        # Assert
        assert "llm" in WorkflowCacheService.DEFAULT_TTL_HOURS
        assert "code" in WorkflowCacheService.DEFAULT_TTL_HOURS
        assert "http_request" in WorkflowCacheService.DEFAULT_TTL_HOURS
        assert WorkflowCacheService.DEFAULT_TTL_HOURS["llm"] == 24
        assert WorkflowCacheService.DEFAULT_TTL_HOURS["code"] == 168


class TestWorkflowCacheEntry:
    """Test WorkflowCacheEntry model."""

    def test_create_cache_entry(self):
        """Test creating a cache entry instance."""
        # Arrange & Act
        now = datetime.utcnow()
        expires_at = now + timedelta(hours=24)

        cache_entry = WorkflowCacheEntry(
            cache_key="test-cache-key",
            node_type="llm",
            node_config_hash="config-hash",
            input_hash="input-hash",
            output_data={"result": "value"},
            output_size_bytes=1024,
            expires_at=expires_at,
            last_accessed_at=now,
            hit_count=0,
            original_execution_time=2.5,
            total_time_saved=0.0,
        )

        # Assert
        assert cache_entry.cache_key == "test-cache-key"
        assert cache_entry.node_type == "llm"
        assert cache_entry.output_data == {"result": "value"}
        assert cache_entry.hit_count == 0
