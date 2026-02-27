from unittest.mock import MagicMock, Mock, patch

import pytest

from models.account import Account
from models.dataset import ChildChunk, Dataset, Document, DocumentSegment
from services.dataset_service import SegmentService
from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs
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
        word_count: int = 3,
        tokens: int = 5,
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
        segment.tokens = tokens
        segment.index_node_id = f"node-{segment_id}"
        segment.index_node_hash = "hash-123"
        segment.keywords = []
        segment.answer = None
        segment.disabled_at = None
        segment.disabled_by = None
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
        content: str = "Test child chunk content",
        position: int = 1,
        word_count: int = 3,
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
        chunk.index_node_id = f"node-{chunk_id}"
        chunk.index_node_hash = "hash-123"
        chunk.type = "automatic"
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
        user_id: str = "user-789",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """Create a mock user with specified attributes."""
        user = Mock(spec=Account)
        user.id = user_id
        user.current_tenant_id = tenant_id
        user.name = "Test User"
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

    def test_create_segment_success(self, mock_db_session, mock_current_user):
        """Test successful creation of a segment."""
        # Arrange
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock(indexing_technique="economy")
        args = {"content": "New segment content", "keywords": ["test", "segment"]}

        mock_query = MagicMock()
        mock_query.where.return_value.scalar.return_value = None  # No existing segments
        mock_db_session.query.return_value = mock_query

        mock_segment = SegmentTestDataFactory.create_segment_mock()
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_segment

        with (
            patch("services.dataset_service.redis_client.lock") as mock_lock,
            patch("services.dataset_service.VectorService.create_segments_vector") as mock_vector_service,
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.naive_utc_now") as mock_now,
        ):
            mock_lock.return_value.__enter__ = Mock()
            mock_lock.return_value.__exit__ = Mock(return_value=None)
            mock_hash.return_value = "hash-123"
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.create_segment(args, document, dataset)

            # Assert
            assert mock_db_session.add.call_count == 2

            created_segment = mock_db_session.add.call_args_list[0].args[0]
            assert isinstance(created_segment, DocumentSegment)
            assert created_segment.content == args["content"]
            assert created_segment.word_count == len(args["content"])

            mock_db_session.commit.assert_called_once()

            mock_vector_service.assert_called_once()
            vector_call_args = mock_vector_service.call_args[0]
            assert vector_call_args[0] == [args["keywords"]]
            assert vector_call_args[1][0] == created_segment
            assert vector_call_args[2] == dataset
            assert vector_call_args[3] == document.doc_form

            assert result == mock_segment

    def test_create_segment_with_qa_model(self, mock_db_session, mock_current_user):
        """Test creation of segment with QA model (requires answer)."""
        # Arrange
        document = SegmentTestDataFactory.create_document_mock(doc_form="qa_model", word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock(indexing_technique="economy")
        args = {"content": "What is AI?", "answer": "AI is Artificial Intelligence", "keywords": ["ai"]}

        mock_query = MagicMock()
        mock_query.where.return_value.scalar.return_value = None
        mock_db_session.query.return_value = mock_query

        mock_segment = SegmentTestDataFactory.create_segment_mock()
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_segment

        with (
            patch("services.dataset_service.redis_client.lock") as mock_lock,
            patch("services.dataset_service.VectorService.create_segments_vector") as mock_vector_service,
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.naive_utc_now") as mock_now,
        ):
            mock_lock.return_value.__enter__ = Mock()
            mock_lock.return_value.__exit__ = Mock(return_value=None)
            mock_hash.return_value = "hash-123"
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.create_segment(args, document, dataset)

            # Assert
            assert result == mock_segment
            mock_db_session.add.assert_called()
            mock_db_session.commit.assert_called()

    def test_create_segment_with_high_quality_indexing(self, mock_db_session, mock_current_user):
        """Test creation of segment with high quality indexing technique."""
        # Arrange
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock(indexing_technique="high_quality")
        args = {"content": "New segment content", "keywords": ["test"]}

        mock_query = MagicMock()
        mock_query.where.return_value.scalar.return_value = None
        mock_db_session.query.return_value = mock_query

        mock_embedding_model = MagicMock()
        mock_embedding_model.get_text_embedding_num_tokens.return_value = [10]
        mock_model_manager = MagicMock()
        mock_model_manager.get_model_instance.return_value = mock_embedding_model

        mock_segment = SegmentTestDataFactory.create_segment_mock()
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_segment

        with (
            patch("services.dataset_service.redis_client.lock") as mock_lock,
            patch("services.dataset_service.VectorService.create_segments_vector") as mock_vector_service,
            patch("services.dataset_service.ModelManager") as mock_model_manager_class,
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.naive_utc_now") as mock_now,
        ):
            mock_lock.return_value.__enter__ = Mock()
            mock_lock.return_value.__exit__ = Mock(return_value=None)
            mock_model_manager_class.return_value = mock_model_manager
            mock_hash.return_value = "hash-123"
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.create_segment(args, document, dataset)

            # Assert
            assert result == mock_segment
            mock_model_manager.get_model_instance.assert_called_once()
            mock_embedding_model.get_text_embedding_num_tokens.assert_called_once()

    def test_create_segment_vector_index_failure(self, mock_db_session, mock_current_user):
        """Test segment creation when vector indexing fails."""
        # Arrange
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock(indexing_technique="economy")
        args = {"content": "New segment content", "keywords": ["test"]}

        mock_query = MagicMock()
        mock_query.where.return_value.scalar.return_value = None
        mock_db_session.query.return_value = mock_query

        mock_segment = SegmentTestDataFactory.create_segment_mock(enabled=False, status="error")
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_segment

        with (
            patch("services.dataset_service.redis_client.lock") as mock_lock,
            patch("services.dataset_service.VectorService.create_segments_vector") as mock_vector_service,
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.naive_utc_now") as mock_now,
        ):
            mock_lock.return_value.__enter__ = Mock()
            mock_lock.return_value.__exit__ = Mock(return_value=None)
            mock_vector_service.side_effect = Exception("Vector indexing failed")
            mock_hash.return_value = "hash-123"
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.create_segment(args, document, dataset)

            # Assert
            assert result == mock_segment
            assert mock_db_session.commit.call_count == 2  # Once for creation, once for error update


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
        segment = SegmentTestDataFactory.create_segment_mock(enabled=True, word_count=10)
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock(indexing_technique="economy")
        args = SegmentUpdateArgs(content="Updated content", keywords=["updated"])

        mock_db_session.query.return_value.where.return_value.first.return_value = segment

        with (
            patch("services.dataset_service.redis_client.get") as mock_redis_get,
            patch("services.dataset_service.VectorService.update_segment_vector") as mock_vector_service,
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.naive_utc_now") as mock_now,
        ):
            mock_redis_get.return_value = None  # Not indexing
            mock_hash.return_value = "new-hash"
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.update_segment(args, segment, document, dataset)

            # Assert
            assert result == segment
            assert segment.content == "Updated content"
            assert segment.keywords == ["updated"]
            assert segment.word_count == len("Updated content")
            assert document.word_count == 100 + (len("Updated content") - 10)
            mock_db_session.add.assert_called()
            mock_db_session.commit.assert_called()

    def test_update_segment_disable(self, mock_db_session, mock_current_user):
        """Test disabling a segment."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=True)
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()
        args = SegmentUpdateArgs(enabled=False)

        with (
            patch("services.dataset_service.redis_client.get") as mock_redis_get,
            patch("services.dataset_service.redis_client.setex") as mock_redis_setex,
            patch("services.dataset_service.disable_segment_from_index_task") as mock_task,
            patch("services.dataset_service.naive_utc_now") as mock_now,
        ):
            mock_redis_get.return_value = None
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.update_segment(args, segment, document, dataset)

            # Assert
            assert result == segment
            assert segment.enabled is False
            mock_db_session.add.assert_called()
            mock_db_session.commit.assert_called()
            mock_task.delay.assert_called_once()

    def test_update_segment_indexing_in_progress(self, mock_db_session, mock_current_user):
        """Test update fails when segment is currently indexing."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=True)
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()
        args = SegmentUpdateArgs(content="Updated content")

        with patch("services.dataset_service.redis_client.get") as mock_redis_get:
            mock_redis_get.return_value = "1"  # Indexing in progress

            # Act & Assert
            with pytest.raises(ValueError, match="Segment is indexing"):
                SegmentService.update_segment(args, segment, document, dataset)

    def test_update_segment_disabled_segment(self, mock_db_session, mock_current_user):
        """Test update fails when segment is disabled."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=False)
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()
        args = SegmentUpdateArgs(content="Updated content")

        with patch("services.dataset_service.redis_client.get") as mock_redis_get:
            mock_redis_get.return_value = None

            # Act & Assert
            with pytest.raises(ValueError, match="Can't update disabled segment"):
                SegmentService.update_segment(args, segment, document, dataset)

    def test_update_segment_with_qa_model(self, mock_db_session, mock_current_user):
        """Test update segment with QA model (includes answer)."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=True, word_count=10)
        document = SegmentTestDataFactory.create_document_mock(doc_form="qa_model", word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock(indexing_technique="economy")
        args = SegmentUpdateArgs(content="Updated question", answer="Updated answer", keywords=["qa"])

        mock_db_session.query.return_value.where.return_value.first.return_value = segment

        with (
            patch("services.dataset_service.redis_client.get") as mock_redis_get,
            patch("services.dataset_service.VectorService.update_segment_vector") as mock_vector_service,
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
            patch("services.dataset_service.naive_utc_now") as mock_now,
        ):
            mock_redis_get.return_value = None
            mock_hash.return_value = "new-hash"
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.update_segment(args, segment, document, dataset)

            # Assert
            assert result == segment
            assert segment.content == "Updated question"
            assert segment.answer == "Updated answer"
            assert segment.keywords == ["qa"]
            new_word_count = len("Updated question") + len("Updated answer")
            assert segment.word_count == new_word_count
            assert document.word_count == 100 + (new_word_count - 10)
            mock_db_session.commit.assert_called()


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
        segment = SegmentTestDataFactory.create_segment_mock(enabled=True, word_count=50)
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock()

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_db_session.scalars.return_value = mock_scalars

        with (
            patch("services.dataset_service.redis_client.get") as mock_redis_get,
            patch("services.dataset_service.redis_client.setex") as mock_redis_setex,
            patch("services.dataset_service.delete_segment_from_index_task") as mock_task,
            patch("services.dataset_service.select") as mock_select,
        ):
            mock_redis_get.return_value = None
            mock_select.return_value.where.return_value = mock_select

            # Act
            SegmentService.delete_segment(segment, document, dataset)

            # Assert
            mock_db_session.delete.assert_called_once_with(segment)
            mock_db_session.commit.assert_called_once()
            mock_task.delay.assert_called_once()

    def test_delete_segment_disabled(self, mock_db_session):
        """Test deletion of disabled segment (no index deletion)."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=False, word_count=50)
        document = SegmentTestDataFactory.create_document_mock(word_count=100)
        dataset = SegmentTestDataFactory.create_dataset_mock()

        with (
            patch("services.dataset_service.redis_client.get") as mock_redis_get,
            patch("services.dataset_service.delete_segment_from_index_task") as mock_task,
        ):
            mock_redis_get.return_value = None

            # Act
            SegmentService.delete_segment(segment, document, dataset)

            # Assert
            mock_db_session.delete.assert_called_once_with(segment)
            mock_db_session.commit.assert_called_once()
            mock_task.delay.assert_not_called()

    def test_delete_segment_indexing_in_progress(self, mock_db_session):
        """Test deletion fails when segment is currently being deleted."""
        # Arrange
        segment = SegmentTestDataFactory.create_segment_mock(enabled=True)
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        with patch("services.dataset_service.redis_client.get") as mock_redis_get:
            mock_redis_get.return_value = "1"  # Deletion in progress

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
        document = SegmentTestDataFactory.create_document_mock(word_count=200)
        dataset = SegmentTestDataFactory.create_dataset_mock()

        segments_info = [
            ("node-1", "segment-1", 50),
            ("node-2", "segment-2", 30),
        ]

        mock_query = MagicMock()
        mock_query.with_entities.return_value.where.return_value.all.return_value = segments_info
        mock_db_session.query.return_value = mock_query

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_select = MagicMock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        with (
            patch("services.dataset_service.delete_segment_from_index_task") as mock_task,
            patch("services.dataset_service.select") as mock_select_func,
        ):
            mock_select_func.return_value = mock_select

            # Act
            SegmentService.delete_segments(segment_ids, document, dataset)

            # Assert
            mock_db_session.query.return_value.where.return_value.delete.assert_called_once()
            mock_db_session.commit.assert_called_once()
            mock_task.delay.assert_called_once()

    def test_delete_segments_empty_list(self, mock_db_session, mock_current_user):
        """Test deletion with empty list (should return early)."""
        # Arrange
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        # Act
        SegmentService.delete_segments([], document, dataset)

        # Assert
        mock_db_session.query.assert_not_called()


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

        with (
            patch("services.dataset_service.redis_client.get") as mock_redis_get,
            patch("services.dataset_service.enable_segments_to_index_task") as mock_task,
            patch("services.dataset_service.select") as mock_select_func,
        ):
            mock_redis_get.return_value = None
            mock_select_func.return_value = mock_select

            # Act
            SegmentService.update_segments_status(segment_ids, "enable", dataset, document)

            # Assert
            assert all(seg.enabled is True for seg in segments)
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

        with (
            patch("services.dataset_service.redis_client.get") as mock_redis_get,
            patch("services.dataset_service.disable_segments_from_index_task") as mock_task,
            patch("services.dataset_service.naive_utc_now") as mock_now,
            patch("services.dataset_service.select") as mock_select_func,
        ):
            mock_redis_get.return_value = None
            mock_now.return_value = "2024-01-01T00:00:00"
            mock_select_func.return_value = mock_select

            # Act
            SegmentService.update_segments_status(segment_ids, "disable", dataset, document)

            # Assert
            assert all(seg.enabled is False for seg in segments)
            mock_db_session.commit.assert_called_once()
            mock_task.delay.assert_called_once()

    def test_update_segments_status_empty_list(self, mock_db_session, mock_current_user):
        """Test update with empty list (should return early)."""
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

    @pytest.fixture
    def mock_current_user(self):
        """Mock current_user."""
        user = SegmentTestDataFactory.create_user_mock()
        with patch("services.dataset_service.current_user", user):
            yield user

    def test_get_segments_success(self, mock_db_session, mock_current_user):
        """Test successful retrieval of segments."""
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        segments = [
            SegmentTestDataFactory.create_segment_mock(segment_id="segment-1"),
            SegmentTestDataFactory.create_segment_mock(segment_id="segment-2"),
        ]

        mock_paginate = MagicMock()
        mock_paginate.items = segments
        mock_paginate.total = 2
        mock_db_session.paginate.return_value = mock_paginate

        # Act
        items, total = SegmentService.get_segments(document_id, tenant_id)

        # Assert
        assert len(items) == 2
        assert total == 2
        mock_db_session.paginate.assert_called_once()

    def test_get_segments_with_status_filter(self, mock_db_session, mock_current_user):
        """Test retrieval with status filter."""
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        status_list = ["completed", "error"]

        mock_paginate = MagicMock()
        mock_paginate.items = []
        mock_paginate.total = 0
        mock_db_session.paginate.return_value = mock_paginate

        # Act
        items, total = SegmentService.get_segments(document_id, tenant_id, status_list=status_list)

        # Assert
        assert len(items) == 0
        assert total == 0

    def test_get_segments_with_keyword(self, mock_db_session, mock_current_user):
        """Test retrieval with keyword search."""
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        keyword = "test"

        mock_paginate = MagicMock()
        mock_paginate.items = [SegmentTestDataFactory.create_segment_mock()]
        mock_paginate.total = 1
        mock_db_session.paginate.return_value = mock_paginate

        # Act
        items, total = SegmentService.get_segments(document_id, tenant_id, keyword=keyword)

        # Assert
        assert len(items) == 1
        assert total == 1


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

        mock_query = MagicMock()
        mock_query.where.return_value.first.return_value = segment
        mock_db_session.query.return_value = mock_query

        # Act
        result = SegmentService.get_segment_by_id(segment_id, tenant_id)

        # Assert
        assert result == segment

    def test_get_segment_by_id_not_found(self, mock_db_session):
        """Test retrieval when segment is not found."""
        # Arrange
        segment_id = "non-existent"
        tenant_id = "tenant-123"

        mock_query = MagicMock()
        mock_query.where.return_value.first.return_value = None
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
        page = 1
        limit = 20

        mock_paginate = MagicMock()
        mock_paginate.items = [
            SegmentTestDataFactory.create_child_chunk_mock(chunk_id="chunk-1"),
            SegmentTestDataFactory.create_child_chunk_mock(chunk_id="chunk-2"),
        ]
        mock_paginate.total = 2
        mock_db_session.paginate.return_value = mock_paginate

        # Act
        result = SegmentService.get_child_chunks(segment_id, document_id, dataset_id, page, limit)

        # Assert
        assert result == mock_paginate
        mock_db_session.paginate.assert_called_once()

    def test_get_child_chunks_with_keyword(self, mock_db_session, mock_current_user):
        """Test retrieval with keyword search."""
        # Arrange
        segment_id = "segment-123"
        document_id = "doc-123"
        dataset_id = "dataset-123"
        page = 1
        limit = 20
        keyword = "test"

        mock_paginate = MagicMock()
        mock_paginate.items = []
        mock_paginate.total = 0
        mock_db_session.paginate.return_value = mock_paginate

        # Act
        result = SegmentService.get_child_chunks(segment_id, document_id, dataset_id, page, limit, keyword=keyword)

        # Assert
        assert result == mock_paginate


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

        mock_query = MagicMock()
        mock_query.where.return_value.first.return_value = chunk
        mock_db_session.query.return_value = mock_query

        # Act
        result = SegmentService.get_child_chunk_by_id(chunk_id, tenant_id)

        # Assert
        assert result == chunk

    def test_get_child_chunk_by_id_not_found(self, mock_db_session):
        """Test retrieval when child chunk is not found."""
        # Arrange
        chunk_id = "non-existent"
        tenant_id = "tenant-123"

        mock_query = MagicMock()
        mock_query.where.return_value.first.return_value = None
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

    def test_create_child_chunk_success(self, mock_db_session, mock_current_user):
        """Test successful creation of a child chunk."""
        # Arrange
        content = "New child chunk content"
        segment = SegmentTestDataFactory.create_segment_mock()
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        mock_query = MagicMock()
        mock_query.where.return_value.scalar.return_value = None
        mock_db_session.query.return_value = mock_query

        with (
            patch("services.dataset_service.redis_client.lock") as mock_lock,
            patch("services.dataset_service.VectorService.create_child_chunk_vector") as mock_vector_service,
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
        ):
            mock_lock.return_value.__enter__ = Mock()
            mock_lock.return_value.__exit__ = Mock(return_value=None)
            mock_hash.return_value = "hash-123"

            # Act
            result = SegmentService.create_child_chunk(content, segment, document, dataset)

            # Assert
            assert result is not None
            mock_db_session.add.assert_called_once()
            mock_db_session.commit.assert_called_once()
            mock_vector_service.assert_called_once()

    def test_create_child_chunk_vector_index_failure(self, mock_db_session, mock_current_user):
        """Test child chunk creation when vector indexing fails."""
        # Arrange
        content = "New child chunk content"
        segment = SegmentTestDataFactory.create_segment_mock()
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        mock_query = MagicMock()
        mock_query.where.return_value.scalar.return_value = None
        mock_db_session.query.return_value = mock_query

        with (
            patch("services.dataset_service.redis_client.lock") as mock_lock,
            patch("services.dataset_service.VectorService.create_child_chunk_vector") as mock_vector_service,
            patch("services.dataset_service.helper.generate_text_hash") as mock_hash,
        ):
            mock_lock.return_value.__enter__ = Mock()
            mock_lock.return_value.__exit__ = Mock(return_value=None)
            mock_vector_service.side_effect = Exception("Vector indexing failed")
            mock_hash.return_value = "hash-123"

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
        content = "Updated child chunk content"
        chunk = SegmentTestDataFactory.create_child_chunk_mock()
        segment = SegmentTestDataFactory.create_segment_mock()
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        with (
            patch("services.dataset_service.VectorService.update_child_chunk_vector") as mock_vector_service,
            patch("services.dataset_service.naive_utc_now") as mock_now,
        ):
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = SegmentService.update_child_chunk(content, chunk, segment, document, dataset)

            # Assert
            assert result == chunk
            assert chunk.content == content
            assert chunk.word_count == len(content)
            mock_db_session.add.assert_called_once_with(chunk)
            mock_db_session.commit.assert_called_once()
            mock_vector_service.assert_called_once()

    def test_update_child_chunk_vector_index_failure(self, mock_db_session, mock_current_user):
        """Test child chunk update when vector indexing fails."""
        # Arrange
        content = "Updated content"
        chunk = SegmentTestDataFactory.create_child_chunk_mock()
        segment = SegmentTestDataFactory.create_segment_mock()
        document = SegmentTestDataFactory.create_document_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        with (
            patch("services.dataset_service.VectorService.update_child_chunk_vector") as mock_vector_service,
            patch("services.dataset_service.naive_utc_now") as mock_now,
        ):
            mock_vector_service.side_effect = Exception("Vector indexing failed")
            mock_now.return_value = "2024-01-01T00:00:00"

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

        with patch("services.dataset_service.VectorService.delete_child_chunk_vector") as mock_vector_service:
            # Act
            SegmentService.delete_child_chunk(chunk, dataset)

            # Assert
            mock_db_session.delete.assert_called_once_with(chunk)
            mock_db_session.commit.assert_called_once()
            mock_vector_service.assert_called_once_with(chunk, dataset)

    def test_delete_child_chunk_vector_index_failure(self, mock_db_session):
        """Test child chunk deletion when vector indexing fails."""
        # Arrange
        chunk = SegmentTestDataFactory.create_child_chunk_mock()
        dataset = SegmentTestDataFactory.create_dataset_mock()

        with patch("services.dataset_service.VectorService.delete_child_chunk_vector") as mock_vector_service:
            mock_vector_service.side_effect = Exception("Vector deletion failed")

            # Act & Assert
            with pytest.raises(ChildChunkDeleteIndexError):
                SegmentService.delete_child_chunk(chunk, dataset)

            mock_db_session.rollback.assert_called_once()
