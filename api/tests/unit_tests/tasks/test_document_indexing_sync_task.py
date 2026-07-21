"""Unit tests for document sync persistence and external collaborator wiring.

The task's Dataset and Document lookups use real SQLite transactions. Datasource,
Notion extraction, index cleanup, and indexing remain mocked I/O boundaries.
"""

import json
import uuid
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.db import session_factory as session_factory_module
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from tasks.document_indexing_sync_task import document_indexing_sync_task

pytestmark = pytest.mark.parametrize(
    "sqlite_session",
    [(Dataset, Document, DocumentSegment)],
    indirect=True,
)


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
def tenant_id() -> str:
    """Generate the tenant that owns the persisted dataset and document."""
    return str(uuid.uuid4())


@pytest.fixture
def dataset(sqlite_session: Session, dataset_id: str, tenant_id: str) -> Dataset:
    """Persist the dataset resolved by the task's initial and cleanup transactions."""
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Notion dataset",
        data_source_type=DataSourceType.NOTION_IMPORT,
        created_by=str(uuid.uuid4()),
    )
    sqlite_session.add(dataset)
    sqlite_session.commit()
    return dataset


@pytest.fixture
def document(
    sqlite_session: Session,
    dataset: Dataset,
    document_id: str,
    tenant_id: str,
    notion_workspace_id: str,
    notion_page_id: str,
    credential_id: str,
) -> Document:
    """Persist a completed Notion document for collaborator and update assertions."""
    document = Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.NOTION_IMPORT,
        data_source_info=json.dumps(
            {
                "notion_workspace_id": notion_workspace_id,
                "notion_page_id": notion_page_id,
                "type": "page",
                "last_edited_time": "2024-01-01T00:00:00Z",
                "credential_id": credential_id,
            }
        ),
        batch="batch-1",
        name="Notion page",
        created_from=DocumentCreatedFrom.API,
        created_by=str(uuid.uuid4()),
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add(document)
    sqlite_session.commit()
    return document


@pytest.fixture(autouse=True)
def _bind_sqlite_session_factory(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    """Bind each task-owned session to the test's isolated SQLite database."""
    monkeypatch.setattr(
        session_factory_module,
        "_session_maker",
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
    )


@pytest.fixture
def mock_datasource_provider_service():
    """Mock datasource credential provider."""
    with patch("tasks.document_indexing_sync_task.DatasourceProviderService", autospec=True) as mock_service_class:
        mock_service = MagicMock()
        mock_service.get_datasource_credentials.return_value = {"integration_secret": "test_token"}
        mock_service_class.return_value = mock_service
        yield mock_service


@pytest.fixture
def mock_notion_extractor():
    """Mock notion extractor class and instance."""
    with patch("tasks.document_indexing_sync_task.NotionExtractor", autospec=True) as mock_extractor_class:
        mock_extractor = MagicMock()
        mock_extractor.get_notion_last_edited_time.return_value = "2024-01-01T00:00:00Z"
        mock_extractor_class.return_value = mock_extractor
        yield {"class": mock_extractor_class, "instance": mock_extractor}


class TestDocumentIndexingSyncTaskCollaboratorParams:
    """Unit tests for collaborator parameter passing in document_indexing_sync_task."""

    def test_notion_extractor_initialized_with_correct_params(
        self,
        mock_datasource_provider_service,
        mock_notion_extractor,
        document: Document,
        dataset_id: str,
        document_id: str,
        notion_workspace_id: str,
        notion_page_id: str,
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
            tenant_id=document.tenant_id,
        )

    def test_datasource_credentials_requested_correctly(
        self,
        mock_datasource_provider_service,
        mock_notion_extractor,
        document: Document,
        dataset_id: str,
        document_id: str,
        credential_id: str,
    ):
        """Test that datasource credentials are requested with expected identifiers."""
        # Arrange
        expected_tenant_id = document.tenant_id

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
        mock_datasource_provider_service,
        mock_notion_extractor,
        document: Document,
        sqlite_session: Session,
        dataset_id: str,
        document_id: str,
    ):
        """Test that missing credential_id is forwarded as None."""
        # Arrange
        document.data_source_info = json.dumps(
            {
                "notion_workspace_id": "workspace-id",
                "notion_page_id": "page-id",
                "type": "page",
                "last_edited_time": "2024-01-01T00:00:00Z",
            }
        )
        sqlite_session.commit()

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        mock_datasource_provider_service.get_datasource_credentials.assert_called_once_with(
            tenant_id=document.tenant_id,
            credential_id=None,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )


class TestDataSourceInfoSerialization:
    """Regression test: data_source_info must be written as a JSON string, not a raw dict.

    See https://github.com/langgenius/dify/issues/32705
    psycopg2 raises ``ProgrammingError: can't adapt type 'dict'`` when a Python
    dict is passed directly to a text/LongText column.
    """

    def test_data_source_info_serialized_as_json_string(
        self,
        document: Document,
        sqlite_session: Session,
        dataset_id: str,
        document_id: str,
    ):
        """data_source_info must be serialized with json.dumps before DB write."""
        with (
            patch("tasks.document_indexing_sync_task.DatasourceProviderService") as mock_service_class,
            patch("tasks.document_indexing_sync_task.NotionExtractor") as mock_extractor_class,
            patch("tasks.document_indexing_sync_task.IndexProcessorFactory") as mock_ipf,
            patch("tasks.document_indexing_sync_task.IndexingRunner") as mock_runner_class,
        ):
            # External collaborators
            mock_service = MagicMock()
            mock_service.get_datasource_credentials.return_value = {"integration_secret": "token"}
            mock_service_class.return_value = mock_service

            mock_extractor = MagicMock()
            # Return a *different* timestamp so the task enters the sync/update branch
            mock_extractor.get_notion_last_edited_time.return_value = "2024-02-01T00:00:00Z"
            mock_extractor_class.return_value = mock_extractor

            mock_ip = MagicMock()
            mock_ipf.return_value.init_index_processor.return_value = mock_ip

            mock_runner = MagicMock()
            mock_runner_class.return_value = mock_runner

            # Act
            document_indexing_sync_task(dataset_id, document_id)

            # Assert: data_source_info must be a JSON *string*, not a dict
            sqlite_session.expire_all()
            stored_document = sqlite_session.get(Document, document.id)
            assert stored_document is not None
            assert isinstance(stored_document.data_source_info, str), (
                f"data_source_info should be a JSON string, got {type(stored_document.data_source_info).__name__}"
            )
            parsed = json.loads(stored_document.data_source_info)
            assert parsed["last_edited_time"] == "2024-02-01T00:00:00Z"
            assert stored_document.indexing_status == IndexingStatus.PARSING
            assert stored_document.processing_started_at is not None
