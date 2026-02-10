"""
Unit tests for SegmentService.get_segments method.

Tests the retrieval of document segments with pagination and filtering:
- Basic pagination (page, limit)
- Status filtering
- Keyword search
- Ordering by position and id (to avoid duplicate data)
"""

from unittest.mock import Mock, create_autospec, patch

import pytest

from models.dataset import DocumentSegment


class SegmentServiceTestDataFactory:
    """
    Factory class for creating test data and mock objects for segment tests.
    """

    @staticmethod
    def create_segment_mock(
        segment_id: str = "segment-123",
        document_id: str = "doc-123",
        tenant_id: str = "tenant-123",
        dataset_id: str = "dataset-123",
        position: int = 1,
        content: str = "Test content",
        status: str = "completed",
        **kwargs,
    ) -> Mock:
        """
        Create a mock document segment.

        Args:
            segment_id: Unique identifier for the segment
            document_id: Parent document ID
            tenant_id: Tenant ID the segment belongs to
            dataset_id: Parent dataset ID
            position: Position within the document
            content: Segment text content
            status: Indexing status
            **kwargs: Additional attributes

        Returns:
            Mock: DocumentSegment mock object
        """
        segment = create_autospec(DocumentSegment, instance=True)
        segment.id = segment_id
        segment.document_id = document_id
        segment.tenant_id = tenant_id
        segment.dataset_id = dataset_id
        segment.position = position
        segment.content = content
        segment.status = status
        for key, value in kwargs.items():
            setattr(segment, key, value)
        return segment


class TestSegmentServiceGetSegments:
    """
    Comprehensive unit tests for SegmentService.get_segments method.

    Tests cover:
    - Basic pagination functionality
    - Status list filtering
    - Keyword search filtering
    - Ordering (position + id for uniqueness)
    - Empty results
    - Combined filters
    """

    @pytest.fixture
    def mock_segment_service_dependencies(self):
        """
        Common mock setup for segment service dependencies.

        Patches:
        - db: Database operations and pagination
        - select: SQLAlchemy query builder
        """
        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.select") as mock_select,
        ):
            yield {
                "db": mock_db,
                "select": mock_select,
            }

    def test_get_segments_basic_pagination(self, mock_segment_service_dependencies):
        """
        Test basic pagination functionality.

        Verifies:
        - Query is built with document_id and tenant_id filters
        - Pagination uses correct page and limit parameters
        - Returns segments and total count
        """
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        page = 1
        limit = 20

        # Create mock segments
        segment1 = SegmentServiceTestDataFactory.create_segment_mock(
            segment_id="seg-1", position=1, content="First segment"
        )
        segment2 = SegmentServiceTestDataFactory.create_segment_mock(
            segment_id="seg-2", position=2, content="Second segment"
        )

        # Mock pagination result
        mock_paginated = Mock()
        mock_paginated.items = [segment1, segment2]
        mock_paginated.total = 2

        mock_segment_service_dependencies["db"].paginate.return_value = mock_paginated

        # Mock select builder
        mock_query = Mock()
        mock_segment_service_dependencies["select"].return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query

        # Act
        from services.dataset_service import SegmentService

        items, total = SegmentService.get_segments(document_id=document_id, tenant_id=tenant_id, page=page, limit=limit)

        # Assert
        assert len(items) == 2
        assert total == 2
        assert items[0].id == "seg-1"
        assert items[1].id == "seg-2"
        mock_segment_service_dependencies["db"].paginate.assert_called_once()
        call_kwargs = mock_segment_service_dependencies["db"].paginate.call_args[1]
        assert call_kwargs["page"] == page
        assert call_kwargs["per_page"] == limit
        assert call_kwargs["max_per_page"] == 100
        assert call_kwargs["error_out"] is False

    def test_get_segments_with_status_filter(self, mock_segment_service_dependencies):
        """
        Test filtering by status list.

        Verifies:
        - Status list filter is applied to query
        - Only segments with matching status are returned
        """
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        status_list = ["completed", "indexing"]

        segment1 = SegmentServiceTestDataFactory.create_segment_mock(segment_id="seg-1", status="completed")
        segment2 = SegmentServiceTestDataFactory.create_segment_mock(segment_id="seg-2", status="indexing")

        mock_paginated = Mock()
        mock_paginated.items = [segment1, segment2]
        mock_paginated.total = 2

        mock_segment_service_dependencies["db"].paginate.return_value = mock_paginated

        mock_query = Mock()
        mock_segment_service_dependencies["select"].return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query

        # Act
        from services.dataset_service import SegmentService

        items, total = SegmentService.get_segments(
            document_id=document_id, tenant_id=tenant_id, status_list=status_list
        )

        # Assert
        assert len(items) == 2
        assert total == 2
        # Verify where was called multiple times (base filters + status filter)
        assert mock_query.where.call_count >= 2

    def test_get_segments_with_empty_status_list(self, mock_segment_service_dependencies):
        """
        Test with empty status list.

        Verifies:
        - Empty status list is handled correctly
        - No status filter is applied to avoid WHERE false condition
        """
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        status_list = []

        segment = SegmentServiceTestDataFactory.create_segment_mock(segment_id="seg-1")

        mock_paginated = Mock()
        mock_paginated.items = [segment]
        mock_paginated.total = 1

        mock_segment_service_dependencies["db"].paginate.return_value = mock_paginated

        mock_query = Mock()
        mock_segment_service_dependencies["select"].return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query

        # Act
        from services.dataset_service import SegmentService

        items, total = SegmentService.get_segments(
            document_id=document_id, tenant_id=tenant_id, status_list=status_list
        )

        # Assert
        assert len(items) == 1
        assert total == 1
        # Should only be called once (base filters, no status filter)
        assert mock_query.where.call_count == 1

    def test_get_segments_with_keyword_search(self, mock_segment_service_dependencies):
        """
        Test keyword search functionality.

        Verifies:
        - Keyword filter uses ilike for case-insensitive search
        - Search pattern includes wildcards (%keyword%)
        """
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        keyword = "search term"

        segment = SegmentServiceTestDataFactory.create_segment_mock(
            segment_id="seg-1", content="This contains search term"
        )

        mock_paginated = Mock()
        mock_paginated.items = [segment]
        mock_paginated.total = 1

        mock_segment_service_dependencies["db"].paginate.return_value = mock_paginated

        mock_query = Mock()
        mock_segment_service_dependencies["select"].return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query

        # Act
        from services.dataset_service import SegmentService

        items, total = SegmentService.get_segments(document_id=document_id, tenant_id=tenant_id, keyword=keyword)

        # Assert
        assert len(items) == 1
        assert total == 1
        # Verify where was called for base filters + keyword filter
        assert mock_query.where.call_count == 2

    def test_get_segments_ordering_by_position_and_id(self, mock_segment_service_dependencies):
        """
        Test ordering by position and id.

        Verifies:
        - Results are ordered by position ASC
        - Results are secondarily ordered by id ASC to ensure uniqueness
        - This prevents duplicate data across pages when positions are not unique
        """
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"

        # Create segments with same position but different ids
        segment1 = SegmentServiceTestDataFactory.create_segment_mock(
            segment_id="seg-1", position=1, content="Content 1"
        )
        segment2 = SegmentServiceTestDataFactory.create_segment_mock(
            segment_id="seg-2", position=1, content="Content 2"
        )
        segment3 = SegmentServiceTestDataFactory.create_segment_mock(
            segment_id="seg-3", position=2, content="Content 3"
        )

        mock_paginated = Mock()
        mock_paginated.items = [segment1, segment2, segment3]
        mock_paginated.total = 3

        mock_segment_service_dependencies["db"].paginate.return_value = mock_paginated

        mock_query = Mock()
        mock_segment_service_dependencies["select"].return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query

        # Act
        from services.dataset_service import SegmentService

        items, total = SegmentService.get_segments(document_id=document_id, tenant_id=tenant_id)

        # Assert
        assert len(items) == 3
        assert total == 3
        mock_query.order_by.assert_called_once()

    def test_get_segments_empty_results(self, mock_segment_service_dependencies):
        """
        Test when no segments match the criteria.

        Verifies:
        - Empty list is returned for items
        - Total count is 0
        """
        # Arrange
        document_id = "non-existent-doc"
        tenant_id = "tenant-123"

        mock_paginated = Mock()
        mock_paginated.items = []
        mock_paginated.total = 0

        mock_segment_service_dependencies["db"].paginate.return_value = mock_paginated

        mock_query = Mock()
        mock_segment_service_dependencies["select"].return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query

        # Act
        from services.dataset_service import SegmentService

        items, total = SegmentService.get_segments(document_id=document_id, tenant_id=tenant_id)

        # Assert
        assert items == []
        assert total == 0

    def test_get_segments_combined_filters(self, mock_segment_service_dependencies):
        """
        Test with multiple filters combined.

        Verifies:
        - All filters work together correctly
        - Status list and keyword search both applied
        """
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        status_list = ["completed"]
        keyword = "important"
        page = 2
        limit = 10

        segment = SegmentServiceTestDataFactory.create_segment_mock(
            segment_id="seg-1",
            status="completed",
            content="This is important information",
        )

        mock_paginated = Mock()
        mock_paginated.items = [segment]
        mock_paginated.total = 1

        mock_segment_service_dependencies["db"].paginate.return_value = mock_paginated

        mock_query = Mock()
        mock_segment_service_dependencies["select"].return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query

        # Act
        from services.dataset_service import SegmentService

        items, total = SegmentService.get_segments(
            document_id=document_id,
            tenant_id=tenant_id,
            status_list=status_list,
            keyword=keyword,
            page=page,
            limit=limit,
        )

        # Assert
        assert len(items) == 1
        assert total == 1
        # Verify filters: base + status + keyword
        assert mock_query.where.call_count == 3
        # Verify pagination parameters
        call_kwargs = mock_segment_service_dependencies["db"].paginate.call_args[1]
        assert call_kwargs["page"] == page
        assert call_kwargs["per_page"] == limit

    def test_get_segments_with_none_status_list(self, mock_segment_service_dependencies):
        """
        Test with None status list.

        Verifies:
        - None status list is handled correctly
        - No status filter is applied
        """
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"

        segment = SegmentServiceTestDataFactory.create_segment_mock(segment_id="seg-1")

        mock_paginated = Mock()
        mock_paginated.items = [segment]
        mock_paginated.total = 1

        mock_segment_service_dependencies["db"].paginate.return_value = mock_paginated

        mock_query = Mock()
        mock_segment_service_dependencies["select"].return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query

        # Act
        from services.dataset_service import SegmentService

        items, total = SegmentService.get_segments(
            document_id=document_id,
            tenant_id=tenant_id,
            status_list=None,
        )

        # Assert
        assert len(items) == 1
        assert total == 1
        # Should only be called once (base filters only, no status filter)
        assert mock_query.where.call_count == 1

    def test_get_segments_pagination_max_per_page_limit(self, mock_segment_service_dependencies):
        """
        Test that max_per_page is correctly set to 100.

        Verifies:
        - max_per_page parameter is set to 100
        - This prevents excessive page sizes
        """
        # Arrange
        document_id = "doc-123"
        tenant_id = "tenant-123"
        limit = 200  # Request more than max_per_page

        mock_paginated = Mock()
        mock_paginated.items = []
        mock_paginated.total = 0

        mock_segment_service_dependencies["db"].paginate.return_value = mock_paginated

        mock_query = Mock()
        mock_segment_service_dependencies["select"].return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query

        # Act
        from services.dataset_service import SegmentService

        SegmentService.get_segments(
            document_id=document_id,
            tenant_id=tenant_id,
            limit=limit,
        )

        # Assert
        call_kwargs = mock_segment_service_dependencies["db"].paginate.call_args[1]
        assert call_kwargs["max_per_page"] == 100
