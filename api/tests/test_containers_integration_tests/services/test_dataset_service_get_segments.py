"""
Integration tests for SegmentService.get_segments method using a real database.

Tests the retrieval of document segments with pagination and filtering:
- Basic pagination (page, limit)
- Status filtering
- Keyword search
- Ordering by position and id (to avoid duplicate data)
"""

from uuid import uuid4

from sqlalchemy.orm import Session

from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, DatasetPermissionEnum, Document, DocumentSegment
from services.dataset_service import SegmentService


class SegmentServiceTestDataFactory:
    """
    Factory class for creating test data for segment tests.
    """

    @staticmethod
    def create_account_with_tenant(
        db_session_with_containers: Session,
        role: TenantAccountRole = TenantAccountRole.OWNER,
        tenant: Tenant | None = None,
    ) -> tuple[Account, Tenant]:
        """Create a real account and tenant with specified role."""
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        if tenant is None:
            tenant = Tenant(name=f"tenant-{uuid4()}", status="normal")
            db_session_with_containers.add(tenant)
            db_session_with_containers.commit()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        account.current_tenant = tenant
        return account, tenant

    @staticmethod
    def create_dataset(db_session_with_containers: Session, tenant_id: str, created_by: str) -> Dataset:
        """Create a real dataset."""
        dataset = Dataset(
            tenant_id=tenant_id,
            name=f"Test Dataset {uuid4()}",
            description="Test description",
            data_source_type="upload_file",
            indexing_technique="high_quality",
            created_by=created_by,
            permission=DatasetPermissionEnum.ONLY_ME,
            provider="vendor",
            retrieval_model={"top_k": 2},
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        return dataset

    @staticmethod
    def create_document(
        db_session_with_containers: Session, tenant_id: str, dataset_id: str, created_by: str
    ) -> Document:
        """Create a real document."""
        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=1,
            data_source_type="upload_file",
            batch=f"batch-{uuid4()}",
            name=f"test-doc-{uuid4()}.txt",
            created_from="api",
            created_by=created_by,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.commit()
        return document

    @staticmethod
    def create_segment(
        db_session_with_containers: Session,
        tenant_id: str,
        dataset_id: str,
        document_id: str,
        created_by: str,
        position: int = 1,
        content: str = "Test content",
        status: str = "completed",
        word_count: int = 10,
        tokens: int = 15,
    ) -> DocumentSegment:
        """Create a real document segment."""
        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            position=position,
            content=content,
            status=status,
            word_count=word_count,
            tokens=tokens,
            created_by=created_by,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()
        return segment


class TestSegmentServiceGetSegments:
    """
    Comprehensive integration tests for SegmentService.get_segments method.

    Tests cover:
    - Basic pagination functionality
    - Status list filtering
    - Keyword search filtering
    - Ordering (position + id for uniqueness)
    - Empty results
    - Combined filters
    """

    def test_get_segments_basic_pagination(self, db_session_with_containers: Session):
        """
        Test basic pagination functionality.

        Verifies:
        - Query is built with document_id and tenant_id filters
        - Pagination uses correct page and limit parameters
        - Returns segments and total count
        """
        # Arrange
        owner, tenant = SegmentServiceTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = SegmentServiceTestDataFactory.create_dataset(db_session_with_containers, tenant.id, owner.id)
        document = SegmentServiceTestDataFactory.create_document(
            db_session_with_containers, tenant.id, dataset.id, owner.id
        )

        segment1 = SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=1,
            content="First segment",
        )
        segment2 = SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=2,
            content="Second segment",
        )

        # Act
        items, total = SegmentService.get_segments(document_id=document.id, tenant_id=tenant.id, page=1, limit=20)

        # Assert
        assert len(items) == 2
        assert total == 2
        assert items[0].id == segment1.id
        assert items[1].id == segment2.id

    def test_get_segments_with_status_filter(self, db_session_with_containers: Session):
        """
        Test filtering by status list.

        Verifies:
        - Status list filter is applied to query
        - Only segments with matching status are returned
        """
        # Arrange
        owner, tenant = SegmentServiceTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = SegmentServiceTestDataFactory.create_dataset(db_session_with_containers, tenant.id, owner.id)
        document = SegmentServiceTestDataFactory.create_document(
            db_session_with_containers, tenant.id, dataset.id, owner.id
        )

        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=1,
            status="completed",
        )
        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=2,
            status="indexing",
        )
        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=3,
            status="waiting",
        )

        # Act
        items, total = SegmentService.get_segments(
            document_id=document.id, tenant_id=tenant.id, status_list=["completed", "indexing"]
        )

        # Assert
        assert len(items) == 2
        assert total == 2
        statuses = {item.status for item in items}
        assert statuses == {"completed", "indexing"}

    def test_get_segments_with_empty_status_list(self, db_session_with_containers: Session):
        """
        Test with empty status list.

        Verifies:
        - Empty status list is handled correctly
        - No status filter is applied to avoid WHERE false condition
        """
        # Arrange
        owner, tenant = SegmentServiceTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = SegmentServiceTestDataFactory.create_dataset(db_session_with_containers, tenant.id, owner.id)
        document = SegmentServiceTestDataFactory.create_document(
            db_session_with_containers, tenant.id, dataset.id, owner.id
        )

        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=1,
            status="completed",
        )
        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=2,
            status="indexing",
        )

        # Act
        items, total = SegmentService.get_segments(document_id=document.id, tenant_id=tenant.id, status_list=[])

        # Assert — empty status_list should return all segments (no status filter applied)
        assert len(items) == 2
        assert total == 2

    def test_get_segments_with_keyword_search(self, db_session_with_containers: Session):
        """
        Test keyword search functionality.

        Verifies:
        - Keyword filter uses ilike for case-insensitive search
        - Search pattern includes wildcards (%keyword%)
        """
        # Arrange
        owner, tenant = SegmentServiceTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = SegmentServiceTestDataFactory.create_dataset(db_session_with_containers, tenant.id, owner.id)
        document = SegmentServiceTestDataFactory.create_document(
            db_session_with_containers, tenant.id, dataset.id, owner.id
        )

        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=1,
            content="This contains search term in the middle",
        )
        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=2,
            content="This does not match",
        )

        # Act
        items, total = SegmentService.get_segments(document_id=document.id, tenant_id=tenant.id, keyword="search term")

        # Assert
        assert len(items) == 1
        assert total == 1
        assert "search term" in items[0].content

    def test_get_segments_ordering_by_position_and_id(self, db_session_with_containers: Session):
        """
        Test ordering by position and id.

        Verifies:
        - Results are ordered by position ASC
        - Results are secondarily ordered by id ASC to ensure uniqueness
        - This prevents duplicate data across pages when positions are not unique
        """
        # Arrange
        owner, tenant = SegmentServiceTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = SegmentServiceTestDataFactory.create_dataset(db_session_with_containers, tenant.id, owner.id)
        document = SegmentServiceTestDataFactory.create_document(
            db_session_with_containers, tenant.id, dataset.id, owner.id
        )

        # Create segments with different positions
        seg_pos2 = SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=2,
            content="Position 2",
        )
        seg_pos1 = SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=1,
            content="Position 1",
        )
        seg_pos3 = SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=3,
            content="Position 3",
        )

        # Act
        items, total = SegmentService.get_segments(document_id=document.id, tenant_id=tenant.id)

        # Assert — segments should be ordered by position ASC
        assert len(items) == 3
        assert total == 3
        assert items[0].id == seg_pos1.id
        assert items[1].id == seg_pos2.id
        assert items[2].id == seg_pos3.id

    def test_get_segments_empty_results(self, db_session_with_containers: Session):
        """
        Test when no segments match the criteria.

        Verifies:
        - Empty list is returned for items
        - Total count is 0
        """
        # Arrange
        owner, tenant = SegmentServiceTestDataFactory.create_account_with_tenant(db_session_with_containers)
        non_existent_doc_id = str(uuid4())

        # Act
        items, total = SegmentService.get_segments(document_id=non_existent_doc_id, tenant_id=tenant.id)

        # Assert
        assert items == []
        assert total == 0

    def test_get_segments_combined_filters(self, db_session_with_containers: Session):
        """
        Test with multiple filters combined.

        Verifies:
        - All filters work together correctly
        - Status list and keyword search both applied
        """
        # Arrange
        owner, tenant = SegmentServiceTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = SegmentServiceTestDataFactory.create_dataset(db_session_with_containers, tenant.id, owner.id)
        document = SegmentServiceTestDataFactory.create_document(
            db_session_with_containers, tenant.id, dataset.id, owner.id
        )

        # Create segments with various statuses and content
        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=1,
            status="completed",
            content="This is important information",
        )
        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=2,
            status="indexing",
            content="This is also important",
        )
        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=3,
            status="completed",
            content="This is irrelevant",
        )

        # Act — filter by status=completed AND keyword=important
        items, total = SegmentService.get_segments(
            document_id=document.id,
            tenant_id=tenant.id,
            status_list=["completed"],
            keyword="important",
            page=1,
            limit=10,
        )

        # Assert — only the first segment matches both filters
        assert len(items) == 1
        assert total == 1
        assert items[0].status == "completed"
        assert "important" in items[0].content

    def test_get_segments_with_none_status_list(self, db_session_with_containers: Session):
        """
        Test with None status list.

        Verifies:
        - None status list is handled correctly
        - No status filter is applied
        """
        # Arrange
        owner, tenant = SegmentServiceTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = SegmentServiceTestDataFactory.create_dataset(db_session_with_containers, tenant.id, owner.id)
        document = SegmentServiceTestDataFactory.create_document(
            db_session_with_containers, tenant.id, dataset.id, owner.id
        )

        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=1,
            status="completed",
        )
        SegmentServiceTestDataFactory.create_segment(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=owner.id,
            position=2,
            status="waiting",
        )

        # Act
        items, total = SegmentService.get_segments(
            document_id=document.id,
            tenant_id=tenant.id,
            status_list=None,
        )

        # Assert — None status_list should return all segments
        assert len(items) == 2
        assert total == 2

    def test_get_segments_pagination_max_per_page_limit(self, db_session_with_containers: Session):
        """
        Test that max_per_page is correctly set to 100.

        Verifies:
        - max_per_page parameter is set to 100
        - This prevents excessive page sizes
        """
        # Arrange
        owner, tenant = SegmentServiceTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = SegmentServiceTestDataFactory.create_dataset(db_session_with_containers, tenant.id, owner.id)
        document = SegmentServiceTestDataFactory.create_document(
            db_session_with_containers, tenant.id, dataset.id, owner.id
        )

        # Create 105 segments to exceed max_per_page of 100
        for i in range(105):
            SegmentServiceTestDataFactory.create_segment(
                db_session_with_containers,
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                document_id=document.id,
                created_by=owner.id,
                position=i + 1,
                content=f"Segment {i + 1}",
            )

        # Act — request limit=200, but max_per_page=100 should cap it
        items, total = SegmentService.get_segments(
            document_id=document.id,
            tenant_id=tenant.id,
            limit=200,
        )

        # Assert — total is 105, but items per page capped at 100
        assert total == 105
        assert len(items) == 100
