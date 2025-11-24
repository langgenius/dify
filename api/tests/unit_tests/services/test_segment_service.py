from unittest.mock import MagicMock, Mock, patch

import pytest

from models.account import Account
from models.dataset import ChildChunk, Dataset, Document, DocumentSegment
from services.dataset_service import SegmentService
from services.entities.knowledge_entities.knowledge_entities import ChildChunkUpdateArgs, SegmentUpdateArgs
from services.errors.chunk import ChildChunkDeleteIndexError, ChildChunkIndexingError


class SegmentTestDataFactory:
    """Factory class for creating test data and mock objects for segment service tests."""

    @staticmethod
    def create_segment_mock(
        segment_id: str = "segment-123",
        document_id: str = "doc-123",
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        content: str = "Test segment content",
        position: int = 1,
        enabled: bool = True,
        status: str = "completed",
        word_count: int = 20,
        index_node_id: str = "index-node-123",
        **kwargs,
    ) -> Mock:
        """Create a mock segment with specified attributes."""
        segment = Mock(spec=DocumentSegment)
        segment.id = segment_id
        segment.document_id = document_id
        segment.dataset_id = dataset_id
        segment.tenant_id = tenant_id
        segment.content = content
        segment.position = position
        segment.enabled = enabled
        segment.status = status
        segment.word_count = word_count
        segment.index_node_id = index_node_id
        segment.index_node_hash = "hash-123"
        segment.tokens = 10
        segment.keywords = []
        segment.answer = None
        segment.disabled_at = None
        segment.disabled_by = None
        segment.created_by = "user-123"
        segment.updated_by = None
        segment.updated_at = None
        segment.indexing_at = None
        segment.completed_at = None
        segment.error = None
        for key, value in kwargs.items():
            setattr(segment, key, value)
        return segment

    @staticmethod
    def create_child_chunk_mock(
        chunk_id: str = "chunk-123",
        segment_id: str = "segment-123",
        document_id: str = "doc-123",
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        content: str = "Test chunk content",
        position: int = 1,
        word_count: int = 15,
        index_node_id: str = "chunk-index-node-123",
        **kwargs,
    ) -> Mock:
        """Create a mock child chunk with specified attributes."""
        chunk = Mock(spec=ChildChunk)
        chunk.id = chunk_id
        chunk.segment_id = segment_id
        chunk.document_id = document_id
        chunk.dataset_id = dataset_id
        chunk.tenant_id = tenant_id
        chunk.content = content
        chunk.position = position
        chunk.word_count = word_count
        chunk.index_node_id = index_node_id
        chunk.index_node_hash = "chunk-hash-123"
        chunk.type = "customized"
        chunk.created_by = "user-123"
        chunk.updated_by = None
        chunk.updated_at = None
        for key, value in kwargs.items():
            setattr(chunk, key, value)
        return chunk

    @staticmethod
    def create_document_mock(
        document_id: str = "doc-123",
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        doc_form: str = "text_model",
        word_count: int = 100,
        **kwargs,
    ) -> Mock:
        """Create a mock document with specified attributes."""
        document = Mock(spec=Document)
        document.id = document_id
        document.dataset_id = dataset_id
        document.tenant_id = tenant_id
        document.doc_form = doc_form
        document.word_count = word_count
        document.dataset_process_rule_id = "rule-123"
        for key, value in kwargs.items():
            setattr(document, key, value)
        return document

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        indexing_technique: str = "high_quality",
        embedding_model: str = "text-embedding-ada-002",
        embedding_model_provider: str = "openai",
        **kwargs,
    ) -> Mock:
        """Create a mock dataset with specified attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.indexing_technique = indexing_technique
        dataset.embedding_model = embedding_model
        dataset.embedding_model_provider = embedding_model_provider
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_user_mock(
        user_id: str = "user-123",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """Create a mock user with specified attributes."""
        user = Mock(spec=Account)
        user.id = user_id
        user.current_tenant_id = tenant_id
        for key, value in kwargs.items():
            setattr(user, key, value)
        return user


class TestSegmentServiceCreateSegment:
    """Tests for SegmentService.create_segment method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """Mock current_user."""
        user = SegmentTestDataFactory.create_user_mock()
        with patch("services.dataset_service.current_user", user):
            yield user

    @pytest.fixture
    def mock_redis_lock(self):
        """Mock redis lock."""
        with patch("services.dataset_service.redis_client.lock") as mock_lock:
            mock_lock.return_value.__enter__ = Mock()
            mock_lock.return_value.__exit__ = Mock(return_value=None)
            yield mock_lock

    def test_create_segment_success(self, mock_db_session, mock_current_user, mock_redis_lock):
        """Test successful creation of a segment."""
        # Arrange
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock(indexing_technique="economy")
        args = {"content": "New segment content", "keywords": []}

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.scalar.return_value = None  # No existing segments
        mock_db_session.query.return_value = mock_query

        mock_query_after = Mock()
        mock_query_after.where.return_value = mock_query_after
        mock_query_after.first.return_value = SegmentTestDataFactory.create_segment_mock()
        mock_db_session.query.return_value = mock_query_after

        with (
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.uuid.uuid4") as mock_uuid,
            patch("services.dataset_service.naive_utc_now") as mock_now,
            patch("services.dataset_service.VectorService.create_segments_vector") as mock_vector,
        ):
            mock_hash.return_value = "hash-123"
            mock_uuid.return_value = Mock(hex="index-node-123")
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.create_segment(args, document, dataset)

            # Assert
            assert result is not None
            mock_db_session.add.assert_called()
            mock_db_session.commit.assert_called()
            mock_vector.assert_called_once()

    def test_create_segment_with_high_quality_indexing(self, mock_db_session, mock_current_user, mock_redis_lock):
        """Test segment creation with high_quality indexing technique."""
        # Arrange
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock(indexing_technique="high_quality")
        args = {"content": "New segment content", "keywords": []}

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.scalar.return_value = None
        mock_db_session.query.return_value = mock_query

        mock_query_after = Mock()
        mock_query_after.where.return_value = mock_query_after
        mock_query_after.first.return_value = SegmentTestDataFactory.create_segment_mock()
        mock_db_session.query.return_value = mock_query_after

        mock_embedding_model = Mock()
        mock_embedding_model.get_text_embedding_num_tokens.return_value = [10]

        with (
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.uuid.uuid4") as mock_uuid,
            patch("services.dataset_service.naive_utc_now") as mock_now,
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch("services.dataset_service.VectorService.create_segments_vector") as mock_vector,
        ):
            mock_hash.return_value = "hash-123"
            mock_uuid.return_value = Mock(hex="index-node-123")
            mock_now.return_value = "2024-01-01T00:00:00"
            mock_model_manager_instance = Mock()
            mock_model_manager_instance.get_model_instance.return_value = mock_embedding_model
            mock_model_manager.return_value = mock_model_manager_instance

            # Act
            result = SegmentService.create_segment(args, document, dataset)

            # Assert
            assert result is not None
            mock_model_manager_instance.get_model_instance.assert_called_once()
            mock_embedding_model.get_text_embedding_num_tokens.assert_called_once()

    def test_create_segment_qa_model(self, mock_db_session, mock_current_user, mock_redis_lock):
        """Test segment creation for QA model document."""
        # Arrange
        document = SegmentTestDataFactory.create_document_mock(doc_form="qa_model", word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock(indexing_technique="economy")
        args = {"content": "Question?", "answer": "Answer", "keywords": []}

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.scalar.return_value = None
        mock_db_session.query.return_value = mock_query

        mock_query_after = Mock()
        mock_query_after.where.return_value = mock_query_after
        mock_query_after.first.return_value = SegmentTestDataFactory.create_segment_mock()
        mock_db_session.query.return_value = mock_query_after

        with (
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.uuid.uuid4") as mock_uuid,
            patch("services.dataset_service.naive_utc_now") as mock_now,
            patch("services.dataset_service.VectorService.create_segments_vector") as mock_vector,
        ):
            mock_hash.return_value = "hash-123"
            mock_uuid.return_value = Mock(hex="index-node-123")
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.create_segment(args, document, dataset)

            # Assert
            assert result is not None
            mock_db_session.add.assert_called()

    def test_create_segment_vector_indexing_failure(self, mock_db_session, mock_current_user, mock_redis_lock):
        """Test segment creation when vector indexing fails."""
        # Arrange
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock(indexing_technique="economy")
        args = {"content": "New segment content", "keywords": []}

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.scalar.return_value = None
        mock_db_session.query.return_value = mock_query

        segment = SegmentTestDataFactory.create_segment_mock()
        mock_query_after = Mock()
        mock_query_after.where.return_value = mock_query_after
        mock_query_after.first.return_value = segment
        mock_db_session.query.return_value = mock_query_after

        with (
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.uuid.uuid4") as mock_uuid,
            patch("services.dataset_service.naive_utc_now") as mock_now,
            patch("services.dataset_service.VectorService.create_segments_vector") as mock_vector,
        ):
            mock_hash.return_value = "hash-123"
            mock_uuid.return_value = Mock(hex="index-node-123")
            mock_now.return_value = "2024-01-01T00:00:00"
            mock_vector.side_effect = Exception("Vector indexing failed")

            # Act
            result = SegmentService.create_segment(args, document, dataset)

            # Assert
            assert result is not None
            assert segment.enabled is False
            assert segment.status == "error"
            assert segment.error == "Vector indexing failed"
            assert mock_db_session.commit.call_count >= 2


class TestSegmentServiceUpdateSegment:
    """Tests for SegmentService.update_segment method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """Mock current_user."""
        user = SegmentTestDataFactory.create_user_mock()
        with patch("services.dataset_service.current_user", user):
            yield user

    def test_update_segment_content_success(self, mock_db_session, mock_current_user):
        """Test successful update of segment content."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=True, word_count=20)
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock(indexing_technique="economy")
        args = SegmentUpdateArgs(content="Updated content", keywords=[])

        mock_redis_get = Mock(return_value=None)
        with (
            patch("services.dataset_service.redis_client.get", mock_redis_get),
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.naive_utc_now") as mock_now,
            patch("services.dataset_service.VectorService.update_segment_vector") as mock_vector,
        ):
            mock_hash.return_value = "new-hash-123"
            mock_now.return_value = "2024-01-01T00:00:00"

            mock_query = Mock()
            mock_query.where.return_value = mock_query
            mock_query.first.return_value = segment
            mock_db_session.query.return_value = mock_query

            # Act
            result = SegmentService.update_segment(args, segment, document, dataset)

            # Assert
            assert result is not None
            assert segment.content == "Updated content"
            mock_db_session.add.assert_called()
            mock_db_session.commit.assert_called()
            mock_vector.assert_called_once()

    def test_update_segment_disable(self, mock_db_session, mock_current_user):
        """Test disabling a segment."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=True)
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()
        args = SegmentUpdateArgs(enabled=False)

        mock_redis_get = Mock(return_value=None)
        with (
            patch("services.dataset_service.redis_client.get", mock_redis_get),
            patch("services.dataset_service.redis_client.setex") as mock_setex,
            patch("services.dataset_service.naive_utc_now") as mock_now,
            patch("services.dataset_service.disable_segment_from_index_task") as mock_task,
        ):
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.update_segment(args, segment, document, dataset)

            # Assert
            assert result is not None
            assert segment.enabled is False
            assert segment.disabled_at is not None
            assert segment.disabled_by == mock_current_user.id
            mock_setex.assert_called_once()
            mock_task.delay.assert_called_once()

    def test_update_segment_indexing_in_progress_error(self, mock_db_session, mock_current_user):
        """Test update fails when segment is being indexed."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=True)
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()
        args = SegmentUpdateArgs(content="Updated content")

        mock_redis_get = Mock(return_value="1")  # Indexing in progress
        with patch("services.dataset_service.redis_client.get", mock_redis_get):
            # Act & Assert
            with pytest.raises(ValueError, match="Segment is indexing"):
                SegmentService.update_segment(args, segment, document, dataset)

    def test_update_segment_disabled_error(self, mock_db_session, mock_current_user):
        """Test update fails when segment is disabled."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=False)
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()
        args = SegmentUpdateArgs(content="Updated content")

        mock_redis_get = Mock(return_value=None)
        with patch("services.dataset_service.redis_client.get", mock_redis_get):
            # Act & Assert
            with pytest.raises(ValueError, match="Can't update disabled segment"):
                SegmentService.update_segment(args, segment, document, dataset)


class TestSegmentServiceDeleteSegment:
    """Tests for SegmentService.delete_segment method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_delete_segment_success(self, mock_db_session):
        """Test successful deletion of a segment."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=False, word_count=20)
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock()

        mock_redis_get = Mock(return_value=None)
        with patch("services.dataset_service.redis_client.get", mock_redis_get):
            # Act
            SegmentService.delete_segment(segment, document, dataset)

            # Assert
            mock_db_session.delete.assert_called_once_with(segment)
            assert document.word_count == 80  # 100 - 20
            mock_db_session.add.assert_called_once_with(document)
            mock_db_session.commit.assert_called_once()

    def test_delete_segment_with_indexing(self, mock_db_session):
        """Test deletion of enabled segment triggers index deletion."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=True, word_count=20, index_node_id="index-123")
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock()

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = []  # No child chunks
        mock_db_session.query.return_value = mock_query

        mock_redis_get = Mock(return_value=None)
        with (
            patch("services.dataset_service.redis_client.get", mock_redis_get),
            patch("services.dataset_service.redis_client.setex") as mock_setex,
            patch("services.dataset_service.delete_segment_from_index_task") as mock_task,
        ):
            # Act
            SegmentService.delete_segment(segment, document, dataset)

            # Assert
            mock_setex.assert_called_once()
            mock_task.delay.assert_called_once_with(["index-123"], dataset.id, document.id, [])
            mock_db_session.delete.assert_called_once_with(segment)

    def test_delete_segment_deleting_error(self, mock_db_session):
        """Test deletion fails when segment is already being deleted."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock()
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        mock_redis_get = Mock(return_value="1")  # Already deleting
        with patch("services.dataset_service.redis_client.get", mock_redis_get):
            # Act & Assert
            with pytest.raises(ValueError, match="Segment is deleting"):
                SegmentService.delete_segment(segment, document, dataset)


class TestSegmentServiceDeleteSegments:
    """Tests for SegmentService.delete_segments method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """Mock current_user."""
        user = SegmentTestDataFactory.create_user_mock()
        with patch("services.dataset_service.current_user", user):
            yield user

    def test_delete_segments_success(self, mock_db_session, mock_current_user):
        """Test successful deletion of multiple segments."""
        # Arrange
        segment_ids = ["segment-1", "segment-2"]
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock()

        segments_info = [
            ("index-1", "segment-1", 20),
            ("index-2", "segment-2", 30),
        ]

        mock_query = Mock()
        mock_query.with_entities.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = segments_info
        mock_db_session.query.return_value = mock_query

        mock_query_chunks = Mock()
        mock_query_chunks.where.return_value = mock_query_chunks
        mock_query_chunks.all.return_value = []
        mock_db_session.query.return_value = mock_query_chunks

        mock_query_delete = Mock()
        mock_query_delete.where.return_value = mock_query_delete
        mock_db_session.query.return_value = mock_query_delete

        with patch("services.dataset_service.delete_segment_from_index_task") as mock_task:
            # Act
            SegmentService.delete_segments(segment_ids, document, dataset)

            # Assert
            assert document.word_count == 50  # 100 - 20 - 30
            mock_db_session.add.assert_called_once_with(document)
            mock_task.delay.assert_called_once()
            mock_db_session.commit.assert_called_once()

    def test_delete_segments_empty_list(self, mock_db_session, mock_current_user):
        """Test deletion with empty list returns early."""
        # Arrange
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        # Act
        SegmentService.delete_segments([], document, dataset)

        # Assert
        mock_db_session.query.assert_not_called()

    def test_delete_segments_no_segments_found(self, mock_db_session, mock_current_user):
        """Test deletion when no segments are found."""
        # Arrange
        segment_ids = ["segment-1"]
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        mock_query = Mock()
        mock_query.with_entities.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.all.return_value = []  # No segments found
        mock_db_session.query.return_value = mock_query

        # Act
        SegmentService.delete_segments(segment_ids, document, dataset)

        # Assert
        mock_db_session.commit.assert_not_called()


class TestSegmentServiceUpdateSegmentsStatus:
    """Tests for SegmentService.update_segments_status method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """Mock current_user."""
        user = SegmentTestDataFactory.create_user_mock()
        with patch("services.dataset_service.current_user", user):
            yield user

    def test_update_segments_status_enable(self, mock_db_session, mock_current_user):
        """Test enabling multiple segments."""
        # Arrange
        segment_ids = ["segment-1", "segment-2"]
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        segments = [
            SegmentTestDataFactory.create_segment_mock(segment_id="segment-1", enabled=False),
            SegmentTestDataFactory.create_segment_mock(segment_id="segment-2", enabled=False),
        ]

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = segments
        mock_select = MagicMock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        mock_redis_get = Mock(return_value=None)
        with (
            patch("services.dataset_service.select") as mock_select_func,
            patch("services.dataset_service.redis_client.get", mock_redis_get),
            patch("services.dataset_service.naive_utc_now") as mock_now,
            patch("services.dataset_service.enable_segments_to_index_task") as mock_task,
        ):
            mock_select_func.return_value = mock_select
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            SegmentService.update_segments_status(segment_ids, "enable", dataset, document)

            # Assert
            assert segments[0].enabled is True
            assert segments[1].enabled is True
            mock_db_session.add.assert_called()
            mock_db_session.commit.assert_called_once()
            mock_task.delay.assert_called_once()

    def test_update_segments_status_disable(self, mock_db_session, mock_current_user):
        """Test disabling multiple segments."""
        # Arrange
        segment_ids = ["segment-1", "segment-2"]
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        segments = [
            SegmentTestDataFactory.create_segment_mock(segment_id="segment-1", enabled=True),
            SegmentTestDataFactory.create_segment_mock(segment_id="segment-2", enabled=True),
        ]

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = segments
        mock_select = MagicMock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        mock_redis_get = Mock(return_value=None)
        with (
            patch("services.dataset_service.select") as mock_select_func,
            patch("services.dataset_service.redis_client.get", mock_redis_get),
            patch("services.dataset_service.naive_utc_now") as mock_now,
            patch("services.dataset_service.disable_segments_from_index_task") as mock_task,
        ):
            mock_select_func.return_value = mock_select
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            SegmentService.update_segments_status(segment_ids, "disable", dataset, document)

            # Assert
            assert segments[0].enabled is False
            assert segments[1].enabled is False
            assert segments[0].disabled_at is not None
            assert segments[1].disabled_at is not None
            mock_db_session.commit.assert_called_once()
            mock_task.delay.assert_called_once()

    def test_update_segments_status_empty_list(self, mock_db_session, mock_current_user):
        """Test update with empty list returns early."""
        # Arrange
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        # Act
        SegmentService.update_segments_status([], "enable", dataset, document)

        # Assert
        mock_db_session.scalars.assert_not_called()


class TestSegmentServiceGetSegments:
    """Tests for SegmentService.get_segments method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_segments_success(self, mock_db_session):
        """Test successful retrieval of segments."""
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        segments = [
            SegmentTestDataFactory.create_segment_mock(segment_id="segment-1"),
            SegmentTestDataFactory.create_segment_mock(segment_id="segment-2"),
        ]

        mock_paginate = Mock()
        mock_paginate.items = segments
        mock_paginate.total = 2

        with patch("services.dataset_service.db.paginate", return_value=mock_paginate):
            # Act
            result_items, result_total = SegmentService.get_segments(document_id, tenant_id)

            # Assert
            assert len(result_items) == 2
            assert result_total == 2

    def test_get_segments_with_status_filter(self, mock_db_session):
        """Test retrieval with status filter."""
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        status_list = ["completed"]

        mock_paginate = Mock()
        mock_paginate.items = []
        mock_paginate.total = 0

        with patch("services.dataset_service.db.paginate", return_value=mock_paginate):
            # Act
            result_items, result_total = SegmentService.get_segments(document_id, tenant_id, status_list=status_list)

            # Assert
            assert len(result_items) == 0
            assert result_total == 0

    def test_get_segments_with_keyword(self, mock_db_session):
        """Test retrieval with keyword search."""
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        keyword = "test"

        mock_paginate = Mock()
        mock_paginate.items = [SegmentTestDataFactory.create_segment_mock()]
        mock_paginate.total = 1

        with patch("services.dataset_service.db.paginate", return_value=mock_paginate):
            # Act
            result_items, result_total = SegmentService.get_segments(document_id, tenant_id, keyword=keyword)

            # Assert
            assert len(result_items) == 1
            assert result_total == 1


class TestSegmentServiceGetSegmentById:
    """Tests for SegmentService.get_segment_by_id method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_segment_by_id_success(self, mock_db_session):
        """Test successful retrieval of segment by ID."""
        # Arrange
        segment_id = "segment-123"
        tenant_id = "tenant-123"
        segment = SegmentTestDataFactory.create_segment_mock(segment_id=segment_id)

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = segment
        mock_db_session.query.return_value = mock_query

        # Act
        result = SegmentService.get_segment_by_id(segment_id, tenant_id)

        # Assert
        assert result is not None
        assert result.id == segment_id

    def test_get_segment_by_id_not_found(self, mock_db_session):
        """Test retrieval when segment is not found."""
        # Arrange
        segment_id = "non-existent"
        tenant_id = "tenant-123"

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act
        result = SegmentService.get_segment_by_id(segment_id, tenant_id)

        # Assert
        assert result is None


class TestSegmentServiceGetChildChunks:
    """Tests for SegmentService.get_child_chunks method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """Mock current_user."""
        user = SegmentTestDataFactory.create_user_mock()
        with patch("services.dataset_service.current_user", user):
            yield user

    def test_get_child_chunks_success(self, mock_db_session, mock_current_user):
        """Test successful retrieval of child chunks."""
        # Arrange
        segment_id = "segment-123"
        document_id = "doc-123"
        dataset_id = "dataset-123"

        chunks = [
            SegmentTestDataFactory.create_child_chunk_mock(chunk_id="chunk-1"),
            SegmentTestDataFactory.create_child_chunk_mock(chunk_id="chunk-2"),
        ]

        mock_paginate = Mock()
        mock_paginate.items = chunks
        mock_paginate.total = 2

        with patch("services.dataset_service.db.paginate", return_value=mock_paginate):
            # Act
            result = SegmentService.get_child_chunks(segment_id, document_id, dataset_id, page=1, limit=20)

            # Assert
            assert result.items == chunks
            assert result.total == 2

    def test_get_child_chunks_with_keyword(self, mock_db_session, mock_current_user):
        """Test retrieval with keyword filter."""
        # Arrange
        segment_id = "segment-123"
        document_id = "doc-123"
        dataset_id = "dataset-123"
        keyword = "test"

        mock_paginate = Mock()
        mock_paginate.items = []
        mock_paginate.total = 0

        with patch("services.dataset_service.db.paginate", return_value=mock_paginate):
            # Act
            result = SegmentService.get_child_chunks(segment_id, document_id, dataset_id, page=1, limit=20, keyword=keyword)

            # Assert
            assert len(result.items) == 0
            assert result.total == 0


class TestSegmentServiceGetChildChunkById:
    """Tests for SegmentService.get_child_chunk_by_id method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_child_chunk_by_id_success(self, mock_db_session):
        """Test successful retrieval of child chunk by ID."""
        # Arrange
        chunk_id = "chunk-123"
        tenant_id = "tenant-123"
        chunk = SegmentTestDataFactory.create_child_chunk_mock(chunk_id=chunk_id)

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = chunk
        mock_db_session.query.return_value = mock_query

        # Act
        result = SegmentService.get_child_chunk_by_id(chunk_id, tenant_id)

        # Assert
        assert result is not None
        assert result.id == chunk_id

    def test_get_child_chunk_by_id_not_found(self, mock_db_session):
        """Test retrieval when child chunk is not found."""
        # Arrange
        chunk_id = "non-existent"
        tenant_id = "tenant-123"

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act
        result = SegmentService.get_child_chunk_by_id(chunk_id, tenant_id)

        # Assert
        assert result is None


class TestSegmentServiceCreateChildChunk:
    """Tests for SegmentService.create_child_chunk method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """Mock current_user."""
        user = SegmentTestDataFactory.create_user_mock()
        with patch("services.dataset_service.current_user", user):
            yield user

    @pytest.fixture
    def mock_redis_lock(self):
        """Mock redis lock."""
        with patch("services.dataset_service.redis_client.lock") as mock_lock:
            mock_lock.return_value.__enter__ = Mock()
            mock_lock.return_value.__exit__ = Mock(return_value=None)
            yield mock_lock

    def test_create_child_chunk_success(self, mock_db_session, mock_current_user, mock_redis_lock):
        """Test successful creation of a child chunk."""
        # Arrange
        content = "New child chunk content"
        segment = SegmentTestDataFactory.create_segment_mock()
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.scalar.return_value = None  # No existing chunks
        mock_db_session.query.return_value = mock_query

        with (
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.uuid.uuid4") as mock_uuid,
            patch("services.dataset_service.VectorService.create_child_chunk_vector") as mock_vector,
        ):
            mock_hash.return_value = "chunk-hash-123"
            mock_uuid.return_value = Mock(hex="chunk-index-node-123")

            # Act
            result = SegmentService.create_child_chunk(content, segment, document, dataset)

            # Assert
            assert result is not None
            mock_db_session.add.assert_called_once()
            mock_vector.assert_called_once()
            mock_db_session.commit.assert_called_once()

    def test_create_child_chunk_vector_indexing_failure(self, mock_db_session, mock_current_user, mock_redis_lock):
        """Test creation fails when vector indexing fails."""
        # Arrange
        content = "New child chunk content"
        segment = SegmentTestDataFactory.create_segment_mock()
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.scalar.return_value = None
        mock_db_session.query.return_value = mock_query

        with (
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.uuid.uuid4") as mock_uuid,
            patch("services.dataset_service.VectorService.create_child_chunk_vector") as mock_vector,
        ):
            mock_hash.return_value = "chunk-hash-123"
            mock_uuid.return_value = Mock(hex="chunk-index-node-123")
            mock_vector.side_effect = Exception("Vector indexing failed")

            # Act & Assert
            with pytest.raises(ChildChunkIndexingError):
                SegmentService.create_child_chunk(content, segment, document, dataset)

            mock_db_session.rollback.assert_called_once()


class TestSegmentServiceUpdateChildChunk:
    """Tests for SegmentService.update_child_chunk method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """Mock current_user."""
        user = SegmentTestDataFactory.create_user_mock()
        with patch("services.dataset_service.current_user", user):
            yield user

    def test_update_child_chunk_success(self, mock_db_session, mock_current_user):
        """Test successful update of a child chunk."""
        # Arrange
        content = "Updated chunk content"
        chunk = SegmentTestDataFactory.create_child_chunk_mock()
        segment = SegmentTestDataFactory.create_segment_mock()
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        with (
            patch("services.dataset_service.naive_utc_now") as mock_now,
            patch("services.dataset_service.VectorService.update_child_chunk_vector") as mock_vector,
        ):
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.update_child_chunk(content, chunk, segment, document, dataset)

            # Assert
            assert result is not None
            assert chunk.content == content
            assert chunk.word_count == len(content.split())
            assert chunk.type == "customized"
            assert chunk.updated_by == mock_current_user.id
            mock_db_session.add.assert_called_once_with(chunk)
            mock_vector.assert_called_once()
            mock_db_session.commit.assert_called_once()

    def test_update_child_chunk_vector_indexing_failure(self, mock_db_session, mock_current_user):
        """Test update fails when vector indexing fails."""
        # Arrange
        content = "Updated chunk content"
        chunk = SegmentTestDataFactory.create_child_chunk_mock()
        segment = SegmentTestDataFactory.create_segment_mock()
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        with (
            patch("services.dataset_service.naive_utc_now") as mock_now,
            patch("services.dataset_service.VectorService.update_child_chunk_vector") as mock_vector,
        ):
            mock_now.return_value = "2024-01-01T00:00:00"
            mock_vector.side_effect = Exception("Vector indexing failed")

            # Act & Assert
            with pytest.raises(ChildChunkIndexingError):
                SegmentService.update_child_chunk(content, chunk, segment, document, dataset)

            mock_db_session.rollback.assert_called_once()


class TestSegmentServiceDeleteChildChunk:
    """Tests for SegmentService.delete_child_chunk method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_delete_child_chunk_success(self, mock_db_session):
        """Test successful deletion of a child chunk."""
        # Arrange
        chunk = SegmentTestDataFactory.create_child_chunk_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        with patch("services.dataset_service.VectorService.delete_child_chunk_vector") as mock_vector:
            # Act
            SegmentService.delete_child_chunk(chunk, dataset)

            # Assert
            mock_db_session.delete.assert_called_once_with(chunk)
            mock_vector.assert_called_once_with(chunk, dataset)
            mock_db_session.commit.assert_called_once()

    def test_delete_child_chunk_vector_indexing_failure(self, mock_db_session):
        """Test deletion fails when vector deletion fails."""
        # Arrange
        chunk = SegmentTestDataFactory.create_child_chunk_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        with patch("services.dataset_service.VectorService.delete_child_chunk_vector") as mock_vector:
            mock_vector.side_effect = Exception("Vector deletion failed")

            # Act & Assert
            with pytest.raises(ChildChunkDeleteIndexError):
                SegmentService.delete_child_chunk(chunk, dataset)

            mock_db_session.rollback.assert_called_once()

