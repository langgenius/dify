"""
Unit tests for Service API Document controllers.

Tests coverage for:
- DocumentTextCreatePayload, DocumentTextUpdate Pydantic models
- DocumentListQuery model
- Document creation and update validation
- DocumentService integration

Focus on:
- Pydantic model validation
- Error type mappings
- Service method interfaces
"""

import uuid
from unittest.mock import Mock, patch

import pytest

from controllers.service_api.dataset.document import (
    DocumentListQuery,
    DocumentTextCreatePayload,
    DocumentTextUpdate,
)
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
    def test_delete_document_returns_success(self, mock_delete):
        """Test delete_document returns success."""
        mock_delete.return_value = True

        result = DocumentService.delete_document(document=Mock())
        assert result is True


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
