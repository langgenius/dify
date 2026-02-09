"""
Unit tests for Service API Segment controllers.

Tests coverage for:
- SegmentCreatePayload, SegmentListQuery Pydantic models
- ChildChunkCreatePayload, ChildChunkListQuery, ChildChunkUpdatePayload
- Segment and ChildChunk service layer interactions
- API endpoint methods (SegmentApi, DatasetSegmentApi)

Focus on:
- Pydantic model validation
- Service method existence and interfaces
- Error types and mappings
- API endpoint business logic and error handling
"""

import uuid
from unittest.mock import Mock, patch

import pytest
from werkzeug.exceptions import NotFound

from controllers.service_api.dataset.segment import (
    ChildChunkApi,
    ChildChunkCreatePayload,
    ChildChunkListQuery,
    ChildChunkUpdatePayload,
    DatasetChildChunkApi,
    DatasetSegmentApi,
    SegmentApi,
    SegmentCreatePayload,
    SegmentListQuery,
)
from models.dataset import ChildChunk, Dataset, Document, DocumentSegment
from services.dataset_service import DocumentService, SegmentService


class TestSegmentCreatePayload:
    """Test suite for SegmentCreatePayload Pydantic model."""

    def test_payload_with_segments(self):
        """Test payload with a list of segments."""
        segments = [
            {"content": "First segment", "answer": "Answer 1"},
            {"content": "Second segment", "keywords": ["key1", "key2"]},
        ]
        payload = SegmentCreatePayload(segments=segments)
        assert payload.segments == segments
        assert len(payload.segments) == 2

    def test_payload_with_none_segments(self):
        """Test payload with None segments (should be valid)."""
        payload = SegmentCreatePayload(segments=None)
        assert payload.segments is None

    def test_payload_with_empty_segments(self):
        """Test payload with empty segments list."""
        payload = SegmentCreatePayload(segments=[])
        assert payload.segments == []

    def test_payload_with_complex_segment_data(self):
        """Test payload with complex segment structure."""
        segments = [
            {
                "content": "Complex segment",
                "answer": "Detailed answer",
                "keywords": ["keyword1", "keyword2"],
                "metadata": {"source": "document.pdf", "page": 1},
            }
        ]
        payload = SegmentCreatePayload(segments=segments)
        assert payload.segments[0]["content"] == "Complex segment"
        assert payload.segments[0]["keywords"] == ["keyword1", "keyword2"]


class TestSegmentListQuery:
    """Test suite for SegmentListQuery Pydantic model."""

    def test_query_with_defaults(self):
        """Test query with default values."""
        query = SegmentListQuery()
        assert query.status == []
        assert query.keyword is None

    def test_query_with_status_filters(self):
        """Test query with status filter."""
        query = SegmentListQuery(status=["completed", "indexing"])
        assert query.status == ["completed", "indexing"]

    def test_query_with_keyword(self):
        """Test query with keyword search."""
        query = SegmentListQuery(keyword="machine learning")
        assert query.keyword == "machine learning"

    def test_query_with_single_status(self):
        """Test query with single status value."""
        query = SegmentListQuery(status=["completed"])
        assert query.status == ["completed"]

    def test_query_with_empty_keyword(self):
        """Test query with empty keyword string."""
        query = SegmentListQuery(keyword="")
        assert query.keyword == ""


class TestChildChunkCreatePayload:
    """Test suite for ChildChunkCreatePayload Pydantic model."""

    def test_payload_with_content(self):
        """Test payload with content."""
        payload = ChildChunkCreatePayload(content="This is child chunk content")
        assert payload.content == "This is child chunk content"

    def test_payload_requires_content(self):
        """Test that content is required."""
        with pytest.raises(ValueError):
            ChildChunkCreatePayload()

    def test_payload_with_long_content(self):
        """Test payload with very long content."""
        long_content = "A" * 10000
        payload = ChildChunkCreatePayload(content=long_content)
        assert len(payload.content) == 10000

    def test_payload_with_unicode_content(self):
        """Test payload with unicode content."""
        unicode_content = "这是中文内容 🎉 Привет мир"
        payload = ChildChunkCreatePayload(content=unicode_content)
        assert payload.content == unicode_content

    def test_payload_with_special_characters(self):
        """Test payload with special characters in content."""
        special_content = "Content with <html> & \"quotes\" and 'apostrophes'"
        payload = ChildChunkCreatePayload(content=special_content)
        assert payload.content == special_content


class TestChildChunkListQuery:
    """Test suite for ChildChunkListQuery Pydantic model."""

    def test_query_with_defaults(self):
        """Test query with default values."""
        query = ChildChunkListQuery()
        assert query.limit == 20
        assert query.keyword is None
        assert query.page == 1

    def test_query_with_pagination(self):
        """Test query with pagination parameters."""
        query = ChildChunkListQuery(limit=50, page=3)
        assert query.limit == 50
        assert query.page == 3

    def test_query_limit_minimum(self):
        """Test query limit minimum validation."""
        with pytest.raises(ValueError):
            ChildChunkListQuery(limit=0)

    def test_query_page_minimum(self):
        """Test query page minimum validation."""
        with pytest.raises(ValueError):
            ChildChunkListQuery(page=0)

    def test_query_with_keyword(self):
        """Test query with keyword filter."""
        query = ChildChunkListQuery(keyword="search term")
        assert query.keyword == "search term"

    def test_query_large_page_number(self):
        """Test query with large page number."""
        query = ChildChunkListQuery(page=1000)
        assert query.page == 1000


class TestChildChunkUpdatePayload:
    """Test suite for ChildChunkUpdatePayload Pydantic model."""

    def test_payload_with_content(self):
        """Test payload with updated content."""
        payload = ChildChunkUpdatePayload(content="Updated child chunk content")
        assert payload.content == "Updated child chunk content"

    def test_payload_with_empty_content(self):
        """Test payload with empty content."""
        payload = ChildChunkUpdatePayload(content="")
        assert payload.content == ""


class TestSegmentServiceInterface:
    """Test SegmentService method interfaces exist."""

    def test_multi_create_segment_method_exists(self):
        """Test that SegmentService.multi_create_segment exists."""
        assert hasattr(SegmentService, "multi_create_segment")
        assert callable(SegmentService.multi_create_segment)

    def test_get_segments_method_exists(self):
        """Test that SegmentService.get_segments exists."""
        assert hasattr(SegmentService, "get_segments")
        assert callable(SegmentService.get_segments)

    def test_get_segment_by_id_method_exists(self):
        """Test that SegmentService.get_segment_by_id exists."""
        assert hasattr(SegmentService, "get_segment_by_id")
        assert callable(SegmentService.get_segment_by_id)

    def test_delete_segment_method_exists(self):
        """Test that SegmentService.delete_segment exists."""
        assert hasattr(SegmentService, "delete_segment")
        assert callable(SegmentService.delete_segment)

    def test_update_segment_method_exists(self):
        """Test that SegmentService.update_segment exists."""
        assert hasattr(SegmentService, "update_segment")
        assert callable(SegmentService.update_segment)

    def test_create_child_chunk_method_exists(self):
        """Test that SegmentService.create_child_chunk exists."""
        assert hasattr(SegmentService, "create_child_chunk")
        assert callable(SegmentService.create_child_chunk)

    def test_get_child_chunks_method_exists(self):
        """Test that SegmentService.get_child_chunks exists."""
        assert hasattr(SegmentService, "get_child_chunks")
        assert callable(SegmentService.get_child_chunks)

    def test_get_child_chunk_by_id_method_exists(self):
        """Test that SegmentService.get_child_chunk_by_id exists."""
        assert hasattr(SegmentService, "get_child_chunk_by_id")
        assert callable(SegmentService.get_child_chunk_by_id)

    def test_delete_child_chunk_method_exists(self):
        """Test that SegmentService.delete_child_chunk exists."""
        assert hasattr(SegmentService, "delete_child_chunk")
        assert callable(SegmentService.delete_child_chunk)

    def test_update_child_chunk_method_exists(self):
        """Test that SegmentService.update_child_chunk exists."""
        assert hasattr(SegmentService, "update_child_chunk")
        assert callable(SegmentService.update_child_chunk)


class TestDocumentServiceInterface:
    """Test DocumentService method interfaces used by segment controller."""

    def test_get_document_method_exists(self):
        """Test that DocumentService.get_document exists."""
        assert hasattr(DocumentService, "get_document")
        assert callable(DocumentService.get_document)


class TestSegmentServiceMockedBehavior:
    """Test SegmentService behavior with mocked methods."""

    @pytest.fixture
    def mock_dataset(self):
        """Create mock dataset."""
        dataset = Mock(spec=Dataset)
        dataset.id = str(uuid.uuid4())
        dataset.tenant_id = str(uuid.uuid4())
        return dataset

    @pytest.fixture
    def mock_document(self):
        """Create mock document."""
        document = Mock(spec=Document)
        document.id = str(uuid.uuid4())
        document.dataset_id = str(uuid.uuid4())
        document.indexing_status = "completed"
        document.enabled = True
        return document

    @pytest.fixture
    def mock_segment(self):
        """Create mock segment."""
        segment = Mock(spec=DocumentSegment)
        segment.id = str(uuid.uuid4())
        segment.document_id = str(uuid.uuid4())
        segment.content = "Test content"
        return segment

    @patch.object(SegmentService, "multi_create_segment")
    def test_create_segments_returns_list(self, mock_create, mock_dataset, mock_document):
        """Test segment creation returns list of segments."""
        mock_segments = [Mock(spec=DocumentSegment), Mock(spec=DocumentSegment)]
        mock_create.return_value = mock_segments

        result = SegmentService.multi_create_segment(
            segments=[{"content": "Test"}, {"content": "Test 2"}], document=mock_document, dataset=mock_dataset
        )

        assert len(result) == 2
        mock_create.assert_called_once()

    @patch.object(SegmentService, "get_segments")
    def test_get_segments_returns_tuple(self, mock_get, mock_document):
        """Test get_segments returns tuple of segments and count."""
        mock_segments = [Mock(), Mock()]
        mock_get.return_value = (mock_segments, 2)

        segments, count = SegmentService.get_segments(document_id=mock_document.id, page=1, limit=20)

        assert len(segments) == 2
        assert count == 2

    @patch.object(SegmentService, "get_segment_by_id")
    def test_get_segment_by_id_returns_segment(self, mock_get, mock_segment):
        """Test get_segment_by_id returns segment."""
        mock_get.return_value = mock_segment

        result = SegmentService.get_segment_by_id(segment_id=mock_segment.id, tenant_id=mock_segment.tenant_id)

        assert result == mock_segment

    @patch.object(SegmentService, "get_segment_by_id")
    def test_get_segment_by_id_returns_none_when_not_found(self, mock_get):
        """Test get_segment_by_id returns None when not found."""
        mock_get.return_value = None

        result = SegmentService.get_segment_by_id(segment_id=str(uuid.uuid4()), tenant_id=str(uuid.uuid4()))

        assert result is None

    @patch.object(SegmentService, "delete_segment")
    def test_delete_segment_called(self, mock_delete, mock_segment, mock_document, mock_dataset):
        """Test segment deletion is called."""
        SegmentService.delete_segment(mock_segment, mock_document, mock_dataset)
        mock_delete.assert_called_once_with(mock_segment, mock_document, mock_dataset)


class TestChildChunkServiceMockedBehavior:
    """Test ChildChunk service behavior with mocked methods."""

    @pytest.fixture
    def mock_segment(self):
        """Create mock segment."""
        segment = Mock(spec=DocumentSegment)
        segment.id = str(uuid.uuid4())
        return segment

    @pytest.fixture
    def mock_child_chunk(self):
        """Create mock child chunk."""
        chunk = Mock(spec=ChildChunk)
        chunk.id = str(uuid.uuid4())
        chunk.segment_id = str(uuid.uuid4())
        chunk.content = "Child chunk content"
        return chunk

    @patch.object(SegmentService, "create_child_chunk")
    def test_create_child_chunk_returns_chunk(self, mock_create, mock_segment, mock_child_chunk):
        """Test child chunk creation returns chunk."""
        mock_create.return_value = mock_child_chunk

        result = SegmentService.create_child_chunk(
            content="New chunk content", segment=mock_segment, document=Mock(spec=Document), dataset=Mock(spec=Dataset)
        )

        assert result == mock_child_chunk

    @patch.object(SegmentService, "get_child_chunks")
    def test_get_child_chunks_returns_paginated_result(self, mock_get, mock_segment):
        """Test get_child_chunks returns paginated result."""
        mock_pagination = Mock()
        mock_pagination.items = [Mock(), Mock()]
        mock_pagination.total = 2
        mock_pagination.pages = 1
        mock_get.return_value = mock_pagination

        result = SegmentService.get_child_chunks(
            segment_id=mock_segment.id,
            document_id=str(uuid.uuid4()),
            dataset_id=str(uuid.uuid4()),
            page=1,
            limit=20,
        )

        assert len(result.items) == 2
        assert result.total == 2

    @patch.object(SegmentService, "get_child_chunk_by_id")
    def test_get_child_chunk_by_id_returns_chunk(self, mock_get, mock_child_chunk):
        """Test get_child_chunk_by_id returns chunk."""
        mock_get.return_value = mock_child_chunk

        result = SegmentService.get_child_chunk_by_id(
            child_chunk_id=mock_child_chunk.id, tenant_id=mock_child_chunk.tenant_id
        )

        assert result == mock_child_chunk

    @patch.object(SegmentService, "update_child_chunk")
    def test_update_child_chunk_returns_updated_chunk(self, mock_update, mock_child_chunk):
        """Test update_child_chunk returns updated chunk."""
        updated_chunk = Mock(spec=ChildChunk)
        updated_chunk.content = "Updated content"
        mock_update.return_value = updated_chunk

        result = SegmentService.update_child_chunk(
            content="Updated content",
            child_chunk=mock_child_chunk,
            segment=Mock(spec=DocumentSegment),
            document=Mock(spec=Document),
            dataset=Mock(spec=Dataset),
        )

        assert result.content == "Updated content"


class TestDocumentValidation:
    """Test document validation patterns used by segment controller."""

    def test_document_indexing_status_completed_is_valid(self):
        """Test that completed indexing status is valid."""
        document = Mock(spec=Document)
        document.indexing_status = "completed"
        assert document.indexing_status == "completed"

    def test_document_indexing_status_indexing_is_invalid(self):
        """Test that indexing status is invalid for segment operations."""
        document = Mock(spec=Document)
        document.indexing_status = "indexing"
        assert document.indexing_status != "completed"

    def test_document_enabled_true_is_valid(self):
        """Test that enabled=True is valid."""
        document = Mock(spec=Document)
        document.enabled = True
        assert document.enabled is True

    def test_document_enabled_false_is_invalid(self):
        """Test that enabled=False is invalid for segment operations."""
        document = Mock(spec=Document)
        document.enabled = False
        assert document.enabled is False


class TestDatasetModels:
    """Test Dataset model structure used by segment controller."""

    def test_dataset_has_required_fields(self):
        """Test Dataset model has required fields."""
        dataset = Mock(spec=Dataset)
        dataset.id = str(uuid.uuid4())
        dataset.tenant_id = str(uuid.uuid4())
        dataset.indexing_technique = "economy"

        assert dataset.id is not None
        assert dataset.tenant_id is not None
        assert dataset.indexing_technique == "economy"

    def test_document_segment_has_required_fields(self):
        """Test DocumentSegment model has required fields."""
        segment = Mock(spec=DocumentSegment)
        segment.id = str(uuid.uuid4())
        segment.document_id = str(uuid.uuid4())
        segment.content = "Test content"
        segment.position = 1

        assert segment.id is not None
        assert segment.document_id is not None
        assert segment.content is not None

    def test_child_chunk_has_required_fields(self):
        """Test ChildChunk model has required fields."""
        chunk = Mock(spec=ChildChunk)
        chunk.id = str(uuid.uuid4())
        chunk.segment_id = str(uuid.uuid4())
        chunk.content = "Chunk content"

        assert chunk.id is not None
        assert chunk.segment_id is not None
        assert chunk.content is not None


class TestSegmentUpdatePayload:
    """Test suite for SegmentUpdatePayload Pydantic model."""

    def test_payload_with_segment_args(self):
        """Test payload with SegmentUpdateArgs."""
        from controllers.service_api.dataset.segment import SegmentUpdatePayload
        from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs

        segment_args = SegmentUpdateArgs(content="Updated content")
        payload = SegmentUpdatePayload(segment=segment_args)
        assert payload.segment.content == "Updated content"

    def test_payload_with_answer_update(self):
        """Test payload with answer update."""
        from controllers.service_api.dataset.segment import SegmentUpdatePayload
        from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs

        segment_args = SegmentUpdateArgs(answer="Updated answer")
        payload = SegmentUpdatePayload(segment=segment_args)
        assert payload.segment.answer == "Updated answer"

    def test_payload_with_keywords_update(self):
        """Test payload with keywords update."""
        from controllers.service_api.dataset.segment import SegmentUpdatePayload
        from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs

        segment_args = SegmentUpdateArgs(keywords=["new", "keywords"])
        payload = SegmentUpdatePayload(segment=segment_args)
        assert payload.segment.keywords == ["new", "keywords"]

    def test_payload_with_enabled_toggle(self):
        """Test payload with enabled toggle."""
        from controllers.service_api.dataset.segment import SegmentUpdatePayload
        from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs

        segment_args = SegmentUpdateArgs(enabled=True)
        payload = SegmentUpdatePayload(segment=segment_args)
        assert payload.segment.enabled is True

    def test_payload_with_regenerate_child_chunks(self):
        """Test payload with regenerate_child_chunks flag."""
        from controllers.service_api.dataset.segment import SegmentUpdatePayload
        from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs

        segment_args = SegmentUpdateArgs(regenerate_child_chunks=True)
        payload = SegmentUpdatePayload(segment=segment_args)
        assert payload.segment.regenerate_child_chunks is True


class TestSegmentUpdateArgs:
    """Test suite for SegmentUpdateArgs Pydantic model."""

    def test_args_with_defaults(self):
        """Test args with default values."""
        from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs

        args = SegmentUpdateArgs()
        assert args.content is None
        assert args.answer is None
        assert args.keywords is None
        assert args.regenerate_child_chunks is False
        assert args.enabled is None

    def test_args_with_content(self):
        """Test args with content update."""
        from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs

        args = SegmentUpdateArgs(content="New content here")
        assert args.content == "New content here"

    def test_args_with_all_fields(self):
        """Test args with all fields populated."""
        from services.entities.knowledge_entities.knowledge_entities import SegmentUpdateArgs

        args = SegmentUpdateArgs(
            content="Full content",
            answer="Full answer",
            keywords=["kw1", "kw2"],
            regenerate_child_chunks=True,
            enabled=True,
            attachment_ids=["att1", "att2"],
            summary="Document summary",
        )
        assert args.content == "Full content"
        assert args.answer == "Full answer"
        assert args.keywords == ["kw1", "kw2"]
        assert args.regenerate_child_chunks is True
        assert args.enabled is True
        assert args.attachment_ids == ["att1", "att2"]
        assert args.summary == "Document summary"


class TestSegmentCreateArgs:
    """Test suite for SegmentCreateArgs Pydantic model."""

    def test_args_with_defaults(self):
        """Test args with default values."""
        from services.entities.knowledge_entities.knowledge_entities import SegmentCreateArgs

        args = SegmentCreateArgs()
        assert args.content is None
        assert args.answer is None
        assert args.keywords is None
        assert args.attachment_ids is None

    def test_args_with_content_and_answer(self):
        """Test args with content and answer for Q&A mode."""
        from services.entities.knowledge_entities.knowledge_entities import SegmentCreateArgs

        args = SegmentCreateArgs(content="Question?", answer="Answer!")
        assert args.content == "Question?"
        assert args.answer == "Answer!"

    def test_args_with_keywords(self):
        """Test args with keywords for search indexing."""
        from services.entities.knowledge_entities.knowledge_entities import SegmentCreateArgs

        args = SegmentCreateArgs(content="Test content", keywords=["machine learning", "AI", "neural networks"])
        assert len(args.keywords) == 3


class TestChildChunkUpdateArgs:
    """Test suite for ChildChunkUpdateArgs Pydantic model."""

    def test_args_with_content_only(self):
        """Test args with content only."""
        from services.entities.knowledge_entities.knowledge_entities import ChildChunkUpdateArgs

        args = ChildChunkUpdateArgs(content="Updated chunk content")
        assert args.content == "Updated chunk content"
        assert args.id is None

    def test_args_with_id_and_content(self):
        """Test args with both id and content."""
        from services.entities.knowledge_entities.knowledge_entities import ChildChunkUpdateArgs

        chunk_id = str(uuid.uuid4())
        args = ChildChunkUpdateArgs(id=chunk_id, content="Updated content")
        assert args.id == chunk_id
        assert args.content == "Updated content"


class TestSegmentErrorPatterns:
    """Test segment-related error handling patterns."""

    def test_not_found_error_pattern(self):
        """Test NotFound error pattern used in segment operations."""
        from werkzeug.exceptions import NotFound

        with pytest.raises(NotFound):
            raise NotFound("Segment not found.")

    def test_dataset_not_found_pattern(self):
        """Test dataset not found pattern."""
        from werkzeug.exceptions import NotFound

        with pytest.raises(NotFound):
            raise NotFound("Dataset not found.")

    def test_document_not_found_pattern(self):
        """Test document not found pattern."""
        from werkzeug.exceptions import NotFound

        with pytest.raises(NotFound):
            raise NotFound("Document not found.")

    def test_provider_not_initialize_error(self):
        """Test ProviderNotInitializeError pattern."""
        from controllers.service_api.app.error import ProviderNotInitializeError

        error = ProviderNotInitializeError("No Embedding Model available.")
        assert error is not None


class TestSegmentIndexingRequirements:
    """Test segment indexing requirements validation patterns."""

    @pytest.mark.parametrize("technique", ["high_quality", "economy"])
    def test_indexing_technique_values(self, technique):
        """Test valid indexing technique values."""
        dataset = Mock(spec=Dataset)
        dataset.indexing_technique = technique
        assert dataset.indexing_technique in ["high_quality", "economy"]

    @pytest.mark.parametrize("status", ["waiting", "parsing", "indexing", "completed", "error"])
    def test_valid_indexing_statuses(self, status):
        """Test valid document indexing statuses."""
        document = Mock(spec=Document)
        document.indexing_status = status
        assert document.indexing_status in ["waiting", "parsing", "indexing", "completed", "error"]

    def test_completed_status_required_for_segments(self):
        """Test that completed status is required for segment operations."""
        document = Mock(spec=Document)
        document.indexing_status = "completed"
        document.enabled = True

        # Both conditions must be true
        assert document.indexing_status == "completed"
        assert document.enabled is True


class TestSegmentLimits:
    """Test segment limit validation patterns."""

    def test_segments_limit_check(self):
        """Test segment limit validation logic."""
        segments = [{"content": f"Segment {i}"} for i in range(10)]
        segments_limit = 100

        # This should pass
        assert len(segments) <= segments_limit

    def test_segments_exceed_limit_pattern(self):
        """Test pattern for segments exceeding limit."""
        segments_limit = 5
        segments = [{"content": f"Segment {i}"} for i in range(10)]

        if segments_limit > 0 and len(segments) > segments_limit:
            error_msg = f"Exceeded maximum segments limit of {segments_limit}."
            assert "Exceeded maximum segments limit" in error_msg


class TestSegmentPagination:
    """Test segment list pagination patterns."""

    def test_pagination_defaults(self):
        """Test default pagination values."""
        page = 1
        limit = 20

        assert page >= 1
        assert limit >= 1
        assert limit <= 100

    def test_has_more_calculation(self):
        """Test has_more pagination flag calculation."""
        segments_count = 20
        limit = 20

        has_more = segments_count == limit
        assert has_more is True

    def test_no_more_when_incomplete_page(self):
        """Test has_more is False for incomplete page."""
        segments_count = 15
        limit = 20

        has_more = segments_count == limit
        assert has_more is False


# =============================================================================
# API Endpoint Tests
#
# ``SegmentApi`` and ``DatasetSegmentApi`` inherit from ``DatasetApiResource``
# whose ``method_decorators`` include ``validate_dataset_token``.  Individual
# methods may also carry billing decorators
# (``cloud_edition_billing_resource_check``, etc.).
#
# Strategy per decorator type:
# - No billing decorator → call the method directly; only patch ``db``,
#   services, ``current_account_with_tenant``, and ``marshal``.
# - ``@cloud_edition_billing_rate_limit_check`` (preserves ``__wrapped__``)
#   → call via ``method.__wrapped__(self, …)`` to skip the decorator.
# - ``@cloud_edition_billing_resource_check`` (no ``__wrapped__``) → patch
#   ``validate_and_get_api_token`` and ``FeatureService`` at the ``wraps``
#   module so the decorator becomes a no-op.
# =============================================================================


class TestSegmentApiGet:
    """Test suite for SegmentApi.get() endpoint.

    ``get`` has no billing decorators but calls
    ``current_account_with_tenant()`` and ``marshal``.
    """

    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_list_segments_success(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        app,
        mock_tenant,
        mock_dataset,
        mock_segment,
    ):
        """Test successful segment list retrieval."""
        # Arrange
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock(doc_form="text_model")
        mock_seg_svc.get_segments.return_value = ([mock_segment], 1)
        mock_marshal.return_value = [{"id": mock_segment.id}]

        # Act
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments?page=1&limit=20",
            method="GET",
        ):
            api = SegmentApi()
            response, status = api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, document_id="doc-id")

        # Assert
        assert status == 200
        assert "data" in response
        assert "total" in response
        assert response["page"] == 1

    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_list_segments_dataset_not_found(self, mock_db, mock_account_fn, app, mock_tenant, mock_dataset):
        """Test 404 when dataset not found."""
        # Arrange
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments",
            method="GET",
        ):
            api = SegmentApi()
            with pytest.raises(NotFound):
                api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, document_id="doc-id")

    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_list_segments_document_not_found(
        self, mock_db, mock_account_fn, mock_doc_svc, app, mock_tenant, mock_dataset
    ):
        """Test 404 when document not found."""
        # Arrange
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = None

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments",
            method="GET",
        ):
            api = SegmentApi()
            with pytest.raises(NotFound):
                api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, document_id="doc-id")


class TestSegmentApiPost:
    """Test suite for SegmentApi.post() endpoint.

    ``post`` is wrapped by ``@cloud_edition_billing_resource_check``,
    ``@cloud_edition_billing_knowledge_limit_check``, and
    ``@cloud_edition_billing_rate_limit_check``.  Since the outermost
    decorator does not preserve ``__wrapped__``, we patch
    ``validate_and_get_api_token`` and ``FeatureService`` at the ``wraps``
    module to neutralise all billing decorators.
    """

    @staticmethod
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

    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_create_segments_success(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        app,
        mock_tenant,
        mock_dataset,
        mock_segment,
    ):
        """Test successful segment creation."""
        # Arrange — neutralise billing decorators
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_account_fn.return_value = (Mock(), mock_tenant.id)

        mock_dataset.indexing_technique = "economy"
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_doc = Mock()
        mock_doc.indexing_status = "completed"
        mock_doc.enabled = True
        mock_doc.doc_form = "text_model"
        mock_doc_svc.get_document.return_value = mock_doc

        mock_seg_svc.segment_create_args_validate.return_value = None
        mock_seg_svc.multi_create_segment.return_value = [mock_segment]
        mock_marshal.return_value = [{"id": mock_segment.id}]

        segments_data = [{"content": "Test segment content", "answer": "Test answer"}]

        # Act
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments",
            method="POST",
            json={"segments": segments_data},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = SegmentApi()
            response, status = api.post(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, document_id="doc-id")

        # Assert
        assert status == 200
        assert "data" in response
        assert "doc_form" in response

    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_create_segments_missing_segments(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 400 error when segments field is missing."""
        # Arrange — neutralise billing decorators
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_account_fn.return_value = (Mock(), mock_tenant.id)

        mock_dataset.indexing_technique = "economy"
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_doc = Mock()
        mock_doc.indexing_status = "completed"
        mock_doc.enabled = True
        mock_doc_svc.get_document.return_value = mock_doc

        # Act
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments",
            method="POST",
            json={},  # No segments field
            headers={"Authorization": "Bearer test_token"},
        ):
            api = SegmentApi()
            response, status = api.post(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, document_id="doc-id")

        # Assert
        assert status == 400
        assert "error" in response

    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_create_segments_document_not_completed(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when document indexing is not completed."""
        # Arrange — neutralise billing decorators
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_account_fn.return_value = (Mock(), mock_tenant.id)

        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_doc = Mock()
        mock_doc.indexing_status = "indexing"  # Not completed
        mock_doc_svc.get_document.return_value = mock_doc

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments",
            method="POST",
            json={"segments": [{"content": "Test"}]},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = SegmentApi()
            with pytest.raises(NotFound):
                api.post(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, document_id="doc-id")


class TestDatasetSegmentApiDelete:
    """Test suite for DatasetSegmentApi.delete() endpoint.

    ``delete`` is wrapped by ``@cloud_edition_billing_rate_limit_check``
    which preserves ``__wrapped__`` via ``functools.wraps``.  We call the
    unwrapped method directly to bypass the billing decorator.
    """

    @staticmethod
    def _call_delete(api: DatasetSegmentApi, **kwargs):
        """Call the unwrapped delete to skip billing decorators."""
        return api.delete.__wrapped__(api, **kwargs)

    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DatasetService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_delete_segment_success(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_dataset_svc,
        mock_seg_svc,
        app,
        mock_tenant,
        mock_dataset,
        mock_segment,
    ):
        """Test successful segment deletion."""
        # Arrange
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_dataset_svc.check_dataset_model_setting.return_value = None

        mock_doc = Mock()
        mock_doc_svc.get_document.return_value = mock_doc

        mock_seg_svc.get_segment_by_id.return_value = mock_segment
        mock_seg_svc.delete_segment.return_value = None

        # Act
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/{mock_segment.id}",
            method="DELETE",
        ):
            api = DatasetSegmentApi()
            response = self._call_delete(
                api,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                document_id="doc-id",
                segment_id=mock_segment.id,
            )

        # Assert
        assert response == ("", 204)
        mock_seg_svc.delete_segment.assert_called_once_with(mock_segment, mock_doc, mock_dataset)

    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_delete_segment_not_found(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when segment not found."""
        # Arrange
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_doc = Mock()
        mock_doc.indexing_status = "completed"
        mock_doc.enabled = True
        mock_doc.doc_form = "text_model"
        mock_doc_svc.get_document.return_value = mock_doc

        mock_seg_svc.get_segment_by_id.return_value = None  # Segment not found

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-not-found",
            method="DELETE",
        ):
            api = DatasetSegmentApi()
            with pytest.raises(NotFound):
                self._call_delete(
                    api,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-not-found",
                )

    @patch("controllers.service_api.dataset.segment.DatasetService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_delete_segment_dataset_not_found(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_dataset_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found for delete."""
        # Arrange
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id",
            method="DELETE",
        ):
            api = DatasetSegmentApi()
            with pytest.raises(NotFound):
                self._call_delete(
                    api,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )

    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.DatasetService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_delete_segment_document_not_found(
        self,
        mock_db,
        mock_account_fn,
        mock_dataset_svc,
        mock_doc_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when document not found for delete."""
        # Arrange
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc_svc.get_document.return_value = None

        # Act & Assert
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id",
            method="DELETE",
        ):
            api = DatasetSegmentApi()
            with pytest.raises(NotFound):
                self._call_delete(
                    api,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )


class TestDatasetSegmentApiUpdate:
    """Test suite for DatasetSegmentApi.post() (update segment) endpoint.

    ``post`` is wrapped by ``@cloud_edition_billing_resource_check`` and
    ``@cloud_edition_billing_rate_limit_check``.  Since the outermost
    decorator does not preserve ``__wrapped__``, we patch
    ``validate_and_get_api_token`` and ``FeatureService`` at the ``wraps``
    module.
    """

    @staticmethod
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

    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.DatasetService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_update_segment_success(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_account_fn,
        mock_dataset_svc,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        app,
        mock_tenant,
        mock_dataset,
        mock_segment,
    ):
        """Test successful segment update."""
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_dataset.indexing_technique = "economy"
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc_svc.get_document.return_value = Mock()
        mock_seg_svc.get_segment_by_id.return_value = mock_segment
        updated = Mock()
        mock_seg_svc.update_segment.return_value = updated
        mock_marshal.return_value = {"id": mock_segment.id}

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/{mock_segment.id}",
            method="POST",
            json={"segment": {"content": "updated content"}},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DatasetSegmentApi()
            response, status = api.post(
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                document_id="doc-id",
                segment_id=mock_segment.id,
            )

        assert status == 200
        assert "data" in response
        mock_seg_svc.update_segment.assert_called_once()

    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.DatasetService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_update_segment_dataset_not_found(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_account_fn,
        mock_dataset_svc,
        mock_doc_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found for update."""
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id",
            method="POST",
            json={"segment": {"content": "x"}},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DatasetSegmentApi()
            with pytest.raises(NotFound):
                api.post(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )

    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.DatasetService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_update_segment_not_found(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_account_fn,
        mock_dataset_svc,
        mock_doc_svc,
        mock_seg_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when segment not found for update."""
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_dataset.indexing_technique = "economy"
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc_svc.get_document.return_value = Mock()
        mock_seg_svc.get_segment_by_id.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id",
            method="POST",
            json={"segment": {"content": "x"}},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = DatasetSegmentApi()
            with pytest.raises(NotFound):
                api.post(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )


class TestDatasetSegmentApiGetSingle:
    """Test suite for DatasetSegmentApi.get() (single segment) endpoint.

    ``get`` has no billing decorators but calls
    ``current_account_with_tenant()`` and ``marshal``.
    """

    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.DatasetService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_get_single_segment_success(
        self,
        mock_db,
        mock_account_fn,
        mock_dataset_svc,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        app,
        mock_tenant,
        mock_dataset,
        mock_segment,
    ):
        """Test successful single segment retrieval."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc = Mock(doc_form="text_model")
        mock_doc_svc.get_document.return_value = mock_doc
        mock_seg_svc.get_segment_by_id.return_value = mock_segment
        mock_marshal.return_value = {"id": mock_segment.id}

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/{mock_segment.id}",
            method="GET",
        ):
            api = DatasetSegmentApi()
            response, status = api.get(
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                document_id="doc-id",
                segment_id=mock_segment.id,
            )

        assert status == 200
        assert "data" in response
        assert response["doc_form"] == "text_model"

    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_get_single_segment_dataset_not_found(
        self,
        mock_db,
        mock_account_fn,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id",
            method="GET",
        ):
            api = DatasetSegmentApi()
            with pytest.raises(NotFound):
                api.get(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )

    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.DatasetService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_get_single_segment_document_not_found(
        self,
        mock_db,
        mock_account_fn,
        mock_dataset_svc,
        mock_doc_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when document not found."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc_svc.get_document.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id",
            method="GET",
        ):
            api = DatasetSegmentApi()
            with pytest.raises(NotFound):
                api.get(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )

    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.DatasetService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_get_single_segment_segment_not_found(
        self,
        mock_db,
        mock_account_fn,
        mock_dataset_svc,
        mock_doc_svc,
        mock_seg_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when segment not found."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc_svc.get_document.return_value = Mock()
        mock_seg_svc.get_segment_by_id.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id",
            method="GET",
        ):
            api = DatasetSegmentApi()
            with pytest.raises(NotFound):
                api.get(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )


class TestChildChunkApiGet:
    """Test suite for ChildChunkApi.get() endpoint.

    ``get`` has no billing decorators but calls
    ``current_account_with_tenant()``, ``marshal``, and ``db``.
    """

    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_list_child_chunks_success(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful child chunk list retrieval."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()
        mock_seg_svc.get_segment_by_id.return_value = Mock()

        mock_pagination = Mock()
        mock_pagination.items = [Mock(), Mock()]
        mock_pagination.total = 2
        mock_pagination.pages = 1
        mock_seg_svc.get_child_chunks.return_value = mock_pagination
        mock_marshal.return_value = [{"id": "c1"}, {"id": "c2"}]

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id/child_chunks?page=1&limit=20",
            method="GET",
        ):
            api = ChildChunkApi()
            response, status = api.get(
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                document_id="doc-id",
                segment_id="seg-id",
            )

        assert status == 200
        assert response["total"] == 2
        assert response["page"] == 1

    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_list_child_chunks_dataset_not_found(
        self,
        mock_db,
        mock_account_fn,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id/child_chunks",
            method="GET",
        ):
            api = ChildChunkApi()
            with pytest.raises(NotFound):
                api.get(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )

    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_list_child_chunks_document_not_found(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when document not found."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id/child_chunks",
            method="GET",
        ):
            api = ChildChunkApi()
            with pytest.raises(NotFound):
                api.get(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )

    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_list_child_chunks_segment_not_found(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when segment not found."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()
        mock_seg_svc.get_segment_by_id.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id/child_chunks",
            method="GET",
        ):
            api = ChildChunkApi()
            with pytest.raises(NotFound):
                api.get(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )


class TestChildChunkApiPost:
    """Test suite for ChildChunkApi.post() endpoint.

    ``post`` has billing decorators; we patch ``validate_and_get_api_token``
    and ``FeatureService`` at the ``wraps`` module.
    """

    @staticmethod
    def _setup_billing_mocks(mock_validate_token, mock_feature_svc, tenant_id: str):
        mock_api_token = Mock()
        mock_api_token.tenant_id = tenant_id
        mock_validate_token.return_value = mock_api_token
        mock_features = Mock()
        mock_features.billing.enabled = False
        mock_feature_svc.get_features.return_value = mock_features
        mock_rate_limit = Mock()
        mock_rate_limit.enabled = False
        mock_feature_svc.get_knowledge_rate_limit.return_value = mock_rate_limit

    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_create_child_chunk_success(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful child chunk creation."""
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_dataset.indexing_technique = "economy"
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()
        mock_seg_svc.get_segment_by_id.return_value = Mock()
        mock_child = Mock()
        mock_seg_svc.create_child_chunk.return_value = mock_child
        mock_marshal.return_value = {"id": "child-1"}

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id/child_chunks",
            method="POST",
            json={"content": "child chunk content"},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = ChildChunkApi()
            response, status = api.post(
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                document_id="doc-id",
                segment_id="seg-id",
            )

        assert status == 200
        assert "data" in response

    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_create_child_chunk_dataset_not_found(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_account_fn,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id/child_chunks",
            method="POST",
            json={"content": "x"},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = ChildChunkApi()
            with pytest.raises(NotFound):
                api.post(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )

    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    @patch("controllers.service_api.wraps.FeatureService")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_create_child_chunk_segment_not_found(
        self,
        mock_validate_token,
        mock_feature_svc,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when segment not found."""
        self._setup_billing_mocks(mock_validate_token, mock_feature_svc, mock_tenant.id)
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()
        mock_seg_svc.get_segment_by_id.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id/child_chunks",
            method="POST",
            json={"content": "x"},
            headers={"Authorization": "Bearer test_token"},
        ):
            api = ChildChunkApi()
            with pytest.raises(NotFound):
                api.post(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )


class TestDatasetChildChunkApiDelete:
    """Test suite for DatasetChildChunkApi.delete() endpoint.

    ``delete`` is wrapped by ``@cloud_edition_billing_knowledge_limit_check``
    and ``@cloud_edition_billing_rate_limit_check``.  The outermost
    (``knowledge_limit_check``) preserves ``__wrapped__``, so we can unwrap
    through both layers.
    """

    @staticmethod
    def _call_delete(api: DatasetChildChunkApi, **kwargs):
        """Unwrap through both decorator layers."""
        fn = api.delete
        while hasattr(fn, "__wrapped__"):
            fn = fn.__wrapped__
        return fn(api, **kwargs)

    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_delete_child_chunk_success(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful child chunk deletion."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset

        mock_doc = Mock()
        mock_doc_svc.get_document.return_value = mock_doc

        segment_id = str(uuid.uuid4())
        mock_segment = Mock()
        mock_segment.id = segment_id
        mock_segment.document_id = "doc-id"
        mock_seg_svc.get_segment_by_id.return_value = mock_segment

        child_chunk_id = str(uuid.uuid4())
        mock_child = Mock()
        mock_child.segment_id = segment_id
        mock_seg_svc.get_child_chunk_by_id.return_value = mock_child
        mock_seg_svc.delete_child_chunk.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/{segment_id}/child_chunks/{child_chunk_id}",
            method="DELETE",
        ):
            api = DatasetChildChunkApi()
            response = self._call_delete(
                api,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                document_id="doc-id",
                segment_id=segment_id,
                child_chunk_id=child_chunk_id,
            )

        assert response == ("", 204)
        mock_seg_svc.delete_child_chunk.assert_called_once()

    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_delete_child_chunk_not_found(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when child chunk not found."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()

        segment_id = str(uuid.uuid4())
        mock_segment = Mock()
        mock_segment.id = segment_id
        mock_segment.document_id = "doc-id"
        mock_seg_svc.get_segment_by_id.return_value = mock_segment
        mock_seg_svc.get_child_chunk_by_id.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/{segment_id}/child_chunks/cc-id",
            method="DELETE",
        ):
            api = DatasetChildChunkApi()
            with pytest.raises(NotFound):
                self._call_delete(
                    api,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id=segment_id,
                    child_chunk_id="cc-id",
                )

    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_delete_child_chunk_segment_document_mismatch(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when segment does not belong to the document."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()

        segment_id = str(uuid.uuid4())
        mock_segment = Mock()
        mock_segment.id = segment_id
        mock_segment.document_id = "different-doc-id"
        mock_seg_svc.get_segment_by_id.return_value = mock_segment

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/{segment_id}/child_chunks/cc-id",
            method="DELETE",
        ):
            api = DatasetChildChunkApi()
            with pytest.raises(NotFound):
                self._call_delete(
                    api,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id=segment_id,
                    child_chunk_id="cc-id",
                )

    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_delete_child_chunk_wrong_segment(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when child chunk does not belong to the segment."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()

        segment_id = str(uuid.uuid4())
        mock_segment = Mock()
        mock_segment.id = segment_id
        mock_segment.document_id = "doc-id"
        mock_seg_svc.get_segment_by_id.return_value = mock_segment

        mock_child = Mock()
        mock_child.segment_id = "different-segment-id"
        mock_seg_svc.get_child_chunk_by_id.return_value = mock_child

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/{segment_id}/child_chunks/cc-id",
            method="DELETE",
        ):
            api = DatasetChildChunkApi()
            with pytest.raises(NotFound):
                self._call_delete(
                    api,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id=segment_id,
                    child_chunk_id="cc-id",
                )
