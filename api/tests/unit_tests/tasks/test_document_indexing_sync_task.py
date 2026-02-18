"""
Unit tests for document indexing sync task.

This module tests the document indexing sync task functionality including:
- Syncing Notion documents when updated
- Validating document and data source existence
- Credential validation and retrieval
- Cleaning old segments before re-indexing
- Error handling and edge cases
"""

import uuid
from unittest.mock import MagicMock, Mock, patch

import pytest

from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from models.dataset import Dataset, Document, DocumentSegment
from tasks.document_indexing_sync_task import document_indexing_sync_task

# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def tenant_id():
    """Generate a unique tenant ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def dataset_id():
    """Generate a unique dataset ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def document_id():
    """Generate a unique document ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def notion_workspace_id():
    """Generate a Notion workspace ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def notion_page_id():
    """Generate a Notion page ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def credential_id():
    """Generate a credential ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def mock_dataset(dataset_id, tenant_id):
    """Create a mock Dataset object."""
    dataset = Mock(spec=Dataset)
    dataset.id = dataset_id
    dataset.tenant_id = tenant_id
    dataset.indexing_technique = "high_quality"
    dataset.embedding_model_provider = "openai"
    dataset.embedding_model = "text-embedding-ada-002"
    return dataset


@pytest.fixture
def mock_document(document_id, dataset_id, tenant_id, notion_workspace_id, notion_page_id, credential_id):
    """Create a mock Document object with Notion data source."""
    doc = Mock(spec=Document)
    doc.id = document_id
    doc.dataset_id = dataset_id
    doc.tenant_id = tenant_id
    doc.data_source_type = "notion_import"
    doc.indexing_status = "completed"
    doc.error = None
    doc.stopped_at = None
    doc.processing_started_at = None
    doc.doc_form = "text_model"
    doc.data_source_info_dict = {
        "notion_workspace_id": notion_workspace_id,
        "notion_page_id": notion_page_id,
        "type": "page",
        "last_edited_time": "2024-01-01T00:00:00Z",
        "credential_id": credential_id,
    }
    return doc


@pytest.fixture
def mock_document_segments(document_id):
    """Create mock DocumentSegment objects."""
    segments = []
    for i in range(3):
        segment = Mock(spec=DocumentSegment)
        segment.id = str(uuid.uuid4())
        segment.document_id = document_id
        segment.index_node_id = f"node-{document_id}-{i}"
        segments.append(segment)
    return segments


@pytest.fixture
def mock_db_session():
    """Mock database session via session_factory.create_session().

    After session split refactor, the code calls create_session() multiple times.
    This fixture creates shared query mocks so all sessions use the same
    query configuration, simulating database persistence across sessions.

    The fixture automatically converts side_effect to cycle to prevent StopIteration.
    Tests configure mocks the same way as before, but behind the scenes the values
    are cycled infinitely for all sessions.
    """
    from itertools import cycle

    with patch("tasks.document_indexing_sync_task.session_factory") as mock_sf:
        sessions = []

        # Shared query mocks - all sessions use these
        shared_query = MagicMock()
        shared_filter_by = MagicMock()
        shared_scalars_result = MagicMock()

        # Create custom first mock that auto-cycles side_effect
        class CyclicMock(MagicMock):
            def __setattr__(self, name, value):
                if name == "side_effect" and value is not None:
                    # Convert list/tuple to infinite cycle
                    if isinstance(value, (list, tuple)):
                        value = cycle(value)
                super().__setattr__(name, value)

        shared_query.where.return_value.first = CyclicMock()
        shared_filter_by.first = CyclicMock()

        def _create_session():
            """Create a new mock session for each create_session() call."""
            session = MagicMock()
            session.close = MagicMock()
            session.commit = MagicMock()

            # Mock session.begin() context manager
            begin_cm = MagicMock()
            begin_cm.__enter__.return_value = session

            def _begin_exit_side_effect(exc_type, exc, tb):
                # commit on success
                if exc_type is None:
                    session.commit()
                # return False to propagate exceptions
                return False

            begin_cm.__exit__.side_effect = _begin_exit_side_effect
            session.begin.return_value = begin_cm

            # Mock create_session() context manager
            cm = MagicMock()
            cm.__enter__.return_value = session

            def _exit_side_effect(exc_type, exc, tb):
                session.close()
                return False

            cm.__exit__.side_effect = _exit_side_effect

            # All sessions use the same shared query mocks
            session.query.return_value = shared_query
            shared_query.where.return_value = shared_query
            shared_query.filter_by.return_value = shared_filter_by
            session.scalars.return_value = shared_scalars_result

            sessions.append(session)
            # Attach helpers on the first created session for assertions across all sessions
            if len(sessions) == 1:
                session.get_all_sessions = lambda: sessions
                session.any_close_called = lambda: any(s.close.called for s in sessions)
                session.any_commit_called = lambda: any(s.commit.called for s in sessions)
            return cm

        mock_sf.create_session.side_effect = _create_session

        # Create first session and return it
        _create_session()
        yield sessions[0]


@pytest.fixture
def mock_datasource_provider_service():
    """Mock DatasourceProviderService."""
    with patch("tasks.document_indexing_sync_task.DatasourceProviderService") as mock_service_class:
        mock_service = MagicMock()
        mock_service.get_datasource_credentials.return_value = {"integration_secret": "test_token"}
        mock_service_class.return_value = mock_service
        yield mock_service


@pytest.fixture
def mock_notion_extractor():
    """Mock NotionExtractor."""
    with patch("tasks.document_indexing_sync_task.NotionExtractor") as mock_extractor_class:
        mock_extractor = MagicMock()
        mock_extractor.get_notion_last_edited_time.return_value = "2024-01-02T00:00:00Z"  # Updated time
        mock_extractor_class.return_value = mock_extractor
        yield mock_extractor


@pytest.fixture
def mock_index_processor_factory():
    """Mock IndexProcessorFactory."""
    with patch("tasks.document_indexing_sync_task.IndexProcessorFactory") as mock_factory:
        mock_processor = MagicMock()
        mock_processor.clean = Mock()
        mock_factory.return_value.init_index_processor.return_value = mock_processor
        yield mock_factory


@pytest.fixture
def mock_indexing_runner():
    """Mock IndexingRunner."""
    with patch("tasks.document_indexing_sync_task.IndexingRunner") as mock_runner_class:
        mock_runner = MagicMock(spec=IndexingRunner)
        mock_runner.run = Mock()
        mock_runner_class.return_value = mock_runner
        yield mock_runner


# ============================================================================
# Tests for document_indexing_sync_task
# ============================================================================


class TestDocumentIndexingSyncTask:
    """Tests for the document_indexing_sync_task function."""

    def test_document_not_found(self, mock_db_session, dataset_id, document_id):
        """Test that task handles document not found gracefully."""
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = None

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert - at least one session should have been closed
        assert mock_db_session.any_close_called()

    def test_missing_notion_workspace_id(self, mock_db_session, mock_document, dataset_id, document_id):
        """Test that task raises error when notion_workspace_id is missing."""
        # Arrange
        mock_document.data_source_info_dict = {"notion_page_id": "page123", "type": "page"}
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_document

        # Act & Assert
        with pytest.raises(ValueError, match="no notion page found"):
            document_indexing_sync_task(dataset_id, document_id)

    def test_missing_notion_page_id(self, mock_db_session, mock_document, dataset_id, document_id):
        """Test that task raises error when notion_page_id is missing."""
        # Arrange
        mock_document.data_source_info_dict = {"notion_workspace_id": "ws123", "type": "page"}
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_document

        # Act & Assert
        with pytest.raises(ValueError, match="no notion page found"):
            document_indexing_sync_task(dataset_id, document_id)

    def test_empty_data_source_info(self, mock_db_session, mock_document, dataset_id, document_id):
        """Test that task raises error when data_source_info is empty."""
        # Arrange
        mock_document.data_source_info_dict = None
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_document

        # Act & Assert
        with pytest.raises(ValueError, match="no notion page found"):
            document_indexing_sync_task(dataset_id, document_id)

    def test_credential_not_found(
        self,
        mock_db_session,
        mock_datasource_provider_service,
        mock_document,
        dataset_id,
        document_id,
    ):
        """Test that task handles missing credentials by updating document status."""
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_document
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = mock_document
        mock_datasource_provider_service.get_datasource_credentials.return_value = None

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        assert mock_document.indexing_status == "error"
        assert "Datasource credential not found" in mock_document.error
        assert mock_document.stopped_at is not None
        assert mock_db_session.any_commit_called()
        assert mock_db_session.any_close_called()

    def test_page_not_updated(
        self,
        mock_db_session,
        mock_datasource_provider_service,
        mock_notion_extractor,
        mock_document,
        dataset_id,
        document_id,
    ):
        """Test that task does nothing when page has not been updated."""
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_document
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = mock_document
        # Return same time as stored in document
        mock_notion_extractor.get_notion_last_edited_time.return_value = "2024-01-01T00:00:00Z"

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        # Document status should remain unchanged
        assert mock_document.indexing_status == "completed"
        # At least one session should have been closed via context manager teardown
        assert mock_db_session.any_close_called()

    def test_successful_sync_when_page_updated(
        self,
        mock_db_session,
        mock_datasource_provider_service,
        mock_notion_extractor,
        mock_index_processor_factory,
        mock_indexing_runner,
        mock_dataset,
        mock_document,
        mock_document_segments,
        dataset_id,
        document_id,
    ):
        """Test successful sync flow when Notion page has been updated."""
        # Arrange
        # Set exact sequence of returns across calls to `.first()`:
        # 1) document (initial fetch)
        # 2) dataset (pre-check)
        # 3) dataset (cleaning phase)
        # 4) document (pre-indexing update)
        # 5) document (indexing runner fetch)
        mock_db_session.query.return_value.where.return_value.first.side_effect = [
            mock_document,
            mock_dataset,
            mock_dataset,
            mock_document,
            mock_document,
        ]
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = mock_document
        mock_db_session.scalars.return_value.all.return_value = mock_document_segments
        # NotionExtractor returns updated time
        mock_notion_extractor.get_notion_last_edited_time.return_value = "2024-01-02T00:00:00Z"

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        # Verify document status was updated to parsing
        assert mock_document.indexing_status == "parsing"
        assert mock_document.processing_started_at is not None

        # Verify segments were cleaned
        mock_processor = mock_index_processor_factory.return_value.init_index_processor.return_value
        mock_processor.clean.assert_called_once()

        # Verify segments were deleted from database in batch (DELETE FROM document_segments)
        # Aggregate execute calls across all created sessions
        execute_sqls = []
        for s in mock_db_session.get_all_sessions():
            execute_sqls.extend([" ".join(str(c[0][0]).split()) for c in s.execute.call_args_list])
        assert any("DELETE FROM document_segments" in sql for sql in execute_sqls)

        # Verify indexing runner was called
        mock_indexing_runner.run.assert_called_once_with([mock_document])

        # Verify session operations (across any created session)
        assert mock_db_session.any_commit_called()
        assert mock_db_session.any_close_called()

    def test_dataset_not_found_during_cleaning(
        self,
        mock_db_session,
        mock_datasource_provider_service,
        mock_notion_extractor,
        mock_indexing_runner,
        mock_document,
        dataset_id,
        document_id,
    ):
        """Test that task handles dataset not found during cleaning phase."""
        # Arrange
        # Sequence: document (initial), dataset (pre-check), None (cleaning), document (update), document (indexing)
        mock_db_session.query.return_value.where.return_value.first.side_effect = [
            mock_document,
            mock_dataset,
            None,
            mock_document,
            mock_document,
        ]
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = mock_document
        mock_notion_extractor.get_notion_last_edited_time.return_value = "2024-01-02T00:00:00Z"

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        # Document should still be set to parsing
        assert mock_document.indexing_status == "parsing"
        # At least one session should be closed after error
        assert mock_db_session.any_close_called()

    def test_cleaning_error_continues_to_indexing(
        self,
        mock_db_session,
        mock_datasource_provider_service,
        mock_notion_extractor,
        mock_index_processor_factory,
        mock_indexing_runner,
        mock_dataset,
        mock_document,
        dataset_id,
        document_id,
    ):
        """Test that indexing continues even if cleaning fails."""
        # Arrange
        from itertools import cycle

        mock_db_session.query.return_value.where.return_value.first.side_effect = cycle([mock_document, mock_dataset])
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = mock_document
        # Make the cleaning step fail but not the segment fetch
        processor = mock_index_processor_factory.return_value.init_index_processor.return_value
        processor.clean.side_effect = Exception("Cleaning error")
        mock_db_session.scalars.return_value.all.return_value = []
        mock_notion_extractor.get_notion_last_edited_time.return_value = "2024-01-02T00:00:00Z"

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        # Indexing should still be attempted despite cleaning error
        mock_indexing_runner.run.assert_called_once_with([mock_document])
        assert mock_db_session.any_close_called()

    def test_indexing_runner_document_paused_error(
        self,
        mock_db_session,
        mock_datasource_provider_service,
        mock_notion_extractor,
        mock_index_processor_factory,
        mock_indexing_runner,
        mock_dataset,
        mock_document,
        mock_document_segments,
        dataset_id,
        document_id,
    ):
        """Test that DocumentIsPausedError is handled gracefully."""
        # Arrange
        from itertools import cycle

        mock_db_session.query.return_value.where.return_value.first.side_effect = cycle([mock_document, mock_dataset])
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = mock_document
        mock_db_session.scalars.return_value.all.return_value = mock_document_segments
        mock_notion_extractor.get_notion_last_edited_time.return_value = "2024-01-02T00:00:00Z"
        mock_indexing_runner.run.side_effect = DocumentIsPausedError("Document paused")

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        # Session should be closed after handling error
        assert mock_db_session.any_close_called()

    def test_indexing_runner_general_error(
        self,
        mock_db_session,
        mock_datasource_provider_service,
        mock_notion_extractor,
        mock_index_processor_factory,
        mock_indexing_runner,
        mock_dataset,
        mock_document,
        mock_document_segments,
        dataset_id,
        document_id,
    ):
        """Test that general exceptions during indexing are handled."""
        # Arrange
        from itertools import cycle

        mock_db_session.query.return_value.where.return_value.first.side_effect = cycle([mock_document, mock_dataset])
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = mock_document
        mock_db_session.scalars.return_value.all.return_value = mock_document_segments
        mock_notion_extractor.get_notion_last_edited_time.return_value = "2024-01-02T00:00:00Z"
        mock_indexing_runner.run.side_effect = Exception("Indexing error")

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        # Session should be closed after error
        assert mock_db_session.any_close_called()

    def test_notion_extractor_initialized_with_correct_params(
        self,
        mock_db_session,
        mock_datasource_provider_service,
        mock_notion_extractor,
        mock_document,
        dataset_id,
        document_id,
        notion_workspace_id,
        notion_page_id,
    ):
        """Test that NotionExtractor is initialized with correct parameters."""
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_document
        mock_notion_extractor.get_notion_last_edited_time.return_value = "2024-01-01T00:00:00Z"  # No update

        # Act
        with patch("tasks.document_indexing_sync_task.NotionExtractor") as mock_extractor_class:
            mock_extractor = MagicMock()
            mock_extractor.get_notion_last_edited_time.return_value = "2024-01-01T00:00:00Z"
            mock_extractor_class.return_value = mock_extractor

            document_indexing_sync_task(dataset_id, document_id)

            # Assert
            mock_extractor_class.assert_called_once_with(
                notion_workspace_id=notion_workspace_id,
                notion_obj_id=notion_page_id,
                notion_page_type="page",
                notion_access_token="test_token",
                tenant_id=mock_document.tenant_id,
            )

    def test_datasource_credentials_requested_correctly(
        self,
        mock_db_session,
        mock_datasource_provider_service,
        mock_notion_extractor,
        mock_document,
        dataset_id,
        document_id,
        credential_id,
    ):
        """Test that datasource credentials are requested with correct parameters."""
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_document
        mock_notion_extractor.get_notion_last_edited_time.return_value = "2024-01-01T00:00:00Z"

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        mock_datasource_provider_service.get_datasource_credentials.assert_called_once_with(
            tenant_id=mock_document.tenant_id,
            credential_id=credential_id,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )

    def test_credential_id_missing_uses_none(
        self,
        mock_db_session,
        mock_datasource_provider_service,
        mock_notion_extractor,
        mock_document,
        dataset_id,
        document_id,
    ):
        """Test that task handles missing credential_id by passing None."""
        # Arrange
        mock_document.data_source_info_dict = {
            "notion_workspace_id": "ws123",
            "notion_page_id": "page123",
            "type": "page",
            "last_edited_time": "2024-01-01T00:00:00Z",
        }
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_document
        mock_notion_extractor.get_notion_last_edited_time.return_value = "2024-01-01T00:00:00Z"

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        mock_datasource_provider_service.get_datasource_credentials.assert_called_once_with(
            tenant_id=mock_document.tenant_id,
            credential_id=None,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )

    def test_index_processor_clean_called_with_correct_params(
        self,
        mock_db_session,
        mock_datasource_provider_service,
        mock_notion_extractor,
        mock_index_processor_factory,
        mock_indexing_runner,
        mock_dataset,
        mock_document,
        mock_document_segments,
        dataset_id,
        document_id,
    ):
        """Test that index processor clean is called with correct parameters."""
        # Arrange
        # Sequence: document (initial), dataset (pre-check), dataset (cleaning), document (update), document (indexing)
        mock_db_session.query.return_value.where.return_value.first.side_effect = [
            mock_document,
            mock_dataset,
            mock_dataset,
            mock_document,
            mock_document,
        ]
        mock_db_session.scalars.return_value.all.return_value = mock_document_segments
        mock_notion_extractor.get_notion_last_edited_time.return_value = "2024-01-02T00:00:00Z"

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        mock_processor = mock_index_processor_factory.return_value.init_index_processor.return_value
        expected_node_ids = [seg.index_node_id for seg in mock_document_segments]
        mock_processor.clean.assert_called_once_with(
            mock_dataset, expected_node_ids, with_keywords=True, delete_child_chunks=True
        )
