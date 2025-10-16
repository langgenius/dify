"""
TestContainers-based integration tests for disable_segments_from_index_task.

This module provides comprehensive integration testing for the disable_segments_from_index_task
using TestContainers to ensure realistic database interactions and proper isolation.
The task is responsible for removing document segments from the search index when they are disabled.
"""

from unittest.mock import MagicMock, patch

from faker import Faker

from models import Account, Dataset, DocumentSegment
from models import Document as DatasetDocument
from models.dataset import DatasetProcessRule
from tasks.disable_segments_from_index_task import disable_segments_from_index_task


class TestDisableSegmentsFromIndexTask:
    """
    Comprehensive integration tests for disable_segments_from_index_task using testcontainers.

    This test class covers all major functionality of the disable_segments_from_index_task:
    - Successful segment disabling with proper index cleanup
    - Error handling for various edge cases
    - Database state validation after task execution
    - Redis cache cleanup verification
    - Index processor integration testing

    All tests use the testcontainers infrastructure to ensure proper database isolation
    and realistic testing environment with actual database interactions.
    """

    def _create_test_account(self, db_session_with_containers, fake=None):
        """
        Helper method to create a test account with realistic data.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            fake: Faker instance for generating test data

        Returns:
            Account: Created test account instance
        """
        fake = fake or Faker()
        account = Account(
            email=fake.email(),
            name=fake.name(),
            avatar=fake.url(),
            status="active",
            interface_language="en-US",
        )
        account.id = fake.uuid4()
        # monkey-patch attributes for test setup
        account.tenant_id = fake.uuid4()
        account.type = "normal"
        account.role = "owner"
        account.created_at = fake.date_time_this_year()
        account.updated_at = account.created_at

        # Create a tenant for the account
        from models.account import Tenant

        tenant = Tenant(
            name=f"Test Tenant {fake.company()}",
            plan="basic",
            status="active",
        )
        tenant.id = account.tenant_id
        tenant.created_at = fake.date_time_this_year()
        tenant.updated_at = tenant.created_at

        from extensions.ext_database import db

        db.session.add(tenant)
        db.session.add(account)
        db.session.commit()

        # Set the current tenant for the account
        account.current_tenant = tenant

        return account

    def _create_test_dataset(self, db_session_with_containers, account, fake=None):
        """
        Helper method to create a test dataset with realistic data.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            account: The account creating the dataset
            fake: Faker instance for generating test data

        Returns:
            Dataset: Created test dataset instance
        """
        fake = fake or Faker()
        dataset = Dataset(
            id=fake.uuid4(),
            tenant_id=account.tenant_id,
            name=f"Test Dataset {fake.word()}",
            description=fake.text(max_nb_chars=200),
            provider="vendor",
            permission="only_me",
            data_source_type="upload_file",
            indexing_technique="high_quality",
            created_by=account.id,
            updated_by=account.id,
            embedding_model="text-embedding-ada-002",
            embedding_model_provider="openai",
            built_in_field_enabled=False,
        )

        from extensions.ext_database import db

        db.session.add(dataset)
        db.session.commit()

        return dataset

    def _create_test_document(self, db_session_with_containers, dataset, account, fake=None):
        """
        Helper method to create a test document with realistic data.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            dataset: The dataset containing the document
            account: The account creating the document
            fake: Faker instance for generating test data

        Returns:
            DatasetDocument: Created test document instance
        """
        fake = fake or Faker()
        document = DatasetDocument()

        document.id = fake.uuid4()
        document.tenant_id = dataset.tenant_id
        document.dataset_id = dataset.id
        document.position = 1
        document.data_source_type = "upload_file"
        document.data_source_info = '{"upload_file_id": "test_file_id"}'
        document.batch = fake.uuid4()
        document.name = f"Test Document {fake.word()}.txt"
        document.created_from = "upload_file"
        document.created_by = account.id
        document.created_api_request_id = fake.uuid4()
        document.processing_started_at = fake.date_time_this_year()
        document.file_id = fake.uuid4()
        document.word_count = fake.random_int(min=100, max=1000)
        document.parsing_completed_at = fake.date_time_this_year()
        document.cleaning_completed_at = fake.date_time_this_year()
        document.splitting_completed_at = fake.date_time_this_year()
        document.tokens = fake.random_int(min=50, max=500)
        document.indexing_started_at = fake.date_time_this_year()
        document.indexing_completed_at = fake.date_time_this_year()
        document.indexing_status = "completed"
        document.enabled = True
        document.archived = False
        document.doc_form = "text_model"  # Use text_model form for testing
        document.doc_language = "en"
        from extensions.ext_database import db

        db.session.add(document)
        db.session.commit()

        return document

    def _create_test_segments(self, db_session_with_containers, document, dataset, account, count=3, fake=None):
        """
        Helper method to create test document segments with realistic data.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            document: The document containing the segments
            dataset: The dataset containing the document
            account: The account creating the segments
            count: Number of segments to create
            fake: Faker instance for generating test data

        Returns:
            List[DocumentSegment]: Created test segment instances
        """
        fake = fake or Faker()
        segments = []

        for i in range(count):
            segment = DocumentSegment()
            segment.id = fake.uuid4()
            segment.tenant_id = dataset.tenant_id
            segment.dataset_id = dataset.id
            segment.document_id = document.id
            segment.position = i + 1
            segment.content = f"Test segment content {i + 1}: {fake.text(max_nb_chars=200)}"
            segment.answer = f"Test answer {i + 1}" if i % 2 == 0 else None
            segment.word_count = fake.random_int(min=10, max=100)
            segment.tokens = fake.random_int(min=5, max=50)
            segment.keywords = [fake.word() for _ in range(3)]
            segment.index_node_id = f"node_{segment.id}"
            segment.index_node_hash = fake.sha256()
            segment.hit_count = 0
            segment.enabled = True
            segment.disabled_at = None
            segment.disabled_by = None
            segment.status = "completed"
            segment.created_by = account.id
            segment.updated_by = account.id
            segment.indexing_at = fake.date_time_this_year()
            segment.completed_at = fake.date_time_this_year()
            segment.error = None
            segment.stopped_at = None

            segments.append(segment)

        from extensions.ext_database import db

        for segment in segments:
            db.session.add(segment)
        db.session.commit()

        return segments

    def _create_dataset_process_rule(self, db_session_with_containers, dataset, fake=None):
        """
        Helper method to create a dataset process rule.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            dataset: The dataset for the process rule
            fake: Faker instance for generating test data

        Returns:
            DatasetProcessRule: Created process rule instance
        """
        fake = fake or Faker()
        process_rule = DatasetProcessRule()
        process_rule.id = fake.uuid4()
        process_rule.tenant_id = dataset.tenant_id
        process_rule.dataset_id = dataset.id
        process_rule.mode = "automatic"
        process_rule.rules = (
            "{"
            '"mode": "automatic", '
            '"rules": {'
            '"pre_processing_rules": [], "segmentation": '
            '{"separator": "\\n\\n", "max_tokens": 1000, "chunk_overlap": 50}}'
            "}"
        )
        process_rule.created_by = dataset.created_by
        process_rule.updated_by = dataset.updated_by

        from extensions.ext_database import db

        db.session.add(process_rule)
        db.session.commit()

        return process_rule

    def test_disable_segments_success(self, db_session_with_containers):
        """
        Test successful disabling of segments from index.

        This test verifies that the task can correctly disable segments from the index
        when all conditions are met, including proper index cleanup and database state updates.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        dataset = self._create_test_dataset(db_session_with_containers, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        segments = self._create_test_segments(db_session_with_containers, document, dataset, account, 3, fake)
        self._create_dataset_process_rule(db_session_with_containers, dataset, fake)

        segment_ids = [segment.id for segment in segments]

        # Mock the index processor to avoid external dependencies
        with patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as mock_factory:
            mock_processor = MagicMock()
            mock_factory.return_value.init_index_processor.return_value = mock_processor

            # Mock Redis client
            with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
                mock_redis.delete.return_value = True

                # Act
                result = disable_segments_from_index_task(segment_ids, dataset.id, document.id)

                # Assert
                assert result is None  # Task should complete without returning a value

                # Verify index processor was called correctly
                mock_factory.assert_called_once_with(document.doc_form)
                mock_processor.clean.assert_called_once()

                # Verify the call arguments (checking by attributes rather than object identity)
                call_args = mock_processor.clean.call_args
                assert call_args[0][0].id == dataset.id  # First argument should be the dataset
                assert sorted(call_args[0][1]) == sorted(
                    [segment.index_node_id for segment in segments]
                )  # Compare sorted lists to handle any order while preserving duplicates
                assert call_args[1]["with_keywords"] is True
                assert call_args[1]["delete_child_chunks"] is False

                # Verify Redis cache cleanup was called for each segment
                assert mock_redis.delete.call_count == len(segments)
                for segment in segments:
                    expected_key = f"segment_{segment.id}_indexing"
                    mock_redis.delete.assert_any_call(expected_key)

    def test_disable_segments_dataset_not_found(self, db_session_with_containers):
        """
        Test handling when dataset is not found.

        This test ensures that the task correctly handles cases where the specified
        dataset doesn't exist, logging appropriate messages and returning early.
        """
        # Arrange
        fake = Faker()
        non_existent_dataset_id = fake.uuid4()
        non_existent_document_id = fake.uuid4()
        segment_ids = [fake.uuid4()]

        # Mock Redis client
        with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
            # Act
            result = disable_segments_from_index_task(segment_ids, non_existent_dataset_id, non_existent_document_id)

            # Assert
            assert result is None  # Task should complete without returning a value
            # Redis should not be called when dataset is not found
            mock_redis.delete.assert_not_called()

    def test_disable_segments_document_not_found(self, db_session_with_containers):
        """
        Test handling when document is not found.

        This test ensures that the task correctly handles cases where the specified
        document doesn't exist, logging appropriate messages and returning early.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        dataset = self._create_test_dataset(db_session_with_containers, account, fake)
        non_existent_document_id = fake.uuid4()
        segment_ids = [fake.uuid4()]

        # Mock Redis client
        with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
            # Act
            result = disable_segments_from_index_task(segment_ids, dataset.id, non_existent_document_id)

            # Assert
            assert result is None  # Task should complete without returning a value
            # Redis should not be called when document is not found
            mock_redis.delete.assert_not_called()

    def test_disable_segments_document_invalid_status(self, db_session_with_containers):
        """
        Test handling when document has invalid status for disabling.

        This test ensures that the task correctly handles cases where the document
        is not enabled, archived, or not completed, preventing invalid operations.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        dataset = self._create_test_dataset(db_session_with_containers, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        segments = self._create_test_segments(db_session_with_containers, document, dataset, account, 2, fake)

        # Test case 1: Document not enabled
        document.enabled = False
        from extensions.ext_database import db

        db.session.commit()

        segment_ids = [segment.id for segment in segments]

        # Mock Redis client
        with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
            # Act
            result = disable_segments_from_index_task(segment_ids, dataset.id, document.id)

            # Assert
            assert result is None  # Task should complete without returning a value
            # Redis should not be called when document status is invalid
            mock_redis.delete.assert_not_called()

        # Test case 2: Document archived
        document.enabled = True
        document.archived = True
        db.session.commit()

        with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
            # Act
            result = disable_segments_from_index_task(segment_ids, dataset.id, document.id)

            # Assert
            assert result is None  # Task should complete without returning a value
            mock_redis.delete.assert_not_called()

        # Test case 3: Document indexing not completed
        document.enabled = True
        document.archived = False
        document.indexing_status = "indexing"
        db.session.commit()

        with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
            # Act
            result = disable_segments_from_index_task(segment_ids, dataset.id, document.id)

            # Assert
            assert result is None  # Task should complete without returning a value
            mock_redis.delete.assert_not_called()

    def test_disable_segments_no_segments_found(self, db_session_with_containers):
        """
        Test handling when no segments are found for the given IDs.

        This test ensures that the task correctly handles cases where the specified
        segment IDs don't exist or don't match the dataset/document criteria.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        dataset = self._create_test_dataset(db_session_with_containers, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        self._create_dataset_process_rule(db_session_with_containers, dataset, fake)

        # Use non-existent segment IDs
        non_existent_segment_ids = [fake.uuid4() for _ in range(3)]

        # Mock Redis client
        with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
            # Act
            result = disable_segments_from_index_task(non_existent_segment_ids, dataset.id, document.id)

            # Assert
            assert result is None  # Task should complete without returning a value
            # Redis should not be called when no segments are found
            mock_redis.delete.assert_not_called()

    def test_disable_segments_index_processor_error(self, db_session_with_containers):
        """
        Test handling when index processor encounters an error.

        This test verifies that the task correctly handles index processor errors
        by rolling back segment states and ensuring proper cleanup.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        dataset = self._create_test_dataset(db_session_with_containers, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        segments = self._create_test_segments(db_session_with_containers, document, dataset, account, 2, fake)
        self._create_dataset_process_rule(db_session_with_containers, dataset, fake)

        segment_ids = [segment.id for segment in segments]

        # Mock the index processor to raise an exception
        with patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as mock_factory:
            mock_processor = MagicMock()
            mock_processor.clean.side_effect = Exception("Index processor error")
            mock_factory.return_value.init_index_processor.return_value = mock_processor

            # Mock Redis client
            with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
                mock_redis.delete.return_value = True

                # Act
                result = disable_segments_from_index_task(segment_ids, dataset.id, document.id)

                # Assert
                assert result is None  # Task should complete without returning a value

                # Verify segments were rolled back to enabled state
                from extensions.ext_database import db

                db.session.refresh(segments[0])
                db.session.refresh(segments[1])

                # Check that segments are re-enabled after error
                updated_segments = db.session.query(DocumentSegment).where(DocumentSegment.id.in_(segment_ids)).all()

                for segment in updated_segments:
                    assert segment.enabled is True
                    assert segment.disabled_at is None
                    assert segment.disabled_by is None

                # Verify Redis cache cleanup was still called
                assert mock_redis.delete.call_count == len(segments)

    def test_disable_segments_with_different_doc_forms(self, db_session_with_containers):
        """
        Test disabling segments with different document forms.

        This test verifies that the task correctly handles different document forms
        (paragraph, qa, parent_child) and initializes the appropriate index processor.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        dataset = self._create_test_dataset(db_session_with_containers, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        segments = self._create_test_segments(db_session_with_containers, document, dataset, account, 2, fake)
        self._create_dataset_process_rule(db_session_with_containers, dataset, fake)

        segment_ids = [segment.id for segment in segments]

        # Test different document forms
        doc_forms = ["text_model", "qa_model", "hierarchical_model"]

        for doc_form in doc_forms:
            # Update document form
            document.doc_form = doc_form
            from extensions.ext_database import db

            db.session.commit()

            # Mock the index processor factory
            with patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as mock_factory:
                mock_processor = MagicMock()
                mock_factory.return_value.init_index_processor.return_value = mock_processor

                # Mock Redis client
                with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
                    mock_redis.delete.return_value = True

                    # Act
                    result = disable_segments_from_index_task(segment_ids, dataset.id, document.id)

                    # Assert
                    assert result is None  # Task should complete without returning a value
                    mock_factory.assert_called_with(doc_form)

    def test_disable_segments_performance_timing(self, db_session_with_containers):
        """
        Test that the task properly measures and logs performance timing.

        This test verifies that the task correctly measures execution time
        and logs performance metrics for monitoring purposes.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        dataset = self._create_test_dataset(db_session_with_containers, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        segments = self._create_test_segments(db_session_with_containers, document, dataset, account, 3, fake)
        self._create_dataset_process_rule(db_session_with_containers, dataset, fake)

        segment_ids = [segment.id for segment in segments]

        # Mock the index processor
        with patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as mock_factory:
            mock_processor = MagicMock()
            mock_factory.return_value.init_index_processor.return_value = mock_processor

            # Mock Redis client
            with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
                mock_redis.delete.return_value = True

                # Mock time.perf_counter to control timing
                with patch("tasks.disable_segments_from_index_task.time.perf_counter") as mock_perf_counter:
                    mock_perf_counter.side_effect = [1000.0, 1000.5]  # 0.5 seconds execution time

                    # Mock logger to capture log messages
                    with patch("tasks.disable_segments_from_index_task.logger") as mock_logger:
                        # Act
                        result = disable_segments_from_index_task(segment_ids, dataset.id, document.id)

                        # Assert
                        assert result is None  # Task should complete without returning a value

                        # Verify performance logging
                        mock_logger.info.assert_called()
                        log_calls = [call[0][0] for call in mock_logger.info.call_args_list]
                        performance_log = next((call for call in log_calls if "latency" in call), None)
                        assert performance_log is not None
                        assert "0.5" in performance_log  # Should log the execution time

    def test_disable_segments_redis_cache_cleanup(self, db_session_with_containers):
        """
        Test that Redis cache is properly cleaned up for all segments.

        This test verifies that the task correctly removes indexing cache entries
        from Redis for all processed segments, preventing stale cache issues.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        dataset = self._create_test_dataset(db_session_with_containers, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        segments = self._create_test_segments(db_session_with_containers, document, dataset, account, 5, fake)
        self._create_dataset_process_rule(db_session_with_containers, dataset, fake)

        segment_ids = [segment.id for segment in segments]

        # Mock the index processor
        with patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as mock_factory:
            mock_processor = MagicMock()
            mock_factory.return_value.init_index_processor.return_value = mock_processor

            # Mock Redis client to track delete calls
            with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
                mock_redis.delete.return_value = True

                # Act
                result = disable_segments_from_index_task(segment_ids, dataset.id, document.id)

                # Assert
                assert result is None  # Task should complete without returning a value

                # Verify Redis delete was called for each segment
                assert mock_redis.delete.call_count == len(segments)

                # Verify correct cache keys were used
                expected_keys = [f"segment_{segment.id}_indexing" for segment in segments]
                actual_calls = [call[0][0] for call in mock_redis.delete.call_args_list]

                for expected_key in expected_keys:
                    assert expected_key in actual_calls

    def test_disable_segments_database_session_cleanup(self, db_session_with_containers):
        """
        Test that database session is properly closed after task execution.

        This test verifies that the task correctly manages database sessions
        and ensures proper cleanup to prevent connection leaks.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        dataset = self._create_test_dataset(db_session_with_containers, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        segments = self._create_test_segments(db_session_with_containers, document, dataset, account, 2, fake)
        self._create_dataset_process_rule(db_session_with_containers, dataset, fake)

        segment_ids = [segment.id for segment in segments]

        # Mock the index processor
        with patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as mock_factory:
            mock_processor = MagicMock()
            mock_factory.return_value.init_index_processor.return_value = mock_processor

            # Mock Redis client
            with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
                mock_redis.delete.return_value = True

                # Mock db.session.close to verify it's called
                with patch("tasks.disable_segments_from_index_task.db.session.close") as mock_close:
                    # Act
                    result = disable_segments_from_index_task(segment_ids, dataset.id, document.id)

                    # Assert
                    assert result is None  # Task should complete without returning a value
                    # Verify session was closed
                    mock_close.assert_called()

    def test_disable_segments_empty_segment_ids(self, db_session_with_containers):
        """
        Test handling when empty segment IDs list is provided.

        This test ensures that the task correctly handles edge cases where
        an empty list of segment IDs is provided.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        dataset = self._create_test_dataset(db_session_with_containers, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        self._create_dataset_process_rule(db_session_with_containers, dataset, fake)

        empty_segment_ids = []

        # Mock Redis client
        with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
            # Act
            result = disable_segments_from_index_task(empty_segment_ids, dataset.id, document.id)

            # Assert
            assert result is None  # Task should complete without returning a value
            # Redis should not be called when no segments are provided
            mock_redis.delete.assert_not_called()

    def test_disable_segments_mixed_valid_invalid_ids(self, db_session_with_containers):
        """
        Test handling when some segment IDs are valid and others are invalid.

        This test verifies that the task correctly processes only the valid
        segment IDs and ignores invalid ones.
        """
        # Arrange
        fake = Faker()
        account = self._create_test_account(db_session_with_containers, fake)
        dataset = self._create_test_dataset(db_session_with_containers, account, fake)
        document = self._create_test_document(db_session_with_containers, dataset, account, fake)
        segments = self._create_test_segments(db_session_with_containers, document, dataset, account, 2, fake)
        self._create_dataset_process_rule(db_session_with_containers, dataset, fake)

        # Mix valid and invalid segment IDs
        valid_segment_ids = [segment.id for segment in segments]
        invalid_segment_ids = [fake.uuid4() for _ in range(2)]
        mixed_segment_ids = valid_segment_ids + invalid_segment_ids

        # Mock the index processor
        with patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as mock_factory:
            mock_processor = MagicMock()
            mock_factory.return_value.init_index_processor.return_value = mock_processor

            # Mock Redis client
            with patch("tasks.disable_segments_from_index_task.redis_client") as mock_redis:
                mock_redis.delete.return_value = True

                # Act
                result = disable_segments_from_index_task(mixed_segment_ids, dataset.id, document.id)

                # Assert
                assert result is None  # Task should complete without returning a value

                # Verify index processor was called with only valid segment node IDs
                expected_node_ids = [segment.index_node_id for segment in segments]
                mock_processor.clean.assert_called_once()

                # Verify the call arguments
                call_args = mock_processor.clean.call_args
                assert call_args[0][0].id == dataset.id  # First argument should be the dataset
                assert sorted(call_args[0][1]) == sorted(
                    expected_node_ids
                )  # Compare sorted lists to handle any order while preserving duplicates
                assert call_args[1]["with_keywords"] is True
                assert call_args[1]["delete_child_chunks"] is False

                # Verify Redis cleanup was called only for valid segments
                assert mock_redis.delete.call_count == len(segments)
