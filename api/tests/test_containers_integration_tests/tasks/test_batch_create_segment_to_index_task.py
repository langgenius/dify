"""
Integration tests for batch_create_segment_to_index_task using testcontainers.

This module provides comprehensive integration tests for the batch segment creation
and indexing task using TestContainers infrastructure. The tests ensure that the
task properly processes CSV files, creates document segments, and establishes
vector indexes in a real database environment.

All tests use the testcontainers infrastructure to ensure proper database isolation
and realistic testing scenarios with actual PostgreSQL and Redis instances.
"""

import uuid
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import CreatorUserRole
from models.model import UploadFile
from tasks.batch_create_segment_to_index_task import batch_create_segment_to_index_task


class TestBatchCreateSegmentToIndexTask:
    """Integration tests for batch_create_segment_to_index_task using testcontainers."""

    @pytest.fixture(autouse=True)
    def cleanup_database(self, db_session_with_containers):
        """Clean up database before each test to ensure isolation."""
        from extensions.ext_database import db
        from extensions.ext_redis import redis_client

        # Clear all test data
        db.session.query(DocumentSegment).delete()
        db.session.query(Document).delete()
        db.session.query(Dataset).delete()
        db.session.query(UploadFile).delete()
        db.session.query(TenantAccountJoin).delete()
        db.session.query(Tenant).delete()
        db.session.query(Account).delete()
        db.session.commit()

        # Clear Redis cache
        redis_client.flushdb()

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.batch_create_segment_to_index_task.storage") as mock_storage,
            patch("tasks.batch_create_segment_to_index_task.ModelManager") as mock_model_manager,
            patch("tasks.batch_create_segment_to_index_task.VectorService") as mock_vector_service,
        ):
            # Setup default mock returns
            mock_storage.download.return_value = None

            # Mock embedding model for high quality indexing
            mock_embedding_model = MagicMock()
            mock_embedding_model.get_text_embedding_num_tokens.return_value = [10, 15, 20]
            mock_model_manager_instance = MagicMock()
            mock_model_manager_instance.get_model_instance.return_value = mock_embedding_model
            mock_model_manager.return_value = mock_model_manager_instance

            # Mock vector service
            mock_vector_service.create_segments_vector.return_value = None

            yield {
                "storage": mock_storage,
                "model_manager": mock_model_manager,
                "vector_service": mock_vector_service,
                "embedding_model": mock_embedding_model,
            }

    def _create_test_account_and_tenant(self, db_session_with_containers):
        """
        Helper method to create a test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure

        Returns:
            tuple: (Account, Tenant) created instances
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Create tenant for the account
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Set current tenant for account
        account.current_tenant = tenant

        return account, tenant

    def _create_test_dataset(self, db_session_with_containers, account, tenant):
        """
        Helper method to create a test dataset for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            account: Account instance
            tenant: Tenant instance

        Returns:
            Dataset: Created dataset instance
        """
        fake = Faker()

        dataset = Dataset(
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(),
            data_source_type="upload_file",
            indexing_technique="high_quality",
            embedding_model="text-embedding-ada-002",
            embedding_model_provider="openai",
            created_by=account.id,
        )

        from extensions.ext_database import db

        db.session.add(dataset)
        db.session.commit()

        return dataset

    def _create_test_document(self, db_session_with_containers, account, tenant, dataset):
        """
        Helper method to create a test document for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            account: Account instance
            tenant: Tenant instance
            dataset: Dataset instance

        Returns:
            Document: Created document instance
        """
        fake = Faker()

        document = Document(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            batch="test_batch",
            name=fake.file_name(),
            created_from="upload_file",
            created_by=account.id,
            indexing_status="completed",
            enabled=True,
            archived=False,
            doc_form="text_model",
            word_count=0,
        )

        from extensions.ext_database import db

        db.session.add(document)
        db.session.commit()

        return document

    def _create_test_upload_file(self, db_session_with_containers, account, tenant):
        """
        Helper method to create a test upload file for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            account: Account instance
            tenant: Tenant instance

        Returns:
            UploadFile: Created upload file instance
        """
        fake = Faker()

        upload_file = UploadFile(
            tenant_id=tenant.id,
            storage_type="local",
            key=f"test_files/{fake.file_name()}",
            name=fake.file_name(),
            size=1024,
            extension=".csv",
            mime_type="text/csv",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=datetime.now(),
            used=False,
        )

        from extensions.ext_database import db

        db.session.add(upload_file)
        db.session.commit()

        return upload_file

    def _create_test_csv_content(self, content_type="text_model"):
        """
        Helper method to create test CSV content.

        Args:
            content_type: Type of content to create ("text_model" or "qa_model")

        Returns:
            str: CSV content as string
        """
        if content_type == "qa_model":
            csv_content = "content,answer\n"
            csv_content += "This is the first segment content,This is the first answer\n"
            csv_content += "This is the second segment content,This is the second answer\n"
            csv_content += "This is the third segment content,This is the third answer\n"
        else:
            csv_content = "content\n"
            csv_content += "This is the first segment content\n"
            csv_content += "This is the second segment content\n"
            csv_content += "This is the third segment content\n"

        return csv_content

    def test_batch_create_segment_to_index_task_success_text_model(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful batch creation of segments for text model documents.

        This test verifies that the task can successfully:
        1. Process a CSV file with text content
        2. Create document segments with proper metadata
        3. Update document word count
        4. Create vector indexes
        5. Set Redis cache status
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset)
        upload_file = self._create_test_upload_file(db_session_with_containers, account, tenant)

        # Create CSV content
        csv_content = self._create_test_csv_content("text_model")

        # Mock storage to return our CSV content
        mock_storage = mock_external_service_dependencies["storage"]

        def mock_download(key, file_path):
            Path(file_path).write_text(csv_content, encoding="utf-8")

        mock_storage.download.side_effect = mock_download

        # Execute the task
        job_id = str(uuid.uuid4())
        batch_create_segment_to_index_task(
            job_id=job_id,
            upload_file_id=upload_file.id,
            dataset_id=dataset.id,
            document_id=document.id,
            tenant_id=tenant.id,
            user_id=account.id,
        )

        # Verify results
        from extensions.ext_database import db

        # Check that segments were created
        segments = (
            db.session.query(DocumentSegment)
            .filter_by(document_id=document.id)
            .order_by(DocumentSegment.position)
            .all()
        )
        assert len(segments) == 3

        # Verify segment content and metadata
        for i, segment in enumerate(segments):
            assert segment.tenant_id == tenant.id
            assert segment.dataset_id == dataset.id
            assert segment.document_id == document.id
            assert segment.position == i + 1
            assert segment.status == "completed"
            assert segment.indexing_at is not None
            assert segment.completed_at is not None
            assert segment.answer is None  # text_model doesn't have answers

        # Check that document word count was updated
        db.session.refresh(document)
        assert document.word_count > 0

        # Verify vector service was called
        mock_vector_service = mock_external_service_dependencies["vector_service"]
        mock_vector_service.create_segments_vector.assert_called_once()

        # Check Redis cache was set
        from extensions.ext_redis import redis_client

        cache_key = f"segment_batch_import_{job_id}"
        cache_value = redis_client.get(cache_key)
        assert cache_value == b"completed"

    def test_batch_create_segment_to_index_task_dataset_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test task failure when dataset does not exist.

        This test verifies that the task properly handles error cases:
        1. Fails gracefully when dataset is not found
        2. Sets appropriate Redis cache status
        3. Logs error information
        4. Maintains database integrity
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        upload_file = self._create_test_upload_file(db_session_with_containers, account, tenant)

        # Use non-existent IDs
        non_existent_dataset_id = str(uuid.uuid4())
        non_existent_document_id = str(uuid.uuid4())

        # Execute the task with non-existent dataset
        job_id = str(uuid.uuid4())
        batch_create_segment_to_index_task(
            job_id=job_id,
            upload_file_id=upload_file.id,
            dataset_id=non_existent_dataset_id,
            document_id=non_existent_document_id,
            tenant_id=tenant.id,
            user_id=account.id,
        )

        # Verify error handling
        # Check Redis cache was set to error status
        from extensions.ext_redis import redis_client

        cache_key = f"segment_batch_import_{job_id}"
        cache_value = redis_client.get(cache_key)
        assert cache_value == b"error"

        # Verify no segments were created (since dataset doesn't exist)
        from extensions.ext_database import db

        segments = db.session.query(DocumentSegment).all()
        assert len(segments) == 0

        # Verify no documents were modified
        documents = db.session.query(Document).all()
        assert len(documents) == 0

    def test_batch_create_segment_to_index_task_document_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test task failure when document does not exist.

        This test verifies that the task properly handles error cases:
        1. Fails gracefully when document is not found
        2. Sets appropriate Redis cache status
        3. Maintains database integrity
        4. Logs appropriate error information
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        upload_file = self._create_test_upload_file(db_session_with_containers, account, tenant)

        # Use non-existent document ID
        non_existent_document_id = str(uuid.uuid4())

        # Execute the task with non-existent document
        job_id = str(uuid.uuid4())
        batch_create_segment_to_index_task(
            job_id=job_id,
            upload_file_id=upload_file.id,
            dataset_id=dataset.id,
            document_id=non_existent_document_id,
            tenant_id=tenant.id,
            user_id=account.id,
        )

        # Verify error handling
        # Check Redis cache was set to error status
        from extensions.ext_redis import redis_client

        cache_key = f"segment_batch_import_{job_id}"
        cache_value = redis_client.get(cache_key)
        assert cache_value == b"error"

        # Verify no segments were created
        from extensions.ext_database import db

        segments = db.session.query(DocumentSegment).all()
        assert len(segments) == 0

        # Verify dataset remains unchanged (no segments were added to the dataset)
        db.session.refresh(dataset)
        segments_for_dataset = db.session.query(DocumentSegment).filter_by(dataset_id=dataset.id).all()
        assert len(segments_for_dataset) == 0

    def test_batch_create_segment_to_index_task_document_not_available(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test task failure when document is not available for indexing.

        This test verifies that the task properly handles error cases:
        1. Fails when document is disabled
        2. Fails when document is archived
        3. Fails when document indexing status is not completed
        4. Sets appropriate Redis cache status
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        upload_file = self._create_test_upload_file(db_session_with_containers, account, tenant)

        # Create document with various unavailable states
        test_cases = [
            # Disabled document
            Document(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=1,
                data_source_type="upload_file",
                batch="test_batch",
                name="disabled_document",
                created_from="upload_file",
                created_by=account.id,
                indexing_status="completed",
                enabled=False,  # Document is disabled
                archived=False,
                doc_form="text_model",
                word_count=0,
            ),
            # Archived document
            Document(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=2,
                data_source_type="upload_file",
                batch="test_batch",
                name="archived_document",
                created_from="upload_file",
                created_by=account.id,
                indexing_status="completed",
                enabled=True,
                archived=True,  # Document is archived
                doc_form="text_model",
                word_count=0,
            ),
            # Document with incomplete indexing
            Document(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=3,
                data_source_type="upload_file",
                batch="test_batch",
                name="incomplete_document",
                created_from="upload_file",
                created_by=account.id,
                indexing_status="indexing",  # Not completed
                enabled=True,
                archived=False,
                doc_form="text_model",
                word_count=0,
            ),
        ]

        from extensions.ext_database import db

        for document in test_cases:
            db.session.add(document)
        db.session.commit()

        # Test each unavailable document
        for document in test_cases:
            job_id = str(uuid.uuid4())
            batch_create_segment_to_index_task(
                job_id=job_id,
                upload_file_id=upload_file.id,
                dataset_id=dataset.id,
                document_id=document.id,
                tenant_id=tenant.id,
                user_id=account.id,
            )

            # Verify error handling for each case
            from extensions.ext_redis import redis_client

            cache_key = f"segment_batch_import_{job_id}"
            cache_value = redis_client.get(cache_key)
            assert cache_value == b"error"

            # Verify no segments were created
            segments = db.session.query(DocumentSegment).filter_by(document_id=document.id).all()
            assert len(segments) == 0

    def test_batch_create_segment_to_index_task_upload_file_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test task failure when upload file does not exist.

        This test verifies that the task properly handles error cases:
        1. Fails gracefully when upload file is not found
        2. Sets appropriate Redis cache status
        3. Maintains database integrity
        4. Logs appropriate error information
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset)

        # Use non-existent upload file ID
        non_existent_upload_file_id = str(uuid.uuid4())

        # Execute the task with non-existent upload file
        job_id = str(uuid.uuid4())
        batch_create_segment_to_index_task(
            job_id=job_id,
            upload_file_id=non_existent_upload_file_id,
            dataset_id=dataset.id,
            document_id=document.id,
            tenant_id=tenant.id,
            user_id=account.id,
        )

        # Verify error handling
        # Check Redis cache was set to error status
        from extensions.ext_redis import redis_client

        cache_key = f"segment_batch_import_{job_id}"
        cache_value = redis_client.get(cache_key)
        assert cache_value == b"error"

        # Verify no segments were created
        from extensions.ext_database import db

        segments = db.session.query(DocumentSegment).all()
        assert len(segments) == 0

        # Verify document remains unchanged
        db.session.refresh(document)
        assert document.word_count == 0

    def test_batch_create_segment_to_index_task_empty_csv_file(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test task failure when CSV file is empty.

        This test verifies that the task properly handles error cases:
        1. Fails when CSV file contains no data
        2. Sets appropriate Redis cache status
        3. Maintains database integrity
        4. Logs appropriate error information
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset)
        upload_file = self._create_test_upload_file(db_session_with_containers, account, tenant)

        # Create empty CSV content
        empty_csv_content = "content\n"  # Only header, no data rows

        # Mock storage to return empty CSV content
        mock_storage = mock_external_service_dependencies["storage"]

        def mock_download(key, file_path):
            Path(file_path).write_text(empty_csv_content, encoding="utf-8")

        mock_storage.download.side_effect = mock_download

        # Execute the task
        job_id = str(uuid.uuid4())
        batch_create_segment_to_index_task(
            job_id=job_id,
            upload_file_id=upload_file.id,
            dataset_id=dataset.id,
            document_id=document.id,
            tenant_id=tenant.id,
            user_id=account.id,
        )

        # Verify error handling
        # Check Redis cache was set to error status
        from extensions.ext_redis import redis_client

        cache_key = f"segment_batch_import_{job_id}"
        cache_value = redis_client.get(cache_key)
        assert cache_value == b"error"

        # Verify no segments were created
        from extensions.ext_database import db

        segments = db.session.query(DocumentSegment).all()
        assert len(segments) == 0

        # Verify document remains unchanged
        db.session.refresh(document)
        assert document.word_count == 0

    def test_batch_create_segment_to_index_task_position_calculation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test proper position calculation for segments when existing segments exist.

        This test verifies that the task correctly:
        1. Calculates positions for new segments based on existing ones
        2. Handles position increment logic properly
        3. Maintains proper segment ordering
        4. Works with existing segment data
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset)
        upload_file = self._create_test_upload_file(db_session_with_containers, account, tenant)

        # Create existing segments to test position calculation
        existing_segments = []
        for i in range(3):
            segment = DocumentSegment(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=i + 1,
                content=f"Existing segment {i + 1}",
                word_count=len(f"Existing segment {i + 1}"),
                tokens=10,
                created_by=account.id,
                status="completed",
                index_node_id=str(uuid.uuid4()),
                index_node_hash=f"hash_{i}",
            )
            existing_segments.append(segment)

        from extensions.ext_database import db

        for segment in existing_segments:
            db.session.add(segment)
        db.session.commit()

        # Create CSV content
        csv_content = self._create_test_csv_content("text_model")

        # Mock storage to return our CSV content
        mock_storage = mock_external_service_dependencies["storage"]

        def mock_download(key, file_path):
            Path(file_path).write_text(csv_content, encoding="utf-8")

        mock_storage.download.side_effect = mock_download

        # Execute the task
        job_id = str(uuid.uuid4())
        batch_create_segment_to_index_task(
            job_id=job_id,
            upload_file_id=upload_file.id,
            dataset_id=dataset.id,
            document_id=document.id,
            tenant_id=tenant.id,
            user_id=account.id,
        )

        # Verify results
        # Check that new segments were created with correct positions
        all_segments = (
            db.session.query(DocumentSegment)
            .filter_by(document_id=document.id)
            .order_by(DocumentSegment.position)
            .all()
        )
        assert len(all_segments) == 6  # 3 existing + 3 new

        # Verify position ordering
        for i, segment in enumerate(all_segments):
            assert segment.position == i + 1

        # Verify new segments have correct positions (4, 5, 6)
        new_segments = all_segments[3:]
        for i, segment in enumerate(new_segments):
            expected_position = 4 + i  # Should start at position 4
            assert segment.position == expected_position
            assert segment.status == "completed"
            assert segment.indexing_at is not None
            assert segment.completed_at is not None

        # Check that document word count was updated
        db.session.refresh(document)
        assert document.word_count > 0

        # Verify vector service was called
        mock_vector_service = mock_external_service_dependencies["vector_service"]
        mock_vector_service.create_segments_vector.assert_called_once()

        # Check Redis cache was set
        from extensions.ext_redis import redis_client

        cache_key = f"segment_batch_import_{job_id}"
        cache_value = redis_client.get(cache_key)
        assert cache_value == b"completed"
