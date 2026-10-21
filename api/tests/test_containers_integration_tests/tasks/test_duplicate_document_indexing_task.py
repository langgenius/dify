from collections.abc import Generator
from typing import TypedDict
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from faker import Faker
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums import CloudPlan, DeploymentEdition
from models import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from services.knowledge.resource_scope import DocumentRef
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind, KnowledgeTaskRequeuedError
from tasks.duplicate_document_indexing_task import (
    normal_duplicate_document_indexing_task,  # New normal task
    priority_duplicate_document_indexing_task,  # New priority task
)
from tests.unit_tests.config_override import config_overrides_context


class ExternalServiceDependencies(TypedDict):
    indexing_runner: MagicMock
    indexing_runner_instance: MagicMock
    feature_service: MagicMock
    features: MagicMock
    vector_factory: MagicMock
    vector: MagicMock


class TestDuplicateDocumentIndexingTasks:
    """Integration tests for duplicate document indexing tasks using testcontainers.

    This test class covers:
    - New normal_duplicate_document_indexing_task function
    - New priority_duplicate_document_indexing_task function
    - Durable generation and outbox execution fencing
    - Document segment cleanup logic
    """

    @pytest.fixture
    def mock_external_service_dependencies(self) -> Generator[ExternalServiceDependencies]:
        """Mock setup for external service dependencies."""
        with (
            patch(
                "tasks.document_indexing_task.build_document_indexing_service", autospec=True
            ) as mock_indexing_runner,
            patch("tasks.document_indexing_task.FeatureService", autospec=True) as mock_feature_service,
            patch("services.knowledge.indexing.adapters.cleanup.Vector", autospec=True) as mock_vector_factory,
        ):
            # Setup mock indexing runner
            mock_runner_instance = mock_indexing_runner.return_value  # Setup mock feature service
            mock_features = MagicMock()
            mock_feature_service.get_features.return_value = mock_features

            mock_vector = mock_vector_factory.return_value

            yield {
                "indexing_runner": mock_indexing_runner,
                "indexing_runner_instance": mock_runner_instance,
                "feature_service": mock_feature_service,
                "features": mock_features,
                "vector_factory": mock_vector_factory,
                "vector": mock_vector,
            }

    def _runner_documents_arg(
        self, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> list[DocumentRef]:
        """Return all document batches passed to the runner."""
        return [
            ref
            for call in mock_external_service_dependencies["indexing_runner_instance"].run.call_args_list
            for ref in call.args[0]
        ]

    def _run_durable_indexing(
        self,
        session: Session,
        *,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        priority: bool = False,
    ) -> str:
        """Execute duplicate indexing through a persisted generation-fenced intent."""
        generations = {document_id: str(uuid4()) for document_id in document_ids}
        documents = session.scalars(
            select(Document).where(
                Document.tenant_id == tenant_id,
                Document.dataset_id == dataset_id,
                Document.id.in_(document_ids),
            )
        ).all()
        for document in documents:
            document.indexing_generation = generations[document.id]
        intent = KnowledgeTaskOutbox(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            task_kind=KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE.value,
            payload={
                "tenant_id": tenant_id,
                "dataset_id": dataset_id,
                "document_ids": document_ids,
                "generations": generations,
                "priority": priority,
            },
            status="dispatched",
        )
        session.add(intent)
        session.commit()
        task = priority_duplicate_document_indexing_task if priority else normal_duplicate_document_indexing_task
        task.run(tenant_id, dataset_id, document_ids, generations, intent.id)
        return intent.id

    def _assert_documents_parsing(self, db_session_with_containers: Session, document_ids: list[str]) -> None:
        """Assert the short status transaction remains committed when the runner exits early."""
        db_session_with_containers.expire_all()
        for doc_id in document_ids:
            updated_document = db_session_with_containers.scalar(select(Document).where(Document.id == doc_id).limit(1))
            assert updated_document is not None
            assert updated_document is not None
            assert updated_document.indexing_status == IndexingStatus.PARSING
            assert updated_document.processing_started_at is not None

    def _create_test_dataset_and_documents(
        self,
        db_session_with_containers: Session,
        mock_external_service_dependencies: ExternalServiceDependencies,
        document_count: int = 3,
    ) -> tuple[Dataset, list[Document]]:
        """
        Helper method to create a test dataset and documents for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            document_count: Number of documents to create

        Returns:
            tuple: (dataset, documents) - Created dataset and document instances
        """
        fake = Faker()

        # Create account and tenant
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status=AccountStatus.ACTIVE,
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(
            name=fake.company(),
            status=TenantStatus.NORMAL,
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        # Create dataset
        dataset = Dataset(
            id=fake.uuid4(),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        # Create documents
        documents = []
        for i in range(document_count):
            document = Document(
                id=fake.uuid4(),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch="test_batch",
                name=fake.file_name(),
                created_from=DocumentCreatedFrom.WEB,
                created_by=account.id,
                indexing_status=IndexingStatus.WAITING,
                enabled=True,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
            )
            db_session_with_containers.add(document)
            documents.append(document)

        db_session_with_containers.commit()

        # Refresh dataset to ensure it's properly loaded
        db_session_with_containers.refresh(dataset)

        return dataset, documents

    def _create_test_dataset_with_segments(
        self,
        db_session_with_containers: Session,
        mock_external_service_dependencies: ExternalServiceDependencies,
        document_count: int = 3,
        segments_per_doc: int = 2,
    ) -> tuple[Dataset, list[Document], list[DocumentSegment]]:
        """
        Helper method to create a test dataset with documents and segments.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            document_count: Number of documents to create
            segments_per_doc: Number of segments per document

        Returns:
            tuple: (dataset, documents, segments) - Created dataset, documents and segments
        """
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count
        )

        fake = Faker()
        segments = []

        # Create segments for each document
        for document in documents:
            for i in range(segments_per_doc):
                segment = DocumentSegment(
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    document_id=document.id,
                    position=i,
                    index_node_id=f"{document.id}-node-{i}",
                    index_node_hash=fake.sha256(),
                    content=fake.text(max_nb_chars=200),
                    word_count=50,
                    tokens=100,
                    status=SegmentStatus.COMPLETED,
                    enabled=True,
                    indexing_at=fake.date_time_this_year(),
                    created_by=dataset.created_by,  # Add required field
                )
                db_session_with_containers.add(segment)
                segments.append(segment)

        db_session_with_containers.commit()

        # Refresh to ensure all relationships are loaded
        for document in documents:
            db_session_with_containers.refresh(document)

        return dataset, documents, segments

    def _create_test_dataset_with_billing_features(
        self,
        db_session_with_containers: Session,
        mock_external_service_dependencies: ExternalServiceDependencies,
    ) -> tuple[Dataset, list[Document]]:
        """
        Helper method to create a test dataset with billing features configured.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (dataset, documents) - Created dataset and document instances
        """
        fake = Faker()

        # Create account and tenant
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status=AccountStatus.ACTIVE,
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(
            name=fake.company(),
            status=TenantStatus.NORMAL,
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        # Create dataset
        dataset = Dataset(
            id=fake.uuid4(),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        # Create documents
        documents = []
        for i in range(3):
            document = Document(
                id=fake.uuid4(),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch="test_batch",
                name=fake.file_name(),
                created_from=DocumentCreatedFrom.WEB,
                created_by=account.id,
                indexing_status=IndexingStatus.WAITING,
                enabled=True,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
            )
            db_session_with_containers.add(document)
            documents.append(document)

        db_session_with_containers.commit()

        # Configure billing features
        mock_external_service_dependencies["features"].billing.subscription.plan = CloudPlan.SANDBOX
        mock_external_service_dependencies["features"].vector_space.limit = 100
        mock_external_service_dependencies["features"].vector_space.size = 50

        # Refresh dataset to ensure it's properly loaded
        db_session_with_containers.refresh(dataset)

        return dataset, documents

    def _test_duplicate_document_indexing_task_success(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """
        Test successful duplicate document indexing with multiple documents.

        This test verifies:
        - Proper dataset retrieval from database
        - Correct document processing and status updates
        - build_document_indexing_service integration
        - Database state updates
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=3
        )
        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        self._run_durable_indexing(
            db_session_with_containers,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_ids=document_ids,
        )

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify the expected outcomes
        # Verify indexing runner was called correctly
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called()

        # Verify documents were updated to parsing status
        # Re-query documents from database since _duplicate_document_indexing_task uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.scalar(select(Document).where(Document.id == doc_id).limit(1))
            assert updated_document is not None
            assert updated_document.indexing_status == IndexingStatus.PARSING
            assert updated_document.processing_started_at is not None

        # Verify the run method was called with correct documents
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = self._runner_documents_arg(mock_external_service_dependencies)
        assert len(processed_documents) == 3

    def _test_duplicate_document_indexing_task_with_segment_cleanup(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """
        Test duplicate document indexing with existing segments that need cleanup.

        This test verifies:
        - Old segments are identified and cleaned
        - Index processor clean method is called
        - Segments are deleted from database
        - New indexing proceeds after cleanup
        """
        # Arrange: Create test data with existing segments
        dataset, documents, segments = self._create_test_dataset_with_segments(
            db_session_with_containers, mock_external_service_dependencies, document_count=2, segments_per_doc=3
        )
        document_ids = [doc.id for doc in documents]
        # Act: Execute the task
        self._run_durable_indexing(
            db_session_with_containers,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_ids=document_ids,
        )

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify segment cleanup
        db_session_with_containers.expire_all()

        # Assert: Verify segment cleanup
        # Each document's previous vector nodes are deleted before replacement.
        assert mock_external_service_dependencies["vector"].delete_by_ids.call_count == len(documents)

        # The mocked indexing provider owns SQL replacement; this task still
        # snapshots and deletes every old external vector before invoking it.
        assert len(segments) == 6

        # Verify documents were updated to parsing status
        for doc_id in document_ids:
            updated_document = db_session_with_containers.scalar(select(Document).where(Document.id == doc_id).limit(1))
            assert updated_document is not None
            assert updated_document.indexing_status == IndexingStatus.PARSING
            assert updated_document.processing_started_at is not None

        # Verify indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called()

    def _test_duplicate_document_indexing_task_dataset_not_found(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """
        Test handling of non-existent dataset.

        This test verifies:
        - Proper error handling for missing datasets
        - Early return without processing
        - Database session cleanup
        - No unnecessary indexing runner calls
        """
        # Arrange: Use non-existent dataset ID
        fake = Faker()
        non_existent_dataset_id = fake.uuid4()
        document_ids = [fake.uuid4() for _ in range(3)]

        # Act: Execute the task with non-existent dataset
        self._run_durable_indexing(
            db_session_with_containers,
            tenant_id=fake.uuid4(),
            dataset_id=non_existent_dataset_id,
            document_ids=document_ids,
        )

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["indexing_runner"].assert_not_called()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()
        mock_external_service_dependencies["vector"].delete_by_ids.assert_not_called()

    def test_duplicate_document_indexing_task_document_not_found_in_dataset(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """
        Test handling when some documents don't exist in the dataset.

        This test verifies:
        - Only existing documents are processed
        - Non-existent documents are ignored
        - Indexing runner receives only valid documents
        - Database state updates correctly
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        # Mix existing and non-existent document IDs
        fake = Faker()
        existing_document_ids = [doc.id for doc in documents]
        non_existent_document_ids = [fake.uuid4() for _ in range(2)]
        all_document_ids = existing_document_ids + non_existent_document_ids

        # Act: Execute the task with mixed document IDs
        self._run_durable_indexing(
            db_session_with_containers,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_ids=all_document_ids,
        )

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify only existing documents were processed
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called()

        # Verify only existing documents were updated
        # Re-query documents from database since _duplicate_document_indexing_task uses a different session
        for doc_id in existing_document_ids:
            updated_document = db_session_with_containers.scalar(select(Document).where(Document.id == doc_id).limit(1))
            assert updated_document is not None
            assert updated_document.indexing_status == IndexingStatus.PARSING
            assert updated_document.processing_started_at is not None

        # Verify the run method was called with only existing documents
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = self._runner_documents_arg(mock_external_service_dependencies)
        assert len(processed_documents) == 2  # Only existing documents

    def _test_duplicate_document_indexing_task_indexing_runner_exception(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """
        Test handling of build_document_indexing_service exceptions.

        This test verifies:
        - Provider failures durably requeue the matching outbox intent
        - The committed parsing phase remains visible for recovery
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Mock build_document_indexing_service to raise an exception
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = Exception(
            "Indexing runner failed"
        )

        # Act: Execute the task
        with pytest.raises(KnowledgeTaskRequeuedError):
            self._run_durable_indexing(
                db_session_with_containers,
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                document_ids=document_ids,
            )

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # The provider call happened before the durable delivery was requeued.
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called()

        # Parsing status is committed before the runner starts, so runner failure cannot roll it back.
        self._assert_documents_parsing(db_session_with_containers, document_ids)

    def _test_duplicate_document_indexing_task_billing_sandbox_plan_batch_limit(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """
        Test billing validation for sandbox plan batch upload limit.

        This test verifies:
        - Sandbox plan batch upload limit enforcement
        - Error handling for batch upload limit exceeded
        - Document status updates to error state
        - Proper error message recording
        """
        # Arrange: Create test data with billing enabled
        dataset, documents = self._create_test_dataset_with_billing_features(
            db_session_with_containers,
            mock_external_service_dependencies,
        )

        # Configure sandbox plan with batch limit
        mock_external_service_dependencies["features"].billing.subscription.plan = CloudPlan.SANDBOX

        # Create more documents than sandbox plan allows (limit is 1)
        fake = Faker()
        extra_documents = []
        for i in range(2):  # Total will be 5 documents (3 existing + 2 new)
            document = Document(
                id=fake.uuid4(),
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                position=i + 3,
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch="test_batch",
                name=fake.file_name(),
                created_from=DocumentCreatedFrom.WEB,
                created_by=dataset.created_by,
                indexing_status=IndexingStatus.WAITING,
                enabled=True,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
            )
            db_session_with_containers.add(document)
            extra_documents.append(document)

        db_session_with_containers.commit()
        all_documents = documents + extra_documents
        document_ids = [doc.id for doc in all_documents]

        # Act: Execute the task with too many documents for sandbox plan
        with pytest.raises(KnowledgeTaskRequeuedError):
            self._run_durable_indexing(
                db_session_with_containers,
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                document_ids=document_ids,
            )

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify error handling
        # Re-query documents from database since _duplicate_document_indexing_task uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.scalar(select(Document).where(Document.id == doc_id).limit(1))
            assert updated_document is not None
            assert updated_document.indexing_status == IndexingStatus.ERROR
            assert updated_document.error is not None
            assert "batch upload" in updated_document.error.lower()
            assert updated_document.stopped_at is not None

        # Verify indexing runner was not called due to early validation error
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

    def _test_duplicate_document_indexing_task_billing_vector_space_limit_exceeded(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """
        Test billing validation for vector space limit.

        This test verifies:
        - Vector space limit enforcement
        - Error handling for vector space limit exceeded
        - Document status updates to error state
        - Proper error message recording
        """
        # Arrange: Create test data with billing enabled
        dataset, documents = self._create_test_dataset_with_billing_features(
            db_session_with_containers,
            mock_external_service_dependencies,
        )

        # Configure TEAM plan with vector space limit exceeded
        mock_external_service_dependencies["features"].billing.subscription.plan = CloudPlan.TEAM
        mock_external_service_dependencies["features"].vector_space.limit = 100
        mock_external_service_dependencies["features"].vector_space.size = 98  # Almost at limit

        document_ids = [doc.id for doc in documents]  # 3 documents will exceed limit

        # Act: Execute the task with documents that will exceed vector space limit
        with pytest.raises(KnowledgeTaskRequeuedError):
            self._run_durable_indexing(
                db_session_with_containers,
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                document_ids=document_ids,
            )

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify error handling
        # Re-query documents from database since _duplicate_document_indexing_task uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.scalar(select(Document).where(Document.id == doc_id).limit(1))
            assert updated_document is not None
            assert updated_document.indexing_status == IndexingStatus.ERROR
            assert updated_document.error is not None
            assert "limit" in updated_document.error.lower()
            assert updated_document.stopped_at is not None

        # Verify indexing runner was not called due to early validation error
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

    def test_duplicate_document_indexing_task_with_empty_document_list(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """
        Test handling of empty document list.

        This test verifies:
        - Empty document list is handled gracefully
        - No processing occurs
        - No errors are raised
        - Database session is properly closed
        """
        # Arrange: Create test dataset
        dataset, _ = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=0
        )
        document_ids = []

        # Act: Execute the task with empty document list
        self._run_durable_indexing(
            db_session_with_containers,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_ids=document_ids,
        )

        # No current document requires provider work.
        mock_external_service_dependencies["indexing_runner"].assert_not_called()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

    def test_normal_duplicate_document_indexing_task(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        self._run_durable_indexing(
            db_session_with_containers,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_ids=[document.id for document in documents],
        )

        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called()

    def test_priority_duplicate_document_indexing_task(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        self._run_durable_indexing(
            db_session_with_containers,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_ids=[document.id for document in documents],
            priority=True,
        )

        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called()

    def test_successful_duplicate_document_indexing(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """Test successful duplicate document indexing flow."""
        self._test_duplicate_document_indexing_task_success(
            db_session_with_containers, mock_external_service_dependencies
        )

    def test_duplicate_document_indexing_dataset_not_found(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """Test duplicate document indexing when dataset is not found."""
        self._test_duplicate_document_indexing_task_dataset_not_found(
            db_session_with_containers, mock_external_service_dependencies
        )

    @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    def test_duplicate_document_indexing_with_cloud_sandbox_plan(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """Test duplicate document indexing with billing enabled and sandbox plan."""
        self._test_duplicate_document_indexing_task_billing_sandbox_plan_batch_limit(
            db_session_with_containers, mock_external_service_dependencies
        )

    @config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    def test_duplicate_document_indexing_with_billing_limit_exceeded(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """Test duplicate document indexing when billing limit is exceeded."""
        self._test_duplicate_document_indexing_task_billing_vector_space_limit_exceeded(
            db_session_with_containers, mock_external_service_dependencies
        )

    def test_duplicate_document_indexing_runner_error(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """Test duplicate document indexing when build_document_indexing_service raises an error."""
        self._test_duplicate_document_indexing_task_indexing_runner_exception(
            db_session_with_containers, mock_external_service_dependencies
        )

    def _test_duplicate_document_indexing_task_document_is_paused(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """Test duplicate document indexing when document is paused."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        for document in documents:
            document.is_paused = True
            db_session_with_containers.add(document)
        db_session_with_containers.commit()

        document_ids = [doc.id for doc in documents]
        self._run_durable_indexing(
            db_session_with_containers,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_ids=document_ids,
        )
        db_session_with_containers.expire_all()

        # Assert
        for doc_id in document_ids:
            updated_document = db_session_with_containers.scalar(select(Document).where(Document.id == doc_id).limit(1))
            assert updated_document is not None
            assert updated_document.is_paused is True
            assert updated_document.indexing_status == IndexingStatus.WAITING
            assert updated_document.display_status == "paused"
            assert updated_document.processing_started_at is None
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

    def test_duplicate_document_indexing_document_is_paused(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """Test duplicate document indexing when document is paused."""
        self._test_duplicate_document_indexing_task_document_is_paused(
            db_session_with_containers, mock_external_service_dependencies
        )

    def test_duplicate_document_indexing_cleans_old_segments(
        self, db_session_with_containers: Session, mock_external_service_dependencies: ExternalServiceDependencies
    ) -> None:
        """Test that duplicate document indexing cleans old segments."""
        self._test_duplicate_document_indexing_task_with_segment_cleanup(
            db_session_with_containers, mock_external_service_dependencies
        )
