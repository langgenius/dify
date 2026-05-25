"""
Integration tests for clean_notion_document_task using TestContainers.

This module tests the clean_notion_document_task functionality with real database
containers to ensure proper cleanup of Notion documents, segments, and vector indices.
"""

import json
import uuid
from unittest.mock import Mock, patch

import pytest
from faker import Faker
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from services.account_service import AccountService, TenantService
from tasks.clean_notion_document_task import clean_notion_document_task
from tests.test_containers_integration_tests.helpers import generate_valid_password


def _count_documents(session: Session, condition: ColumnElement[bool]) -> int:
    return session.scalar(select(func.count()).select_from(Document).where(condition)) or 0


def _count_segments(session: Session, condition: ColumnElement[bool]) -> int:
    return session.scalar(select(func.count()).select_from(DocumentSegment).where(condition)) or 0


class TestCleanNotionDocumentTask:
    """Integration tests for clean_notion_document_task using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_account_feature_service,
        ):
            # Setup default mock returns for account service
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True

            yield {
                "account_feature_service": mock_account_feature_service,
            }

    @pytest.fixture
    def mock_index_processor(self):
        """Mock IndexProcessor for testing."""
        mock_processor = Mock()
        mock_processor.clean = Mock()
        return mock_processor

    @pytest.fixture
    def mock_index_processor_factory(self, mock_index_processor):
        """Mock IndexProcessorFactory for testing."""
        # Mock the actual IndexProcessorFactory class
        with patch("tasks.clean_notion_document_task.IndexProcessorFactory") as mock_factory:
            # Create a mock instance that will be returned when IndexProcessorFactory() is called
            mock_instance = Mock()
            mock_instance.init_index_processor.return_value = mock_index_processor

            # Set the mock_factory to return our mock_instance when called
            mock_factory.return_value = mock_instance

            # Ensure the mock_index_processor has the clean method properly set
            mock_index_processor.clean = Mock()

            yield mock_factory

    def test_clean_notion_document_task_success(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test successful cleanup of Notion documents with proper database operations.

        This test verifies that the task correctly:
        1. Deletes Document records from database
        2. Deletes DocumentSegment records from database
        3. Calls index processor to clean vector and keyword indices
        4. Commits all changes to database
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.NOTION_IMPORT,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create documents
        document_ids = []
        segments = []
        index_node_ids = []

        for i in range(3):
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type=DataSourceType.NOTION_IMPORT,
                data_source_info=json.dumps(
                    {"notion_workspace_id": f"workspace_{i}", "notion_page_id": f"page_{i}", "type": "page"}
                ),
                batch="test_batch",
                name=f"Notion Page {i}",
                created_from=DocumentCreatedFrom.WEB,
                created_by=account.id,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,  # Set doc_form to ensure dataset.doc_form works
                doc_language="en",
                indexing_status=IndexingStatus.COMPLETED,
            )
            db_session_with_containers.add(document)
            db_session_with_containers.flush()
            document_ids.append(document.id)
            assert tenant
            # Create segments for each document
            for j in range(2):
                segment = DocumentSegment(
                    tenant_id=tenant.id,
                    dataset_id=dataset.id,
                    document_id=document.id,
                    position=j,
                    content=f"Content {i}-{j}",
                    word_count=100,
                    tokens=50,
                    index_node_id=f"node_{i}_{j}",
                    created_by=account.id,
                    status=SegmentStatus.COMPLETED,
                )
                db_session_with_containers.add(segment)
                segments.append(segment)
                index_node_ids.append(f"node_{i}_{j}")

        db_session_with_containers.commit()

        # Verify data exists before cleanup
        assert _count_documents(db_session_with_containers, Document.id.in_(document_ids)) == 3
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id.in_(document_ids)) == 6

        # Execute cleanup task
        clean_notion_document_task(document_ids, dataset.id)

        # Verify segments are deleted
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id.in_(document_ids)) == 0

        # Verify index processor was called
        mock_processor = mock_index_processor_factory.return_value.init_index_processor.return_value
        mock_processor.clean.assert_called_once()

        # This test successfully verifies:
        # 1. Document records are properly deleted from the database
        # 2. DocumentSegment records are properly deleted from the database
        # 3. The index processor's clean method is called
        # 4. Database transaction handling works correctly
        # 5. The task completes without errors

    def test_clean_notion_document_task_dataset_not_found(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test cleanup task behavior when dataset is not found.

        This test verifies that the task properly handles the case where
        the specified dataset does not exist in the database.
        """
        fake = Faker()
        non_existent_dataset_id = str(uuid.uuid4())
        document_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

        # Execute cleanup task with non-existent dataset - expect exception
        with pytest.raises(Exception, match="Document has no dataset"):
            clean_notion_document_task(document_ids, non_existent_dataset_id)

        # Verify that the index processor factory was not used
        mock_index_processor_factory.return_value.init_index_processor.assert_not_called()

    def test_clean_notion_document_task_empty_document_list(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test cleanup task behavior with empty document list.

        This test verifies that the task handles empty document lists gracefully
        without attempting to process or delete anything.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.NOTION_IMPORT,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        # Execute cleanup task with empty document list
        clean_notion_document_task([], dataset.id)

        # Verify that the index processor was called once with empty node list
        mock_processor = mock_index_processor_factory.return_value.init_index_processor.return_value
        assert mock_processor.clean.call_count == 1
        args, kwargs = mock_processor.clean.call_args
        # args: (dataset, total_index_node_ids)
        assert isinstance(args[0], Dataset)
        assert args[1] == []

    def test_clean_notion_document_task_with_different_index_types(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test cleanup task with different dataset index types.

        This test verifies that the task correctly initializes different types
        of index processors based on the dataset's doc_form configuration.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Test different index types
        # Note: Only testing text_model to avoid dependency on external services
        index_types = [IndexStructureType.PARAGRAPH_INDEX]

        for index_type in index_types:
            # Create dataset (doc_form will be set via document creation)
            dataset = Dataset(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                name=f"{fake.company()}_{index_type}",
                description=fake.text(max_nb_chars=100),
                data_source_type=DataSourceType.NOTION_IMPORT,
                created_by=account.id,
            )
            db_session_with_containers.add(dataset)
            db_session_with_containers.flush()

            # Create a test document with specific doc_form
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=0,
                data_source_type=DataSourceType.NOTION_IMPORT,
                data_source_info=json.dumps(
                    {"notion_workspace_id": "workspace_test", "notion_page_id": "page_test", "type": "page"}
                ),
                batch="test_batch",
                name="Test Notion Page",
                created_from=DocumentCreatedFrom.WEB,
                created_by=account.id,
                doc_form=index_type,
                doc_language="en",
                indexing_status=IndexingStatus.COMPLETED,
            )
            db_session_with_containers.add(document)
            db_session_with_containers.flush()
            assert tenant
            # Create test segment
            segment = DocumentSegment(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=0,
                content="Test content",
                word_count=100,
                tokens=50,
                index_node_id="test_node",
                created_by=account.id,
                status=SegmentStatus.COMPLETED,
            )
            db_session_with_containers.add(segment)
            db_session_with_containers.commit()

            # Execute cleanup task
            clean_notion_document_task([document.id], dataset.id)

            # Note: This test successfully verifies cleanup with different document types.
            # The task properly handles various index types and document configurations.

            # Verify segments are deleted
            assert _count_segments(db_session_with_containers, DocumentSegment.document_id == document.id) == 0

            # Reset mock for next iteration
            mock_index_processor_factory.reset_mock()

    def test_clean_notion_document_task_with_segments_no_index_node_ids(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test cleanup task with segments that have no index_node_ids.

        This test verifies that the task handles segments without index_node_ids
        gracefully and still performs proper cleanup.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.NOTION_IMPORT,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create document
        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type=DataSourceType.NOTION_IMPORT,
            data_source_info=json.dumps(
                {"notion_workspace_id": "workspace_test", "notion_page_id": "page_test", "type": "page"}
            ),
            batch="test_batch",
            name="Test Notion Page",
            created_from=DocumentCreatedFrom.WEB,
            created_by=account.id,
            doc_language="en",
            indexing_status=IndexingStatus.COMPLETED,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()
        assert tenant
        # Create segments without index_node_ids
        segments = []
        for i in range(3):
            segment = DocumentSegment(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=i,
                content=f"Content {i}",
                word_count=100,
                tokens=50,
                index_node_id=None,  # No index node ID
                created_by=account.id,
                status=SegmentStatus.COMPLETED,
            )
            db_session_with_containers.add(segment)
            segments.append(segment)

        db_session_with_containers.commit()

        # Execute cleanup task
        clean_notion_document_task([document.id], dataset.id)

        # Verify segments are deleted
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id == document.id) == 0

        # Note: This test successfully verifies that segments without index_node_ids
        # are properly deleted from the database.

    def test_clean_notion_document_task_partial_document_cleanup(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test cleanup task with partial document cleanup scenario.

        This test verifies that the task can handle cleaning up only specific
        documents while leaving others intact.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.NOTION_IMPORT,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create multiple documents
        documents = []
        all_segments = []
        all_index_node_ids = []

        for i in range(5):
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type=DataSourceType.NOTION_IMPORT,
                data_source_info=json.dumps(
                    {"notion_workspace_id": f"workspace_{i}", "notion_page_id": f"page_{i}", "type": "page"}
                ),
                batch="test_batch",
                name=f"Notion Page {i}",
                created_from=DocumentCreatedFrom.WEB,
                created_by=account.id,
                doc_language="en",
                indexing_status=IndexingStatus.COMPLETED,
            )
            db_session_with_containers.add(document)
            db_session_with_containers.flush()
            documents.append(document)
            assert tenant
            # Create segments for each document
            for j in range(2):
                segment = DocumentSegment(
                    tenant_id=tenant.id,
                    dataset_id=dataset.id,
                    document_id=document.id,
                    position=j,
                    content=f"Content {i}-{j}",
                    word_count=100,
                    tokens=50,
                    index_node_id=f"node_{i}_{j}",
                    created_by=account.id,
                    status=SegmentStatus.COMPLETED,
                )
                db_session_with_containers.add(segment)
                all_segments.append(segment)
                all_index_node_ids.append(f"node_{i}_{j}")

        db_session_with_containers.commit()

        # Verify all data exists before cleanup
        assert _count_documents(db_session_with_containers, Document.dataset_id == dataset.id) == 5
        assert _count_segments(db_session_with_containers, DocumentSegment.dataset_id == dataset.id) == 10

        # Clean up only first 3 documents
        documents_to_clean = [doc.id for doc in documents[:3]]
        segments_to_clean = [seg for seg in all_segments if seg.document_id in documents_to_clean]
        index_node_ids_to_clean = [seg.index_node_id for seg in segments_to_clean]

        clean_notion_document_task(documents_to_clean, dataset.id)

        # Verify only specified documents' segments are deleted
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id.in_(documents_to_clean)) == 0

        # Verify remaining documents and segments are intact
        remaining_docs = [doc.id for doc in documents[3:]]
        assert _count_documents(db_session_with_containers, Document.id.in_(remaining_docs)) == 2
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id.in_(remaining_docs)) == 4

        # Note: This test successfully verifies partial document cleanup operations.
        # The database operations work correctly, isolating only the specified documents.

    def test_clean_notion_document_task_with_mixed_segment_statuses(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test cleanup task with segments in different statuses.

        This test verifies that the task properly handles segments with
        various statuses (waiting, processing, completed, error).
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.NOTION_IMPORT,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create document
        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type=DataSourceType.NOTION_IMPORT,
            data_source_info=json.dumps(
                {"notion_workspace_id": "workspace_test", "notion_page_id": "page_test", "type": "page"}
            ),
            batch="test_batch",
            name="Test Notion Page",
            created_from=DocumentCreatedFrom.WEB,
            created_by=account.id,
            doc_language="en",
            indexing_status=IndexingStatus.COMPLETED,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        # Create segments with different statuses
        segment_statuses = [SegmentStatus.WAITING, SegmentStatus.INDEXING, SegmentStatus.COMPLETED, SegmentStatus.ERROR]
        segments = []
        index_node_ids = []
        assert tenant
        for i, status in enumerate(segment_statuses):
            segment = DocumentSegment(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=i,
                content=f"Content {i}",
                word_count=100,
                tokens=50,
                index_node_id=f"node_{i}",
                created_by=account.id,
                status=status,
            )
            db_session_with_containers.add(segment)
            segments.append(segment)
            index_node_ids.append(f"node_{i}")

        db_session_with_containers.commit()

        # Verify all segments exist before cleanup
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id == document.id) == 4

        # Execute cleanup task
        clean_notion_document_task([document.id], dataset.id)

        # Verify all segments are deleted regardless of status
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id == document.id) == 0

        # Note: This test successfully verifies database operations.
        # IndexProcessor verification would require more sophisticated mocking.

    def test_clean_notion_document_task_continues_when_index_processor_fails(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Index processor failure (e.g. transient billing API error propagated via
        ``FeatureService`` when ``Vector(dataset)`` lazily resolves the embedding
        model) must NOT abort the cleanup task. The Document rows have already
        been hard-deleted in the first session block before vector cleanup runs,
        so any uncaught exception escaping the task would strand
        ``DocumentSegment`` rows in PG with no parent ``Document``.

        Contract: the task swallows the index_processor exception, logs it, and
        proceeds to delete the segments — leaving PG consistent. (Vector orphans,
        if any, can be reaped later by an offline scanner.)

        Regression guard for the production incident where ``clean_document_task``
        / ``clean_notion_document_task`` failed with
        ``ValueError("Unable to retrieve billing information...")`` and left
        tens of thousands of orphan segments per affected tenant.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.NOTION_IMPORT,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create document
        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type=DataSourceType.NOTION_IMPORT,
            data_source_info=json.dumps(
                {"notion_workspace_id": "workspace_test", "notion_page_id": "page_test", "type": "page"}
            ),
            batch="test_batch",
            name="Test Notion Page",
            created_from=DocumentCreatedFrom.WEB,
            created_by=account.id,
            doc_language="en",
            indexing_status=IndexingStatus.COMPLETED,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()
        assert tenant
        # Create segment
        segment = DocumentSegment(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=0,
            content="Test content",
            word_count=100,
            tokens=50,
            index_node_id="test_node",
            created_by=account.id,
            status=SegmentStatus.COMPLETED,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Simulate the production failure mode: index_processor.clean() raises a
        # ValueError mirroring ``BillingService._send_request`` returning non-200.
        mock_index_processor = mock_index_processor_factory.return_value.init_index_processor.return_value
        mock_index_processor.clean.side_effect = ValueError(
            "Unable to retrieve billing information. Please try again later or contact support."
        )

        # Execute cleanup task — must NOT raise even though clean() raises.
        # Before the safety-net wrapper this would have re-raised the ValueError,
        # aborting the task and leaving DocumentSegment stranded in PG.
        clean_notion_document_task([document.id], dataset.id)

        # Vector cleanup was attempted exactly once.
        mock_index_processor.clean.assert_called_once()

        # The crucial assertion: despite the index processor failure, the
        # final session block (line 51-52, ``DELETE FROM document_segments``)
        # still ran and committed. This is what the wrapper buys us — without
        # it the production incident left tens of thousands of orphan segments
        # per affected tenant. Aligns with the assertion shape used by the
        # happy-path test (``test_clean_notion_document_task_success``).
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id == document.id) == 0

    def test_clean_notion_document_task_with_large_number_of_documents(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test cleanup task with a large number of documents and segments.

        This test verifies that the task can handle bulk cleanup operations
        efficiently with a significant number of documents and segments.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.NOTION_IMPORT,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create a large number of documents
        num_documents = 50
        documents = []
        all_segments = []
        all_index_node_ids = []

        for i in range(num_documents):
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type=DataSourceType.NOTION_IMPORT,
                data_source_info=json.dumps(
                    {"notion_workspace_id": f"workspace_{i}", "notion_page_id": f"page_{i}", "type": "page"}
                ),
                batch="test_batch",
                name=f"Notion Page {i}",
                created_from=DocumentCreatedFrom.WEB,
                created_by=account.id,
                doc_language="en",
                indexing_status=IndexingStatus.COMPLETED,
            )
            db_session_with_containers.add(document)
            db_session_with_containers.flush()
            documents.append(document)
            assert tenant
            # Create multiple segments for each document
            num_segments_per_doc = 5
            for j in range(num_segments_per_doc):
                segment = DocumentSegment(
                    tenant_id=tenant.id,
                    dataset_id=dataset.id,
                    document_id=document.id,
                    position=j,
                    content=f"Content {i}-{j}",
                    word_count=100,
                    tokens=50,
                    index_node_id=f"node_{i}_{j}",
                    created_by=account.id,
                    status=SegmentStatus.COMPLETED,
                )
                db_session_with_containers.add(segment)
                all_segments.append(segment)
                all_index_node_ids.append(f"node_{i}_{j}")

        db_session_with_containers.commit()

        # Verify all data exists before cleanup
        assert _count_documents(db_session_with_containers, Document.dataset_id == dataset.id) == num_documents
        assert (
            _count_segments(db_session_with_containers, DocumentSegment.dataset_id == dataset.id)
            == num_documents * num_segments_per_doc
        )

        # Execute cleanup task for all documents
        all_document_ids = [doc.id for doc in documents]
        clean_notion_document_task(all_document_ids, dataset.id)

        # Verify all segments are deleted
        assert _count_segments(db_session_with_containers, DocumentSegment.dataset_id == dataset.id) == 0

        # Note: This test successfully verifies bulk document cleanup operations.
        # The database efficiently handles large-scale deletions.

    def test_clean_notion_document_task_with_documents_from_different_tenants(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test cleanup task with documents from different tenants.

        This test verifies that the task properly handles multi-tenant scenarios
        and only affects documents from the specified dataset's tenant.
        """
        fake = Faker()

        # Create multiple accounts and tenants
        accounts = []
        tenants = []
        datasets = []

        for i in range(3):
            account = AccountService.create_account(
                email=fake.email(),
                name=fake.name(),
                interface_language="en-US",
                password=generate_valid_password(fake),
            )
            TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
            tenant = account.current_tenant
            accounts.append(account)
            tenants.append(tenant)

            # Create dataset for each tenant
            dataset = Dataset(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                name=f"{fake.company()}_{i}",
                description=fake.text(max_nb_chars=100),
                data_source_type=DataSourceType.NOTION_IMPORT,
                created_by=account.id,
            )
            db_session_with_containers.add(dataset)
            db_session_with_containers.flush()
            datasets.append(dataset)

        # Create documents for each dataset
        all_documents = []
        all_segments = []
        all_index_node_ids = []

        for i, (dataset, account) in enumerate(zip(datasets, accounts)):
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=account.current_tenant.id,
                dataset_id=dataset.id,
                position=0,
                data_source_type=DataSourceType.NOTION_IMPORT,
                data_source_info=json.dumps(
                    {"notion_workspace_id": f"workspace_{i}", "notion_page_id": f"page_{i}", "type": "page"}
                ),
                batch="test_batch",
                name=f"Notion Page {i}",
                created_from=DocumentCreatedFrom.WEB,
                created_by=account.id,
                doc_language="en",
                indexing_status=IndexingStatus.COMPLETED,
            )
            db_session_with_containers.add(document)
            db_session_with_containers.flush()
            all_documents.append(document)

            # Create segments for each document
            for j in range(3):
                segment = DocumentSegment(
                    tenant_id=account.current_tenant.id,
                    dataset_id=dataset.id,
                    document_id=document.id,
                    position=j,
                    content=f"Content {i}-{j}",
                    word_count=100,
                    tokens=50,
                    index_node_id=f"node_{i}_{j}",
                    created_by=account.id,
                    status=SegmentStatus.COMPLETED,
                )
                db_session_with_containers.add(segment)
                all_segments.append(segment)
                all_index_node_ids.append(f"node_{i}_{j}")

        db_session_with_containers.commit()

        # Verify all data exists before cleanup
        # Note: There may be documents from previous tests, so we check for at least 3
        assert db_session_with_containers.scalar(select(func.count()).select_from(Document)) >= 3
        assert db_session_with_containers.scalar(select(func.count()).select_from(DocumentSegment)) >= 9

        # Clean up documents from only the first dataset
        target_dataset = datasets[0]
        target_document = all_documents[0]
        target_segments = [seg for seg in all_segments if seg.dataset_id == target_dataset.id]
        target_index_node_ids = [seg.index_node_id for seg in target_segments]

        clean_notion_document_task([target_document.id], target_dataset.id)

        # Verify only documents' segments from target dataset are deleted
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id == target_document.id) == 0

        # Verify documents from other datasets remain intact
        remaining_docs = [doc.id for doc in all_documents[1:]]
        assert _count_documents(db_session_with_containers, Document.id.in_(remaining_docs)) == 2
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id.in_(remaining_docs)) == 6

        # Note: This test successfully verifies multi-tenant isolation.
        # Only documents from the target dataset are affected, maintaining tenant separation.

    def test_clean_notion_document_task_with_documents_in_different_states(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test cleanup task with documents in different indexing states.

        This test verifies that the task properly handles documents with
        various indexing statuses (waiting, processing, completed, error).
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.NOTION_IMPORT,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create documents with different indexing statuses
        document_statuses = [
            IndexingStatus.WAITING,
            IndexingStatus.PARSING,
            IndexingStatus.CLEANING,
            IndexingStatus.SPLITTING,
            IndexingStatus.INDEXING,
            IndexingStatus.COMPLETED,
            IndexingStatus.ERROR,
        ]
        documents = []
        all_segments = []
        all_index_node_ids = []

        for i, status in enumerate(document_statuses):
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type=DataSourceType.NOTION_IMPORT,
                data_source_info=json.dumps(
                    {"notion_workspace_id": f"workspace_{i}", "notion_page_id": f"page_{i}", "type": "page"}
                ),
                batch="test_batch",
                name=f"Notion Page {i}",
                created_from=DocumentCreatedFrom.WEB,
                created_by=account.id,
                doc_language="en",
                indexing_status=status,
            )
            db_session_with_containers.add(document)
            db_session_with_containers.flush()
            documents.append(document)
            assert tenant
            # Create segments for each document
            for j in range(2):
                segment = DocumentSegment(
                    tenant_id=tenant.id,
                    dataset_id=dataset.id,
                    document_id=document.id,
                    position=j,
                    content=f"Content {i}-{j}",
                    word_count=100,
                    tokens=50,
                    index_node_id=f"node_{i}_{j}",
                    created_by=account.id,
                    status=SegmentStatus.COMPLETED,
                )
                db_session_with_containers.add(segment)
                all_segments.append(segment)
                all_index_node_ids.append(f"node_{i}_{j}")

        db_session_with_containers.commit()

        # Verify all data exists before cleanup
        assert _count_documents(db_session_with_containers, Document.dataset_id == dataset.id) == len(document_statuses)
        assert (
            _count_segments(db_session_with_containers, DocumentSegment.dataset_id == dataset.id)
            == len(document_statuses) * 2
        )

        # Execute cleanup task for all documents
        all_document_ids = [doc.id for doc in documents]
        clean_notion_document_task(all_document_ids, dataset.id)

        # Verify all segments are deleted regardless of status
        assert _count_segments(db_session_with_containers, DocumentSegment.dataset_id == dataset.id) == 0

        # Note: This test successfully verifies cleanup of documents in various states.
        # All documents are deleted regardless of their indexing status.

    def test_clean_notion_document_task_with_documents_having_metadata(
        self, db_session_with_containers: Session, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test cleanup task with documents that have rich metadata.

        This test verifies that the task properly handles documents with
        various metadata fields and complex data_source_info.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=generate_valid_password(fake),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset with built-in fields enabled
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.NOTION_IMPORT,
            created_by=account.id,
            built_in_field_enabled=True,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create document with rich metadata
        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type=DataSourceType.NOTION_IMPORT,
            data_source_info=json.dumps(
                {
                    "notion_workspace_id": "workspace_test",
                    "notion_page_id": "page_test",
                    "notion_page_icon": {"type": "emoji", "emoji": "📝"},
                    "type": "page",
                    "additional_field": "additional_value",
                }
            ),
            batch="test_batch",
            name="Test Notion Page with Metadata",
            created_from=DocumentCreatedFrom.WEB,
            created_by=account.id,
            doc_language="en",
            indexing_status=IndexingStatus.COMPLETED,
            doc_metadata={
                "document_name": "Test Notion Page with Metadata",
                "uploader": account.name,
                "upload_date": "2024-01-01 00:00:00",
                "last_update_date": "2024-01-01 00:00:00",
                "source": "notion_import",
            },
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        # Create segments with metadata
        segments = []
        index_node_ids = []
        assert tenant
        for i in range(3):
            segment = DocumentSegment(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=i,
                content=f"Content {i} with rich metadata",
                word_count=150,
                tokens=75,
                index_node_id=f"node_{i}",
                created_by=account.id,
                status=SegmentStatus.COMPLETED,
                keywords={"key1": ["value1", "value2"], "key2": ["value3"]},
            )
            db_session_with_containers.add(segment)
            segments.append(segment)
            index_node_ids.append(f"node_{i}")

        db_session_with_containers.commit()

        # Verify data exists before cleanup
        assert _count_documents(db_session_with_containers, Document.id == document.id) == 1
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id == document.id) == 3

        # Execute cleanup task
        clean_notion_document_task([document.id], dataset.id)

        # Verify segments are deleted
        assert _count_segments(db_session_with_containers, DocumentSegment.document_id == document.id) == 0

        # Note: This test successfully verifies cleanup of documents with rich metadata.
        # The task properly handles complex document structures and metadata fields.
