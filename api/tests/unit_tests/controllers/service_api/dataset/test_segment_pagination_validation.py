"""
Unit tests for pagination query parameter validation in segment endpoints.

Tests for issue #36519: Validate pagination query parameters
Ensures malformed pagination values (page=bad, limit=abc) return 400 errors
instead of silently falling back to defaults.
"""

import uuid
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.service_api.dataset.segment import (
    ChildChunkApi,
    ChildChunkListQuery,
    SegmentApi,
    SegmentListQuery,
)


class TestSegmentListQueryPaginationValidation:
    """Test pagination validation in SegmentListQuery."""

    def test_valid_page_and_limit(self):
        """Test valid page and limit values."""
        query = SegmentListQuery(page=2, limit=50)
        assert query.page == 2
        assert query.limit == 50

    def test_default_page_and_limit(self):
        """Test default values when not provided."""
        query = SegmentListQuery()
        assert query.page == 1
        assert query.limit == 20

    def test_page_minimum_validation(self):
        """Test page must be >= 1."""
        with pytest.raises(ValidationError) as exc_info:
            SegmentListQuery(page=0)
        assert "page" in str(exc_info.value).lower()

    def test_page_negative_validation(self):
        """Test page cannot be negative."""
        with pytest.raises(ValidationError) as exc_info:
            SegmentListQuery(page=-1)
        assert "page" in str(exc_info.value).lower()

    def test_limit_minimum_validation(self):
        """Test limit must be >= 1."""
        with pytest.raises(ValidationError) as exc_info:
            SegmentListQuery(limit=0)
        assert "limit" in str(exc_info.value).lower()

    def test_limit_negative_validation(self):
        """Test limit cannot be negative."""
        with pytest.raises(ValidationError) as exc_info:
            SegmentListQuery(limit=-1)
        assert "limit" in str(exc_info.value).lower()

    def test_page_string_validation(self):
        """Test page rejects non-numeric strings."""
        with pytest.raises(ValidationError) as exc_info:
            SegmentListQuery(page="bad")
        assert "page" in str(exc_info.value).lower()

    def test_limit_string_validation(self):
        """Test limit rejects non-numeric strings."""
        with pytest.raises(ValidationError) as exc_info:
            SegmentListQuery(limit="abc")
        assert "limit" in str(exc_info.value).lower()

    def test_page_empty_string_validation(self):
        """Test page rejects empty string."""
        with pytest.raises(ValidationError) as exc_info:
            SegmentListQuery(page="")
        assert "page" in str(exc_info.value).lower()

    def test_limit_empty_string_validation(self):
        """Test limit rejects empty string."""
        with pytest.raises(ValidationError) as exc_info:
            SegmentListQuery(limit="")
        assert "limit" in str(exc_info.value).lower()

    def test_page_float_string_validation(self):
        """Test page rejects float strings."""
        with pytest.raises(ValidationError) as exc_info:
            SegmentListQuery(page="1.5")
        assert "page" in str(exc_info.value).lower()

    def test_limit_float_string_validation(self):
        """Test limit rejects float strings."""
        with pytest.raises(ValidationError) as exc_info:
            SegmentListQuery(limit="20.5")
        assert "limit" in str(exc_info.value).lower()

    def test_page_none_uses_default(self):
        """Test page=None uses default value."""
        query = SegmentListQuery(page=None)
        assert query.page == 1

    def test_limit_none_uses_default(self):
        """Test limit=None uses default value."""
        query = SegmentListQuery(limit=None)
        assert query.limit == 20

    def test_valid_numeric_strings(self):
        """Test valid numeric strings are coerced to integers."""
        query = SegmentListQuery(page="3", limit="25")
        assert query.page == 3
        assert query.limit == 25


class TestChildChunkListQueryPaginationValidation:
    """Test pagination validation in ChildChunkListQuery."""

    def test_valid_page_and_limit(self):
        """Test valid page and limit values."""
        query = ChildChunkListQuery(page=2, limit=50)
        assert query.page == 2
        assert query.limit == 50

    def test_default_page_and_limit(self):
        """Test default values when not provided."""
        query = ChildChunkListQuery()
        assert query.page == 1
        assert query.limit == 20

    def test_page_minimum_validation(self):
        """Test page must be >= 1."""
        with pytest.raises(ValidationError) as exc_info:
            ChildChunkListQuery(page=0)
        assert "page" in str(exc_info.value).lower()

    def test_limit_minimum_validation(self):
        """Test limit must be >= 1."""
        with pytest.raises(ValidationError) as exc_info:
            ChildChunkListQuery(limit=0)
        assert "limit" in str(exc_info.value).lower()

    def test_page_string_validation(self):
        """Test page rejects non-numeric strings."""
        with pytest.raises(ValidationError) as exc_info:
            ChildChunkListQuery(page="bad")
        assert "page" in str(exc_info.value).lower()

    def test_limit_string_validation(self):
        """Test limit rejects non-numeric strings."""
        with pytest.raises(ValidationError) as exc_info:
            ChildChunkListQuery(limit="abc")
        assert "limit" in str(exc_info.value).lower()

    def test_page_empty_string_validation(self):
        """Test page rejects empty string."""
        with pytest.raises(ValidationError) as exc_info:
            ChildChunkListQuery(page="")
        assert "page" in str(exc_info.value).lower()

    def test_limit_empty_string_validation(self):
        """Test limit rejects empty string."""
        with pytest.raises(ValidationError) as exc_info:
            ChildChunkListQuery(limit="")
        assert "limit" in str(exc_info.value).lower()


class TestSegmentApiGetPaginationValidation:
    """Test SegmentApi.get() endpoint pagination validation."""

    @patch("controllers.service_api.dataset.segment.SummaryIndexService")
    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_malformed_page_parameter_raises_validation_error(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        mock_summary_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test that page=bad raises ValidationError."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_dataset.indexing_technique = "economy"
        mock_db.session.scalar.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments?page=bad&limit=20",
            method="GET",
        ):
            api = SegmentApi()
            with pytest.raises(ValidationError) as exc_info:
                api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, document_id="doc-id")
            assert "page" in str(exc_info.value).lower()

    @patch("controllers.service_api.dataset.segment.SummaryIndexService")
    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_malformed_limit_parameter_raises_validation_error(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        mock_summary_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test that limit=abc raises ValidationError."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_dataset.indexing_technique = "economy"
        mock_db.session.scalar.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments?page=1&limit=abc",
            method="GET",
        ):
            api = SegmentApi()
            with pytest.raises(ValidationError) as exc_info:
                api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, document_id="doc-id")
            assert "limit" in str(exc_info.value).lower()

    @patch("controllers.service_api.dataset.segment.SummaryIndexService")
    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_empty_limit_parameter_raises_validation_error(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        mock_summary_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test that limit= (empty) raises ValidationError."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_dataset.indexing_technique = "economy"
        mock_db.session.scalar.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments?page=1&limit=",
            method="GET",
        ):
            api = SegmentApi()
            with pytest.raises(ValidationError) as exc_info:
                api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, document_id="doc-id")
            assert "limit" in str(exc_info.value).lower()

    @patch("controllers.service_api.dataset.segment.SummaryIndexService")
    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_missing_parameters_use_defaults(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        mock_summary_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
        mock_segment,
    ):
        """Test that missing page/limit use default values."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_dataset.indexing_technique = "economy"
        mock_db.session.scalar.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock(doc_form="paragraph")
        mock_seg_svc.get_segments.return_value = ([mock_segment], 1)
        mock_marshal.return_value = {"id": mock_segment.id}
        mock_summary_svc.get_segments_summaries.return_value = {}

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments",
            method="GET",
        ):
            api = SegmentApi()
            response, status = api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id, document_id="doc-id")

        assert status == 200
        assert response["page"] == 1
        assert response["limit"] == 20


class TestChildChunkApiGetPaginationValidation:
    """Test ChildChunkApi.get() endpoint pagination validation."""

    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_malformed_page_parameter_raises_validation_error(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test that page=bad raises ValidationError."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.scalar.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()
        mock_seg_svc.get_segment_by_id.return_value = Mock()

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id/child_chunks?page=bad&limit=20",
            method="GET",
        ):
            api = ChildChunkApi()
            with pytest.raises(ValidationError) as exc_info:
                api.get(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )
            assert "page" in str(exc_info.value).lower()

    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_malformed_limit_parameter_raises_validation_error(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test that limit=abc raises ValidationError."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.scalar.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()
        mock_seg_svc.get_segment_by_id.return_value = Mock()

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id/child_chunks?page=1&limit=abc",
            method="GET",
        ):
            api = ChildChunkApi()
            with pytest.raises(ValidationError) as exc_info:
                api.get(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    document_id="doc-id",
                    segment_id="seg-id",
                )
            assert "limit" in str(exc_info.value).lower()

    @patch("controllers.service_api.dataset.segment.marshal")
    @patch("controllers.service_api.dataset.segment.SegmentService")
    @patch("controllers.service_api.dataset.segment.DocumentService")
    @patch("controllers.service_api.dataset.segment.current_account_with_tenant")
    @patch("controllers.service_api.dataset.segment.db")
    def test_missing_parameters_use_defaults(
        self,
        mock_db,
        mock_account_fn,
        mock_doc_svc,
        mock_seg_svc,
        mock_marshal,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test that missing page/limit use default values."""
        mock_account_fn.return_value = (Mock(), mock_tenant.id)
        mock_db.session.scalar.return_value = mock_dataset
        mock_doc_svc.get_document.return_value = Mock()
        mock_seg_svc.get_segment_by_id.return_value = Mock()

        mock_pagination = Mock()
        mock_pagination.items = []
        mock_pagination.total = 0
        mock_pagination.pages = 0
        mock_seg_svc.get_child_chunks.return_value = mock_pagination
        mock_marshal.return_value = []

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/doc-id/segments/seg-id/child_chunks",
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
        assert response["page"] == 1
        assert response["limit"] == 20


@pytest.fixture
def app():
    """Create Flask app for testing."""
    from flask import Flask

    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def mock_tenant():
    """Create mock tenant."""
    tenant = Mock()
    tenant.id = str(uuid.uuid4())
    return tenant


@pytest.fixture
def mock_dataset():
    """Create mock dataset."""
    dataset = Mock()
    dataset.id = str(uuid.uuid4())
    dataset.tenant_id = str(uuid.uuid4())
    dataset.indexing_technique = "economy"
    return dataset


@pytest.fixture
def mock_segment():
    """Create mock segment."""
    segment = Mock()
    segment.id = str(uuid.uuid4())
    segment.document_id = str(uuid.uuid4())
    segment.content = "Test content"
    return segment
