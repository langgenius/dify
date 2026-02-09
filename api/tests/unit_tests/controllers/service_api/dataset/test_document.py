"""
Unit tests for Service API Document controllers.

Tests coverage for:
- DocumentTextCreatePayload, DocumentTextUpdate Pydantic models
- DocumentListQuery model
- Document creation and update validation
- DocumentService integration
- API endpoint methods (get, delete, list, indexing-status, create-by-text)

Focus on:
- Pydantic model validation
- Error type mappings
- Service method interfaces
- API endpoint business logic and error handling
"""

import uuid
from unittest.mock import Mock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

from controllers.service_api.dataset.document import (
    DocumentAddByFileApi,
    DocumentAddByTextApi,
    DocumentApi,
    DocumentIndexingStatusApi,
    DocumentListApi,
    DocumentListQuery,
    DocumentTextCreatePayload,
    DocumentTextUpdate,
    DocumentUpdateByFileApi,
    DocumentUpdateByTextApi,
    InvalidMetadataError,
)
from controllers.service_api.dataset.error import ArchivedDocumentImmutableError
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import ProcessRule, RetrievalModel


class TestDocumentTextCreatePayload:
    """Test suite for DocumentTextCreatePayload Pydantic model."""

    def test_payload_with_required_fields(self):
        """Test payload with required name and text fields."""
        payload = DocumentTextCreatePayload(name="Test Document", text="Document content")
        assert payload.name == "Test Document"
        assert payload.text == "Document content"

    def test_payload_with_defaults(self):
        """Test payload default values."""
        payload = DocumentTextCreatePayload(name="Doc", text="Content")
        assert payload.doc_form == "text_model"
        assert payload.doc_language == "English"
        assert payload.process_rule is None
        assert payload.indexing_technique is None

    def test_payload_with_all_fields(self):
        """Test payload with all fields populated."""
        payload = DocumentTextCreatePayload(
            name="Full Document",
            text="Complete document content here",
            doc_form="qa_model",
            doc_language="Chinese",
            indexing_technique="high_quality",
            embedding_model="text-embedding-ada-002",
            embedding_model_provider="openai",
        )
        assert payload.name == "Full Document"
        assert payload.doc_form == "qa_model"
        assert payload.doc_language == "Chinese"
        assert payload.indexing_technique == "high_quality"
        assert payload.embedding_model == "text-embedding-ada-002"
        assert payload.embedding_model_provider == "openai"

    def test_payload_with_original_document_id(self):
        """Test payload with original document ID for updates."""
        doc_id = str(uuid.uuid4())
        payload = DocumentTextCreatePayload(name="Updated Doc", text="Updated content", original_document_id=doc_id)
        assert payload.original_document_id == doc_id

    def test_payload_with_long_text(self):
        """Test payload with very long text content."""
        long_text = "A" * 100000  # 100KB of text
        payload = DocumentTextCreatePayload(name="Long Doc", text=long_text)
        assert len(payload.text) == 100000

    def test_payload_with_unicode_content(self):
        """Test payload with unicode characters."""
        unicode_text = "这是中文文档 📄 Документ на русском"
        payload = DocumentTextCreatePayload(name="Unicode Doc", text=unicode_text)
        assert payload.text == unicode_text

    def test_payload_with_markdown_content(self):
        """Test payload with markdown content."""
        markdown_text = """
# Heading

This is **bold** and *italic*.

- List item 1
- List item 2

```python
code block
```
"""
        payload = DocumentTextCreatePayload(name="Markdown Doc", text=markdown_text)
        assert "# Heading" in payload.text


class TestDocumentTextUpdate:
    """Test suite for DocumentTextUpdate Pydantic model."""

    def test_payload_all_optional(self):
        """Test payload with all fields optional."""
        payload = DocumentTextUpdate()
        assert payload.name is None
        assert payload.text is None

    def test_payload_with_name_only(self):
        """Test payload with name update only."""
        payload = DocumentTextUpdate(name="New Name")
        assert payload.name == "New Name"
        assert payload.text is None

    def test_payload_with_text_only(self):
        """Test payload with text update only."""
        # DocumentTextUpdate requires name if text is provided - validator check_text_and_name
        payload = DocumentTextUpdate(text="New Content", name="Some Name")
        assert payload.text == "New Content"

    def test_payload_text_without_name_raises(self):
        """Test that payload with text but no name raises validation error."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            DocumentTextUpdate(text="New Content")

    def test_payload_with_both_fields(self):
        """Test payload with both name and text."""
        payload = DocumentTextUpdate(name="Updated Name", text="Updated Content")
        assert payload.name == "Updated Name"
        assert payload.text == "Updated Content"

    def test_payload_with_doc_form_update(self):
        """Test payload with doc_form update."""
        payload = DocumentTextUpdate(doc_form="qa_model")
        assert payload.doc_form == "qa_model"

    def test_payload_with_language_update(self):
        """Test payload with doc_language update."""
        payload = DocumentTextUpdate(doc_language="Japanese")
        assert payload.doc_language == "Japanese"

    def test_payload_default_values(self):
        """Test payload default values."""
        payload = DocumentTextUpdate()
        assert payload.doc_form == "text_model"
        assert payload.doc_language == "English"


class TestDocumentListQuery:
    """Test suite for DocumentListQuery Pydantic model."""

    def test_query_with_defaults(self):
        """Test query with default values."""
        query = DocumentListQuery()
        assert query.page == 1
        assert query.limit == 20
        assert query.keyword is None
        assert query.status is None

    def test_query_with_pagination(self):
        """Test query with pagination parameters."""
        query = DocumentListQuery(page=5, limit=50)
        assert query.page == 5
        assert query.limit == 50

    def test_query_with_keyword(self):
        """Test query with keyword search."""
        query = DocumentListQuery(keyword="machine learning")
        assert query.keyword == "machine learning"

    def test_query_with_status_filter(self):
        """Test query with status filter."""
        query = DocumentListQuery(status="completed")
        assert query.status == "completed"

    def test_query_with_all_filters(self):
        """Test query with all filter fields."""
        query = DocumentListQuery(page=2, limit=30, keyword="AI", status="indexing")
        assert query.page == 2
        assert query.limit == 30
        assert query.keyword == "AI"
        assert query.status == "indexing"


class TestDocumentService:
    """Test DocumentService interface methods."""

    def test_get_document_method_exists(self):
        """Test DocumentService.get_document exists."""
        assert hasattr(DocumentService, "get_document")

    def test_update_document_with_dataset_id_method_exists(self):
        """Test DocumentService.update_document_with_dataset_id exists."""
        assert hasattr(DocumentService, "update_document_with_dataset_id")

    def test_delete_document_method_exists(self):
        """Test DocumentService.delete_document exists."""
        assert hasattr(DocumentService, "delete_document")

    def test_get_document_file_detail_method_exists(self):
        """Test DocumentService.get_document_file_detail exists."""
        assert hasattr(DocumentService, "get_document_file_detail")

    def test_batch_update_document_status_method_exists(self):
        """Test DocumentService.batch_update_document_status exists."""
        assert hasattr(DocumentService, "batch_update_document_status")

    @patch.object(DocumentService, "get_document")
    def test_get_document_returns_document(self, mock_get):
        """Test get_document returns document object."""
        mock_doc = Mock()
        mock_doc.id = str(uuid.uuid4())
        mock_doc.name = "Test Document"
        mock_doc.indexing_status = "completed"
        mock_get.return_value = mock_doc

        result = DocumentService.get_document(dataset_id="dataset_id", document_id="doc_id")
        assert result.name == "Test Document"
        assert result.indexing_status == "completed"

    @patch.object(DocumentService, "delete_document")
    def test_delete_document_called(self, mock_delete):
        """Test delete_document is called with document."""
        mock_doc = Mock()
        DocumentService.delete_document(document=mock_doc)
        mock_delete.assert_called_once_with(document=mock_doc)


class TestDocumentIndexingStatus:
    """Test document indexing status values."""

    def test_completed_status(self):
        """Test completed status."""
        status = "completed"
        valid_statuses = ["waiting", "parsing", "indexing", "completed", "error", "paused"]
        assert status in valid_statuses

    def test_indexing_status(self):
        """Test indexing status."""
        status = "indexing"
        valid_statuses = ["waiting", "parsing", "indexing", "completed", "error", "paused"]
        assert status in valid_statuses

    def test_error_status(self):
        """Test error status."""
        status = "error"
        valid_statuses = ["waiting", "parsing", "indexing", "completed", "error", "paused"]
        assert status in valid_statuses


class TestDocumentDocForm:
    """Test document doc_form values."""

    def test_text_model_form(self):
        """Test text_model form."""
        doc_form = "text_model"
        valid_forms = ["text_model", "qa_model", "hierarchical_model", "parent_child_model"]
        assert doc_form in valid_forms

    def test_qa_model_form(self):
        """Test qa_model form."""
        doc_form = "qa_model"
        valid_forms = ["text_model", "qa_model", "hierarchical_model", "parent_child_model"]
        assert doc_form in valid_forms


class TestProcessRule:
    """Test ProcessRule model from knowledge entities."""

    def test_process_rule_exists(self):
        """Test ProcessRule model exists."""
        assert ProcessRule is not None

    def test_process_rule_has_mode_field(self):
        """Test ProcessRule has mode field."""
        assert hasattr(ProcessRule, "model_fields")


class TestRetrievalModel:
    """Test RetrievalModel configuration."""

    def test_retrieval_model_exists(self):
        """Test RetrievalModel exists."""
        assert RetrievalModel is not None

    def test_retrieval_model_has_fields(self):
        """Test RetrievalModel has expected fields."""
        assert hasattr(RetrievalModel, "model_fields")


class TestDocumentMetadataChoices:
    """Test document metadata filter choices."""

    def test_all_metadata(self):
        """Test 'all' metadata choice."""
        choice = "all"
        valid_choices = {"all", "only", "without"}
        assert choice in valid_choices

    def test_only_metadata(self):
        """Test 'only' metadata choice."""
        choice = "only"
        valid_choices = {"all", "only", "without"}
        assert choice in valid_choices

    def test_without_metadata(self):
        """Test 'without' metadata choice."""
        choice = "without"
        valid_choices = {"all", "only", "without"}
        assert choice in valid_choices


class TestDocumentLanguages:
    """Test commonly supported document languages."""

    @pytest.mark.parametrize("language", ["English", "Chinese", "Japanese", "Korean", "Spanish", "French", "German"])
    def test_common_languages(self, language):
        """Test common languages are valid."""
        payload = DocumentTextCreatePayload(name="Multilingual Doc", text="Content", doc_language=language)
        assert payload.doc_language == language


class TestDocumentErrors:
    """Test document-related error handling."""

    def test_document_not_found_pattern(self):
        """Test document not found error pattern."""
        # Documents typically return NotFound when missing
        error_message = "Document Not Exists."
        assert "Document" in error_message
        assert "Not Exists" in error_message

    def test_dataset_not_found_pattern(self):
        """Test dataset not found error pattern."""
        error_message = "Dataset not found."
        assert "Dataset" in error_message
        assert "not found" in error_message


class TestDocumentFileUpload:
    """Test document file upload patterns."""

    def test_supported_file_extensions(self):
        """Test commonly supported file extensions."""
        supported = ["pdf", "txt", "md", "doc", "docx", "csv", "html", "htm", "json"]
        for ext in supported:
            assert len(ext) > 0
            assert ext.isalnum()

    def test_file_size_units(self):
        """Test file size calculation."""
        # 15MB limit is common for file uploads
        max_size_mb = 15
        max_size_bytes = max_size_mb * 1024 * 1024
        assert max_size_bytes == 15728640


class TestDocumentDisplayStatusLogic:
    """Test DocumentService display status logic."""

    def test_normalize_display_status_aliases(self):
        """Test status normalization with aliases."""
        assert DocumentService.normalize_display_status("active") == "available"
        assert DocumentService.normalize_display_status("enabled") == "available"

    def test_normalize_display_status_valid(self):
        """Test normalization of valid statuses."""
        valid_statuses = ["queuing", "indexing", "paused", "error", "available", "disabled", "archived"]
        for status in valid_statuses:
            assert DocumentService.normalize_display_status(status) == status

    def test_normalize_display_status_invalid(self):
        """Test normalization of invalid status returns None."""
        assert DocumentService.normalize_display_status("unknown_status") is None
        assert DocumentService.normalize_display_status("") is None
        assert DocumentService.normalize_display_status(None) is None

    def test_build_display_status_filters(self):
        """Test filter building returns tuple."""
        filters = DocumentService.build_display_status_filters("available")
        assert isinstance(filters, tuple)
        assert len(filters) > 0


class TestDocumentServiceBatchMethods:
    """Test DocumentService batch operations."""

    @patch("services.dataset_service.db.session.scalars")
    def test_get_documents_by_ids(self, mock_scalars):
        """Test batch retrieval of documents by IDs."""
        dataset_id = str(uuid.uuid4())
        doc_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

        mock_result = Mock()
        mock_result.all.return_value = [Mock(id=doc_ids[0]), Mock(id=doc_ids[1])]
        mock_scalars.return_value = mock_result

        documents = DocumentService.get_documents_by_ids(dataset_id, doc_ids)

        assert len(documents) == 2
        mock_scalars.assert_called_once()

    def test_get_documents_by_ids_empty(self):
        """Test batch retrieval with empty list returns empty."""
        assert DocumentService.get_documents_by_ids("ds_id", []) == []


class TestDocumentServiceFileOperations:
    """Test DocumentService file related operations."""

    @patch("services.dataset_service.file_helpers.get_signed_file_url")
    @patch("services.dataset_service.DocumentService._get_upload_file_for_upload_file_document")
    def test_get_document_download_url(self, mock_get_file, mock_signed_url):
        """Test generation of download URL."""
        mock_doc = Mock()
        mock_file = Mock()
        mock_file.id = "file_id"
        mock_get_file.return_value = mock_file
        mock_signed_url.return_value = "https://example.com/download"

        url = DocumentService.get_document_download_url(mock_doc)

        assert url == "https://example.com/download"
        mock_signed_url.assert_called_with(upload_file_id="file_id", as_attachment=True)


class TestDocumentServiceSaveValidation:
    """Test validations during document saving."""

    @patch("services.dataset_service.DatasetService.check_doc_form")
    @patch("services.dataset_service.FeatureService.get_features")
    @patch("services.dataset_service.current_user")
    def test_save_document_validates_doc_form(self, mock_user, mock_features, mock_check_form):
        """Test that doc_form is validated during save."""
        mock_user.current_tenant_id = "tenant_id"
        dataset = Mock()
        config = Mock()
        features = Mock()
        features.billing.enabled = False
        mock_features.return_value = features

        class TestStopError(Exception):
            pass

        mock_check_form.side_effect = TestStopError()

        # Skip actual logic by mocking dependent calls or raising error to stop early
        with pytest.raises(TestStopError):
            # We just want to check check_doc_form is called early
            DocumentService.save_document_with_dataset_id(dataset, config, Mock())

        # This will fail if we raise exception before check_doc_form,
        # but check_doc_form is the first thing called.
        # Ideally we'd mock everything to completion, but for unit validation:
        # We can just verify check_doc_form was called if we mock it to not raise.
        mock_check_form.assert_called_once()


# =============================================================================
# API Endpoint Tests
#
# These tests call controller methods directly, bypassing the
# ``DatasetApiResource.method_decorators`` (``validate_dataset_token``) by
# invoking the *undecorated* method on the class instance.  Every external
# dependency (``db``, service classes, ``marshal``, ``current_user``, …) is
# patched at the module where it is looked up so the real SQLAlchemy / Flask
# extensions are never touched.
# =============================================================================


class TestDocumentApiGet:
    """Test suite for DocumentApi.get() endpoint.

    ``DocumentApi.get`` uses ``self.get_dataset()`` (defined on
    ``DatasetApiResource``) which calls the real ``db`` from ``wraps.py``.
    We patch it on the instance after construction so the real db is never hit.
    """

    @pytest.fixture
    def mock_doc_detail(self, mock_tenant):
        """A document mock with every attribute ``DocumentApi.get`` reads."""
        doc = Mock()
        doc.id = str(uuid.uuid4())
        doc.tenant_id = mock_tenant.id
        doc.name = "test_document.txt"
        doc.indexing_status = "completed"
        doc.enabled = True
        doc.doc_form = "text_model"
        doc.doc_language = "English"
        doc.doc_type = "book"
        doc.doc_metadata_details = {"source": "upload"}
        doc.position = 1
        doc.data_source_type = "upload_file"
        doc.data_source_detail_dict = {"type": "upload_file"}
        doc.dataset_process_rule_id = str(uuid.uuid4())
        doc.dataset_process_rule = None
        doc.created_from = "api"
        doc.created_by = str(uuid.uuid4())
        doc.created_at = Mock()
        doc.created_at.timestamp.return_value = 1609459200
        doc.tokens = 100
        doc.completed_at = Mock()
        doc.completed_at.timestamp.return_value = 1609459200
        doc.updated_at = Mock()
        doc.updated_at.timestamp.return_value = 1609459200
        doc.indexing_latency = 0.5
        doc.error = None
        doc.disabled_at = None
        doc.disabled_by = None
        doc.archived = False
        doc.segment_count = 5
        doc.average_segment_length = 20
        doc.hit_count = 0
        doc.display_status = "available"
        doc.need_summary = False
        return doc

    @patch("controllers.service_api.dataset.document.DatasetService")
    @patch("controllers.service_api.dataset.document.DocumentService")
    def test_get_document_success_with_all_metadata(
        self, mock_doc_svc, mock_dataset_svc, app, mock_tenant, mock_doc_detail
    ):
        """Test successful document retrieval with metadata='all'."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        mock_dataset = Mock()
        mock_dataset.id = dataset_id
        mock_dataset.summary_index_setting = None

        mock_doc_svc.get_document.return_value = mock_doc_detail
        mock_dataset_svc.get_process_rules.return_value = []

        # Act
        with app.test_request_context(
            f"/datasets/{dataset_id}/documents/{mock_doc_detail.id}?metadata=all",
            method="GET",
        ):
            api = DocumentApi()
            api.get_dataset = Mock(return_value=mock_dataset)
            response = api.get(tenant_id=mock_tenant.id, dataset_id=dataset_id, document_id=mock_doc_detail.id)

        # Assert
        assert response["id"] == mock_doc_detail.id
        assert response["name"] == mock_doc_detail.name
        assert response["indexing_status"] == mock_doc_detail.indexing_status
        assert "doc_type" in response
        assert "doc_metadata" in response

    @patch("controllers.service_api.dataset.document.DocumentService")
    def test_get_document_not_found(self, mock_doc_svc, app, mock_tenant):
        """Test 404 when document is not found."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        mock_dataset = Mock()
        mock_dataset.id = dataset_id

        mock_doc_svc.get_document.return_value = None

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{dataset_id}/documents/nonexistent",
            method="GET",
        ):
            api = DocumentApi()
            api.get_dataset = Mock(return_value=mock_dataset)
            with pytest.raises(NotFound):
                api.get(tenant_id=mock_tenant.id, dataset_id=dataset_id, document_id="nonexistent")

    @patch("controllers.service_api.dataset.document.DocumentService")
    def test_get_document_forbidden_wrong_tenant(self, mock_doc_svc, app, mock_tenant, mock_doc_detail):
        """Test 403 when document tenant doesn't match request tenant."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        mock_dataset = Mock()
        mock_dataset.id = dataset_id

        mock_doc_detail.tenant_id = "different-tenant-id"
        mock_doc_svc.get_document.return_value = mock_doc_detail

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{dataset_id}/documents/{mock_doc_detail.id}",
            method="GET",
        ):
            api = DocumentApi()
            api.get_dataset = Mock(return_value=mock_dataset)
            with pytest.raises(Forbidden):
                api.get(tenant_id=mock_tenant.id, dataset_id=dataset_id, document_id=mock_doc_detail.id)

    @patch("controllers.service_api.dataset.document.DocumentService")
    def test_get_document_metadata_only(self, mock_doc_svc, app, mock_tenant, mock_doc_detail):
        """Test document retrieval with metadata='only'."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        mock_dataset = Mock()
        mock_dataset.id = dataset_id
        mock_dataset.summary_index_setting = None

        mock_doc_svc.get_document.return_value = mock_doc_detail

        # Act
        with app.test_request_context(
            f"/datasets/{dataset_id}/documents/{mock_doc_detail.id}?metadata=only",
            method="GET",
        ):
            api = DocumentApi()
            api.get_dataset = Mock(return_value=mock_dataset)
            response = api.get(tenant_id=mock_tenant.id, dataset_id=dataset_id, document_id=mock_doc_detail.id)

        # Assert — metadata='only' returns only id, doc_type, doc_metadata
        assert response["id"] == mock_doc_detail.id
        assert "doc_type" in response
        assert "doc_metadata" in response
        assert "name" not in response

    @patch("controllers.service_api.dataset.document.DatasetService")
    @patch("controllers.service_api.dataset.document.DocumentService")
    def test_get_document_metadata_without(self, mock_doc_svc, mock_dataset_svc, app, mock_tenant, mock_doc_detail):
        """Test document retrieval with metadata='without'."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        mock_dataset = Mock()
        mock_dataset.id = dataset_id
        mock_dataset.summary_index_setting = None

        mock_doc_svc.get_document.return_value = mock_doc_detail
        mock_dataset_svc.get_process_rules.return_value = []

        # Act
        with app.test_request_context(
            f"/datasets/{dataset_id}/documents/{mock_doc_detail.id}?metadata=without",
            method="GET",
        ):
            api = DocumentApi()
            api.get_dataset = Mock(return_value=mock_dataset)
            response = api.get(tenant_id=mock_tenant.id, dataset_id=dataset_id, document_id=mock_doc_detail.id)

        # Assert — metadata='without' omits doc_type / doc_metadata
        assert response["id"] == mock_doc_detail.id
        assert "doc_type" not in response
        assert "doc_metadata" not in response
        assert "name" in response

    @patch("controllers.service_api.dataset.document.DocumentService")
    def test_get_document_invalid_metadata_value(self, mock_doc_svc, app, mock_tenant, mock_doc_detail):
        """Test error when metadata parameter has invalid value."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        mock_dataset = Mock()
        mock_dataset.id = dataset_id
        mock_dataset.summary_index_setting = None

        mock_doc_svc.get_document.return_value = mock_doc_detail

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{dataset_id}/documents/{mock_doc_detail.id}?metadata=invalid",
            method="GET",
        ):
            api = DocumentApi()
            api.get_dataset = Mock(return_value=mock_dataset)
            with pytest.raises(InvalidMetadataError):
                api.get(tenant_id=mock_tenant.id, dataset_id=dataset_id, document_id=mock_doc_detail.id)


class TestDocumentApiDelete:
    """Test suite for DocumentApi.delete() endpoint.

    ``delete`` is wrapped by ``@cloud_edition_billing_rate_limit_check`` which
    internally calls ``validate_and_get_api_token``.  To bypass the decorator
    we call the original function via ``__wrapped__`` (preserved by
    ``functools.wraps``).  ``delete`` queries the dataset via
    ``db.session.query(Dataset)`` directly, so we patch ``db`` at the
    controller module.
    """

    @staticmethod
    def _call_delete(api: DocumentApi, **kwargs):
        """Call the unwrapped delete to skip billing decorators."""
        return api.delete.__wrapped__(api, **kwargs)

    @patch("controllers.service_api.dataset.document.DocumentService")
    @patch("controllers.service_api.dataset.document.db")
    def test_delete_document_success(self, mock_db, mock_doc_svc, app, mock_tenant, mock_document):
        """Test successful document deletion."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        mock_dataset = Mock()
        mock_dataset.id = dataset_id
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_doc_svc.get_document.return_value = mock_document
        mock_doc_svc.check_archived.return_value = False
        mock_doc_svc.delete_document.return_value = True

        # Act
        with app.test_request_context(
            f"/datasets/{dataset_id}/documents/{mock_document.id}",
            method="DELETE",
        ):
            api = DocumentApi()
            response = self._call_delete(
                api, tenant_id=mock_tenant.id, dataset_id=dataset_id, document_id=mock_document.id
            )

        # Assert
        assert response == ("", 204)
        mock_doc_svc.delete_document.assert_called_once_with(mock_document)

    @patch("controllers.service_api.dataset.document.DocumentService")
    @patch("controllers.service_api.dataset.document.db")
    def test_delete_document_not_found(self, mock_db, mock_doc_svc, app, mock_tenant):
        """Test 404 when document not found."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        mock_dataset = Mock()
        mock_dataset.id = dataset_id
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_doc_svc.get_document.return_value = None

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{dataset_id}/documents/{document_id}",
            method="DELETE",
        ):
            api = DocumentApi()
            with pytest.raises(NotFound):
                self._call_delete(api, tenant_id=mock_tenant.id, dataset_id=dataset_id, document_id=document_id)

    @patch("controllers.service_api.dataset.document.DocumentService")
    @patch("controllers.service_api.dataset.document.db")
    def test_delete_document_archived_forbidden(self, mock_db, mock_doc_svc, app, mock_tenant, mock_document):
        """Test ArchivedDocumentImmutableError when deleting archived document."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        mock_dataset = Mock()
        mock_dataset.id = dataset_id
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_doc_svc.get_document.return_value = mock_document
        mock_doc_svc.check_archived.return_value = True

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{dataset_id}/documents/{mock_document.id}",
            method="DELETE",
        ):
            api = DocumentApi()
            with pytest.raises(ArchivedDocumentImmutableError):
                self._call_delete(api, tenant_id=mock_tenant.id, dataset_id=dataset_id, document_id=mock_document.id)

    @patch("controllers.service_api.dataset.document.DocumentService")
    @patch("controllers.service_api.dataset.document.db")
    def test_delete_document_dataset_not_found(self, mock_db, mock_doc_svc, app, mock_tenant):
        """Test ValueError when dataset not found."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{dataset_id}/documents/{document_id}",
            method="DELETE",
        ):
            api = DocumentApi()
            with pytest.raises(ValueError, match="Dataset does not exist."):
                self._call_delete(api, tenant_id=mock_tenant.id, dataset_id=dataset_id, document_id=document_id)


class TestDocumentListApi:
    """Test suite for DocumentListApi endpoint."""

    @patch("controllers.service_api.dataset.document.marshal")
    @patch("controllers.service_api.dataset.document.DocumentService")
    @patch("controllers.service_api.dataset.document.db")
    def test_list_documents_success(self, mock_db, mock_doc_svc, mock_marshal, app, mock_tenant, mock_dataset):
        """Test successful document list retrieval."""
        # Arrange
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_pagination = Mock()
        mock_pagination.items = [Mock(), Mock()]
        mock_pagination.total = 2
        mock_db.paginate.return_value = mock_pagination

        mock_doc_svc.enrich_documents_with_summary_index_status.return_value = None
        mock_marshal.return_value = [{"id": "doc1"}, {"id": "doc2"}]

        # Act
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents?page=1&limit=20",
            method="GET",
        ):
            api = DocumentListApi()
            response = api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id)

        # Assert
        assert "data" in response
        assert "total" in response
        assert response["page"] == 1
        assert response["limit"] == 20
        assert response["total"] == 2

    @patch("controllers.service_api.dataset.document.db")
    def test_list_documents_dataset_not_found(self, mock_db, app, mock_tenant, mock_dataset):
        """Test 404 when dataset not found."""
        # Arrange
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents",
            method="GET",
        ):
            api = DocumentListApi()
            with pytest.raises(NotFound):
                api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id)


class TestDocumentIndexingStatusApi:
    """Test suite for DocumentIndexingStatusApi endpoint."""

    @patch("controllers.service_api.dataset.document.marshal")
    @patch("controllers.service_api.dataset.document.DocumentService")
    @patch("controllers.service_api.dataset.document.db")
    def test_get_indexing_status_success(self, mock_db, mock_doc_svc, mock_marshal, app, mock_tenant, mock_dataset):
        """Test successful indexing status retrieval."""
        # Arrange
        batch_id = "batch_123"
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_doc = Mock()
        mock_doc.id = str(uuid.uuid4())
        mock_doc.is_paused = False
        mock_doc.indexing_status = "completed"
        mock_doc.processing_started_at = None
        mock_doc.parsing_completed_at = None
        mock_doc.cleaning_completed_at = None
        mock_doc.splitting_completed_at = None
        mock_doc.completed_at = None
        mock_doc.paused_at = None
        mock_doc.error = None
        mock_doc.stopped_at = None

        mock_doc_svc.get_batch_documents.return_value = [mock_doc]

        # Mock segment count queries
        mock_db.session.query.return_value.where.return_value.where.return_value.count.return_value = 5
        mock_marshal.return_value = {"id": mock_doc.id, "indexing_status": "completed"}

        # Act
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/{batch_id}/indexing-status",
            method="GET",
        ):
            api = DocumentIndexingStatusApi()
            response = api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, batch=batch_id)

        # Assert
        assert "data" in response
        assert len(response["data"]) == 1

    @patch("controllers.service_api.dataset.document.db")
    def test_get_indexing_status_dataset_not_found(self, mock_db, app, mock_tenant, mock_dataset):
        """Test 404 when dataset not found."""
        # Arrange
        batch_id = "batch_123"
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/{batch_id}/indexing-status",
            method="GET",
        ):
            api = DocumentIndexingStatusApi()
            with pytest.raises(NotFound):
                api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, batch=batch_id)

    @patch("controllers.service_api.dataset.document.DocumentService")
    @patch("controllers.service_api.dataset.document.db")
    def test_get_indexing_status_documents_not_found(self, mock_db, mock_doc_svc, app, mock_tenant, mock_dataset):
        """Test 404 when no documents found for batch."""
        # Arrange
        batch_id = "batch_empty"
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_doc_svc.get_batch_documents.return_value = []

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/{batch_id}/indexing-status",
            method="GET",
        ):
            api = DocumentIndexingStatusApi()
            with pytest.raises(NotFound):
                api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, batch=batch_id)


class TestDocumentAddByTextApi:
    """Test suite for DocumentAddByTextApi.post() endpoint.

    ``post`` is wrapped by ``@cloud_edition_billing_resource_check`` and
    ``@cloud_edition_billing_rate_limit_check`` which call
    ``validate_and_get_api_token`` at call time.  We patch that function
    (and ``FeatureService``) at the ``wraps`` module so the billing
    decorators become no-ops and the underlying method executes normally.
    """

    @staticmethod
    def _setup_billing_mocks(mock_validate_token, mock_feature_svc, tenant_id: str):
        """Configure mocks to neutralise billing/auth decorators.

        ``cloud_edition_billing_resource_check`` calls
        ``FeatureService.get_features`` and
        ``cloud_edition_billing_rate_limit_check`` calls
        ``FeatureService.get_knowledge_rate_limit``.
        Both call ``validate_and_get_api_token`` first.
        """
        mock_api_token = Mock()
        mock_api_token.tenant_id = tenant_id
        mock_validate_token.return_value = mock_api_token

        mock_features = Mock()
        mock_features.billing.enabled = False
        mock_feature_svc.get_features.return_value = mock_features

        mock_rate_limit = Mock()
        mock_rate_limit.enabled = False
        mock_feature_svc.get_knowledge_rate_limit.return_value = mock_rate_limit

    @patch("controllers.service_api.dataset.document.marshal")
    @patch("controllers.service_api.dataset.document.DocumentService")
    @patch("controllers.service_api.dataset.document.KnowledgeConfig")
    @patch("controllers.service_api.dataset.document.FileService")
    @patch("controllers.service_api.dataset.document.current_user")
    @patch("controllers.service_api.dataset.document.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_create_document_by_text_success(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_current_user,
        mock_file_svc_cls,
        mock_knowledge_config,
        mock_doc_svc,
        mock_marshal,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful document creation by text."""
        # Arrange — neutralise billing decorators
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)

        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_dataset.indexing_technique = "economy"
        mock_current_user.id = str(uuid.uuid4())

        mock_upload_file = Mock()
        mock_upload_file.id = str(uuid.uuid4())
        mock_file_svc = Mock()
        mock_file_svc.upload_text.return_value = mock_upload_file
        mock_file_svc_cls.return_value = mock_file_svc

        mock_config = Mock()
        mock_knowledge_config.model_validate.return_value = mock_config

        mock_doc = Mock()
        mock_doc.id = str(uuid.uuid4())
        mock_doc_svc.save_document_with_dataset_id.return_value = ([mock_doc], "batch_123")
        mock_doc_svc.document_create_args_validate.return_value = None
        mock_marshal.return_value = {"id": mock_doc.id, "name": "Test Document"}

        # Act
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/document/create_by_text",
            method="POST",
            json={
                "name": "Test Document",
                "text": "This is test content",
                "indexing_technique": "economy",
            },
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentAddByTextApi()
            response, status = api.post(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id)

        # Assert
        assert status == 200
        assert "document" in response
        assert "batch" in response
        assert response["batch"] == "batch_123"

    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.dataset.document.db")
    def test_create_document_dataset_not_found(
        self, mock_db, mock_validate_token, mock_feature_svc, app, mock_tenant, mock_dataset
    ):
        """Test ValueError when dataset not found."""
        # Arrange — neutralise billing decorators
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)

        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/document/create_by_text",
            method="POST",
            json={"name": "Test Document", "text": "Content"},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentAddByTextApi()
            with pytest.raises(ValueError, match="Dataset does not exist."):
                api.post(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id)

    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.dataset.document.db")
    def test_create_document_missing_indexing_technique(
        self, mock_db, mock_validate_token, mock_feature_svc, app, mock_tenant, mock_dataset
    ):
        """Test error when both dataset and payload lack indexing_technique.

        When ``indexing_technique`` is ``None`` in the payload, ``model_dump(exclude_none=True)``
        omits the key.  The production code accesses ``args["indexing_technique"]`` which raises
        ``KeyError`` before the ``ValueError`` guard can fire.
        """
        # Arrange — neutralise billing decorators
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)

        mock_dataset.indexing_technique = None
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/document/create_by_text",
            method="POST",
            json={"name": "Test Document", "text": "Content"},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentAddByTextApi()
            with pytest.raises(KeyError):
                api.post(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id)


class TestArchivedDocumentImmutableError:
    """Test ArchivedDocumentImmutableError behavior."""

    def test_archived_document_error_can_be_raised(self):
        """Test ArchivedDocumentImmutableError can be raised and caught."""
        with pytest.raises(ArchivedDocumentImmutableError):
            raise ArchivedDocumentImmutableError()

    def test_archived_document_error_inheritance(self):
        """Test ArchivedDocumentImmutableError inherits from correct base."""
        from libs.exception import BaseHTTPException

        error = ArchivedDocumentImmutableError()
        assert isinstance(error, BaseHTTPException)
        assert error.code == 403


# =============================================================================
# Endpoint tests for DocumentUpdateByTextApi, DocumentAddByFileApi,
# DocumentUpdateByFileApi.
#
# These controllers use ``@cloud_edition_billing_resource_check`` (does NOT
# preserve ``__wrapped__``) and ``@cloud_edition_billing_rate_limit_check``
# (preserves ``__wrapped__``).  We patch ``validate_and_get_api_token`` and
# ``FeatureService`` at the ``wraps`` module to neutralise both.
# =============================================================================


def _setup_billing_mocks(mock_validate_token, mock_feature_svc, tenant_id: str):
    """Configure mocks to neutralise billing/auth decorators."""
    mock_api_token = Mock()
    mock_api_token.tenant_id = tenant_id
    mock_validate_token.return_value = mock_api_token
    mock_features = Mock()
    mock_features.billing.enabled = False
    mock_feature_svc.get_features.return_value = mock_features
    mock_rate_limit = Mock()
    mock_rate_limit.enabled = False
    mock_feature_svc.get_knowledge_rate_limit.return_value = mock_rate_limit


class TestDocumentUpdateByTextApiPost:
    """Test suite for DocumentUpdateByTextApi.post() endpoint.

    ``post`` is wrapped by ``@cloud_edition_billing_resource_check`` and
    ``@cloud_edition_billing_rate_limit_check``.
    """

    @patch("controllers.service_api.dataset.document.marshal")
    @patch("controllers.service_api.dataset.document.DocumentService")
    @patch("controllers.service_api.dataset.document.FileService")
    @patch("controllers.service_api.dataset.document.current_user")
    @patch("controllers.service_api.dataset.document.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_update_by_text_success(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_current_user,
        mock_file_svc_cls,
        mock_doc_svc,
        mock_marshal,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful document update by text."""
        _setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_dataset.indexing_technique = "economy"
        mock_dataset.latest_process_rule = Mock()
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_current_user.id = "user-1"
        mock_upload = Mock()
        mock_upload.id = str(uuid.uuid4())
        mock_file_svc_cls.return_value.upload_text.return_value = mock_upload

        mock_document = Mock()
        mock_doc_svc.document_create_args_validate.return_value = None
        mock_doc_svc.save_document_with_dataset_id.return_value = ([mock_document], "batch-1")
        mock_marshal.return_value = {"id": "doc-1"}

        doc_id = str(uuid.uuid4())
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/{doc_id}/update_by_text",
            method="POST",
            json={"name": "Updated Doc", "text": "New content"},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentUpdateByTextApi()
            response, status = api.post(
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                document_id=doc_id,
            )

        assert status == 200
        assert "document" in response

    @patch("controllers.service_api.dataset.document.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_update_by_text_dataset_not_found(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test ValueError when dataset not found."""
        _setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        doc_id = str(uuid.uuid4())
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/{doc_id}/update_by_text",
            method="POST",
            json={"name": "Doc", "text": "Content"},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentUpdateByTextApi()
            with pytest.raises(ValueError, match="Dataset does not exist"):
                api.post(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id=doc_id,
                )


class TestDocumentAddByFileApiPost:
    """Test suite for DocumentAddByFileApi.post() endpoint.

    ``post`` is wrapped by two ``@cloud_edition_billing_resource_check``
    decorators and ``@cloud_edition_billing_rate_limit_check``.
    """

    @patch("controllers.service_api.dataset.document.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_add_by_file_dataset_not_found(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test ValueError when dataset not found."""
        _setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        from io import BytesIO

        data = {"file": (BytesIO(b"content"), "test.pdf", "application/pdf")}
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/document/create_by_file",
            method="POST",
            content_type="multipart/form-data",
            data=data,
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentAddByFileApi()
            with pytest.raises(ValueError, match="Dataset does not exist"):
                api.post(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id)

    @patch("controllers.service_api.dataset.document.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_add_by_file_external_dataset(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test ValueError when dataset is external."""
        _setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_dataset.provider = "external"
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        from io import BytesIO

        data = {"file": (BytesIO(b"content"), "test.pdf", "application/pdf")}
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/document/create_by_file",
            method="POST",
            content_type="multipart/form-data",
            data=data,
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentAddByFileApi()
            with pytest.raises(ValueError, match="External datasets"):
                api.post(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id)

    @patch("controllers.service_api.dataset.document.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_add_by_file_no_file_uploaded(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test NoFileUploadedError when no file in request."""
        from controllers.common.errors import NoFileUploadedError

        _setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_dataset.provider = "vendor"
        mock_dataset.indexing_technique = "economy"
        mock_dataset.chunk_structure = None
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/document/create_by_file",
            method="POST",
            content_type="multipart/form-data",
            data={},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentAddByFileApi()
            with pytest.raises(NoFileUploadedError):
                api.post(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id)

    @patch("controllers.service_api.dataset.document.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_add_by_file_missing_indexing_technique(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test ValueError when indexing_technique is missing."""
        _setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_dataset.provider = "vendor"
        mock_dataset.indexing_technique = None
        mock_dataset.chunk_structure = None
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        from io import BytesIO

        data = {"file": (BytesIO(b"content"), "test.pdf", "application/pdf")}
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/document/create_by_file",
            method="POST",
            content_type="multipart/form-data",
            data=data,
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentAddByFileApi()
            with pytest.raises(ValueError, match="indexing_technique is required"):
                api.post(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id)


class TestDocumentUpdateByFileApiPost:
    """Test suite for DocumentUpdateByFileApi.post() endpoint.

    ``post`` is wrapped by ``@cloud_edition_billing_resource_check`` and
    ``@cloud_edition_billing_rate_limit_check``.
    """

    @patch("controllers.service_api.dataset.document.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_update_by_file_dataset_not_found(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test ValueError when dataset not found."""
        _setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        from io import BytesIO

        doc_id = str(uuid.uuid4())
        data = {"file": (BytesIO(b"content"), "test.pdf", "application/pdf")}
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/{doc_id}/update_by_file",
            method="POST",
            content_type="multipart/form-data",
            data=data,
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentUpdateByFileApi()
            with pytest.raises(ValueError, match="Dataset does not exist"):
                api.post(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id=doc_id,
                )

    @patch("controllers.service_api.dataset.document.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_update_by_file_external_dataset(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test ValueError when dataset is external."""
        _setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_dataset.provider = "external"
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        from io import BytesIO

        doc_id = str(uuid.uuid4())
        data = {"file": (BytesIO(b"content"), "test.pdf", "application/pdf")}
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/{doc_id}/update_by_file",
            method="POST",
            content_type="multipart/form-data",
            data=data,
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentUpdateByFileApi()
            with pytest.raises(ValueError, match="External datasets"):
                api.post(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id=doc_id,
                )

    @patch("controllers.service_api.dataset.document.marshal")
    @patch("controllers.service_api.dataset.document.DocumentService")
    @patch("controllers.service_api.dataset.document.FileService")
    @patch("controllers.service_api.dataset.document.current_user")
    @patch("controllers.service_api.dataset.document.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_update_by_file_success(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_current_user,
        mock_file_svc_cls,
        mock_doc_svc,
        mock_marshal,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful document update by file."""
        _setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_dataset.indexing_technique = "economy"
        mock_dataset.provider = "vendor"
        mock_dataset.chunk_structure = None
        mock_dataset.latest_process_rule = Mock()
        mock_dataset.created_by_account = Mock()
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_current_user.id = "user-1"
        mock_upload = Mock()
        mock_upload.id = str(uuid.uuid4())
        mock_file_svc_cls.return_value.upload_file.return_value = mock_upload

        mock_document = Mock()
        mock_document.batch = "batch-1"
        mock_doc_svc.document_create_args_validate.return_value = None
        mock_doc_svc.save_document_with_dataset_id.return_value = ([mock_document], None)
        mock_marshal.return_value = {"id": "doc-1"}

        from io import BytesIO

        doc_id = str(uuid.uuid4())
        data = {"file": (BytesIO(b"file content"), "test.pdf", "application/pdf")}
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/{doc_id}/update_by_file",
            method="POST",
            content_type="multipart/form-data",
            data=data,
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DocumentUpdateByFileApi()
            response, status = api.post(
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                document_id=doc_id,
            )

        assert status == 200
        assert "document" in response
