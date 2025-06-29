import datetime
from typing import Any, Optional

# Mock redis_client before importing segment_service
from unittest.mock import Mock, patch

import pytest

from core.rag.index_processor.constant.index_type import IndexType
from models.dataset import Dataset, DatasetProcessRule, Document, DocumentSegment
from services.dataset_service import SegmentService
from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs
from tests.unit_tests.conftest import redis_mock


class SegmentUpdateTestDataFactory:
    """Factory class for creating test data and mock objects for segment update tests."""

    @staticmethod
    def create_segment_mock(
        segment_id: str = "segment-123",
        content: str = "old_content",
        answer: Optional[str] = None,
        keywords: Optional[list[str]] = None,
        enabled: bool = True,
        status: str = "completed",
        word_count: int = 10,
        tokens: int = 15,
        position: int = 1,
        **kwargs,
    ) -> Mock:
        """Create a mock segment with specified attributes."""
        segment = Mock(spec=DocumentSegment)
        segment.id = segment_id
        segment.content = content
        segment.answer = answer
        segment.keywords = keywords or []
        segment.enabled = enabled
        segment.status = status
        segment.word_count = word_count
        segment.tokens = tokens
        segment.position = position
        segment.index_node_id = f"node-{segment_id}"
        segment.index_node_hash = f"hash-{segment_id}"
        segment.tenant_id = "tenant-123"
        segment.dataset_id = "dataset-123"
        segment.document_id = "document-123"
        segment.created_by = "user-789"
        segment.created_at = datetime.datetime(2023, 1, 1, 12, 0, 0)
        segment.updated_by = None
        segment.updated_at = datetime.datetime(2023, 1, 1, 12, 0, 0)
        segment.indexing_at = datetime.datetime(2023, 1, 1, 12, 0, 0)
        segment.completed_at = datetime.datetime(2023, 1, 1, 12, 0, 0)
        segment.disabled_at = None
        segment.disabled_by = None
        segment.error = None
        for key, value in kwargs.items():
            setattr(segment, key, value)
        return segment

    @staticmethod
    def create_document_mock(
        document_id: str = "document-123",
        doc_form: str = IndexType.PARAGRAPH_INDEX,
        word_count: int = 100,
        dataset_process_rule_id: str = "rule-123",
        **kwargs,
    ) -> Mock:
        """Create a mock document with specified attributes."""
        document = Mock(spec=Document)
        document.id = document_id
        document.doc_form = doc_form
        document.word_count = word_count
        document.dataset_process_rule_id = dataset_process_rule_id
        document.tenant_id = "tenant-123"
        document.dataset_id = "dataset-123"
        document.created_by = "user-789"
        document.created_at = datetime.datetime(2023, 1, 1, 12, 0, 0)
        for key, value in kwargs.items():
            setattr(document, key, value)
        return document

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        indexing_technique: str = "high_quality",
        embedding_model_provider: str = "openai",
        embedding_model: str = "text-embedding-ada-002",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """Create a mock dataset with specified attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.indexing_technique = indexing_technique
        dataset.embedding_model_provider = embedding_model_provider
        dataset.embedding_model = embedding_model
        dataset.tenant_id = tenant_id
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_embedding_model_mock(model: str = "text-embedding-ada-002", provider: str = "openai") -> Mock:
        """Create a mock embedding model."""
        embedding_model = Mock()
        embedding_model.model = model
        embedding_model.provider = provider
        embedding_model.get_text_embedding_num_tokens.return_value = [20]
        return embedding_model

    @staticmethod
    def create_processing_rule_mock(rule_id: str = "rule-123") -> Mock:
        """Create a mock processing rule."""
        processing_rule = Mock(spec=DatasetProcessRule)
        processing_rule.id = rule_id
        processing_rule.to_dict.return_value = {"rules": {"parent_mode": "full_doc"}}
        return processing_rule

    @staticmethod
    def create_current_user_mock(user_id: str = "user-789", tenant_id: str = "tenant-123") -> Mock:
        """Create a mock current user."""
        current_user = Mock()
        current_user.id = user_id
        current_user.current_tenant_id = tenant_id
        return current_user


class TestSegmentServiceUpdateSegment:
    """
    Comprehensive unit tests for SegmentService.update_segment method.

    This test suite covers all supported scenarios including:
    - Segment enable/disable operations
    - Content updates with same and different content
    - QA model updates with answer field
    - Keyword updates
    - Different document forms (paragraph, QA, parent-child)
    - High quality vs economy indexing techniques
    - Child chunk regeneration
    - Error handling and edge cases
    - Redis cache management
    - Vector index updates
    """

    @pytest.fixture
    def mock_segment_service_dependencies(self):
        """Common mock setup for segment service dependencies."""
        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.dataset_service.datetime") as mock_datetime,
            patch("services.dataset_service.current_user") as mock_current_user,
            patch("services.dataset_service.helper") as mock_helper,
        ):
            current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
            mock_datetime.datetime.now.return_value = current_time
            mock_datetime.UTC = datetime.UTC
            mock_current_user.id = "user-789"
            mock_current_user.current_tenant_id = "tenant-123"
            mock_helper.generate_text_hash.return_value = "new_hash_123"

            yield {
                "redis_client": mock_redis,
                "db_session": mock_db,
                "datetime": mock_datetime,
                "current_user": mock_current_user,
                "helper": mock_helper,
                "current_time": current_time,
            }

    @pytest.fixture
    def mock_model_manager_dependencies(self):
        """Mock setup for model manager tests."""
        with patch("services.dataset_service.ModelManager") as mock_model_manager:
            yield mock_model_manager

    @pytest.fixture
    def mock_vector_service_dependencies(self):
        """Mock setup for vector service tests."""
        with (
            patch("services.dataset_service.VectorService") as mock_vector_service,
            patch("services.dataset_service.disable_segment_from_index_task") as mock_disable_task,
        ):
            yield {
                "vector_service": mock_vector_service,
                "disable_task": mock_disable_task,
            }

    @pytest.fixture
    def mock_processing_rule_dependencies(self):
        """Mock setup for processing rule tests."""
        with patch("services.dataset_service.DatasetProcessRule") as mock_processing_rule:
            yield mock_processing_rule

    def _assert_redis_cache_operations(self, mock_redis, segment_id: str, should_set_cache: bool = False):
        """Helper method to verify Redis cache operations."""
        mock_redis.get.assert_called_once_with(f"segment_{segment_id}_indexing")
        if should_set_cache:
            mock_redis.setex.assert_called_once_with(f"segment_{segment_id}_indexing", 600, 1)

    def _assert_database_operations(self, mock_db, expected_objects: list[Any]):
        """Helper method to verify database operations.

        Args:
            mock_db: Mock database session
            expected_objects: List of objects that should have been added to the session.
                             If None, only verifies that add() was called at least once.
        """
        if expected_objects is None:
            # Just verify that add was called at least once
            assert mock_db.add.call_count >= 1
        else:
            # Get all the objects that were passed to add()
            added_objects = [call.args[0] for call in mock_db.add.call_args_list]

            # Verify each expected object was added
            for expected_obj in expected_objects:
                assert expected_obj in added_objects, f"Expected object {expected_obj} was not added to session"

    def _assert_segment_attributes_updated(self, segment, expected_updates: dict[str, Any]):
        """Helper method to verify segment attribute updates."""
        for key, value in expected_updates.items():
            assert getattr(segment, key) == value

    # ==================== Enable/Disable Segment Tests ====================

    def test_disable_segment_success(self, mock_segment_service_dependencies, mock_vector_service_dependencies):
        """Test successful disable of an enabled segment."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(enabled=True)
        document = SegmentUpdateTestDataFactory.create_document_mock()
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(enabled=False)

        result = SegmentService.update_segment(args, segment, document, dataset)

        # Verify Redis cache check
        self._assert_redis_cache_operations(
            mock_segment_service_dependencies["redis_client"], segment.id, should_set_cache=True
        )

        # Verify segment was disabled
        self._assert_segment_attributes_updated(
            segment,
            {
                "enabled": False,
                "disabled_at": mock_segment_service_dependencies["current_time"].replace(tzinfo=None),
                "disabled_by": mock_segment_service_dependencies["current_user"].id,
            },
        )

        # Verify database operations
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment])

        # Verify disable task was triggered
        mock_vector_service_dependencies["disable_task"].delay.assert_called_once_with(segment.id)

        # Verify return value
        assert result == segment

    def test_disable_segment_already_disabled(self, mock_segment_service_dependencies):
        """Test disable operation on already disabled segment."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(enabled=False)
        document = SegmentUpdateTestDataFactory.create_document_mock()
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(enabled=False)

        with pytest.raises(ValueError) as context:
            SegmentService.update_segment(args, segment, document, dataset)

        assert "Can't update disabled segment" in str(context.value)

    def test_enable_segment_no_change(self, mock_segment_service_dependencies, mock_vector_service_dependencies):
        """Test enable operation on already enabled segment (no change)."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(enabled=True)
        document = SegmentUpdateTestDataFactory.create_document_mock()
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(enabled=True)

        result = SegmentService.update_segment(args, segment, document, dataset)

        # Verify segment remains enabled (no change)
        assert segment.enabled is True
        assert segment.disabled_at is None
        assert segment.disabled_by is None

    def test_update_disabled_segment_without_enable(self, mock_segment_service_dependencies):
        """Test updating disabled segment without enabling it."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(enabled=False)
        document = SegmentUpdateTestDataFactory.create_document_mock()
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(content="new_content")

        with pytest.raises(ValueError) as context:
            SegmentService.update_segment(args, segment, document, dataset)

        assert "Can't update disabled segment" in str(context.value)

    def test_segment_indexing_in_progress_error(self, mock_segment_service_dependencies):
        """Test error when segment is currently being indexed."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock()
        document = SegmentUpdateTestDataFactory.create_document_mock()
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as indexing in progress
        mock_segment_service_dependencies["redis_client"].get.return_value = "1"

        args = SegmentUpdateArgs(content="new_content")

        with pytest.raises(ValueError) as context:
            SegmentService.update_segment(args, segment, document, dataset)

        assert "Segment is indexing, please try again later" in str(context.value)

    # ==================== Content Update Tests (Same Content) ====================

    def test_update_segment_same_content_success(
        self, mock_segment_service_dependencies, mock_vector_service_dependencies
    ):
        """Test updating segment with same content (only keywords/answer change)."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(
            content="test_content", keywords=["old_keyword"], answer="old_answer"
        )
        document = SegmentUpdateTestDataFactory.create_document_mock(doc_form=IndexType.QA_INDEX)
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(
            content="test_content",  # Same content
            keywords=["new_keyword"],
            answer="new_answer",
        )

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify segment attributes were updated
        self._assert_segment_attributes_updated(
            segment,
            {
                "keywords": ["new_keyword"],
                "answer": "new_answer",
                "enabled": True,
                "disabled_at": None,
                "disabled_by": None,
                "word_count": len("test_content") + len("new_answer"),
            },
        )

        # Verify database operations
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment])

    def test_update_segment_same_content_keywords_unchanged(
        self, mock_segment_service_dependencies, mock_vector_service_dependencies
    ):
        """Test updating segment with same content and unchanged keywords."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(
            content="test_content", keywords=["keyword1", "keyword2"]
        )
        document = SegmentUpdateTestDataFactory.create_document_mock()
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(
            content="test_content",  # Same content
            keywords=["keyword1", "keyword2"],  # Same keywords
        )

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify keywords remain unchanged
        assert segment.keywords == ["keyword1", "keyword2"]

    def test_update_segment_same_content_no_keywords_provided(
        self, mock_segment_service_dependencies, mock_vector_service_dependencies
    ):
        """Test updating segment with same content and no keywords provided."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(
            content="test_content", keywords=["existing_keyword"]
        )
        document = SegmentUpdateTestDataFactory.create_document_mock()
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(content="test_content")  # No keywords provided

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify keywords remain unchanged
        assert segment.keywords == ["existing_keyword"]

    # ==================== Content Update Tests (Different Content) ====================

    def test_update_segment_different_content_paragraph_index(
        self, mock_segment_service_dependencies, mock_model_manager_dependencies, mock_vector_service_dependencies
    ):
        """Test updating segment with different content for paragraph index."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="old_content", word_count=10, tokens=15)
        document = SegmentUpdateTestDataFactory.create_document_mock(doc_form=IndexType.PARAGRAPH_INDEX)
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        # Mock embedding model
        embedding_model = SegmentUpdateTestDataFactory.create_embedding_model_mock()
        mock_model_manager_dependencies.return_value.get_model_instance.return_value = embedding_model

        args = SegmentUpdateArgs(content="new_content", keywords=["new_keyword"])

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify segment attributes were updated
        self._assert_segment_attributes_updated(
            segment,
            {
                "content": "new_content",
                "index_node_hash": "new_hash_123",
                "word_count": len("new_content"),
                "tokens": 20,  # From mock embedding model
                "status": "completed",
                "keywords": [],  # keywords are not updated for content update
                "enabled": True,
                "disabled_at": None,
                "disabled_by": None,
            },
        )

        # Verify database operations
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment])

        # Verify vector service was called
        mock_vector_service_dependencies["vector_service"].update_segment_vector.assert_called_once_with(
            ["new_keyword"], segment, dataset
        )

    def test_update_segment_different_content_qa_index(
        self, mock_segment_service_dependencies, mock_model_manager_dependencies, mock_vector_service_dependencies
    ):
        """Test updating segment with different content for QA index."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(
            content="old_content", answer="old_answer", word_count=10, tokens=15
        )
        document = SegmentUpdateTestDataFactory.create_document_mock(doc_form=IndexType.QA_INDEX)
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        # Mock embedding model
        embedding_model = SegmentUpdateTestDataFactory.create_embedding_model_mock()
        mock_model_manager_dependencies.return_value.get_model_instance.return_value = embedding_model

        args = SegmentUpdateArgs(content="new_content", answer="new_answer", keywords=["new_keyword"])

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify segment attributes were updated
        expected_word_count = len("new_content") + len("new_answer")
        self._assert_segment_attributes_updated(
            segment,
            {
                "content": "new_content",
                "answer": "new_answer",
                "index_node_hash": "new_hash_123",
                "word_count": expected_word_count,
                "tokens": 20,  # From mock embedding model
                "status": "completed",
                "keywords": [],  # keywords are not updated for content update
                "enabled": True,
                "disabled_at": None,
                "disabled_by": None,
            },
        )

        # Verify embedding model was called with combined content
        embedding_model.get_text_embedding_num_tokens.assert_called_once_with(texts=["new_contentnew_answer"])

        # Verify vector service was called
        mock_vector_service_dependencies["vector_service"].update_segment_vector.assert_called_once_with(
            ["new_keyword"], segment, dataset
        )

        # Verify database operations - segment should be added
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment])

    def test_update_segment_different_content_economy_indexing(
        self, mock_segment_service_dependencies, mock_vector_service_dependencies
    ):
        """Test updating segment with different content for economy indexing technique."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="old_content", word_count=10, tokens=15)
        document = SegmentUpdateTestDataFactory.create_document_mock(doc_form=IndexType.PARAGRAPH_INDEX)
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock(indexing_technique="economy")

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(content="new_content", keywords=["new_keyword"])

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify segment attributes were updated (no tokens calculation for economy)
        self._assert_segment_attributes_updated(
            segment,
            {
                "content": "new_content",
                "index_node_hash": "new_hash_123",
                "word_count": len("new_content"),
                "tokens": 0,  # No tokens calculation for economy
                "status": "completed",
                "keywords": [],  # keywords are not updated for content update
                "enabled": True,
                "disabled_at": None,
                "disabled_by": None,
            },
        )

        # Verify vector service was called
        mock_vector_service_dependencies["vector_service"].update_segment_vector.assert_called_once_with(
            ["new_keyword"], segment, dataset
        )

        # Verify database operations - segment should be added
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment])

    # ==================== Parent-Child Index Tests ====================

    def test_update_segment_parent_child_index_regenerate_child_chunks(
        self,
        mock_segment_service_dependencies,
        mock_model_manager_dependencies,
        mock_vector_service_dependencies,
        mock_processing_rule_dependencies,
    ):
        """Test updating segment with parent-child index and child chunk regeneration."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="new_content")
        document = SegmentUpdateTestDataFactory.create_document_mock(
            doc_form=IndexType.PARENT_CHILD_INDEX, dataset_process_rule_id="rule-123"
        )
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        # Mock embedding model
        embedding_model = SegmentUpdateTestDataFactory.create_embedding_model_mock()
        mock_model_manager_dependencies.return_value.get_model_instance.return_value = embedding_model

        # Mock processing rule query
        processing_rule = SegmentUpdateTestDataFactory.create_processing_rule_mock()
        mock_segment_service_dependencies[
            "db_session"
        ].query.return_value.filter.return_value.first.return_value = processing_rule

        args = SegmentUpdateArgs(content="new_content", regenerate_child_chunks=True, keywords=["new_keyword"])

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify child chunks were regenerated
        mock_vector_service_dependencies["vector_service"].generate_child_chunks.assert_called_once_with(
            segment, document, dataset, embedding_model, processing_rule, True
        )

        # Verify database operations - segment should be added
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment])

    def test_update_segment_parent_child_index_no_regenerate(
        self, mock_segment_service_dependencies, mock_model_manager_dependencies, mock_vector_service_dependencies
    ):
        """Test updating segment with parent-child index without child chunk regeneration."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="new_content")
        document = SegmentUpdateTestDataFactory.create_document_mock(doc_form=IndexType.PARENT_CHILD_INDEX)
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        # Mock embedding model
        embedding_model = SegmentUpdateTestDataFactory.create_embedding_model_mock()
        mock_model_manager_dependencies.return_value.get_model_instance.return_value = embedding_model

        args = SegmentUpdateArgs(content="new_content", regenerate_child_chunks=False)

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify child chunks were not regenerated
        mock_vector_service_dependencies["vector_service"].generate_child_chunks.assert_not_called()

        # Verify database operations - segment should be added
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment])

    def test_update_segment_parent_child_index_economy_technique_error(
        self, mock_segment_service_dependencies, mock_model_manager_dependencies
    ):
        """Test error when trying to regenerate child chunks with economy indexing technique."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="new_content")
        document = SegmentUpdateTestDataFactory.create_document_mock(doc_form=IndexType.PARENT_CHILD_INDEX)
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock(indexing_technique="economy")

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(content="new_content", regenerate_child_chunks=True)

        SegmentService.update_segment(args, segment, document, dataset)

        assert "error" in segment.status
        assert "The knowledge base index technique is not high quality!" in str(segment.error)

    def test_update_segment_parent_child_index_no_processing_rule_error(
        self, mock_segment_service_dependencies, mock_model_manager_dependencies
    ):
        """Test error when processing rule is not found for parent-child index."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="new_content")
        document = SegmentUpdateTestDataFactory.create_document_mock(
            doc_form=IndexType.PARENT_CHILD_INDEX, dataset_process_rule_id="rule-123"
        )
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        # Mock embedding model
        embedding_model = SegmentUpdateTestDataFactory.create_embedding_model_mock()
        mock_model_manager_dependencies.return_value.get_model_instance.return_value = embedding_model

        # Mock processing rule query returning None
        mock_segment_service_dependencies["db_session"].query.return_value.filter.return_value.first.return_value = None

        args = SegmentUpdateArgs(content="new_content", regenerate_child_chunks=True)

        SegmentService.update_segment(args, segment, document, dataset)

        assert "error" in segment.status
        assert "No processing rule found." in str(segment.error)

    # ==================== Document Word Count Update Tests ====================

    def test_update_segment_word_count_increase(
        self, mock_segment_service_dependencies, mock_model_manager_dependencies
    ):
        """Test that document word count is updated when segment word count increases."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="old_content", word_count=10)
        document = SegmentUpdateTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(content="new_content_much_longer_than_old")

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify document word count was updated
        expected_word_count_change = len("new_content_much_longer_than_old") - 10
        expected_document_word_count = 100 + expected_word_count_change
        assert document.word_count == expected_document_word_count

        # Verify database operations - both segment and document should be added
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment, document])

    def test_update_segment_word_count_decrease(
        self, mock_segment_service_dependencies, mock_model_manager_dependencies
    ):
        """Test that document word count is updated when segment word count decreases."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="very_long_old_content", word_count=25)
        document = SegmentUpdateTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(content="short")

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify document word count was updated
        expected_word_count_change = len("short") - 25
        expected_document_word_count = 100 + expected_word_count_change
        assert document.word_count == expected_document_word_count

        # Verify database operations - both segment and document should be added
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment, document])

    def test_update_segment_word_count_no_change(self, mock_segment_service_dependencies):
        """Test that document word count is not updated when segment word count doesn't change."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="same_length", word_count=11)
        document = SegmentUpdateTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(content="same_length")  # Same length content

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify document word count was not changed
        assert document.word_count == 100

        # Verify database operations - only segment should be added (no word count change for document)
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment])

    def test_update_segment_word_count_qa_model_with_answer(
        self, mock_segment_service_dependencies, mock_model_manager_dependencies
    ):
        """Test word count update for QA model with answer field."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(
            content="question", answer="old_answer", word_count=7
        )
        document = SegmentUpdateTestDataFactory.create_document_mock(doc_form=IndexType.QA_INDEX, word_count=100)
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        # Mock embedding model
        embedding_model = SegmentUpdateTestDataFactory.create_embedding_model_mock()
        mock_model_manager_dependencies.return_value.get_model_instance.return_value = embedding_model

        args = SegmentUpdateArgs(content="question", answer="new_longer_answer")

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify segment word count includes answer
        expected_segment_word_count = len("question") + len("new_longer_answer")
        assert segment.word_count == expected_segment_word_count

        # Verify document word count was updated
        expected_word_count_change = expected_segment_word_count - 7
        expected_document_word_count = 100 + expected_word_count_change
        assert document.word_count == expected_document_word_count

        # Verify database operations - both segment and document should be added
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment, document])

    # ==================== Error Handling Tests ====================

    def test_update_segment_vector_service_error(
        self, mock_segment_service_dependencies, mock_model_manager_dependencies, mock_vector_service_dependencies
    ):
        """Test error handling when vector service fails."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="old_content")
        document = SegmentUpdateTestDataFactory.create_document_mock()
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        # Mock embedding model
        embedding_model = SegmentUpdateTestDataFactory.create_embedding_model_mock()
        mock_model_manager_dependencies.return_value.get_model_instance.return_value = embedding_model

        # Mock vector service to raise error
        mock_vector_service_dependencies["vector_service"].update_segment_vector.side_effect = Exception(
            "Vector service error"
        )

        args = SegmentUpdateArgs(content="new_content", keywords=["keyword"])

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify segment was marked as error
        self._assert_segment_attributes_updated(
            segment,
            {
                "enabled": False,
                "status": "error",
                "error": "Vector service error",
                "disabled_at": mock_segment_service_dependencies["current_time"].replace(tzinfo=None),
            },
        )

        # Verify database operations - segment should be added with error state
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment])

    # ==================== Edge Cases and Integration Tests ====================

    def test_update_segment_with_none_content_uses_existing(self, mock_segment_service_dependencies):
        """Test that None content uses existing segment content."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="existing_content")
        document = SegmentUpdateTestDataFactory.create_document_mock()
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(content=None, keywords=["new_keyword"])

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify content remains unchanged
        assert segment.content == "existing_content"

        # Verify keywords were updated
        assert segment.keywords == ["new_keyword"]

        # Verify database operations - segment should be added
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment])

    def test_update_segment_with_none_answer_qa_model(self, mock_segment_service_dependencies):
        """Test updating QA model segment with None answer."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(
            content="question", answer="old_answer", word_count=15
        )
        document = SegmentUpdateTestDataFactory.create_document_mock(doc_form=IndexType.QA_INDEX)
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        args = SegmentUpdateArgs(content="question", answer=None)

        SegmentService.update_segment(args, segment, document, dataset)

        # Verify answer was updated to None
        assert segment.answer is None

        # Verify word count only includes content (no answer)
        assert segment.word_count == len("question")

        # Verify database operations - segment should be added
        self._assert_database_operations(mock_segment_service_dependencies["db_session"], [segment])

    def test_update_segment_final_query_returns_updated_segment(self, mock_segment_service_dependencies):
        """Test that the final database query returns the updated segment."""
        segment = SegmentUpdateTestDataFactory.create_segment_mock(content="old_content")
        document = SegmentUpdateTestDataFactory.create_document_mock()
        dataset = SegmentUpdateTestDataFactory.create_dataset_mock()

        # Mock Redis cache as not indexing
        mock_segment_service_dependencies["redis_client"].get.return_value = None

        # Mock final query to return updated segment
        updated_segment = SegmentUpdateTestDataFactory.create_segment_mock(
            segment_id="segment-123", content="new_content"
        )
        mock_segment_service_dependencies[
            "db_session"
        ].query.return_value.filter.return_value.first.return_value = updated_segment

        args = SegmentUpdateArgs(content="new_content")

        mock_segment_service_dependencies[
            "db_session"
        ].query.return_value.filter.return_value.first.return_value = updated_segment

        result = SegmentService.update_segment(args, segment, document, dataset)

        # Verify result is the updated segment
        assert result == updated_segment
