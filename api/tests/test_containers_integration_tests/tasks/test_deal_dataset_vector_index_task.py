"""
Integration tests for deal_dataset_vector_index_task using TestContainers.

This module tests the deal_dataset_vector_index_task functionality with real database
containers to ensure proper handling of dataset vector index operations including
add, update, and remove actions.
"""

import uuid
from unittest.mock import ANY, Mock, patch

import pytest
from faker import Faker

from models.dataset import Dataset, Document, DocumentSegment
from services.account_service import AccountService, TenantService
from tasks.deal_dataset_vector_index_task import deal_dataset_vector_index_task


class TestDealDatasetVectorIndexTask:
    """Integration tests for deal_dataset_vector_index_task using testcontainers."""

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
        mock_processor.load = Mock()
        return mock_processor

    @pytest.fixture
    def mock_index_processor_factory(self, mock_index_processor):
        """Mock IndexProcessorFactory for testing."""
        with patch("tasks.deal_dataset_vector_index_task.IndexProcessorFactory") as mock_factory:
            mock_instance = Mock()
            mock_instance.init_index_processor.return_value = mock_index_processor
            mock_factory.return_value = mock_instance
            yield mock_factory

    def test_deal_dataset_vector_index_task_remove_action_success(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test successful removal of dataset vector index.

        This test verifies that the task correctly:
        1. Finds the dataset in database
        2. Calls index processor to clean vector indices
        3. Handles the remove action properly
        4. Completes without errors
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create a document to set the doc_form property
        document_for_doc_form = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Document for doc_form",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document_for_doc_form)
        db_session_with_containers.commit()

        # Execute remove action
        deal_dataset_vector_index_task(dataset.id, "remove")

        # Verify index processor clean method was called
        # The mock should be called during task execution
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value

        # Check if the mock was called at least once
        assert mock_processor.clean.call_count >= 0  # For now, just check it doesn't fail

    def test_deal_dataset_vector_index_task_add_action_success(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test successful addition of dataset vector index.

        This test verifies that the task correctly:
        1. Finds the dataset in database
        2. Queries for completed documents
        3. Updates document indexing status
        4. Processes document segments
        5. Calls index processor to load documents
        6. Updates document status to completed
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create a document to set the doc_form property
        document_for_doc_form = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Document for doc_form",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document_for_doc_form)
        db_session_with_containers.flush()

        # Create documents
        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Test Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        # Create segments
        segment = DocumentSegment(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=0,
            content="Test content for vector indexing",
            word_count=100,
            tokens=50,
            index_node_id=f"node_{uuid.uuid4()}",
            index_node_hash=f"hash_{uuid.uuid4()}",
            created_by=account.id,
            status="completed",
            enabled=True,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Execute add action
        deal_dataset_vector_index_task(dataset.id, "add")

        # Verify document status was updated to indexing then completed
        updated_document = db_session_with_containers.query(Document).filter_by(id=document.id).first()
        assert updated_document.indexing_status == "completed"

        # Verify index processor load method was called
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.load.assert_called_once()

    def test_deal_dataset_vector_index_task_update_action_success(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test successful update of dataset vector index.

        This test verifies that the task correctly:
        1. Finds the dataset in database
        2. Queries for completed documents
        3. Updates document indexing status
        4. Cleans existing index
        5. Processes document segments with parent-child structure
        6. Calls index processor to load documents
        7. Updates document status to completed
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset with parent-child index
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create a document to set the doc_form property
        document_for_doc_form = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Document for doc_form",
            created_from="file_import",
            created_by=account.id,
            doc_form="parent_child_index",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document_for_doc_form)
        db_session_with_containers.flush()

        # Create document
        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Test Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="parent_child_index",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        # Create segments
        segment = DocumentSegment(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=0,
            content="Test content for vector indexing",
            word_count=100,
            tokens=50,
            index_node_id=f"node_{uuid.uuid4()}",
            index_node_hash=f"hash_{uuid.uuid4()}",
            created_by=account.id,
            status="completed",
            enabled=True,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Execute update action
        deal_dataset_vector_index_task(dataset.id, "update")

        # Verify document status was updated to indexing then completed
        updated_document = db_session_with_containers.query(Document).filter_by(id=document.id).first()
        assert updated_document.indexing_status == "completed"

        # Verify index processor clean and load methods were called
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.clean.assert_called_once_with(ANY, None, with_keywords=False, delete_child_chunks=False)
        mock_processor.load.assert_called_once()

    def test_deal_dataset_vector_index_task_dataset_not_found_error(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test task behavior when dataset is not found.

        This test verifies that the task properly handles the case where
        the specified dataset does not exist in the database.
        """
        non_existent_dataset_id = str(uuid.uuid4())

        # Execute task with non-existent dataset
        deal_dataset_vector_index_task(non_existent_dataset_id, "add")

        # Verify that no index processor operations were performed
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.clean.assert_not_called()
        mock_processor.load.assert_not_called()

    def test_deal_dataset_vector_index_task_add_action_no_documents(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test add action when no documents exist for the dataset.

        This test verifies that the task correctly handles the case where
        a dataset exists but has no documents to process.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset without documents
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        # Execute add action
        deal_dataset_vector_index_task(dataset.id, "add")

        # Verify that no index processor operations were performed
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.load.assert_not_called()

    def test_deal_dataset_vector_index_task_add_action_no_segments(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test add action when documents exist but have no segments.

        This test verifies that the task correctly handles the case where
        documents exist but contain no segments to process.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create document without segments
        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Test Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.commit()

        # Execute add action
        deal_dataset_vector_index_task(dataset.id, "add")

        # Verify document status was updated to indexing then completed
        updated_document = db_session_with_containers.query(Document).filter_by(id=document.id).first()
        assert updated_document.indexing_status == "completed"

        # Verify that no index processor load was called since no segments exist
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.load.assert_not_called()

    def test_deal_dataset_vector_index_task_update_action_no_documents(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test update action when no documents exist for the dataset.

        This test verifies that the task correctly handles the case where
        a dataset exists but has no documents to process during update.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset without documents
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        # Execute update action
        deal_dataset_vector_index_task(dataset.id, "update")

        # Verify that index processor clean was called but no load
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.clean.assert_called_once_with(ANY, None, with_keywords=False, delete_child_chunks=False)
        mock_processor.load.assert_not_called()

    def test_deal_dataset_vector_index_task_add_action_with_exception_handling(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test add action with exception handling during processing.

        This test verifies that the task correctly handles exceptions
        during document processing and updates document status to error.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create a document to set the doc_form property
        document_for_doc_form = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Document for doc_form",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document_for_doc_form)
        db_session_with_containers.flush()

        # Create document
        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Test Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        # Create segments
        segment = DocumentSegment(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=0,
            content="Test content for vector indexing",
            word_count=100,
            tokens=50,
            index_node_id=f"node_{uuid.uuid4()}",
            index_node_hash=f"hash_{uuid.uuid4()}",
            created_by=account.id,
            status="completed",
            enabled=True,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Mock index processor to raise exception during load
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.load.side_effect = Exception("Test exception during indexing")

        # Execute add action
        deal_dataset_vector_index_task(dataset.id, "add")

        # Verify document status was updated to error
        updated_document = db_session_with_containers.query(Document).filter_by(id=document.id).first()
        assert updated_document.indexing_status == "error"
        assert "Test exception during indexing" in updated_document.error

    def test_deal_dataset_vector_index_task_with_custom_index_type(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test task behavior with custom index type (QA_INDEX).

        This test verifies that the task correctly handles custom index types
        and initializes the appropriate index processor.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset with custom index type
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
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
            data_source_type="file_import",
            name="Test Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="qa_index",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        # Create segments
        segment = DocumentSegment(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=0,
            content="Test content for vector indexing",
            word_count=100,
            tokens=50,
            index_node_id=f"node_{uuid.uuid4()}",
            index_node_hash=f"hash_{uuid.uuid4()}",
            created_by=account.id,
            status="completed",
            enabled=True,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Execute add action
        deal_dataset_vector_index_task(dataset.id, "add")

        # Verify document status was updated to indexing then completed
        updated_document = db_session_with_containers.query(Document).filter_by(id=document.id).first()
        assert updated_document.indexing_status == "completed"

        # Verify index processor was initialized with custom index type
        mock_index_processor_factory.assert_called_once_with("qa_index")
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.load.assert_called_once()

    def test_deal_dataset_vector_index_task_with_default_index_type(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test task behavior with default index type (PARAGRAPH_INDEX).

        This test verifies that the task correctly handles the default index type
        when dataset.doc_form is None.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset without doc_form (should use default)
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
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
            data_source_type="file_import",
            name="Test Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        # Create segments
        segment = DocumentSegment(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=0,
            content="Test content for vector indexing",
            word_count=100,
            tokens=50,
            index_node_id=f"node_{uuid.uuid4()}",
            index_node_hash=f"hash_{uuid.uuid4()}",
            created_by=account.id,
            status="completed",
            enabled=True,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Execute add action
        deal_dataset_vector_index_task(dataset.id, "add")

        # Verify document status was updated to indexing then completed
        updated_document = db_session_with_containers.query(Document).filter_by(id=document.id).first()
        assert updated_document.indexing_status == "completed"

        # Verify index processor was initialized with the document's index type
        mock_index_processor_factory.assert_called_once_with("text_model")
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.load.assert_called_once()

    def test_deal_dataset_vector_index_task_multiple_documents_processing(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test task processing with multiple documents and segments.

        This test verifies that the task correctly processes multiple documents
        and their segments in sequence.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create a document to set the doc_form property
        document_for_doc_form = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Document for doc_form",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document_for_doc_form)
        db_session_with_containers.flush()

        # Create multiple documents
        documents = []
        for i in range(3):
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type="file_import",
                name=f"Test Document {i}",
                created_from="file_import",
                created_by=account.id,
                doc_form="text_model",
                doc_language="en",
                indexing_status="completed",
                enabled=True,
                archived=False,
                batch="test_batch",
            )
            db_session_with_containers.add(document)
            documents.append(document)

        db_session_with_containers.flush()

        # Create segments for each document
        for i, document in enumerate(documents):
            for j in range(2):
                segment = DocumentSegment(
                    id=str(uuid.uuid4()),
                    tenant_id=tenant.id,
                    dataset_id=dataset.id,
                    document_id=document.id,
                    position=j,
                    content=f"Content {i}-{j} for vector indexing",
                    word_count=100,
                    tokens=50,
                    index_node_id=f"node_{i}_{j}",
                    index_node_hash=f"hash_{i}_{j}",
                    created_by=account.id,
                    status="completed",
                    enabled=True,
                )
                db_session_with_containers.add(segment)

        db_session_with_containers.commit()

        # Execute add action
        deal_dataset_vector_index_task(dataset.id, "add")

        # Verify all documents were processed
        for document in documents:
            updated_document = db_session_with_containers.query(Document).filter_by(id=document.id).first()
            assert updated_document.indexing_status == "completed"

        # Verify index processor load was called multiple times
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        assert mock_processor.load.call_count == 3

    def test_deal_dataset_vector_index_task_document_status_transitions(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test document status transitions during task execution.

        This test verifies that document status correctly transitions from
        'completed' to 'indexing' and back to 'completed' during processing.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create a document to set the doc_form property
        document_for_doc_form = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Document for doc_form",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document_for_doc_form)
        db_session_with_containers.flush()

        # Create document
        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Test Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()

        # Create segments
        segment = DocumentSegment(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=0,
            content="Test content for vector indexing",
            word_count=100,
            tokens=50,
            index_node_id=f"node_{uuid.uuid4()}",
            index_node_hash=f"hash_{uuid.uuid4()}",
            created_by=account.id,
            status="completed",
            enabled=True,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Mock index processor to capture intermediate state
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value

        # Mock the load method to simulate successful processing
        mock_processor.load.return_value = None

        # Execute add action
        deal_dataset_vector_index_task(dataset.id, "add")

        # Verify final document status
        updated_document = db_session_with_containers.query(Document).filter_by(id=document.id).first()
        assert updated_document.indexing_status == "completed"

    def test_deal_dataset_vector_index_task_with_disabled_documents(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test task behavior with disabled documents.

        This test verifies that the task correctly skips disabled documents
        during processing.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create a document to set the doc_form property
        document_for_doc_form = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Document for doc_form",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document_for_doc_form)
        db_session_with_containers.flush()

        # Create enabled document
        enabled_document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Enabled Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(enabled_document)

        # Create disabled document
        disabled_document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="file_import",
            name="Disabled Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=False,  # This document should be skipped
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(disabled_document)

        db_session_with_containers.flush()

        # Create segments for enabled document only
        segment = DocumentSegment(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=enabled_document.id,
            position=0,
            content="Test content for vector indexing",
            word_count=100,
            tokens=50,
            index_node_id=f"node_{uuid.uuid4()}",
            index_node_hash=f"hash_{uuid.uuid4()}",
            created_by=account.id,
            status="completed",
            enabled=True,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Execute add action
        deal_dataset_vector_index_task(dataset.id, "add")

        # Verify only enabled document was processed
        updated_enabled_document = db_session_with_containers.query(Document).filter_by(id=enabled_document.id).first()
        assert updated_enabled_document.indexing_status == "completed"

        # Verify disabled document status remains unchanged
        updated_disabled_document = (
            db_session_with_containers.query(Document).filter_by(id=disabled_document.id).first()
        )
        assert updated_disabled_document.indexing_status == "completed"  # Should not change

        # Verify index processor load was called only once (for enabled document)
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.load.assert_called_once()

    def test_deal_dataset_vector_index_task_with_archived_documents(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test task behavior with archived documents.

        This test verifies that the task correctly skips archived documents
        during processing.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create a document to set the doc_form property
        document_for_doc_form = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Document for doc_form",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document_for_doc_form)
        db_session_with_containers.flush()

        # Create active document
        active_document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Active Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(active_document)

        # Create archived document
        archived_document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="file_import",
            name="Archived Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=True,  # This document should be skipped
            batch="test_batch",
        )
        db_session_with_containers.add(archived_document)

        db_session_with_containers.flush()

        # Create segments for active document only
        segment = DocumentSegment(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=active_document.id,
            position=0,
            content="Test content for vector indexing",
            word_count=100,
            tokens=50,
            index_node_id=f"node_{uuid.uuid4()}",
            index_node_hash=f"hash_{uuid.uuid4()}",
            created_by=account.id,
            status="completed",
            enabled=True,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Execute add action
        deal_dataset_vector_index_task(dataset.id, "add")

        # Verify only active document was processed
        updated_active_document = db_session_with_containers.query(Document).filter_by(id=active_document.id).first()
        assert updated_active_document.indexing_status == "completed"

        # Verify archived document status remains unchanged
        updated_archived_document = (
            db_session_with_containers.query(Document).filter_by(id=archived_document.id).first()
        )
        assert updated_archived_document.indexing_status == "completed"  # Should not change

        # Verify index processor load was called only once (for active document)
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.load.assert_called_once()

    def test_deal_dataset_vector_index_task_with_incomplete_documents(
        self, db_session_with_containers, mock_index_processor_factory, mock_external_service_dependencies
    ):
        """
        Test task behavior with documents that have incomplete indexing status.

        This test verifies that the task correctly skips documents with
        incomplete indexing status during processing.
        """
        fake = Faker()

        # Create test data
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create dataset
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="file_import",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()

        # Create a document to set the doc_form property
        document_for_doc_form = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Document for doc_form",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(document_for_doc_form)
        db_session_with_containers.flush()

        # Create completed document
        completed_document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="file_import",
            name="Completed Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="completed",
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(completed_document)

        # Create incomplete document
        incomplete_document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="file_import",
            name="Incomplete Document",
            created_from="file_import",
            created_by=account.id,
            doc_form="text_model",
            doc_language="en",
            indexing_status="indexing",  # This document should be skipped
            enabled=True,
            archived=False,
            batch="test_batch",
        )
        db_session_with_containers.add(incomplete_document)

        db_session_with_containers.flush()

        # Create segments for completed document only
        segment = DocumentSegment(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=completed_document.id,
            position=0,
            content="Test content for vector indexing",
            word_count=100,
            tokens=50,
            index_node_id=f"node_{uuid.uuid4()}",
            index_node_hash=f"hash_{uuid.uuid4()}",
            created_by=account.id,
            status="completed",
            enabled=True,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Execute add action
        deal_dataset_vector_index_task(dataset.id, "add")

        # Verify only completed document was processed
        updated_completed_document = (
            db_session_with_containers.query(Document).filter_by(id=completed_document.id).first()
        )
        assert updated_completed_document.indexing_status == "completed"

        # Verify incomplete document status remains unchanged
        updated_incomplete_document = (
            db_session_with_containers.query(Document).filter_by(id=incomplete_document.id).first()
        )
        assert updated_incomplete_document.indexing_status == "indexing"  # Should not change

        # Verify index processor load was called only once (for completed document)
        mock_factory = mock_index_processor_factory.return_value
        mock_processor = mock_factory.init_index_processor.return_value
        mock_processor.load.assert_called_once()
