import uuid
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums.account import TenantAccountRole
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantStatus
from models.dataset import Dataset, Document, Pipeline
from models.enums import DatasetRuntimeMode, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.workflow import Workflow
from services.rag_pipeline.entities import RagPipelineInvokeBatch, RagPipelineInvokeEntity
from services.rag_pipeline.tenant_task_queue import RagPipelinePermanentTaskError
from services.rag_pipeline.workflow_snapshot import capture_workflow
from tasks.rag_pipeline.priority_rag_pipeline_run_task import (
    priority_rag_pipeline_run_task,
    run_single_rag_pipeline_task,
)
from tasks.rag_pipeline.rag_pipeline_run_task import rag_pipeline_run_task


class _OwnedLease:
    @property
    def token(self) -> str:
        return "test-dataset-lease"

    def assert_owned(self) -> None:
        return None

    def renew(self) -> bool:
        return True

    def release(self) -> bool:
        return True


class TestRagPipelineRunTasks:
    """Integration tests for RAG pipeline run tasks using testcontainers.

    This test class covers:
    - priority_rag_pipeline_run_task function
    - rag_pipeline_run_task function
    - run_single_rag_pipeline_task function
    - Real Redis-based TenantIsolatedTaskQueue operations
    - PipelineGenerator.run method mocking and parameter validation
    - File operations and cleanup
    - Error handling and queue management
    """

    @pytest.fixture
    def mock_pipeline_generator(self):
        """Mock PipelineGenerator.run method."""
        with patch("core.app.apps.pipeline.pipeline_generator.PipelineGenerator.run") as mock_generate:
            # Mock the public run method to return a simple response
            mock_generate.return_value = {"answer": "Test response", "metadata": {"test": "data"}}
            yield mock_generate

    @pytest.fixture
    def mock_file_service(self):
        """Mock FileService for file operations."""
        with (
            patch("services.file_service.FileService.get_file_content") as mock_get_content,
            patch("services.file_service.FileService.delete_file") as mock_delete_file,
        ):
            yield {
                "get_content": mock_get_content,
                "delete_file": mock_delete_file,
            }

    def _create_test_pipeline_and_workflow(self, db_session_with_containers: Session):
        """
        Helper method to create test pipeline and workflow for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure

        Returns:
            tuple: (account, tenant, pipeline, workflow) - Created entities
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

        pipeline_id = str(uuid.uuid4())

        # Create workflow
        workflow = Workflow(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            app_id=pipeline_id,
            type="workflow",
            version="draft",
            graph="{}",
            features="{}",
            marked_name=fake.company(),
            marked_comment=fake.text(max_nb_chars=100),
            created_by=account.id,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        db_session_with_containers.add(workflow)
        db_session_with_containers.commit()

        # Create pipeline
        pipeline = Pipeline(
            tenant_id=tenant.id,
            workflow_id=workflow.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            created_by=account.id,
        )
        pipeline.id = pipeline_id
        db_session_with_containers.add(pipeline)
        db_session_with_containers.commit()

        # Refresh entities to ensure they're properly loaded
        db_session_with_containers.refresh(account)
        db_session_with_containers.refresh(tenant)
        db_session_with_containers.refresh(workflow)
        db_session_with_containers.refresh(pipeline)

        return account, tenant, pipeline, workflow

    def _create_rag_pipeline_invoke_entities(
        self,
        session: Session,
        account: Account,
        tenant: Tenant,
        pipeline: Pipeline,
        workflow: Workflow,
        count: int = 2,
    ) -> list[RagPipelineInvokeEntity]:
        """
        Helper method to create RAG pipeline invoke entities for testing.

        Args:
            account: Account instance
            tenant: Tenant instance
            pipeline: Pipeline instance
            workflow: Workflow instance
            count: Number of entities to create

        Returns:
            list: List of RagPipelineInvokeEntity instances
        """
        fake = Faker()
        entities = []
        dataset = Dataset(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            name=fake.company(),
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.ECONOMY,
            chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
            runtime_mode=DatasetRuntimeMode.RAG_PIPELINE,
            pipeline_id=pipeline.id,
            created_by=account.id,
        )
        session.add(dataset)

        for i in range(count):
            generation = str(uuid.uuid4())
            document = Document(
                id=str(uuid.uuid4()),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i + 1,
                data_source_type=DataSourceType.UPLOAD_FILE,
                data_source_info="{}",
                batch="test_batch",
                name=f"Pipeline document {i}",
                created_from=DocumentCreatedFrom.RAG_PIPELINE,
                created_by=account.id,
                indexing_status=IndexingStatus.WAITING,
                indexing_generation=generation,
                enabled=True,
                archived=False,
                is_paused=False,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
            )
            session.add(document)
            # Create application generate entity
            app_config = {
                "app_id": pipeline.id,
                "app_name": fake.company(),
                "mode": "workflow",
                "workflow_id": workflow.id,
                "tenant_id": tenant.id,
                "app_mode": "workflow",
            }

            application_generate_entity = {
                "task_id": str(uuid.uuid4()),
                "app_config": app_config,
                "inputs": {"query": f"Test query {i}"},
                "files": [],
                "user_id": account.id,
                "stream": False,
                "invoke_from": InvokeFrom.PUBLISHED_PIPELINE.value,
                "workflow_execution_id": str(uuid.uuid4()),
                "pipeline_config": {
                    "app_id": str(uuid.uuid4()),
                    "app_name": fake.company(),
                    "mode": "workflow",
                    "workflow_id": workflow.id,
                    "tenant_id": tenant.id,
                    "app_mode": "workflow",
                },
                "datasource_type": "upload_file",
                "datasource_info": {},
                "dataset_id": dataset.id,
                "batch": "test_batch",
                "document_id": document.id,
            }

            entity = RagPipelineInvokeEntity(
                pipeline_id=pipeline.id,
                application_generate_entity=application_generate_entity,
                user_id=account.id,
                tenant_id=tenant.id,
                workflow_id=workflow.id,
                workflow_snapshot=capture_workflow(workflow),
                streaming=False,
                workflow_execution_id=str(uuid.uuid4()),
                workflow_thread_pool_id=str(uuid.uuid4()),
                indexing_generation=generation,
            )
            entities.append(entity)

        session.commit()
        return entities

    def _create_file_content_for_entities(self, entities):
        """
        Helper method to create file content for RAG pipeline invoke entities.

        Args:
            entities: List of RagPipelineInvokeEntity instances

        Returns:
            str: JSON string containing serialized entities
        """
        snapshot = entities[0].workflow_snapshot
        assert snapshot is not None
        batch = RagPipelineInvokeBatch(
            workflow_snapshot=snapshot,
            invoke_entities=[entity.model_copy(update={"workflow_snapshot": None}) for entity in entities],
        )
        return batch.model_dump_json(exclude_none=True)

    def test_priority_rag_pipeline_run_task_success(
        self, db_session_with_containers: Session, mock_pipeline_generator, mock_file_service
    ):
        """
        Test successful priority RAG pipeline run task execution.

        This test verifies:
        - Task execution with multiple RAG pipeline invoke entities
        - File content retrieval and parsing
        - PipelineGenerator.run method calls with correct parameters
        - Thread pool execution
        - File cleanup after execution
        - Queue management with no waiting tasks
        """
        # Arrange: Create test data
        account, tenant, pipeline, workflow = self._create_test_pipeline_and_workflow(db_session_with_containers)
        entities = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account, tenant, pipeline, workflow, count=2
        )
        file_content = self._create_file_content_for_entities(entities)

        # Mock file service
        file_id = str(uuid.uuid4())
        mock_file_service["get_content"].return_value = file_content

        # Act: Execute the priority task
        priority_rag_pipeline_run_task(file_id, tenant.id)

        # Assert: Verify expected outcomes
        # Verify file operations
        mock_file_service["get_content"].assert_called_once_with(file_id)
        mock_file_service["delete_file"].assert_called_once_with(file_id)

        # Verify PipelineGenerator.run was called for each entity
        assert mock_pipeline_generator.call_count == 2

        # Verify call parameters for each entity
        calls = mock_pipeline_generator.call_args_list
        for call in calls:
            call_kwargs = call[1]  # Get keyword arguments
            assert call_kwargs["pipeline"].id == pipeline.id
            assert call_kwargs["workflow"].id == workflow.id
            assert call_kwargs["user"].id == account.id
            assert call_kwargs["invoke_from"] == InvokeFrom.PUBLISHED_PIPELINE
            assert call_kwargs["streaming"] is False
            assert isinstance(call_kwargs["application_generate_entity"], RagPipelineGenerateEntity)

    def test_rag_pipeline_run_task_success(
        self, db_session_with_containers: Session, mock_pipeline_generator, mock_file_service
    ):
        """
        Test successful regular RAG pipeline run task execution.

        This test verifies:
        - Task execution with multiple RAG pipeline invoke entities
        - File content retrieval and parsing
        - PipelineGenerator.run method calls with correct parameters
        - Thread pool execution
        - File cleanup after execution
        - Queue management with no waiting tasks
        """
        # Arrange: Create test data
        account, tenant, pipeline, workflow = self._create_test_pipeline_and_workflow(db_session_with_containers)
        entities = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account, tenant, pipeline, workflow, count=3
        )
        file_content = self._create_file_content_for_entities(entities)

        # Mock file service
        file_id = str(uuid.uuid4())
        mock_file_service["get_content"].return_value = file_content

        # Act: Execute the regular task
        rag_pipeline_run_task(file_id, tenant.id)

        # Assert: Verify expected outcomes
        # Verify file operations
        mock_file_service["get_content"].assert_called_once_with(file_id)
        mock_file_service["delete_file"].assert_called_once_with(file_id)

        # Verify PipelineGenerator.run was called for each entity
        assert mock_pipeline_generator.call_count == 3

        # Verify call parameters for each entity
        calls = mock_pipeline_generator.call_args_list
        for call in calls:
            call_kwargs = call[1]  # Get keyword arguments
            assert call_kwargs["pipeline"].id == pipeline.id
            assert call_kwargs["workflow"].id == workflow.id
            assert call_kwargs["user"].id == account.id
            assert call_kwargs["invoke_from"] == InvokeFrom.PUBLISHED_PIPELINE
            assert call_kwargs["streaming"] is False
            assert isinstance(call_kwargs["application_generate_entity"], RagPipelineGenerateEntity)

    def test_priority_rag_pipeline_run_task_with_waiting_tasks(
        self, db_session_with_containers: Session, mock_pipeline_generator, mock_file_service
    ):
        """
        Test priority RAG pipeline run task with waiting tasks in queue using real Redis.

        This test verifies:
        - Core task execution
        - Real Redis-based tenant queue processing of waiting tasks
        - Task function calls for waiting tasks
        - Queue management with multiple tasks using actual Redis operations
        """
        # Arrange: Create test data
        account, tenant, pipeline, workflow = self._create_test_pipeline_and_workflow(db_session_with_containers)
        entities = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account, tenant, pipeline, workflow, count=1
        )
        file_content = self._create_file_content_for_entities(entities)

        # Mock file service
        file_id = str(uuid.uuid4())
        mock_file_service["get_content"].return_value = file_content

        # Use real Redis for TenantIsolatedTaskQueue
        queue = TenantIsolatedTaskQueue(tenant.id, "pipeline")

        # Add waiting tasks to the real Redis queue
        waiting_file_ids = [str(uuid.uuid4()) for _ in range(2)]
        queue.push_tasks(waiting_file_ids)

        # Mock the task function calls
        with patch(
            "tasks.rag_pipeline.priority_rag_pipeline_run_task.priority_rag_pipeline_run_task.delay"
        ) as mock_delay:
            # Act: Execute the priority task
            priority_rag_pipeline_run_task(file_id, tenant.id)

            # Assert: Verify core processing occurred
            mock_file_service["get_content"].assert_called_once_with(file_id)
            mock_file_service["delete_file"].assert_called_once_with(file_id)
            assert mock_pipeline_generator.call_count == 1

            # Verify waiting tasks were processed, pull 1 task a time by default
            assert mock_delay.call_count == 1

            # Verify correct parameters for the call
            call_kwargs = mock_delay.call_args[1] if mock_delay.call_args else {}
            assert call_kwargs.get("rag_pipeline_invoke_entities_file_id") == waiting_file_ids[0]
            assert call_kwargs.get("tenant_id") == tenant.id

            # Verify queue still has remaining tasks (only 1 was pulled)
            remaining_tasks = queue.pull_tasks(count=10)
            assert len(remaining_tasks) == 1  # 2 original - 1 pulled = 1 remaining

    def test_rag_pipeline_run_task_legacy_compatibility(
        self, db_session_with_containers: Session, mock_pipeline_generator, mock_file_service
    ):
        """
        Test regular RAG pipeline run task with legacy Redis queue format for backward compatibility.

        This test simulates the scenario where:
        - Old code writes file IDs directly to Redis list using lpush
        - New worker processes these legacy queue entries
        - Ensures backward compatibility during deployment transition

        Legacy format: redis_client.lpush(tenant_self_pipeline_task_queue, upload_file.id)
        New format: TenantIsolatedTaskQueue.push_tasks([file_id])
        """
        # Arrange: Create test data
        account, tenant, pipeline, workflow = self._create_test_pipeline_and_workflow(db_session_with_containers)
        entities = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account, tenant, pipeline, workflow, count=1
        )
        file_content = self._create_file_content_for_entities(entities)

        # Mock file service
        file_id = str(uuid.uuid4())
        mock_file_service["get_content"].return_value = file_content

        # Simulate legacy Redis queue format - direct file IDs in Redis list
        from extensions.ext_redis import redis_client

        # Legacy queue key format (old code)
        legacy_queue_key = f"tenant_self_pipeline_task_queue:{tenant.id}"
        legacy_task_key = f"tenant_pipeline_task:{tenant.id}"

        # Add legacy format data to Redis (simulating old code behavior)
        legacy_file_ids = [str(uuid.uuid4()) for _ in range(3)]
        for file_id_legacy in legacy_file_ids:
            redis_client.lpush(legacy_queue_key, file_id_legacy)

        # Set the task key to indicate there are waiting tasks (legacy behavior)
        redis_client.set(legacy_task_key, 1, ex=60 * 60)

        # Mock the Celery group scheduling used by the implementation
        with patch("tasks.rag_pipeline.rag_pipeline_run_task.group") as mock_group:
            mock_group.return_value.apply_async = MagicMock()

            # Act: Execute the priority task with new code but legacy queue data
            rag_pipeline_run_task(file_id, tenant.id)

            # Assert: Verify core processing occurred
            mock_file_service["get_content"].assert_called_once_with(file_id)
            mock_file_service["delete_file"].assert_called_once_with(file_id)
            assert mock_pipeline_generator.call_count == 1

            # Verify waiting tasks were processed via group, pull 1 task a time by default
            assert mock_group.return_value.apply_async.called

            # Verify correct parameters for the first scheduled job signature
            jobs = mock_group.call_args.args[0] if mock_group.call_args else []
            first_kwargs = jobs[0].kwargs if jobs else {}
            assert first_kwargs.get("rag_pipeline_invoke_entities_file_id") == legacy_file_ids[0]
            assert first_kwargs.get("tenant_id") == tenant.id

            # Verify that new code can process legacy queue entries
            # The new TenantIsolatedTaskQueue should be able to read from the legacy format
            queue = TenantIsolatedTaskQueue(tenant.id, "pipeline")

            # Verify queue still has remaining tasks (only 1 was pulled)
            remaining_tasks = queue.pull_tasks(count=10)
            assert len(remaining_tasks) == 2  # 3 original - 1 pulled = 2 remaining

        # Cleanup: Remove legacy test data
        redis_client.delete(legacy_queue_key)
        redis_client.delete(legacy_task_key)

    def test_rag_pipeline_run_task_with_waiting_tasks(
        self, db_session_with_containers: Session, mock_pipeline_generator, mock_file_service
    ):
        """
        Test regular RAG pipeline run task with waiting tasks in queue using real Redis.

        This test verifies:
        - Core task execution
        - Real Redis-based tenant queue processing of waiting tasks
        - Task function calls for waiting tasks
        - Queue management with multiple tasks using actual Redis operations
        """
        # Arrange: Create test data
        account, tenant, pipeline, workflow = self._create_test_pipeline_and_workflow(db_session_with_containers)
        entities = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account, tenant, pipeline, workflow, count=1
        )
        file_content = self._create_file_content_for_entities(entities)

        # Mock file service
        file_id = str(uuid.uuid4())
        mock_file_service["get_content"].return_value = file_content

        # Use real Redis for TenantIsolatedTaskQueue
        queue = TenantIsolatedTaskQueue(tenant.id, "pipeline")

        # Add waiting tasks to the real Redis queue
        waiting_file_ids = [str(uuid.uuid4()) for _ in range(3)]
        queue.push_tasks(waiting_file_ids)

        # Mock the Celery group scheduling used by the implementation
        with patch("tasks.rag_pipeline.rag_pipeline_run_task.group") as mock_group:
            mock_group.return_value.apply_async = MagicMock()

            # Act: Execute the regular task
            rag_pipeline_run_task(file_id, tenant.id)

            # Assert: Verify core processing occurred
            mock_file_service["get_content"].assert_called_once_with(file_id)
            mock_file_service["delete_file"].assert_called_once_with(file_id)
            assert mock_pipeline_generator.call_count == 1

            # Verify waiting tasks were processed via group.apply_async
            assert mock_group.return_value.apply_async.called

            # Verify correct parameters for the first scheduled job signature
            jobs = mock_group.call_args.args[0] if mock_group.call_args else []
            first_kwargs = jobs[0].kwargs if jobs else {}
            assert first_kwargs.get("rag_pipeline_invoke_entities_file_id") == waiting_file_ids[0]
            assert first_kwargs.get("tenant_id") == tenant.id

            # Verify queue still has remaining tasks (only 1 was pulled)
            remaining_tasks = queue.pull_tasks(count=10)
            assert len(remaining_tasks) == 2  # 3 original - 1 pulled = 2 remaining

    def test_priority_rag_pipeline_run_task_error_handling(
        self, db_session_with_containers: Session, mock_pipeline_generator, mock_file_service
    ):
        """
        Test error handling in priority RAG pipeline run task using real Redis.

        This test verifies:
        - Exception handling during core processing
        - Tenant queue cleanup even on errors using real Redis
        - Proper error logging
        - Aggregated failure is propagated to Celery
        - Queue management continues despite core processing errors
        - Retry input is preserved
        """
        # Arrange: Create test data
        account, tenant, pipeline, workflow = self._create_test_pipeline_and_workflow(db_session_with_containers)
        entities = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account, tenant, pipeline, workflow, count=1
        )
        file_content = self._create_file_content_for_entities(entities)

        # Mock file service
        file_id = str(uuid.uuid4())
        mock_file_service["get_content"].return_value = file_content

        # Mock PipelineGenerator to raise an exception
        mock_pipeline_generator.side_effect = Exception("Pipeline generation failed")

        # Use real Redis for TenantIsolatedTaskQueue
        queue = TenantIsolatedTaskQueue(tenant.id, "pipeline")

        # Add waiting task to the real Redis queue
        waiting_file_id = str(uuid.uuid4())
        queue.push_tasks([waiting_file_id])

        # Mock the task function calls
        with patch(
            "tasks.rag_pipeline.priority_rag_pipeline_run_task.priority_rag_pipeline_run_task.delay"
        ) as mock_delay:
            with pytest.raises(ExceptionGroup):
                priority_rag_pipeline_run_task(file_id, tenant.id)

            # Assert: Verify error was handled gracefully
            mock_file_service["get_content"].assert_called_once_with(file_id)
            mock_file_service["delete_file"].assert_not_called()
            assert mock_pipeline_generator.call_count == 1

            # Verify waiting task was still processed despite core processing error
            mock_delay.assert_called_once()

            # Verify correct parameters for the call
            call_kwargs = mock_delay.call_args[1] if mock_delay.call_args else {}
            assert call_kwargs.get("rag_pipeline_invoke_entities_file_id") == waiting_file_id
            assert call_kwargs.get("tenant_id") == tenant.id

            # Verify queue is empty after processing (task was pulled)
            remaining_tasks = queue.pull_tasks(count=10)
            assert len(remaining_tasks) == 0

    def test_rag_pipeline_run_task_error_handling(
        self, db_session_with_containers: Session, mock_pipeline_generator, mock_file_service
    ):
        """
        Test error handling in regular RAG pipeline run task using real Redis.

        This test verifies:
        - Exception handling during core processing
        - Tenant queue cleanup even on errors using real Redis
        - Proper error logging
        - Aggregated failure is propagated to Celery
        - Queue management continues despite core processing errors
        - Retry input is preserved
        """
        # Arrange: Create test data
        account, tenant, pipeline, workflow = self._create_test_pipeline_and_workflow(db_session_with_containers)
        entities = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account, tenant, pipeline, workflow, count=1
        )
        file_content = self._create_file_content_for_entities(entities)

        # Mock file service
        file_id = str(uuid.uuid4())
        mock_file_service["get_content"].return_value = file_content

        # Mock PipelineGenerator to raise an exception
        mock_pipeline_generator.side_effect = Exception("Pipeline generation failed")

        # Use real Redis for TenantIsolatedTaskQueue
        queue = TenantIsolatedTaskQueue(tenant.id, "pipeline")

        # Add waiting task to the real Redis queue
        waiting_file_id = str(uuid.uuid4())
        queue.push_tasks([waiting_file_id])

        # Mock the Celery group scheduling used by the implementation
        with patch("tasks.rag_pipeline.rag_pipeline_run_task.group") as mock_group:
            mock_group.return_value.apply_async = MagicMock()

            with pytest.raises(ExceptionGroup):
                rag_pipeline_run_task(file_id, tenant.id)

            # Assert: Verify error was handled gracefully
            mock_file_service["get_content"].assert_called_once_with(file_id)
            mock_file_service["delete_file"].assert_not_called()
            assert mock_pipeline_generator.call_count == 1

            # Verify waiting task was still processed despite core processing error
            assert mock_group.return_value.apply_async.called

            # Verify correct parameters for the first scheduled job signature
            jobs = mock_group.call_args.args[0] if mock_group.call_args else []
            first_kwargs = jobs[0].kwargs if jobs else {}
            assert first_kwargs.get("rag_pipeline_invoke_entities_file_id") == waiting_file_id
            assert first_kwargs.get("tenant_id") == tenant.id

            # Verify queue is empty after processing (task was pulled)
            remaining_tasks = queue.pull_tasks(count=10)
            assert len(remaining_tasks) == 0

    def test_priority_rag_pipeline_run_task_tenant_isolation(
        self, db_session_with_containers: Session, mock_pipeline_generator, mock_file_service
    ):
        """
        Test tenant isolation in priority RAG pipeline run task using real Redis.

        This test verifies:
        - Different tenants have isolated queues
        - Tasks from one tenant don't affect another tenant's queue
        - Queue operations are properly scoped to tenant
        """
        # Arrange: Create test data for two different tenants
        account1, tenant1, pipeline1, workflow1 = self._create_test_pipeline_and_workflow(db_session_with_containers)
        account2, tenant2, pipeline2, workflow2 = self._create_test_pipeline_and_workflow(db_session_with_containers)

        entities1 = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account1, tenant1, pipeline1, workflow1, count=1
        )
        entities2 = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account2, tenant2, pipeline2, workflow2, count=1
        )

        file_content1 = self._create_file_content_for_entities(entities1)
        file_content2 = self._create_file_content_for_entities(entities2)

        # Mock file service
        file_id1 = str(uuid.uuid4())
        str(uuid.uuid4())
        mock_file_service["get_content"].side_effect = [file_content1, file_content2]

        # Use real Redis for TenantIsolatedTaskQueue
        queue1 = TenantIsolatedTaskQueue(tenant1.id, "pipeline")
        queue2 = TenantIsolatedTaskQueue(tenant2.id, "pipeline")

        # Add waiting tasks to both queues
        waiting_file_id1 = str(uuid.uuid4())
        waiting_file_id2 = str(uuid.uuid4())

        queue1.push_tasks([waiting_file_id1])
        queue2.push_tasks([waiting_file_id2])

        # Mock the task function calls
        with patch(
            "tasks.rag_pipeline.priority_rag_pipeline_run_task.priority_rag_pipeline_run_task.delay"
        ) as mock_delay:
            # Act: Execute the priority task for tenant1 only
            priority_rag_pipeline_run_task(file_id1, tenant1.id)

            # Assert: Verify core processing occurred for tenant1
            assert mock_file_service["get_content"].call_count == 1
            assert mock_file_service["delete_file"].call_count == 1
            assert mock_pipeline_generator.call_count == 1

            # Verify only tenant1's waiting task was processed
            mock_delay.assert_called_once()
            call_kwargs = mock_delay.call_args[1] if mock_delay.call_args else {}
            assert call_kwargs.get("rag_pipeline_invoke_entities_file_id") == waiting_file_id1
            assert call_kwargs.get("tenant_id") == tenant1.id

            # Verify tenant1's queue is empty
            remaining_tasks1 = queue1.pull_tasks(count=10)
            assert len(remaining_tasks1) == 0

            # Verify tenant2's queue still has its task (isolation)
            remaining_tasks2 = queue2.pull_tasks(count=10)
            assert len(remaining_tasks2) == 1

            # Verify queue keys are different
            assert queue1._queue != queue2._queue
            assert queue1._task_key != queue2._task_key

    def test_rag_pipeline_run_task_tenant_isolation(
        self, db_session_with_containers: Session, mock_pipeline_generator, mock_file_service
    ):
        """
        Test tenant isolation in regular RAG pipeline run task using real Redis.

        This test verifies:
        - Different tenants have isolated queues
        - Tasks from one tenant don't affect another tenant's queue
        - Queue operations are properly scoped to tenant
        """
        # Arrange: Create test data for two different tenants
        account1, tenant1, pipeline1, workflow1 = self._create_test_pipeline_and_workflow(db_session_with_containers)
        account2, tenant2, pipeline2, workflow2 = self._create_test_pipeline_and_workflow(db_session_with_containers)

        entities1 = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account1, tenant1, pipeline1, workflow1, count=1
        )
        entities2 = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account2, tenant2, pipeline2, workflow2, count=1
        )

        file_content1 = self._create_file_content_for_entities(entities1)
        file_content2 = self._create_file_content_for_entities(entities2)

        # Mock file service
        file_id1 = str(uuid.uuid4())
        str(uuid.uuid4())
        mock_file_service["get_content"].side_effect = [file_content1, file_content2]

        # Use real Redis for TenantIsolatedTaskQueue
        queue1 = TenantIsolatedTaskQueue(tenant1.id, "pipeline")
        queue2 = TenantIsolatedTaskQueue(tenant2.id, "pipeline")

        # Add waiting tasks to both queues
        waiting_file_id1 = str(uuid.uuid4())
        waiting_file_id2 = str(uuid.uuid4())

        queue1.push_tasks([waiting_file_id1])
        queue2.push_tasks([waiting_file_id2])

        # Mock the Celery group scheduling used by the implementation
        with patch("tasks.rag_pipeline.rag_pipeline_run_task.group") as mock_group:
            mock_group.return_value.apply_async = MagicMock()

            # Act: Execute the regular task for tenant1 only
            rag_pipeline_run_task(file_id1, tenant1.id)

            # Assert: Verify core processing occurred for tenant1
            assert mock_file_service["get_content"].call_count == 1
            assert mock_file_service["delete_file"].call_count == 1
            assert mock_pipeline_generator.call_count == 1

            # Verify only tenant1's waiting task was processed (via group)
            assert mock_group.return_value.apply_async.called
            jobs = mock_group.call_args.args[0] if mock_group.call_args else []
            first_kwargs = jobs[0].kwargs if jobs else {}
            assert first_kwargs.get("rag_pipeline_invoke_entities_file_id") == waiting_file_id1
            assert first_kwargs.get("tenant_id") == tenant1.id

            # Verify tenant1's queue is empty
            remaining_tasks1 = queue1.pull_tasks(count=10)
            assert len(remaining_tasks1) == 0

            # Verify tenant2's queue still has its task (isolation)
            remaining_tasks2 = queue2.pull_tasks(count=10)
            assert len(remaining_tasks2) == 1

            # Verify queue keys are different
            assert queue1._queue != queue2._queue
            assert queue1._task_key != queue2._task_key

    def test_run_single_rag_pipeline_task_uses_snapshot_after_workflow_deletion(
        self, db_session_with_containers: Session, mock_pipeline_generator, flask_app_with_containers: Flask
    ):
        """
        Test successful run_single_rag_pipeline_task execution.

        This test verifies:
        - Single RAG pipeline task execution within Flask app context
        - Entity validation and database queries
        - PipelineGenerator.run method call with correct parameters
        - Proper Flask context handling
        """
        # Arrange: Create test data
        account, tenant, pipeline, workflow = self._create_test_pipeline_and_workflow(db_session_with_containers)
        entities = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account, tenant, pipeline, workflow, count=1
        )
        entity_data = entities[0].model_dump()
        workflow_id = workflow.id
        workflow_snapshot = entities[0].workflow_snapshot
        assert workflow_snapshot is not None
        pipeline.workflow_id = None
        db_session_with_containers.commit()
        db_session_with_containers.delete(workflow)
        db_session_with_containers.commit()

        # Act: Execute the single task
        execution_id = str(uuid.uuid4())
        with flask_app_with_containers.app_context():
            run_single_rag_pipeline_task(
                entity_data,
                flask_app_with_containers,
                dataset_lease=_OwnedLease(),
                execution_id=execution_id,
            )

        # Assert: Verify expected outcomes
        # Verify PipelineGenerator.run was called
        assert mock_pipeline_generator.call_count == 1

        # Verify call parameters
        call = mock_pipeline_generator.call_args
        call_kwargs = call[1]  # Get keyword arguments
        assert call_kwargs["pipeline"].id == pipeline.id
        assert call_kwargs["workflow"].id == workflow_id
        assert call_kwargs["workflow"].graph == workflow_snapshot.graph
        assert call_kwargs["user"].id == account.id
        assert call_kwargs["invoke_from"] == InvokeFrom.PUBLISHED_PIPELINE
        assert call_kwargs["streaming"] is False
        assert isinstance(call_kwargs["application_generate_entity"], RagPipelineGenerateEntity)
        document_id = RagPipelineGenerateEntity.model_validate(entity_data["application_generate_entity"]).document_id
        assert document_id is not None
        db_session_with_containers.expire_all()
        persisted_document = db_session_with_containers.get(Document, document_id)
        assert persisted_document is not None
        assert persisted_document.indexing_execution_id == execution_id

    def test_run_single_rag_pipeline_task_entity_validation_error(
        self, mock_pipeline_generator, flask_app_with_containers: Flask
    ):
        """
        Test run_single_rag_pipeline_task with invalid entity data.

        This test verifies:
        - Proper error handling for invalid entity data
        - Exception logging
        - Function raises ValidationError before acquiring execution ownership
        """
        with flask_app_with_containers.app_context():
            with pytest.raises(ValidationError):
                run_single_rag_pipeline_task({}, flask_app_with_containers)

        # Assert: Pipeline generator should not be called
        mock_pipeline_generator.assert_not_called()

    def test_run_single_rag_pipeline_task_database_entity_not_found(
        self, db_session_with_containers: Session, mock_pipeline_generator, flask_app_with_containers: Flask
    ):
        """
        Test run_single_rag_pipeline_task with non-existent database entities.

        This test verifies:
        - Proper error handling for missing database entities
        - Exception logging
        - The claimed document generation is failed permanently
        """
        account, tenant, pipeline, workflow = self._create_test_pipeline_and_workflow(db_session_with_containers)
        entity = self._create_rag_pipeline_invoke_entities(
            db_session_with_containers, account, tenant, pipeline, workflow, count=1
        )[0]
        entity_data = entity.model_dump()
        document_id = RagPipelineGenerateEntity.model_validate(entity_data["application_generate_entity"]).document_id
        assert document_id is not None
        missing_account_id = str(uuid.uuid4())
        entity_data["user_id"] = missing_account_id

        with flask_app_with_containers.app_context():
            with pytest.raises(RagPipelinePermanentTaskError, match=f"Account {missing_account_id} not found"):
                run_single_rag_pipeline_task(
                    entity_data,
                    flask_app_with_containers,
                    dataset_lease=_OwnedLease(),
                    execution_id=str(uuid.uuid4()),
                )

        # Assert: Pipeline generator should not be called
        mock_pipeline_generator.assert_not_called()
        db_session_with_containers.expire_all()
        persisted_document = db_session_with_containers.get(Document, document_id)
        assert persisted_document is not None
        assert persisted_document.indexing_status == IndexingStatus.ERROR
        assert persisted_document.indexing_execution_id is None

    def test_priority_rag_pipeline_run_task_file_not_found(
        self, db_session_with_containers: Session, mock_pipeline_generator, mock_file_service
    ):
        """
        Test priority RAG pipeline run task with non-existent file.

        This test verifies:
        - Proper error handling for missing files
        - Exception logging
        - Function raises Exception for file errors
        - Queue management continues despite file errors
        """
        # Arrange: Create test data
        account, tenant, pipeline, workflow = self._create_test_pipeline_and_workflow(db_session_with_containers)

        # Mock file service to raise exception
        file_id = str(uuid.uuid4())
        mock_file_service["get_content"].side_effect = Exception("File not found")

        # Use real Redis for TenantIsolatedTaskQueue
        queue = TenantIsolatedTaskQueue(tenant.id, "pipeline")

        # Add waiting task to the real Redis queue
        waiting_file_id = str(uuid.uuid4())
        queue.push_tasks([waiting_file_id])

        # Mock the task function calls
        with patch(
            "tasks.rag_pipeline.priority_rag_pipeline_run_task.priority_rag_pipeline_run_task.delay"
        ) as mock_delay:
            # Act & Assert: Execute the priority task (should raise Exception)
            with pytest.raises(Exception, match="File not found"):
                priority_rag_pipeline_run_task(file_id, tenant.id)

            # Assert: Verify error was handled gracefully
            mock_file_service["get_content"].assert_called_once_with(file_id)
            mock_pipeline_generator.assert_not_called()

            # Verify waiting task was still processed despite file error
            mock_delay.assert_called_once()

            # Verify correct parameters for the call
            call_kwargs = mock_delay.call_args[1] if mock_delay.call_args else {}
            assert call_kwargs.get("rag_pipeline_invoke_entities_file_id") == waiting_file_id
            assert call_kwargs.get("tenant_id") == tenant.id

            # Verify queue is empty after processing (task was pulled)
            remaining_tasks = queue.pull_tasks(count=10)
            assert len(remaining_tasks) == 0

    def test_rag_pipeline_run_task_file_not_found(
        self, db_session_with_containers: Session, mock_pipeline_generator, mock_file_service
    ):
        """
        Test regular RAG pipeline run task with non-existent file.

        This test verifies:
        - Proper error handling for missing files
        - Exception logging
        - Function raises Exception for file errors
        - Queue management continues despite file errors
        """
        # Arrange: Create test data
        account, tenant, pipeline, workflow = self._create_test_pipeline_and_workflow(db_session_with_containers)

        # Mock file service to raise exception
        file_id = str(uuid.uuid4())
        mock_file_service["get_content"].side_effect = Exception("File not found")

        # Use real Redis for TenantIsolatedTaskQueue
        queue = TenantIsolatedTaskQueue(tenant.id, "pipeline")

        # Add waiting task to the real Redis queue
        waiting_file_id = str(uuid.uuid4())
        queue.push_tasks([waiting_file_id])

        # Mock the Celery group scheduling used by the implementation
        with patch("tasks.rag_pipeline.rag_pipeline_run_task.group") as mock_group:
            mock_group.return_value.apply_async = MagicMock()

            # Act & Assert: Execute the regular task (should raise Exception)
            with pytest.raises(Exception, match="File not found"):
                rag_pipeline_run_task(file_id, tenant.id)

            # Assert: Verify error was handled gracefully
            mock_file_service["get_content"].assert_called_once_with(file_id)
            mock_pipeline_generator.assert_not_called()

            # Verify waiting task was still processed despite file error
            assert mock_group.return_value.apply_async.called

            # Verify correct parameters for the first scheduled job signature
            jobs = mock_group.call_args.args[0] if mock_group.call_args else []
            first_kwargs = jobs[0].kwargs if jobs else {}
            assert first_kwargs.get("rag_pipeline_invoke_entities_file_id") == waiting_file_id
            assert first_kwargs.get("tenant_id") == tenant.id

            # Verify queue is empty after processing (task was pulled)
            remaining_tasks = queue.pull_tasks(count=10)
            assert len(remaining_tasks) == 0
