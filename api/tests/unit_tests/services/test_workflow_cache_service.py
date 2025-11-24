"""
Unit tests for Workflow Cache Service

This module contains comprehensive tests for the workflow caching functionality.
"""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest

from libs.datetime_utils import naive_utc_now
from models.workflow_performance import WorkflowCacheEntry
from services.workflow_cache_service import WorkflowCacheService


class TestWorkflowCacheService:
    """Test suite for WorkflowCacheService"""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session"""
        with patch("services.workflow_cache_service.db") as mock_db:
            mock_db.session = MagicMock()
            yield mock_db

    def test_generate_cache_key(self):
        """Test cache key generation"""
        # Arrange
        node_type = "llm"
        node_config = {"model": "gpt-4", "temperature": 0.7}
        input_data = {"prompt": "Hello, world!"}

        # Act
        cache_key_1 = WorkflowCacheService.generate_cache_key(
            node_type=node_type,
            node_config=node_config,
            input_data=input_data,
        )

        cache_key_2 = WorkflowCacheService.generate_cache_key(
            node_type=node_type,
            node_config=node_config,
            input_data=input_data,
        )

        # Assert
        assert cache_key_1 == cache_key_2  # Same inputs produce same key
        assert cache_key_1.startswith("wf_node_llm_")
        assert len(cache_key_1) > 20

    def test_generate_cache_key_different_inputs(self):
        """Test that different inputs produce different cache keys"""
        # Arrange
        node_type = "llm"
        node_config = {"model": "gpt-4"}
        input_data_1 = {"prompt": "Hello"}
        input_data_2 = {"prompt": "World"}

        # Act
        cache_key_1 = WorkflowCacheService.generate_cache_key(
            node_type=node_type,
            node_config=node_config,
            input_data=input_data_1,
        )

        cache_key_2 = WorkflowCacheService.generate_cache_key(
            node_type=node_type,
            node_config=node_config,
            input_data=input_data_2,
        )

        # Assert
        assert cache_key_1 != cache_key_2

    def test_generate_config_hash(self):
        """Test configuration hash generation"""
        # Arrange
        config_1 = {"model": "gpt-4", "temperature": 0.7}
        config_2 = {"temperature": 0.7, "model": "gpt-4"}  # Different order
        config_3 = {"model": "gpt-3.5", "temperature": 0.7}  # Different value

        # Act
        hash_1 = WorkflowCacheService.generate_config_hash(config_1)
        hash_2 = WorkflowCacheService.generate_config_hash(config_2)
        hash_3 = WorkflowCacheService.generate_config_hash(config_3)

        # Assert
        assert hash_1 == hash_2  # Order doesn't matter
        assert hash_1 != hash_3  # Different values produce different hashes
        assert len(hash_1) == 64  # SHA256 hash length

    def test_generate_input_hash(self):
        """Test input hash generation"""
        # Arrange
        input_1 = {"prompt": "Hello", "max_tokens": 100}
        input_2 = {"max_tokens": 100, "prompt": "Hello"}  # Different order
        input_3 = {"prompt": "World", "max_tokens": 100}  # Different value

        # Act
        hash_1 = WorkflowCacheService.generate_input_hash(input_1)
        hash_2 = WorkflowCacheService.generate_input_hash(input_2)
        hash_3 = WorkflowCacheService.generate_input_hash(input_3)

        # Assert
        assert hash_1 == hash_2  # Order doesn't matter
        assert hash_1 != hash_3  # Different values produce different hashes

    @patch("services.workflow_cache_service.db.session")
    def test_get_cached_result_hit(self, mock_session):
        """Test getting cached result when cache hit occurs"""
        # Arrange
        cache_key = "test-cache-key"
        cached_output = {"result": "cached data"}

        mock_cache_entry = MagicMock(spec=WorkflowCacheEntry)
        mock_cache_entry.output_data = cached_output
        mock_cache_entry.hit_count = 5
        mock_cache_entry.original_execution_time = 10.0

        mock_session.execute.return_value.scalar_one_or_none.return_value = mock_cache_entry

        # Act
        result = WorkflowCacheService.get_cached_result(cache_key=cache_key)

        # Assert
        assert result == cached_output
        assert mock_cache_entry.hit_count == 6  # Incremented
        assert mock_cache_entry.last_accessed_at is not None
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    def test_get_cached_result_miss(self, mock_session):
        """Test getting cached result when cache miss occurs"""
        # Arrange
        cache_key = "test-cache-key"
        mock_session.execute.return_value.scalar_one_or_none.return_value = None

        # Act
        result = WorkflowCacheService.get_cached_result(cache_key=cache_key)

        # Assert
        assert result is None
        mock_session.commit.assert_not_called()

    def test_store_cached_result_new_entry(self, mock_db_session):
        """Test storing a new cached result"""
        # Arrange
        cache_key = "test-cache-key"
        node_type = "llm"
        node_config = {"model": "gpt-4"}
        input_data = {"prompt": "test"}
        output_data = {"result": "test output"}
        execution_time = 5.0

        mock_db_session.session.execute.return_value.scalar_one_or_none.return_value = None

        # Act
        cache_entry = WorkflowCacheService.store_cached_result(
            cache_key=cache_key,
            node_type=node_type,
            node_config=node_config,
            input_data=input_data,
            output_data=output_data,
            execution_time=execution_time,
            ttl_hours=24,
        )

        # Assert
        assert cache_entry.cache_key == cache_key
        assert cache_entry.node_type == node_type
        assert cache_entry.output_data == output_data
        assert cache_entry.original_execution_time == execution_time
        mock_db_session.session.add.assert_called_once()
        mock_db_session.session.commit.assert_called_once()

    def test_store_cached_result_update_existing(self, mock_db_session):
        """Test updating an existing cached result"""
        # Arrange
        cache_key = "test-cache-key"
        node_type = "llm"
        node_config = {"model": "gpt-4"}
        input_data = {"prompt": "test"}
        output_data = {"result": "updated output"}
        execution_time = 5.0

        mock_existing_entry = MagicMock(spec=WorkflowCacheEntry)
        mock_db_session.session.execute.return_value.scalar_one_or_none.return_value = mock_existing_entry

        # Act
        cache_entry = WorkflowCacheService.store_cached_result(
            cache_key=cache_key,
            node_type=node_type,
            node_config=node_config,
            input_data=input_data,
            output_data=output_data,
            execution_time=execution_time,
        )

        # Assert
        assert cache_entry == mock_existing_entry
        assert mock_existing_entry.output_data == output_data
        mock_db_session.session.add.assert_not_called()  # Not adding new entry
        mock_db_session.session.commit.assert_called_once()

    def test_store_cached_result_default_ttl(self, mock_db_session):
        """Test storing cached result with default TTL"""
        # Arrange
        cache_key = "test-cache-key"
        node_type = "llm"
        node_config = {"model": "gpt-4"}
        input_data = {"prompt": "test"}
        output_data = {"result": "test output"}
        execution_time = 5.0

        mock_db_session.session.execute.return_value.scalar_one_or_none.return_value = None

        # Act
        cache_entry = WorkflowCacheService.store_cached_result(
            cache_key=cache_key,
            node_type=node_type,
            node_config=node_config,
            input_data=input_data,
            output_data=output_data,
            execution_time=execution_time,
            # ttl_hours not specified, should use default for 'llm' (24 hours)
        )

        # Assert
        assert cache_entry.expires_at is not None
        # Verify TTL is approximately 24 hours (with some tolerance)
        time_diff = (cache_entry.expires_at - naive_utc_now()).total_seconds()
        assert 23.9 * 3600 < time_diff < 24.1 * 3600

    @patch("services.workflow_cache_service.db.session")
    def test_invalidate_cache_by_key(self, mock_session):
        """Test invalidating cache by specific key"""
        # Arrange
        cache_key = "test-cache-key"
        mock_result = MagicMock()
        mock_result.rowcount = 1
        mock_session.execute.return_value = mock_result

        # Act
        count = WorkflowCacheService.invalidate_cache(cache_key=cache_key)

        # Assert
        assert count == 1
        mock_session.execute.assert_called_once()
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    def test_invalidate_cache_by_node_type(self, mock_session):
        """Test invalidating cache by node type"""
        # Arrange
        node_type = "llm"
        mock_result = MagicMock()
        mock_result.rowcount = 5
        mock_session.execute.return_value = mock_result

        # Act
        count = WorkflowCacheService.invalidate_cache(node_type=node_type)

        # Assert
        assert count == 5
        mock_session.execute.assert_called_once()
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    def test_invalidate_cache_older_than(self, mock_session):
        """Test invalidating cache older than specified hours"""
        # Arrange
        older_than_hours = 48
        mock_result = MagicMock()
        mock_result.rowcount = 10
        mock_session.execute.return_value = mock_result

        # Act
        count = WorkflowCacheService.invalidate_cache(older_than_hours=older_than_hours)

        # Assert
        assert count == 10
        mock_session.execute.assert_called_once()
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    def test_invalidate_cache_no_criteria(self, mock_session):
        """Test invalidating cache with no criteria returns 0"""
        # Act
        count = WorkflowCacheService.invalidate_cache()

        # Assert
        assert count == 0
        mock_session.execute.assert_not_called()

    @patch("services.workflow_cache_service.db.session")
    def test_cleanup_expired_cache(self, mock_session):
        """Test cleaning up expired cache entries"""
        # Arrange
        mock_result = MagicMock()
        mock_result.rowcount = 15
        mock_session.execute.return_value = mock_result

        # Act
        count = WorkflowCacheService.cleanup_expired_cache()

        # Assert
        assert count == 15
        mock_session.execute.assert_called_once()
        mock_session.commit.assert_called_once()

    @patch("services.workflow_cache_service.db.session")
    def test_get_cache_statistics_no_data(self, mock_session):
        """Test getting cache statistics with no data"""
        # Arrange
        mock_result = MagicMock()
        mock_result.total_entries = 0
        mock_session.execute.return_value.first.return_value = mock_result

        # Act
        stats = WorkflowCacheService.get_cache_statistics(days=7)

        # Assert
        assert stats["total_entries"] == 0
        assert stats["total_hits"] == 0
        assert stats["cache_efficiency"] == 0.0

    @patch("services.workflow_cache_service.db.session")
    def test_get_cache_statistics_with_data(self, mock_session):
        """Test getting cache statistics with data"""
        # Arrange
        mock_result = MagicMock()
        mock_result.total_entries = 100
        mock_result.active_entries = 80
        mock_result.total_hits = 500
        mock_result.avg_hits_per_entry = 5.0
        mock_result.total_time_saved = 1000.0
        mock_result.avg_execution_time = 2.0
        mock_result.total_cache_size = 10485760  # 10 MB in bytes

        mock_session.execute.return_value.first.return_value = mock_result

        # Act
        stats = WorkflowCacheService.get_cache_statistics(days=7)

        # Assert
        assert stats["total_entries"] == 100
        assert stats["active_entries"] == 80
        assert stats["total_hits"] == 500
        assert stats["avg_hits_per_entry"] == 5.0
        assert stats["total_time_saved"] == 1000.0
        assert stats["total_cache_size_mb"] == 10.0
        assert stats["cache_efficiency"] == 500.0  # 500 hits / 100 entries * 100

    @patch("services.workflow_cache_service.db.session")
    def test_get_top_cached_nodes(self, mock_session):
        """Test getting top cached nodes"""
        # Arrange
        mock_results = [
            MagicMock(
                node_type="llm",
                entry_count=50,
                total_hits=250,
                total_time_saved=500.0,
                avg_execution_time=2.0,
            ),
            MagicMock(
                node_type="http_request",
                entry_count=30,
                total_hits=150,
                total_time_saved=300.0,
                avg_execution_time=1.5,
            ),
        ]

        mock_session.execute.return_value.fetchall.return_value = mock_results

        # Act
        top_nodes = WorkflowCacheService.get_top_cached_nodes(limit=10, days=7)

        # Assert
        assert len(top_nodes) == 2
        assert top_nodes[0]["node_type"] == "llm"
        assert top_nodes[0]["entry_count"] == 50
        assert top_nodes[0]["total_hits"] == 250
        assert top_nodes[1]["node_type"] == "http_request"

    def test_should_cache_node_fast_operation(self):
        """Test that very fast operations should not be cached"""
        # Arrange
        node_type = "code"
        node_config = {}
        execution_time = 0.05  # 50ms - very fast

        # Act
        should_cache = WorkflowCacheService.should_cache_node(
            node_type=node_type,
            node_config=node_config,
            execution_time=execution_time,
        )

        # Assert
        assert should_cache is False

    def test_should_cache_node_non_cacheable_type(self):
        """Test that certain node types should not be cached"""
        # Arrange
        node_config = {}
        execution_time = 5.0

        # Act & Assert
        assert WorkflowCacheService.should_cache_node("start", node_config, execution_time) is False
        assert WorkflowCacheService.should_cache_node("end", node_config, execution_time) is False
        assert WorkflowCacheService.should_cache_node("answer", node_config, execution_time) is False
        assert WorkflowCacheService.should_cache_node("human_input", node_config, execution_time) is False

    def test_should_cache_node_disabled_in_config(self):
        """Test that nodes with caching disabled should not be cached"""
        # Arrange
        node_type = "llm"
        node_config = {"disable_cache": True}
        execution_time = 5.0

        # Act
        should_cache = WorkflowCacheService.should_cache_node(
            node_type=node_type,
            node_config=node_config,
            execution_time=execution_time,
        )

        # Assert
        assert should_cache is False

    def test_should_cache_node_cacheable(self):
        """Test that cacheable nodes return True"""
        # Arrange
        node_type = "llm"
        node_config = {}
        execution_time = 5.0

        # Act
        should_cache = WorkflowCacheService.should_cache_node(
            node_type=node_type,
            node_config=node_config,
            execution_time=execution_time,
        )

        # Assert
        assert should_cache is True


class TestWorkflowCacheEntry:
    """Test suite for WorkflowCacheEntry model"""

    def test_create_cache_entry(self):
        """Test creating cache entry instance"""
        # Arrange & Act
        cache_entry = WorkflowCacheEntry(
            cache_key="test-key",
            node_type="llm",
            node_config_hash="abc123",
            input_hash="def456",
            output_data={"result": "test"},
            output_size_bytes=100,
            expires_at=naive_utc_now() + timedelta(hours=24),
            original_execution_time=5.0,
        )

        # Assert
        assert cache_entry.cache_key == "test-key"
        assert cache_entry.node_type == "llm"
        assert cache_entry.output_data == {"result": "test"}
        assert cache_entry.original_execution_time == 5.0
