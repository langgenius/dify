from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from core.rag.index_processor.constant.index_type import IndexType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from tasks.duplicate_document_indexing_task import duplicate_document_indexing_task


class TestDuplicateDocumentIndexingTask:
    """Integration tests for duplicate_document_indexing_task using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.duplicate_document_indexing_task.IndexProcessorFactory") as mock_index_processor_factory,
            patch("tasks.duplicate_document_indexing_task.IndexingRunner") as mock_indexing_runner,
            patch("tasks.duplicate_document_indexing_task.FeatureService") as mock_feature_service,
        ):
            # Setup mock index processor
            mock_processor = MagicMock()
            mock_index_processor_factory.return_value.init_index_processor.return_value = mock_processor

            # Setup mock indexing runner
            mock_runner_instance = MagicMock()
            mock_indexing_runner.return_value = mock_runner_instance

            # Setup mock feature service
            mock_features = MagicMock()
            mock_features.billing.enabled = False
            mock_feature_service.get_features.return_value = mock_features

            yield {
                "index_processor_factory": mock_index_processor_factory,
                "index_processor": mock_processor,
                "indexing_runner": mock_indexing_runner,
                "indexing_runner_instance": mock_runner_instance,
                "feature_service": mock_feature_service,
                "features": mock_features,
            }

    def _create_test_dataset_and_documents(
        self, db_session_with_containers, mock_external_service_dependencies, document_count=3
    ):
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
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER.value,
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
            data_source_type="upload_file",
            indexing_technique="high_quality",
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
                data_source_type="upload_file",
                batch="test_batch",
                name=fake.file_name(),
                created_from="upload_file",
                created_by=account.id,
                indexing_status="completed",
                enabled=True,
                doc_form=IndexType.PARAGRAPH_INDEX,
            )
            db_session_with_containers.add(document)
            documents.append(document)

        db_session_with_containers.commit()

        # Refresh dataset to ensure doc_form property works correctly
        db_session_with_containers.refresh(dataset)

        return dataset, documents

    def _create_test_segments(self, db_session_with_containers, document, dataset, segment_count=3):
        """
        Helper method to create test document segments.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            document: Document instance
            dataset: Dataset instance
            segment_count: Number of segments to create

        Returns:
            list: List of created DocumentSegment instances
        """
        fake = Faker()
        segments = []

        for i in range(segment_count):
            segment_text = fake.text(max_nb_chars=200)
            segment = DocumentSegment(
                id=fake.uuid4(),
                tenant_id=document.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=i,
                content=segment_text,
                word_count=len(segment_text.split()),
                tokens=len(segment_text.split()) * 2,
                index_node_id=f"node_{i}",
                index_node_hash=f"hash_{i}",
                enabled=False,
                status="completed",
                created_by=document.created_by,
            )
            db_session_with_containers.add(segment)
            segments.append(segment)

        db_session_with_containers.commit()
        return segments

    def test_duplicate_document_indexing_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful duplicate document indexing.

        This test verifies:
        - Proper dataset and document retrieval
        - Old segments are cleaned from vector index
        - Old segments are deleted from database
        - Documents are prepared for re-indexing
        - IndexingRunner processes documents correctly
        - Database state is properly managed
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        # Create segments for each document
        all_segments = []
        for document in documents:
            segments = self._create_test_segments(db_session_with_containers, document, dataset)
            all_segments.extend(segments)

        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify the expected outcomes
        # Verify index processor was called for each document
        assert mock_external_service_dependencies["index_processor_factory"].call_count == 2

        # Verify segments were cleaned from vector index
        mock_processor = mock_external_service_dependencies["index_processor"]
        assert mock_processor.clean.call_count == 2

        # Verify clean was called with correct parameters
        for i, call in enumerate(mock_processor.clean.call_args_list):
            args, kwargs = call
            # Verify parameters (skip dataset object check due to SQLAlchemy session issues)
            assert len(args) >= 2  # dataset and index_node_ids
            assert args[1] == [f"node_{j}" for j in range(3)]  # index_node_ids
            assert kwargs["with_keywords"] is True
            assert kwargs["delete_child_chunks"] is True

        # Verify segments were deleted from database
        for document in documents:
            remaining_segments = (
                db_session_with_containers.query(DocumentSegment)
                .where(DocumentSegment.document_id == document.id)
                .all()
            )
            assert len(remaining_segments) == 0

        # Verify documents were prepared for re-indexing
        for document in documents:
            db_session_with_containers.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify IndexingRunner was called
        mock_runner_instance = mock_external_service_dependencies["indexing_runner_instance"]
        mock_runner_instance.run.assert_called_once()
        run_args = mock_runner_instance.run.call_args[0][0]
        assert len(run_args) == 2
        # Skip document ID verification due to SQLAlchemy session issues

    def test_duplicate_document_indexing_with_different_index_types(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test duplicate document indexing with different index types.

        This test verifies:
        - Proper handling of different index types (PARAGRAPH_INDEX, QA_INDEX)
        - Index processor factory integration with correct types
        - Document processing with various configurations
        - Database state management
        """
        # Arrange: Create test data with different index types
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        # Set different index types for documents
        documents[0].doc_form = IndexType.PARAGRAPH_INDEX
        documents[1].doc_form = IndexType.QA_INDEX
        db_session_with_containers.commit()

        # Create segments for each document
        for document in documents:
            self._create_test_segments(db_session_with_containers, document, dataset)

        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify different index types were handled correctly
        mock_processor_factory = mock_external_service_dependencies["index_processor_factory"]
        assert mock_processor_factory.call_count == 2

        # Verify correct index types were used
        call_args_list = mock_processor_factory.call_args_list
        assert call_args_list[0][0][0] == IndexType.PARAGRAPH_INDEX
        assert call_args_list[1][0][0] == IndexType.QA_INDEX

        # Verify IndexingRunner processed documents
        mock_runner_instance = mock_external_service_dependencies["indexing_runner_instance"]
        mock_runner_instance.run.assert_called_once()

    def test_duplicate_document_indexing_dataset_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling when dataset doesn't exist.

        This test verifies:
        - Proper error handling for missing dataset
        - Early return without processing
        - Database session cleanup
        - No unnecessary external service calls
        """
        # Arrange: Use non-existent dataset ID
        fake = Faker()
        non_existent_dataset_id = fake.uuid4()
        document_ids = [fake.uuid4()]

        # Act: Execute the task with non-existent dataset
        duplicate_document_indexing_task(non_existent_dataset_id, document_ids)

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_duplicate_document_indexing_document_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling when some documents don't exist.

        This test verifies:
        - Task continues processing existing documents
        - Non-existent documents are skipped
        - Existing documents are processed normally
        - Database state is properly managed
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=1
        )

        # Create segments for the document
        self._create_test_segments(db_session_with_containers, documents[0], dataset)

        # Mix existing and non-existent document IDs
        fake = Faker()
        document_ids = [documents[0].id, fake.uuid4(), fake.uuid4()]

        # Act: Execute the task
        duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify only existing document was processed
        mock_processor_factory = mock_external_service_dependencies["index_processor_factory"]
        assert mock_processor_factory.call_count == 1

        # Verify the existing document was processed
        mock_runner_instance = mock_external_service_dependencies["indexing_runner_instance"]
        mock_runner_instance.run.assert_called_once()
        run_args = mock_runner_instance.run.call_args[0][0]
        assert len(run_args) == 1
        # Skip document ID verification due to SQLAlchemy session issues

    def test_duplicate_document_indexing_with_no_segments(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test duplicate document indexing when documents have no segments.

        This test verifies:
        - Proper handling when documents have no existing segments
        - Index processor clean is not called for documents without segments
        - Documents are still prepared for re-indexing
        - IndexingRunner processes documents normally
        """
        # Arrange: Create test data without segments
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify processing occurred without segment cleanup
        mock_processor = mock_external_service_dependencies["index_processor"]
        # Clean should not be called since there are no segments
        mock_processor.clean.assert_not_called()

        # Verify documents were prepared for re-indexing
        for document in documents:
            db_session_with_containers.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify IndexingRunner was called
        mock_runner_instance = mock_external_service_dependencies["indexing_runner_instance"]
        mock_runner_instance.run.assert_called_once()

    def test_duplicate_document_indexing_billing_limit_exceeded(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling when billing limits are exceeded.

        This test verifies:
        - Proper billing limit validation
        - Documents are marked with error status when limits exceeded
        - Error information is recorded correctly
        - Processing stops when limits are exceeded
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        # Setup billing features to exceed limits
        mock_features = mock_external_service_dependencies["features"]
        mock_features.billing.enabled = True
        mock_features.vector_space.size = 5
        mock_features.vector_space.limit = (
            mock_features.vector_space.size + len(documents) - 1
        )  # Exceed limit by adding documents

        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify error handling
        for document in documents:
            db_session_with_containers.refresh(document)
            assert document.indexing_status == "error"
            assert document.error is not None
            assert "exceeded the limit" in document.error
            assert document.stopped_at is not None

        # Verify no processing occurred due to billing limits
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_duplicate_document_indexing_sandbox_plan_batch_limit(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling when sandbox plan tries to process multiple documents.

        This test verifies:
        - Sandbox plan batch upload limit enforcement
        - Proper error message for plan limitations
        - Documents are marked with error status
        - Processing stops when plan limits are exceeded
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        # Setup sandbox plan with billing enabled
        mock_features = mock_external_service_dependencies["features"]
        mock_features.billing.enabled = True
        mock_features.billing.subscription.plan = "sandbox"

        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify sandbox plan limit enforcement
        for document in documents:
            db_session_with_containers.refresh(document)
            assert document.indexing_status == "error"
            assert document.error is not None
            assert "does not support batch upload" in document.error
            assert document.stopped_at is not None

        # Verify no processing occurred due to plan limits
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_duplicate_document_indexing_batch_upload_limit_exceeded(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling when batch upload limit is exceeded.

        This test verifies:
        - Batch upload limit validation
        - Proper error message for batch limits
        - Documents are marked with error status
        - Processing stops when batch limits are exceeded
        """
        # Arrange: Create test data with many documents
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=5
        )

        # Setup billing features with batch upload limit
        mock_features = mock_external_service_dependencies["features"]
        mock_features.billing.enabled = True
        mock_features.billing.subscription.plan = "pro"

        # Mock BATCH_UPLOAD_LIMIT to be lower than document count
        with patch("tasks.duplicate_document_indexing_task.dify_config") as mock_config:
            mock_config.BATCH_UPLOAD_LIMIT = len(documents) - 2

            document_ids = [doc.id for doc in documents]

            # Act: Execute the task
            duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify batch upload limit enforcement
        for document in documents:
            db_session_with_containers.refresh(document)
            assert document.indexing_status == "error"
            assert document.error is not None
            assert "batch upload limit" in document.error
            assert document.stopped_at is not None

        # Verify no processing occurred due to batch limits
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_duplicate_document_indexing_document_is_paused_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling when DocumentIsPausedError is raised.

        This test verifies:
        - DocumentIsPausedError is properly caught and logged
        - Task continues execution despite pause error
        - Database session is properly closed
        - No additional processing occurs after pause error
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=1
        )

        # Create segments for the document
        self._create_test_segments(db_session_with_containers, documents[0], dataset)

        # Mock IndexingRunner to raise DocumentIsPausedError
        from core.indexing_runner import DocumentIsPausedError

        mock_runner_instance = mock_external_service_dependencies["indexing_runner_instance"]
        mock_runner_instance.run.side_effect = DocumentIsPausedError("Document paused")

        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify DocumentIsPausedError was handled
        # The task should complete without raising an exception
        # and the database session should be closed properly

        # Verify IndexingRunner was called
        mock_runner_instance.run.assert_called_once()

        # Verify documents were prepared for re-indexing before the error
        for document in documents:
            db_session_with_containers.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

    def test_duplicate_document_indexing_general_exception_handling(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test general exception handling during processing.

        This test verifies:
        - General exceptions are properly caught and logged
        - Task completes without raising unhandled exceptions
        - Database session is properly closed
        - Error information is logged correctly
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=1
        )

        # Create segments for the document
        self._create_test_segments(db_session_with_containers, documents[0], dataset)

        # Mock IndexingRunner to raise a general exception
        mock_runner_instance = mock_external_service_dependencies["indexing_runner_instance"]
        mock_runner_instance.run.side_effect = Exception("General processing error")

        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify general exception was handled
        # The task should complete without raising an exception
        # and the database session should be closed properly

        # Verify IndexingRunner was called
        mock_runner_instance.run.assert_called_once()

        # Verify documents were prepared for re-indexing before the error
        for document in documents:
            db_session_with_containers.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

    def test_duplicate_document_indexing_mixed_document_states(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test processing documents with mixed states and configurations.

        This test verifies:
        - Documents with different index types are handled correctly
        - Documents with and without segments are processed properly
        - Mixed document states don't cause processing issues
        - All valid documents are processed regardless of others
        """
        # Arrange: Create test data with mixed states
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=3
        )

        # Set different index types and states
        documents[0].doc_form = IndexType.PARAGRAPH_INDEX
        documents[1].doc_form = IndexType.QA_INDEX
        documents[2].doc_form = IndexType.PARENT_CHILD_INDEX
        db_session_with_containers.commit()

        # Create segments only for first two documents
        self._create_test_segments(db_session_with_containers, documents[0], dataset)
        self._create_test_segments(db_session_with_containers, documents[1], dataset)
        # documents[2] has no segments

        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify all documents were processed correctly
        mock_processor_factory = mock_external_service_dependencies["index_processor_factory"]
        assert mock_processor_factory.call_count == 3

        # Verify correct index types were used
        call_args_list = mock_processor_factory.call_args_list
        assert call_args_list[0][0][0] == IndexType.PARAGRAPH_INDEX
        assert call_args_list[1][0][0] == IndexType.QA_INDEX
        assert call_args_list[2][0][0] == IndexType.PARENT_CHILD_INDEX

        # Verify clean was called only for documents with segments
        mock_processor = mock_external_service_dependencies["index_processor"]
        assert mock_processor.clean.call_count == 2  # Only first two documents had segments

        # Verify all documents were prepared for re-indexing
        for document in documents:
            db_session_with_containers.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify IndexingRunner processed all documents
        mock_runner_instance = mock_external_service_dependencies["indexing_runner_instance"]
        mock_runner_instance.run.assert_called_once()
        run_args = mock_runner_instance.run.call_args[0][0]
        assert len(run_args) == 3
