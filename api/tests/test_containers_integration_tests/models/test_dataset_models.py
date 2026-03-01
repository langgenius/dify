"""
Integration tests for Dataset and Document model properties using testcontainers.

These tests validate database-backed model properties (total_documents, word_count, etc.)
without mocking SQLAlchemy queries, ensuring real query behavior against PostgreSQL.
"""

from collections.abc import Generator
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models.dataset import Dataset, Document, DocumentSegment


class TestDatasetDocumentProperties:
    """Integration tests for Dataset and Document model properties."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        """Automatically rollback session changes after each test."""
        yield
        db_session_with_containers.rollback()

    def test_dataset_with_documents_relationship(self, db_session_with_containers: Session) -> None:
        """Test dataset can track its documents."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        dataset = Dataset(
            tenant_id=tenant_id, name="Test Dataset", data_source_type="upload_file", created_by=created_by
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        for i in range(3):
            doc = Document(
                tenant_id=tenant_id,
                dataset_id=dataset.id,
                position=i + 1,
                data_source_type="upload_file",
                batch="batch_001",
                name=f"doc_{i}.pdf",
                created_from="web",
                created_by=created_by,
            )
            db_session_with_containers.add(doc)
        db_session_with_containers.flush()

        assert dataset.total_documents == 3

    def test_dataset_available_documents_count(self, db_session_with_containers: Session) -> None:
        """Test dataset can count available documents."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        dataset = Dataset(
            tenant_id=tenant_id, name="Test Dataset", data_source_type="upload_file", created_by=created_by
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        doc_available = Document(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="available.pdf",
            created_from="web",
            created_by=created_by,
            indexing_status="completed",
            enabled=True,
            archived=False,
        )
        doc_pending = Document(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            position=2,
            data_source_type="upload_file",
            batch="batch_001",
            name="pending.pdf",
            created_from="web",
            created_by=created_by,
            indexing_status="waiting",
            enabled=True,
            archived=False,
        )
        doc_disabled = Document(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            position=3,
            data_source_type="upload_file",
            batch="batch_001",
            name="disabled.pdf",
            created_from="web",
            created_by=created_by,
            indexing_status="completed",
            enabled=False,
            archived=False,
        )
        db_session_with_containers.add_all([doc_available, doc_pending, doc_disabled])
        db_session_with_containers.flush()

        assert dataset.total_available_documents == 1

    def test_dataset_word_count_aggregation(self, db_session_with_containers: Session) -> None:
        """Test dataset can aggregate word count from documents."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        dataset = Dataset(
            tenant_id=tenant_id, name="Test Dataset", data_source_type="upload_file", created_by=created_by
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        for i, wc in enumerate([2000, 3000]):
            doc = Document(
                tenant_id=tenant_id,
                dataset_id=dataset.id,
                position=i + 1,
                data_source_type="upload_file",
                batch="batch_001",
                name=f"doc_{i}.pdf",
                created_from="web",
                created_by=created_by,
                word_count=wc,
            )
            db_session_with_containers.add(doc)
        db_session_with_containers.flush()

        assert dataset.word_count == 5000

    def test_dataset_available_segment_count(self, db_session_with_containers: Session) -> None:
        """Test Dataset.available_segment_count counts completed and enabled segments."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        dataset = Dataset(
            tenant_id=tenant_id, name="Test Dataset", data_source_type="upload_file", created_by=created_by
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        doc = Document(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="doc.pdf",
            created_from="web",
            created_by=created_by,
        )
        db_session_with_containers.add(doc)
        db_session_with_containers.flush()

        for i in range(2):
            seg = DocumentSegment(
                tenant_id=tenant_id,
                dataset_id=dataset.id,
                document_id=doc.id,
                position=i + 1,
                content=f"segment {i}",
                word_count=100,
                tokens=50,
                status="completed",
                enabled=True,
                created_by=created_by,
            )
            db_session_with_containers.add(seg)

        seg_waiting = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=doc.id,
            position=3,
            content="waiting segment",
            word_count=100,
            tokens=50,
            status="waiting",
            enabled=True,
            created_by=created_by,
        )
        db_session_with_containers.add(seg_waiting)
        db_session_with_containers.flush()

        assert dataset.available_segment_count == 2

    def test_document_segment_count_property(self, db_session_with_containers: Session) -> None:
        """Test document can count its segments."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        dataset = Dataset(
            tenant_id=tenant_id, name="Test Dataset", data_source_type="upload_file", created_by=created_by
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        doc = Document(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="doc.pdf",
            created_from="web",
            created_by=created_by,
        )
        db_session_with_containers.add(doc)
        db_session_with_containers.flush()

        for i in range(3):
            seg = DocumentSegment(
                tenant_id=tenant_id,
                dataset_id=dataset.id,
                document_id=doc.id,
                position=i + 1,
                content=f"segment {i}",
                word_count=100,
                tokens=50,
                created_by=created_by,
            )
            db_session_with_containers.add(seg)
        db_session_with_containers.flush()

        assert doc.segment_count == 3

    def test_document_hit_count_aggregation(self, db_session_with_containers: Session) -> None:
        """Test document can aggregate hit count from segments."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        dataset = Dataset(
            tenant_id=tenant_id, name="Test Dataset", data_source_type="upload_file", created_by=created_by
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        doc = Document(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="doc.pdf",
            created_from="web",
            created_by=created_by,
        )
        db_session_with_containers.add(doc)
        db_session_with_containers.flush()

        for i, hits in enumerate([10, 15]):
            seg = DocumentSegment(
                tenant_id=tenant_id,
                dataset_id=dataset.id,
                document_id=doc.id,
                position=i + 1,
                content=f"segment {i}",
                word_count=100,
                tokens=50,
                hit_count=hits,
                created_by=created_by,
            )
            db_session_with_containers.add(seg)
        db_session_with_containers.flush()

        assert doc.hit_count == 25


class TestDocumentSegmentNavigationProperties:
    """Integration tests for DocumentSegment navigation properties."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        """Automatically rollback session changes after each test."""
        yield
        db_session_with_containers.rollback()

    def test_document_segment_dataset_property(self, db_session_with_containers: Session) -> None:
        """Test segment can access its parent dataset."""
        # Arrange
        tenant_id = str(uuid4())
        created_by = str(uuid4())
        dataset = Dataset(
            tenant_id=tenant_id,
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=created_by,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=created_by,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content="Test",
            word_count=1,
            tokens=2,
            created_by=created_by,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.flush()

        # Act
        related_dataset = segment.dataset

        # Assert
        assert related_dataset is not None
        assert related_dataset.id == dataset.id

    def test_document_segment_document_property(self, db_session_with_containers: Session) -> None:
        """Test segment can access its parent document."""
        # Arrange
        tenant_id = str(uuid4())
        created_by = str(uuid4())
        dataset = Dataset(
            tenant_id=tenant_id,
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=created_by,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=created_by,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content="Test",
            word_count=1,
            tokens=2,
            created_by=created_by,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.flush()

        # Act
        related_document = segment.document

        # Assert
        assert related_document is not None
        assert related_document.id == document.id

    def test_document_segment_previous_segment(self, db_session_with_containers: Session) -> None:
        """Test segment can access previous segment."""
        # Arrange
        tenant_id = str(uuid4())
        created_by = str(uuid4())
        dataset = Dataset(
            tenant_id=tenant_id,
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=created_by,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=created_by,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        previous_segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content="Previous",
            word_count=1,
            tokens=2,
            created_by=created_by,
        )
        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=2,
            content="Current",
            word_count=1,
            tokens=2,
            created_by=created_by,
        )
        db_session_with_containers.add_all([previous_segment, segment])
        db_session_with_containers.flush()

        # Act
        prev_seg = segment.previous_segment

        # Assert
        assert prev_seg is not None
        assert prev_seg.position == 1

    def test_document_segment_next_segment(self, db_session_with_containers: Session) -> None:
        """Test segment can access next segment."""
        # Arrange
        tenant_id = str(uuid4())
        created_by = str(uuid4())
        dataset = Dataset(
            tenant_id=tenant_id,
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=created_by,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=created_by,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content="Current",
            word_count=1,
            tokens=2,
            created_by=created_by,
        )
        next_segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=2,
            content="Next",
            word_count=1,
            tokens=2,
            created_by=created_by,
        )
        db_session_with_containers.add_all([segment, next_segment])
        db_session_with_containers.flush()

        # Act
        next_seg = segment.next_segment

        # Assert
        assert next_seg is not None
        assert next_seg.position == 2
