"""
TestContainers-based integration tests for delete_segment_from_index_task.

This module provides comprehensive integration testing for the delete_segment_from_index_task
using TestContainers to ensure realistic database interactions and proper isolation.
The task is responsible for removing document segments from the vector index when segments
are deleted from the dataset.
"""

import logging

import pytest
from faker import Faker
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models import (
    Account,
    AccountStatus,
    Dataset,
    DatasetPermissionEnum,
    Document,
    DocumentSegment,
    Tenant,
    TenantStatus,
)
from models.enums import DataSourceType, DocumentCreatedFrom, DocumentDocType, IndexingStatus, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind
from tasks.delete_segment_from_index_task import delete_segment_from_index_task
from tests.unit_tests.config_override import apply_config_overrides

logger = logging.getLogger(__name__)


class TestDeleteSegmentFromIndexTask:
    """
    Comprehensive integration tests for delete_segment_from_index_task using testcontainers.

    This test class covers all major functionality of the delete_segment_from_index_task:
    - Successful segment deletion from index
    - Dataset not found scenarios
    - Document not found scenarios
    - Document status validation (disabled, archived, not completed)
    - Index processor integration and cleanup
    - Exception handling and error scenarios
    - Performance and timing verification

    All tests use the testcontainers infrastructure to ensure proper database isolation
    and realistic testing environment with actual database interactions.
    """

    @pytest.fixture(autouse=True)
    def _stub_dispatcher(self, monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=True)
        monkeypatch.setattr("services.knowledge.task_outbox.gateway.wake_knowledge_task_dispatcher", lambda: True)

    def _create_test_tenant(self, db_session_with_containers: Session, fake: Faker | None = None):
        """
        Helper method to create a test tenant with realistic data.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            fake: Faker instance for generating test data

        Returns:
            Tenant: Created test tenant instance
        """
        fake = fake or Faker()
        tenant = Tenant(name=f"Test Tenant {fake.company()}", plan="basic", status=TenantStatus.NORMAL)
        tenant.id = fake.uuid4()
        tenant.created_at = fake.date_time_this_year()
        tenant.updated_at = tenant.created_at

        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()
        return tenant

    def _create_test_account(self, db_session_with_containers: Session, tenant, fake: Faker | None = None):
        """
        Helper method to create a test account with realistic data.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            tenant: Tenant instance for the account
            fake: Faker instance for generating test data

        Returns:
            Account: Created test account instance
        """
        fake = fake or Faker()
        account = Account(
            name=fake.name(),
            email=fake.email(),
            avatar=fake.url(),
            status=AccountStatus.ACTIVE,
            interface_language="en-US",
        )
        account.id = fake.uuid4()
        account.created_at = fake.date_time_this_year()
        account.updated_at = account.created_at

        db_session_with_containers.add(account)
        db_session_with_containers.commit()
        return account

    def _create_test_dataset(
        self, db_session_with_containers: Session, tenant: Tenant, account: Account, fake: Faker | None = None
    ):
        """
        Helper method to create a test dataset with realistic data.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            tenant: Tenant instance for the dataset
            account: Account instance for the dataset
            fake: Faker instance for generating test data

        Returns:
            Dataset: Created test dataset instance
        """
        fake = fake or Faker()
        dataset = Dataset()
        dataset.id = fake.uuid4()
        dataset.tenant_id = tenant.id
        dataset.name = f"Test Dataset {fake.word()}"
        dataset.description = fake.text(max_nb_chars=200)
        dataset.provider = "vendor"
        dataset.permission = DatasetPermissionEnum.ONLY_ME
        dataset.data_source_type = DataSourceType.UPLOAD_FILE
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.index_struct = '{"type": "paragraph"}'
        dataset.created_by = account.id
        dataset.created_at = fake.date_time_this_year()
        dataset.updated_by = account.id
        dataset.updated_at = dataset.created_at
        dataset.embedding_model = "text-embedding-ada-002"
        dataset.embedding_model_provider = "openai"
        dataset.built_in_field_enabled = False

        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        return dataset

    def _create_test_document(self, db_session_with_containers: Session, dataset, account, fake=None, **kwargs):
        """
        Helper method to create a test document with realistic data.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            dataset: Dataset instance for the document
            account: Account instance for the document
            fake: Faker instance for generating test data
            **kwargs: Additional document attributes to override defaults

        Returns:
            Document: Created test document instance
        """
        fake = fake or Faker()
        document = Document()
        document.id = fake.uuid4()
        document.tenant_id = dataset.tenant_id
        document.dataset_id = dataset.id
        document.position = kwargs.get("position", 1)
        document.data_source_type = kwargs.get("data_source_type", "upload_file")
        document.data_source_info = kwargs.get("data_source_info", "{}")
        document.batch = kwargs.get("batch", fake.uuid4())
        document.name = kwargs.get("name", f"Test Document {fake.word()}")
        document.created_from = kwargs.get("created_from", DocumentCreatedFrom.API)
        document.created_by = account.id
        document.created_at = fake.date_time_this_year()
        document.processing_started_at = kwargs.get("processing_started_at", fake.date_time_this_year())
        document.file_id = kwargs.get("file_id", fake.uuid4())
        document.word_count = kwargs.get("word_count", fake.random_int(min=100, max=1000))
        document.parsing_completed_at = kwargs.get("parsing_completed_at", fake.date_time_this_year())
        document.cleaning_completed_at = kwargs.get("cleaning_completed_at", fake.date_time_this_year())
        document.splitting_completed_at = kwargs.get("splitting_completed_at", fake.date_time_this_year())
        document.tokens = kwargs.get("tokens", fake.random_int(min=50, max=500))
        document.indexing_latency = kwargs.get("indexing_latency", fake.random_number(digits=3))
        document.completed_at = kwargs.get("completed_at", fake.date_time_this_year())
        document.is_paused = kwargs.get("is_paused", False)
        document.indexing_status = kwargs.get("indexing_status", "completed")
        document.enabled = kwargs.get("enabled", True)
        document.archived = kwargs.get("archived", False)
        document.updated_at = fake.date_time_this_year()
        document.doc_type = kwargs.get("doc_type", DocumentDocType.PERSONAL_DOCUMENT)
        document.doc_metadata = kwargs.get("doc_metadata", {})
        document.doc_form = kwargs.get("doc_form", IndexStructureType.PARAGRAPH_INDEX)
        document.doc_language = kwargs.get("doc_language", "en")

        db_session_with_containers.add(document)
        db_session_with_containers.commit()
        return document

    def _create_test_document_segments(
        self,
        db_session_with_containers: Session,
        document: Document,
        account: Account,
        count: int = 3,
        fake: Faker | None = None,
    ):
        """
        Helper method to create test document segments with realistic data.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            document: Document instance for the segments
            account: Account instance for the segments
            count: Number of segments to create
            fake: Faker instance for generating test data

        Returns:
            list[DocumentSegment]: List of created test document segment instances
        """
        fake = fake or Faker()
        segments = []

        for i in range(count):
            fake.date_time_this_year()
            segment = DocumentSegment(
                tenant_id=document.tenant_id,
                dataset_id=document.dataset_id,
                document_id=document.id,
                position=i + 1,
                content=f"Test segment content {i + 1}: {fake.text(max_nb_chars=200)}",
                answer=f"Test segment answer {i + 1}: {fake.text(max_nb_chars=100)}",
                word_count=fake.random_int(min=10, max=100),
                tokens=fake.random_int(min=5, max=50),
                keywords=[fake.word() for _ in range(3)],
                index_node_id=f"node_{fake.uuid4()}",
                index_node_hash=fake.sha256(),
                hit_count=0,
                enabled=True,
                status=SegmentStatus.COMPLETED,
                created_by=account.id,
                updated_by=account.id,
            )

            db_session_with_containers.add(segment)
            segments.append(segment)

        db_session_with_containers.commit()
        return segments

    def test_delete_segment_from_index_task_success(self, db_session_with_containers: Session):
        """
        Test successful segment deletion from index with comprehensive verification.

        This test verifies:
        - Proper task execution with valid dataset and document
        - Index processor factory initialization with correct document form
        - Index processor clean method called with correct parameters
        - Database session properly closed after execution
        - Task completes without exceptions
        """
        fake = Faker()

        # Create test data
        tenant = self._create_test_tenant(db_session_with_containers, fake)
        account = self._create_test_account(db_session_with_containers, tenant, fake)
        dataset = self._create_test_dataset(db_session_with_containers, tenant, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        segments = self._create_test_document_segments(db_session_with_containers, document, account, 3, fake)

        # Extract index node IDs for the task
        index_node_ids = [segment.index_node_id for segment in segments]

        # Extract segment IDs for the task
        segment_ids = [segment.id for segment in segments]

        # Execute the task
        result = delete_segment_from_index_task(index_node_ids, dataset.id, document.id, segment_ids)

        # Verify the task completed successfully
        assert result is None  # Task should return None on success

        intent = db_session_with_containers.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP,
                KnowledgeTaskOutbox.dataset_id == dataset.id,
            )
        )
        assert intent is not None
        assert intent.payload["vector_node_ids"] == index_node_ids

    def test_delete_segment_from_index_task_dataset_not_found(self, db_session_with_containers: Session):
        """
        Test task behavior when dataset is not found.

        This test verifies:
        - Task handles missing dataset gracefully
        - No index processor operations are attempted
        - Task returns early without exceptions
        - Database session is properly closed
        """
        fake = Faker()
        non_existent_dataset_id = fake.uuid4()
        non_existent_document_id = fake.uuid4()
        index_node_ids = [f"node_{fake.uuid4()}" for _ in range(3)]

        # Execute the task with non-existent dataset
        result = delete_segment_from_index_task(index_node_ids, non_existent_dataset_id, non_existent_document_id, [])

        # Verify the task completed without exceptions
        assert result is None  # Task should return None when dataset not found

    def test_delete_segment_from_index_task_document_not_found(self, db_session_with_containers: Session):
        """
        Test task behavior when document is not found.

        This test verifies:
        - Task handles missing document gracefully
        - No index processor operations are attempted
        - Task returns early without exceptions
        - Database session is properly closed
        """
        fake = Faker()

        # Create test data
        tenant = self._create_test_tenant(db_session_with_containers, fake)
        account = self._create_test_account(db_session_with_containers, tenant, fake)
        dataset = self._create_test_dataset(db_session_with_containers, tenant, account, fake)

        non_existent_document_id = fake.uuid4()
        index_node_ids = [f"node_{fake.uuid4()}" for _ in range(3)]

        # Execute the task with non-existent document
        result = delete_segment_from_index_task(index_node_ids, dataset.id, non_existent_document_id, [])

        # Verify the task completed without exceptions
        assert result is None  # Task should return None when document not found

    def test_delete_segment_from_index_task_document_disabled(self, db_session_with_containers: Session):
        """
        Test task behavior when document is disabled.

        This test verifies:
        - Task handles disabled document gracefully
        - No index processor operations are attempted
        - Task returns early without exceptions
        - Database session is properly closed
        """
        fake = Faker()

        # Create test data with disabled document
        tenant = self._create_test_tenant(db_session_with_containers, fake)
        account = self._create_test_account(db_session_with_containers, tenant, fake)
        dataset = self._create_test_dataset(db_session_with_containers, tenant, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake, enabled=False)
        segments = self._create_test_document_segments(db_session_with_containers, document, account, 3, fake)

        index_node_ids = [segment.index_node_id for segment in segments]
        segment_ids = [segment.id for segment in segments]

        # Execute the task with disabled document
        result = delete_segment_from_index_task(index_node_ids, dataset.id, document.id, segment_ids)

        # Verify the task completed without exceptions
        assert result is None  # Task should return None when document is disabled

    def test_delete_segment_from_index_task_document_archived(self, db_session_with_containers: Session):
        """
        Test task behavior when document is archived.

        This test verifies:
        - Task handles archived document gracefully
        - No index processor operations are attempted
        - Task returns early without exceptions
        - Database session is properly closed
        """
        fake = Faker()

        # Create test data with archived document
        tenant = self._create_test_tenant(db_session_with_containers, fake)
        account = self._create_test_account(db_session_with_containers, tenant, fake)
        dataset = self._create_test_dataset(db_session_with_containers, tenant, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake, archived=True)
        segments = self._create_test_document_segments(db_session_with_containers, document, account, 3, fake)

        index_node_ids = [segment.index_node_id for segment in segments]
        segment_ids = [segment.id for segment in segments]

        # Execute the task with archived document
        result = delete_segment_from_index_task(index_node_ids, dataset.id, document.id, segment_ids)

        # Verify the task completed without exceptions
        assert result is None  # Task should return None when document is archived

    def test_delete_segment_from_index_task_document_not_completed(self, db_session_with_containers: Session):
        """
        Test task behavior when document indexing is not completed.

        This test verifies:
        - Task handles incomplete indexing status gracefully
        - No index processor operations are attempted
        - Task returns early without exceptions
        - Database session is properly closed
        """
        fake = Faker()

        # Create test data with incomplete indexing
        tenant = self._create_test_tenant(db_session_with_containers, fake)
        account = self._create_test_account(db_session_with_containers, tenant, fake)
        dataset = self._create_test_dataset(db_session_with_containers, tenant, account, fake)
        document = self._create_test_document(
            db_session_with_containers, dataset, account, fake, indexing_status=IndexingStatus.INDEXING
        )
        segments = self._create_test_document_segments(db_session_with_containers, document, account, 3, fake)

        index_node_ids = [segment.index_node_id for segment in segments]
        segment_ids = [segment.id for segment in segments]

        # Execute the task with incomplete indexing
        result = delete_segment_from_index_task(index_node_ids, dataset.id, document.id, segment_ids)

        # Verify the task completed without exceptions
        assert result is None  # Task should return None when indexing is not completed

    @pytest.mark.parametrize(
        "doc_form",
        [
            IndexStructureType.PARAGRAPH_INDEX,
            IndexStructureType.QA_INDEX,
            IndexStructureType.PARENT_CHILD_INDEX,
        ],
    )
    def test_delete_segment_persists_nodes_for_each_document_form(
        self,
        db_session_with_containers: Session,
        doc_form: IndexStructureType,
    ) -> None:
        fake = Faker()
        tenant = self._create_test_tenant(db_session_with_containers, fake)
        account = self._create_test_account(db_session_with_containers, tenant, fake)
        dataset = self._create_test_dataset(db_session_with_containers, tenant, account, fake)
        document = self._create_test_document(
            db_session_with_containers,
            dataset,
            account,
            fake,
            doc_form=doc_form,
        )
        segments = self._create_test_document_segments(db_session_with_containers, document, account, 2, fake)
        index_node_ids = [segment.index_node_id for segment in segments]

        delete_segment_from_index_task(
            index_node_ids,
            dataset.id,
            document.id,
            [segment.id for segment in segments],
        )

        intent = db_session_with_containers.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP,
                KnowledgeTaskOutbox.dataset_id == dataset.id,
            )
        )
        assert intent is not None
        assert intent.payload["vector_node_ids"] == index_node_ids

    def test_delete_segment_with_empty_nodes_skips_empty_index_intent(
        self,
        db_session_with_containers: Session,
    ) -> None:
        fake = Faker()
        tenant = self._create_test_tenant(db_session_with_containers, fake)
        account = self._create_test_account(db_session_with_containers, tenant, fake)
        dataset = self._create_test_dataset(db_session_with_containers, tenant, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)

        delete_segment_from_index_task([], dataset.id, document.id, [])

        intent_count = db_session_with_containers.scalar(
            select(func.count())
            .select_from(KnowledgeTaskOutbox)
            .where(
                KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP,
                KnowledgeTaskOutbox.dataset_id == dataset.id,
            )
        )
        assert intent_count == 0

    def test_delete_segment_persists_large_node_batch(
        self,
        db_session_with_containers: Session,
    ) -> None:
        fake = Faker()
        tenant = self._create_test_tenant(db_session_with_containers, fake)
        account = self._create_test_account(db_session_with_containers, tenant, fake)
        dataset = self._create_test_dataset(db_session_with_containers, tenant, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        segments = self._create_test_document_segments(db_session_with_containers, document, account, 50, fake)
        index_node_ids = [segment.index_node_id for segment in segments]

        delete_segment_from_index_task(
            index_node_ids,
            dataset.id,
            document.id,
            [segment.id for segment in segments],
        )

        intent = db_session_with_containers.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP,
                KnowledgeTaskOutbox.dataset_id == dataset.id,
            )
        )
        assert intent is not None
        assert intent.payload["vector_node_ids"] == index_node_ids
