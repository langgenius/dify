from collections.abc import Sequence
from unittest.mock import Mock, patch

import pytest
from werkzeug.exceptions import NotFound

from models.account import Account
from models.dataset import Dataset, Document, UploadFile
from services.dataset_service import DocumentService
from services.errors.file import FileNotExistsError


class DocumentTestDataFactory:
    """Factory class for creating test data and mock objects for document service tests."""

    @staticmethod
    def create_document_mock(
        document_id: str = "doc-123",
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        name: str = "test_document.pdf",
        indexing_status: str = "completed",
        enabled: bool = True,
        archived: bool = False,
        data_source_type: str = "upload_file",
        position: int = 1,
        batch: str = "batch-123",
        **kwargs,
    ) -> Mock:
        """Create a mock document with specified attributes."""
        document = Mock(spec=Document)
        document.id = document_id
        document.dataset_id = dataset_id
        document.tenant_id = tenant_id
        document.name = name
        document.indexing_status = indexing_status
        document.enabled = enabled
        document.archived = archived
        document.data_source_type = data_source_type
        document.position = position
        document.batch = batch
        document.data_source_info = '{"upload_file_id": "file-123"}'
        document.data_source_info_dict = {"upload_file_id": "file-123"}
        document.display_status = "available"
        for key, value in kwargs.items():
            setattr(document, key, value)
        return document

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        doc_form: str = "text_model",
        **kwargs,
    ) -> Mock:
        """Create a mock dataset with specified attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.doc_form = doc_form
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

    @staticmethod
    def create_upload_file_mock(
        file_id: str = "file-123",
        name: str = "test_file.pdf",
        tenant_id: str = "tenant-123",
    ) -> Mock:
        """Create a mock upload file."""
        upload_file = Mock(spec=UploadFile)
        upload_file.id = file_id
        upload_file.name = name
        upload_file.tenant_id = tenant_id
        return upload_file


class TestDocumentServiceGetDocument:
    """Tests for DocumentService.get_document method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_document_with_id_success(self, mock_db_session):
        """Test successful retrieval of document by dataset_id and document_id."""
        # Arrange
        dataset_id = "dataset-123"
        document_id = "doc-123"
        document = DocumentTestDataFactory.create_document_mock(document_id=document_id, dataset_id=dataset_id)

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = document
        mock_db_session.query.return_value = mock_query

        # Act
        result = DocumentService.get_document(dataset_id, document_id)

        # Assert
        assert result == document
        mock_db_session.query.assert_called_once_with(Document)
        mock_query.where.assert_called_once()

    def test_get_document_with_id_not_found(self, mock_db_session):
        """Test retrieval when document is not found."""
        # Arrange
        dataset_id = "dataset-123"
        document_id = "doc-123"

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act
        result = DocumentService.get_document(dataset_id, document_id)

        # Assert
        assert result is None

    def test_get_document_without_id_returns_none(self, mock_db_session):
        """Test that get_document returns None when document_id is not provided."""
        # Arrange
        dataset_id = "dataset-123"

        # Act
        result = DocumentService.get_document(dataset_id, None)

        # Assert
        assert result is None
        mock_db_session.query.assert_not_called()


class TestDocumentServiceGetDocumentById:
    """Tests for DocumentService.get_document_by_id method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_document_by_id_success(self, mock_db_session):
        """Test successful retrieval of document by id."""
        # Arrange
        document_id = "doc-123"
        document = DocumentTestDataFactory.create_document_mock(document_id=document_id)

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = document
        mock_db_session.query.return_value = mock_query

        # Act
        result = DocumentService.get_document_by_id(document_id)

        # Assert
        assert result == document
        mock_db_session.query.assert_called_once_with(Document)

    def test_get_document_by_id_not_found(self, mock_db_session):
        """Test retrieval when document is not found."""
        # Arrange
        document_id = "doc-123"

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act
        result = DocumentService.get_document_by_id(document_id)

        # Assert
        assert result is None


class TestDocumentServiceGetDocumentByIds:
    """Tests for DocumentService.get_document_by_ids method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_document_by_ids_success(self, mock_db_session):
        """Test successful bulk retrieval of documents by ids."""
        # Arrange
        document_ids = ["doc-123", "doc-456", "doc-789"]
        documents = [DocumentTestDataFactory.create_document_mock(document_id=doc_id) for doc_id in document_ids]

        mock_scalars = Mock()
        mock_scalars.all.return_value = documents
        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            result = DocumentService.get_document_by_ids(document_ids)

            # Assert
            assert isinstance(result, Sequence)
            assert len(result) == 3
            assert set(result) == set(documents)
            mock_db_session.scalars.assert_called_once()

    def test_get_document_by_ids_empty_list(self, mock_db_session):
        """Test retrieval with empty list returns empty sequence."""
        # Arrange
        document_ids = []

        mock_scalars = Mock()
        mock_scalars.all.return_value = []
        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            result = DocumentService.get_document_by_ids(document_ids)

            # Assert
            assert isinstance(result, Sequence)
            assert len(result) == 0


class TestDocumentServiceGetDocumentByDatasetId:
    """Tests for DocumentService.get_document_by_dataset_id method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_document_by_dataset_id_success(self, mock_db_session):
        """Test successful retrieval of documents by dataset_id."""
        # Arrange
        dataset_id = "dataset-123"
        documents = [
            DocumentTestDataFactory.create_document_mock(document_id=f"doc-{i}", dataset_id=dataset_id, enabled=True)
            for i in range(3)
        ]

        mock_scalars = Mock()
        mock_scalars.all.return_value = documents
        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            result = DocumentService.get_document_by_dataset_id(dataset_id)

            # Assert
            assert isinstance(result, Sequence)
            assert len(result) == 3
            assert all(doc in result for doc in documents)

    def test_get_document_by_dataset_id_empty(self, mock_db_session):
        """Test retrieval when no documents exist for dataset."""
        # Arrange
        dataset_id = "dataset-123"

        mock_scalars = Mock()
        mock_scalars.all.return_value = []
        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            result = DocumentService.get_document_by_dataset_id(dataset_id)

            # Assert
            assert isinstance(result, Sequence)
            assert len(result) == 0


class TestDocumentServiceGetWorkingDocumentsByDatasetId:
    """Tests for DocumentService.get_working_documents_by_dataset_id method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_working_documents_by_dataset_id_success(self, mock_db_session):
        """Test successful retrieval of working documents (completed, enabled, not archived)."""
        # Arrange
        dataset_id = "dataset-123"
        documents = [
            DocumentTestDataFactory.create_document_mock(
                document_id=f"doc-{i}",
                dataset_id=dataset_id,
                indexing_status="completed",
                enabled=True,
                archived=False,
            )
            for i in range(2)
        ]

        mock_scalars = Mock()
        mock_scalars.all.return_value = documents
        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            result = DocumentService.get_working_documents_by_dataset_id(dataset_id)

            # Assert
            assert isinstance(result, Sequence)
            assert len(result) == 2
            assert all(doc.indexing_status == "completed" for doc in result)
            assert all(doc.enabled is True for doc in result)
            assert all(doc.archived is False for doc in result)

    def test_get_working_documents_by_dataset_id_empty(self, mock_db_session):
        """Test retrieval when no working documents exist."""
        # Arrange
        dataset_id = "dataset-123"

        mock_scalars = Mock()
        mock_scalars.all.return_value = []
        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            result = DocumentService.get_working_documents_by_dataset_id(dataset_id)

            # Assert
            assert isinstance(result, Sequence)
            assert len(result) == 0


class TestDocumentServiceGetErrorDocumentsByDatasetId:
    """Tests for DocumentService.get_error_documents_by_dataset_id method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_error_documents_by_dataset_id_success(self, mock_db_session):
        """Test successful retrieval of error documents (error or paused status)."""
        # Arrange
        dataset_id = "dataset-123"
        error_doc = DocumentTestDataFactory.create_document_mock(
            document_id="doc-error",
            dataset_id=dataset_id,
            indexing_status="error",
        )
        paused_doc = DocumentTestDataFactory.create_document_mock(
            document_id="doc-paused",
            dataset_id=dataset_id,
            indexing_status="paused",
        )
        documents = [error_doc, paused_doc]

        mock_scalars = Mock()
        mock_scalars.all.return_value = documents
        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            result = DocumentService.get_error_documents_by_dataset_id(dataset_id)

            # Assert
            assert isinstance(result, Sequence)
            assert len(result) == 2
            assert any(doc.indexing_status == "error" for doc in result)
            assert any(doc.indexing_status == "paused" for doc in result)

    def test_get_error_documents_by_dataset_id_empty(self, mock_db_session):
        """Test retrieval when no error documents exist."""
        # Arrange
        dataset_id = "dataset-123"

        mock_scalars = Mock()
        mock_scalars.all.return_value = []
        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            result = DocumentService.get_error_documents_by_dataset_id(dataset_id)

            # Assert
            assert isinstance(result, Sequence)
            assert len(result) == 0


class TestDocumentServiceGetBatchDocuments:
    """Tests for DocumentService.get_batch_documents method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """Mock current_user."""
        user = DocumentTestDataFactory.create_user_mock()
        with patch("services.dataset_service.current_user", user):
            yield user

    def test_get_batch_documents_success(self, mock_db_session, mock_current_user):
        """Test successful retrieval of documents by batch."""
        # Arrange
        dataset_id = "dataset-123"
        batch = "batch-123"
        tenant_id = mock_current_user.current_tenant_id
        documents = [
            DocumentTestDataFactory.create_document_mock(
                document_id=f"doc-{i}", dataset_id=dataset_id, batch=batch, tenant_id=tenant_id
            )
            for i in range(2)
        ]

        mock_scalars = Mock()
        mock_scalars.all.return_value = documents
        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            result = DocumentService.get_batch_documents(dataset_id, batch)

            # Assert
            assert isinstance(result, Sequence)
            assert len(result) == 2
            assert all(doc.batch == batch for doc in result)
            assert all(doc.dataset_id == dataset_id for doc in result)
            assert all(doc.tenant_id == tenant_id for doc in result)

    def test_get_batch_documents_empty(self, mock_db_session, mock_current_user):
        """Test retrieval when no documents exist for batch."""
        # Arrange
        dataset_id = "dataset-123"
        batch = "batch-123"

        mock_scalars = Mock()
        mock_scalars.all.return_value = []
        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value = mock_scalars

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            result = DocumentService.get_batch_documents(dataset_id, batch)

            # Assert
            assert isinstance(result, Sequence)
            assert len(result) == 0


class TestDocumentServiceGetDocumentsPosition:
    """Tests for DocumentService.get_documents_position method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_documents_position_with_existing_documents(self, mock_db_session):
        """Test position calculation when documents exist."""
        # Arrange
        dataset_id = "dataset-123"
        max_position = 5
        document = DocumentTestDataFactory.create_document_mock(position=max_position)

        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = document
        mock_db_session.query.return_value = mock_query

        # Act
        result = DocumentService.get_documents_position(dataset_id)

        # Assert
        assert result == max_position + 1
        mock_db_session.query.assert_called_once_with(Document)
        mock_query.filter_by.assert_called_once_with(dataset_id=dataset_id)

    def test_get_documents_position_no_documents(self, mock_db_session):
        """Test position calculation when no documents exist (returns 1)."""
        # Arrange
        dataset_id = "dataset-123"

        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act
        result = DocumentService.get_documents_position(dataset_id)

        # Assert
        assert result == 1


class TestDocumentServiceDeleteDocument:
    """Tests for DocumentService.delete_document method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_document_was_deleted(self):
        """Mock document_was_deleted signal."""
        with patch("services.dataset_service.document_was_deleted") as mock_signal:
            yield mock_signal

    def test_delete_document_with_upload_file_success(self, mock_db_session, mock_document_was_deleted):
        """Test successful deletion of document with upload_file data source."""
        # Arrange
        document = DocumentTestDataFactory.create_document_mock(
            data_source_type="upload_file",
            data_source_info='{"upload_file_id": "file-123"}',
        )
        document.data_source_info_dict = {"upload_file_id": "file-123"}

        # Act
        DocumentService.delete_document(document)

        # Assert
        mock_document_was_deleted.send.assert_called_once_with(
            document.id,
            dataset_id=document.dataset_id,
            doc_form=document.doc_form,
            file_id="file-123",
        )
        mock_db_session.delete.assert_called_once_with(document)
        mock_db_session.commit.assert_called_once()

    def test_delete_document_without_file_id_success(self, mock_db_session, mock_document_was_deleted):
        """Test successful deletion of document without file_id."""
        # Arrange
        document = DocumentTestDataFactory.create_document_mock(
            data_source_type="website_crawl",
            data_source_info='{"url": "https://example.com"}',
        )
        document.data_source_info_dict = {"url": "https://example.com"}

        # Act
        DocumentService.delete_document(document)

        # Assert
        mock_document_was_deleted.send.assert_called_once_with(
            document.id,
            dataset_id=document.dataset_id,
            doc_form=document.doc_form,
            file_id=None,
        )
        mock_db_session.delete.assert_called_once_with(document)
        mock_db_session.commit.assert_called_once()

    def test_delete_document_with_none_data_source_info(self, mock_db_session, mock_document_was_deleted):
        """Test deletion of document with None data_source_info."""
        # Arrange
        document = DocumentTestDataFactory.create_document_mock(
            data_source_type="upload_file",
            data_source_info=None,
        )
        document.data_source_info_dict = None

        # Act
        DocumentService.delete_document(document)

        # Assert
        mock_document_was_deleted.send.assert_called_once_with(
            document.id,
            dataset_id=document.dataset_id,
            doc_form=document.doc_form,
            file_id=None,
        )
        mock_db_session.delete.assert_called_once_with(document)
        mock_db_session.commit.assert_called_once()


class TestDocumentServiceDeleteDocuments:
    """Tests for DocumentService.delete_documents method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_batch_clean_task(self):
        """Mock batch_clean_document_task."""
        with patch("services.dataset_service.batch_clean_document_task") as mock_task:
            yield mock_task

    def test_delete_documents_success(self, mock_db_session, mock_batch_clean_task):
        """Test successful deletion of multiple documents."""
        # Arrange
        dataset = DocumentTestDataFactory.create_dataset_mock(doc_form="text_model")
        document_ids = ["doc-123", "doc-456"]
        documents = [
            DocumentTestDataFactory.create_document_mock(
                document_id=doc_id,
                dataset_id=dataset.id,
                data_source_type="upload_file",
                data_source_info='{"upload_file_id": "file-123"}',
            )
            for doc_id in document_ids
        ]
        for doc in documents:
            doc.data_source_info_dict = {"upload_file_id": "file-123"}

        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value.all.return_value = documents

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            DocumentService.delete_documents(dataset, document_ids)

            # Assert
            mock_batch_clean_document_task.delay.assert_called_once()
            assert mock_db_session.delete.call_count == 2
            mock_db_session.commit.assert_called_once()

    def test_delete_documents_empty_list(self, mock_db_session, mock_batch_clean_task):
        """Test deletion with empty list (should return early)."""
        # Arrange
        dataset = DocumentTestDataFactory.create_dataset_mock()

        # Act
        DocumentService.delete_documents(dataset, [])

        # Assert
        mock_batch_clean_task.delay.assert_not_called()
        mock_db_session.delete.assert_not_called()
        mock_db_session.commit.assert_not_called()

    def test_delete_documents_none_list(self, mock_db_session, mock_batch_clean_task):
        """Test deletion with None list (should return early)."""
        # Arrange
        dataset = DocumentTestDataFactory.create_dataset_mock()

        # Act
        DocumentService.delete_documents(dataset, None)

        # Assert
        mock_batch_clean_task.delay.assert_not_called()
        mock_db_session.delete.assert_not_called()
        mock_db_session.commit.assert_not_called()

    def test_delete_documents_without_doc_form(self, mock_db_session, mock_batch_clean_task):
        """Test deletion when dataset has no doc_form (should not trigger batch clean task)."""
        # Arrange
        dataset = DocumentTestDataFactory.create_dataset_mock(doc_form=None)
        document_ids = ["doc-123"]
        documents = [
            DocumentTestDataFactory.create_document_mock(document_id=doc_id, dataset_id=dataset.id)
            for doc_id in document_ids
        ]

        mock_select = Mock()
        mock_select.where.return_value = mock_select
        mock_db_session.scalars.return_value.all.return_value = documents

        with patch("services.dataset_service.select") as mock_select_func:
            mock_select_func.return_value = mock_select

            # Act
            DocumentService.delete_documents(dataset, document_ids)

            # Assert
            mock_batch_clean_document_task.delay.assert_not_called()
            mock_db_session.delete.assert_called_once()
            mock_db_session.commit.assert_called_once()


class TestDocumentServiceUpdateDocumentWithDatasetId:
    """Tests for DocumentService.update_document_with_dataset_id method."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """Mock current_user."""
        user = DocumentTestDataFactory.create_user_mock()
        with patch("services.dataset_service.current_user", user):
            yield user

    @pytest.fixture
    def mock_document_indexing_update_task(self):
        """Mock document_indexing_update_task."""
        with patch("services.dataset_service.document_indexing_update_task") as mock_task:
            yield mock_task

    def test_update_document_with_dataset_id_success(
        self, mock_db_session, mock_current_user, mock_document_indexing_update_task
    ):
        """Test successful update of document."""
        # Arrange
        dataset = DocumentTestDataFactory.create_dataset_mock()
        account = DocumentTestDataFactory.create_user_mock()
        document = DocumentTestDataFactory.create_document_mock(dataset_id=dataset.id, display_status="available")

        knowledge_config = Mock()
        knowledge_config.original_document_id = document.id
        knowledge_config.doc_form = "text_model"
        knowledge_config.name = "updated_name"
        knowledge_config.data_source = None
        knowledge_config.process_rule = None

        with (
            patch("services.dataset_service.DatasetService.check_dataset_model_setting") as mock_check,
            patch("services.dataset_service.DocumentService.get_document") as mock_get_doc,
            patch("services.dataset_service.naive_utc_now") as mock_now,
        ):
            mock_get_doc.return_value = document
            mock_now.return_value = "2024-01-01T00:00:00"

            # Act
            result = DocumentService.update_document_with_dataset_id(dataset, knowledge_config, account)

            # Assert
            assert result == document
            mock_check.assert_called_once_with(dataset)
            mock_get_doc.assert_called_once_with(dataset.id, document.id)
            assert document.name == "updated_name"
            assert document.indexing_status == "waiting"
            mock_db_session.add.assert_called()
            mock_db_session.commit.assert_called()
            mock_document_indexing_update_task.delay.assert_called_once()

    def test_update_document_not_found(self, mock_db_session, mock_current_user, mock_document_indexing_update_task):
        """Test update when document is not found."""
        # Arrange
        dataset = DocumentTestDataFactory.create_dataset_mock()
        account = DocumentTestDataFactory.create_user_mock()
        knowledge_config = Mock()
        knowledge_config.original_document_id = "non-existent-doc"

        with (
            patch("services.dataset_service.DatasetService.check_dataset_model_setting") as mock_check,
            patch("services.dataset_service.DocumentService.get_document") as mock_get_doc,
        ):
            mock_get_doc.return_value = None

            # Act & Assert
            with pytest.raises(NotFound, match="Document not found"):
                DocumentService.update_document_with_dataset_id(dataset, knowledge_config, account)

    def test_update_document_not_available(
        self, mock_db_session, mock_current_user, mock_document_indexing_update_task
    ):
        """Test update when document is not available."""
        # Arrange
        dataset = DocumentTestDataFactory.create_dataset_mock()
        account = DocumentTestDataFactory.create_user_mock()
        document = DocumentTestDataFactory.create_document_mock(dataset_id=dataset.id, display_status="error")

        knowledge_config = Mock()
        knowledge_config.original_document_id = document.id

        with (
            patch("services.dataset_service.DatasetService.check_dataset_model_setting") as mock_check,
            patch("services.dataset_service.DocumentService.get_document") as mock_get_doc,
        ):
            mock_get_doc.return_value = document

            # Act & Assert
            with pytest.raises(ValueError, match="Document is not available"):
                DocumentService.update_document_with_dataset_id(dataset, knowledge_config, account)


class TestDocumentServiceSaveDocumentWithDatasetId:
    """Tests for DocumentService.save_document_with_dataset_id method (create_document flows)."""

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session."""
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """Mock current_user."""
        user = DocumentTestDataFactory.create_user_mock()
        with patch("services.dataset_service.current_user", user):
            yield user

    @pytest.fixture
    def mock_document_indexing_task(self):
        """Mock DocumentIndexingTaskProxy."""
        with patch("services.dataset_service.DocumentIndexingTaskProxy") as mock_task:
            yield mock_task

    def test_save_document_with_dataset_id_new_upload_file_success(
        self, mock_db_session, mock_current_user, mock_document_indexing_task
    ):
        """Test successful creation of new document from upload_file."""
        # Arrange
        dataset = DocumentTestDataFactory.create_dataset_mock(data_source_type=None, indexing_technique=None)
        account = DocumentTestDataFactory.create_user_mock()
        upload_file = DocumentTestDataFactory.create_upload_file_mock()

        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.doc_form = "text_model"
        knowledge_config.doc_language = "en"
        knowledge_config.indexing_technique = "high_quality"
        knowledge_config.embedding_model = None
        knowledge_config.embedding_model_provider = None
        knowledge_config.retrieval_model = None
        knowledge_config.duplicate = False
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "upload_file"
        knowledge_config.data_source.info_list.file_info_list = Mock()
        knowledge_config.data_source.info_list.file_info_list.file_ids = [upload_file.id]
        knowledge_config.process_rule = None

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = upload_file
        mock_db_session.query.return_value = mock_query

        mock_scalars_result = Mock()
        mock_scalars_result.all.return_value = []
        mock_select = Mock()
        mock_select.where.return_value = mock_select
        # Mock scalars for any queries that might use it
        mock_db_session.scalars.return_value = mock_scalars_result

        with (
            patch("services.dataset_service.DatasetService.check_doc_form") as mock_check_doc_form,
            patch("services.dataset_service.FeatureService.get_features") as mock_features,
            patch("services.dataset_service.DocumentService.get_documents_position") as mock_position,
            patch("services.dataset_service.DocumentService.build_document") as mock_build,
            patch("services.dataset_service.redis_client.lock") as mock_lock,
            patch("services.dataset_service.select") as mock_select_func,
            patch("services.dataset_service.DatasetProcessRule") as mock_process_rule,
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch("services.dataset_service.DatasetCollectionBindingService") as mock_binding_service,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as mock_indexing_proxy,
            patch("services.dataset_service.time.strftime") as mock_strftime,
            patch("services.dataset_service.secrets.randbelow") as mock_randbelow,
        ):
            mock_features.return_value.billing.enabled = False
            mock_position.return_value = 1
            mock_lock.return_value.__enter__ = Mock()
            mock_lock.return_value.__exit__ = Mock(return_value=None)
            mock_select_func.return_value = mock_select
            mock_strftime.return_value = "20240101120000"
            mock_randbelow.return_value = 123456

            # Mock ModelManager for embedding model
            mock_embedding_model = Mock()
            mock_embedding_model.model = "text-embedding-ada-002"
            mock_embedding_model.provider = "openai"
            mock_model_manager_instance = Mock()
            mock_model_manager_instance.get_default_model_instance.return_value = mock_embedding_model
            mock_model_manager.return_value = mock_model_manager_instance

            # Mock DatasetCollectionBindingService
            mock_collection_binding = Mock()
            mock_collection_binding.id = "binding-123"
            mock_binding_service.get_dataset_collection_binding.return_value = mock_collection_binding

            # Mock DocumentIndexingTaskProxy
            mock_task_instance = Mock()
            mock_task_instance.delay = Mock()
            mock_indexing_proxy.return_value = mock_task_instance

            document = DocumentTestDataFactory.create_document_mock()
            document.id = "doc-123"
            mock_build.return_value = document

            process_rule = Mock()
            process_rule.id = "process-rule-123"
            mock_process_rule.return_value = process_rule

            # Act
            documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

            # Assert
            assert len(documents) == 1
            assert batch is not None
            mock_check_doc_form.assert_called_once()
            mock_build.assert_called_once()
            mock_db_session.add.assert_called()
            mock_db_session.flush.assert_called()
            mock_db_session.commit.assert_called()
            mock_task_instance.delay.assert_called_once()

    def test_save_document_with_dataset_id_missing_data_source(
        self, mock_db_session, mock_current_user, mock_document_indexing_task
    ):
        """Test creation fails when data_source is missing for new documents."""
        # Arrange
        dataset = DocumentTestDataFactory.create_dataset_mock()
        account = DocumentTestDataFactory.create_user_mock()

        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.data_source = None

        with (
            patch("services.dataset_service.DatasetService.check_doc_form") as mock_check_doc_form,
            patch("services.dataset_service.FeatureService.get_features") as mock_features,
        ):
            mock_features.return_value.billing.enabled = False

            # Act & Assert
            with pytest.raises(ValueError, match="Data source is required"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)

    def test_save_document_with_dataset_id_file_not_found(
        self, mock_db_session, mock_current_user, mock_document_indexing_task
    ):
        """Test creation fails when upload file is not found."""
        # Arrange
        dataset = DocumentTestDataFactory.create_dataset_mock()
        account = DocumentTestDataFactory.create_user_mock()

        knowledge_config = Mock()
        knowledge_config.original_document_id = None
        knowledge_config.doc_form = "text_model"
        knowledge_config.data_source = Mock()
        knowledge_config.data_source.info_list = Mock()
        knowledge_config.data_source.info_list.data_source_type = "upload_file"
        knowledge_config.data_source.info_list.file_info_list = Mock()
        knowledge_config.data_source.info_list.file_info_list.file_ids = ["non-existent-file"]
        knowledge_config.process_rule = None

        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        with (
            patch("services.dataset_service.DatasetService.check_doc_form") as mock_check_doc_form,
            patch("services.dataset_service.FeatureService.get_features") as mock_features,
            patch("services.dataset_service.DocumentService.get_documents_position") as mock_position,
            patch("services.dataset_service.redis_client.lock") as mock_lock,
            patch("services.dataset_service.select") as mock_select_func,
            patch("services.dataset_service.DatasetProcessRule") as mock_process_rule,
            patch("services.dataset_service.time.strftime") as mock_strftime,
            patch("services.dataset_service.secrets.randbelow") as mock_randbelow,
            patch("services.dataset_service.naive_utc_now") as mock_naive_utc_now,
        ):
            mock_features.return_value.billing.enabled = False
            mock_position.return_value = 1
            mock_lock.return_value.__enter__ = Mock()
            mock_lock.return_value.__exit__ = Mock(return_value=None)
            mock_select_func.return_value = Mock()
            mock_strftime.return_value = "20240101120000"
            mock_randbelow.return_value = 123456
            mock_naive_utc_now.return_value = "2024-01-01T00:00:00"

            process_rule = Mock()
            process_rule.id = "process-rule-123"
            mock_process_rule.return_value = process_rule

            # Act & Assert
            with pytest.raises(FileNotExistsError):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account)
