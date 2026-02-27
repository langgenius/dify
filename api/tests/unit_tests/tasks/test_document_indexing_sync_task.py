"""
Unit tests for collaborator parameter wiring in document_indexing_sync_task.

These tests intentionally stay in unit scope because they validate call arguments
for external collaborators rather than SQL-backed state transitions.
"""

import uuid
from unittest.mock import MagicMock, Mock, patch

import pytest

from models.dataset import Dataset, Document
from tasks.document_indexing_sync_task import document_indexing_sync_task


@pytest.fixture
def dataset_id() -> str:
    """Generate a dataset id."""
    return str(uuid.uuid4())


@pytest.fixture
def document_id() -> str:
    """Generate a document id."""
    return str(uuid.uuid4())


@pytest.fixture
def notion_workspace_id() -> str:
    """Generate a notion workspace id."""
    return str(uuid.uuid4())


@pytest.fixture
def notion_page_id() -> str:
    """Generate a notion page id."""
    return str(uuid.uuid4())


@pytest.fixture
def credential_id() -> str:
    """Generate a credential id."""
    return str(uuid.uuid4())


@pytest.fixture
def mock_dataset(dataset_id):
    """Create a minimal dataset mock used by the task pre-check."""
    dataset = Mock(spec=Dataset)
    dataset.id = dataset_id
    return dataset


@pytest.fixture
def mock_document(document_id, dataset_id, notion_workspace_id, notion_page_id, credential_id):
    """Create a minimal notion document mock for collaborator parameter assertions."""
    document = Mock(spec=Document)
    document.id = document_id
    document.dataset_id = dataset_id
    document.tenant_id = str(uuid.uuid4())
    document.data_source_type = "notion_import"
    document.indexing_status = "completed"
    document.doc_form = "text_model"
    document.data_source_info_dict = {
        "notion_workspace_id": notion_workspace_id,
        "notion_page_id": notion_page_id,
        "type": "page",
        "last_edited_time": "2024-01-01T00:00:00Z",
        "credential_id": credential_id,
    }
    return document


@pytest.fixture
def mock_db_session(mock_document, mock_dataset):
    """Mock session_factory.create_session to drive deterministic read-only task flow."""
    with patch("tasks.document_indexing_sync_task.session_factory") as mock_session_factory:
        session = MagicMock()
        session.scalars.return_value.all.return_value = []
        session.query.return_value.where.return_value.first.side_effect = [mock_document, mock_dataset]

        begin_cm = MagicMock()
        begin_cm.__enter__.return_value = session
        begin_cm.__exit__.return_value = False
        session.begin.return_value = begin_cm

        session_cm = MagicMock()
        session_cm.__enter__.return_value = session
        session_cm.__exit__.return_value = False

        mock_session_factory.create_session.return_value = session_cm
        yield session


@pytest.fixture
def mock_datasource_provider_service():
    """Mock datasource credential provider."""
    with patch("tasks.document_indexing_sync_task.DatasourceProviderService") as mock_service_class:
        mock_service = MagicMock()
        mock_service.get_datasource_credentials.return_value = {"integration_secret": "test_token"}
        mock_service_class.return_value = mock_service
        yield mock_service


@pytest.fixture
def mock_notion_extractor():
    """Mock notion extractor class and instance."""
    with patch("tasks.document_indexing_sync_task.NotionExtractor") as mock_extractor_class:
        mock_extractor = MagicMock()
        mock_extractor.get_notion_last_edited_time.return_value = "2024-01-01T00:00:00Z"
        mock_extractor_class.return_value = mock_extractor
        yield {"class": mock_extractor_class, "instance": mock_extractor}


class TestDocumentIndexingSyncTaskCollaboratorParams:
    """Unit tests for collaborator parameter passing in document_indexing_sync_task."""

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
        """Test that NotionExtractor is initialized with expected arguments."""
        # Arrange
        expected_token = "test_token"

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        mock_notion_extractor["class"].assert_called_once_with(
            notion_workspace_id=notion_workspace_id,
            notion_obj_id=notion_page_id,
            notion_page_type="page",
            notion_access_token=expected_token,
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
        """Test that datasource credentials are requested with expected identifiers."""
        # Arrange
        expected_tenant_id = mock_document.tenant_id

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        mock_datasource_provider_service.get_datasource_credentials.assert_called_once_with(
            tenant_id=expected_tenant_id,
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
        """Test that missing credential_id is forwarded as None."""
        # Arrange
        mock_document.data_source_info_dict = {
            "notion_workspace_id": "workspace-id",
            "notion_page_id": "page-id",
            "type": "page",
            "last_edited_time": "2024-01-01T00:00:00Z",
        }

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        mock_datasource_provider_service.get_datasource_credentials.assert_called_once_with(
            tenant_id=mock_document.tenant_id,
            credential_id=None,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )
