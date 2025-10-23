"""Comprehensive TestContainers-based integration tests for WorkflowRunService class.

This test suite covers all pause state management operations including:
- Real database interactions using containerized PostgreSQL
- Real storage operations using the test storage backend
- Complete workflow: save_pause_state -> get_pause_state -> mark_as_resumed
- Testing with actual FileService (not mocked)
- Database transactions and rollback behavior
- Actual file upload and retrieval through storage
- Workflow status transitions in the database
- Error handling with real database constraints
- Concurrent access scenarios
- Large state handling with real storage

These tests use TestContainers to spin up real services for integration testing,
providing more reliable and realistic test scenarios than mocks.
"""

import json
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any

import pytest
from sqlalchemy import Engine, delete
from sqlalchemy.orm import Session

from core.workflow.enums import WorkflowExecutionStatus
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models import Account
from models import WorkflowPause as WorkflowPauseModel
from models.model import UploadFile
from models.workflow import Workflow, WorkflowRun
from services.file_service import FileService
from services.workflow_run_service import (
    WorkflowRunService,
    _InvalidStateTransitionError,
    _StateFileNotExistError,
    _WorkflowRunNotFoundError,
)


class TestWorkflowRunServiceTestContainers:
    """Comprehensive TestContainers-based integration tests for WorkflowRunService class."""

    @pytest.fixture
    def engine(self, db_session_with_containers: Session):
        """Get database engine from TestContainers session."""

        bind = db_session_with_containers.get_bind()
        assert isinstance(bind, Engine)
        return bind

    @pytest.fixture
    def file_service(self, engine: Engine):
        """Create FileService instance with TestContainers engine."""
        return FileService(engine)

    @pytest.fixture
    def workflow_run_service(self, engine: Engine, file_service: FileService):
        """Create WorkflowRunService instance with TestContainers engine and FileService."""
        return WorkflowRunService(engine, file_service)

    @pytest.fixture(autouse=True)
    def setup_test_data(self, db_session_with_containers, file_service, workflow_run_service):
        """Set up test data for each test method using TestContainers."""
        # Create test tenant and account
        from models.account import Tenant, TenantAccountJoin, TenantAccountRole

        tenant = Tenant(
            name="Test Tenant",
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        account = Account(
            email="test@example.com",
            name="Test User",
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        # Create tenant-account join
        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(tenant_join)
        db_session_with_containers.commit()

        # Set test data
        self.test_tenant_id = tenant.id
        self.test_user_id = account.id
        self.test_app_id = str(uuid.uuid4())
        self.test_workflow_id = str(uuid.uuid4())
        self.test_workflow_run_id = str(uuid.uuid4())

        # Create test workflow
        self.test_workflow = Workflow(
            id=self.test_workflow_id,
            tenant_id=self.test_tenant_id,
            app_id=self.test_app_id,
            type="workflow",
            version="draft",
            graph='{"nodes": [], "edges": []}',
            features='{"file_upload": {"enabled": false}}',
            created_by=self.test_user_id,
            created_at=naive_utc_now(),
        )

        # Create test workflow run
        self.test_workflow_run = WorkflowRun(
            id=self.test_workflow_run_id,
            tenant_id=self.test_tenant_id,
            app_id=self.test_app_id,
            workflow_id=self.test_workflow_id,
            type="workflow",
            triggered_from="debugging",
            version="draft",
            status=WorkflowExecutionStatus.RUNNING,
            created_by=self.test_user_id,
            created_by_role="account",
            created_at=naive_utc_now(),
        )

        # Store session and service instances
        self.session = db_session_with_containers
        self.file_service = file_service
        self.workflow_run_service = workflow_run_service

        # Save test data to database
        self.session.add(self.test_workflow)
        self.session.add(self.test_workflow_run)
        self.session.commit()

        yield

        # Cleanup
        self._cleanup_test_data()

    def _cleanup_test_data(self):
        """Clean up test data after each test method."""
        try:
            # Clean up workflow pauses
            self.session.execute(
                delete(WorkflowPauseModel).where(
                    WorkflowPauseModel.tenant_id == self.test_tenant_id,
                    WorkflowPauseModel.app_id == self.test_app_id,
                )
            )
            # Clean up upload files
            self.session.execute(
                delete(UploadFile).where(
                    UploadFile.tenant_id == self.test_tenant_id,
                )
            )
            # Clean up workflow runs
            self.session.execute(
                delete(WorkflowRun).where(
                    WorkflowRun.tenant_id == self.test_tenant_id,
                    WorkflowRun.app_id == self.test_app_id,
                )
            )
            # Clean up workflows
            self.session.execute(
                delete(Workflow).where(
                    Workflow.tenant_id == self.test_tenant_id,
                    Workflow.app_id == self.test_app_id,
                )
            )
            self.session.commit()
        except Exception as e:
            self.session.rollback()
            raise e

    def _create_test_state(self) -> str:
        """Create a test state string."""
        return json.dumps(
            {
                "node_id": "test-node",
                "node_type": "llm",
                "status": "paused",
                "data": {"key": "value"},
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    def test_complete_pause_resume_workflow(self, db_session_with_containers):
        """Test complete workflow: save_pause_state -> get_pause_state -> mark_as_resumed."""
        # Arrange
        test_state = self._create_test_state()

        # Act - Save pause state
        pause_entity = self.workflow_run_service.save_pause_state(self.test_workflow_run, self.test_user_id, test_state)

        # Assert - Pause state saved
        assert pause_entity is not None
        assert pause_entity.id is not None
        assert pause_entity.workflow_run_id == self.test_workflow_run_id
        assert pause_entity.get_state() == test_state

        # Verify database state - refresh to get the latest data
        db_session_with_containers.refresh(self.test_workflow_run)
        workflow_run = db_session_with_containers.get(WorkflowRun, self.test_workflow_run_id)
        assert workflow_run is not None
        assert workflow_run.pause_id == pause_entity.id

        # Act - Get pause state
        retrieved_entity = self.workflow_run_service.get_pause_state(self.test_workflow_run_id)

        # Assert - Pause state retrieved
        assert retrieved_entity is not None
        assert retrieved_entity.id == pause_entity.id
        assert retrieved_entity.get_state() == test_state

        # Act - Mark as resumed
        self.workflow_run_service.mark_as_resumed(pause_entity)

        # Assert - Marked as resumed
        db_session_with_containers.refresh(self.test_workflow_run)
        workflow_run = db_session_with_containers.get(WorkflowRun, self.test_workflow_run_id)
        assert workflow_run is not None
        assert workflow_run.pause_id is None
        assert workflow_run.status == WorkflowExecutionStatus.RUNNING

        pause_model = db_session_with_containers.get(WorkflowPauseModel, pause_entity.id)
        assert pause_model is not None
        assert pause_model.resumed_at is not None

    def test_save_pause_state_with_real_file_service(self, db_session_with_containers):
        """Test save_pause_state with real FileService and storage."""
        # Arrange
        test_state = self._create_test_state()

        # Act
        pause_entity = self.workflow_run_service.save_pause_state(self.test_workflow_run, self.test_user_id, test_state)

        # Assert
        assert pause_entity is not None
        assert pause_entity.get_state() == test_state

        # Verify file was uploaded to storage
        pause_model = db_session_with_containers.get(WorkflowPauseModel, pause_entity.id)
        assert pause_model is not None
        assert pause_model.state_file_id is not None

        upload_file = db_session_with_containers.get(UploadFile, pause_model.state_file_id)
        assert upload_file is not None
        # Verify file content in storage

        file_key = upload_file.key
        storage_content = storage.load(file_key).decode()
        assert storage_content == test_state

    def test_save_pause_state_transaction_commit(self, db_session_with_containers):
        """Test that save_pause_state properly commits transactions."""
        # Arrange
        test_state = self._create_test_state()

        # Act
        pause_entity = self.workflow_run_service.save_pause_state(self.test_workflow_run, self.test_user_id, test_state)

        # Assert - Verify data is committed and accessible in new session
        with Session(bind=db_session_with_containers.get_bind(), expire_on_commit=False) as new_session:
            workflow_run = new_session.get(WorkflowRun, self.test_workflow_run_id)
            assert workflow_run is not None
            assert workflow_run.pause_id == pause_entity.id

            pause_model = new_session.get(WorkflowPauseModel, pause_entity.id)
            assert pause_model is not None

    def test_mark_as_resumed_transaction_commit(self, db_session_with_containers):
        """Test that mark_as_resumed properly commits transactions."""
        # Arrange
        test_state = self._create_test_state()
        pause_entity = self.workflow_run_service.save_pause_state(self.test_workflow_run, self.test_user_id, test_state)

        # Act
        self.workflow_run_service.mark_as_resumed(pause_entity)

        # Assert - Verify data is committed and accessible in new session
        with Session(bind=db_session_with_containers.get_bind(), expire_on_commit=False) as new_session:
            workflow_run = new_session.get(WorkflowRun, self.test_workflow_run_id)
            assert workflow_run is not None
            assert workflow_run.pause_id is None
            assert workflow_run.status == WorkflowExecutionStatus.RUNNING

            pause_model = new_session.get(WorkflowPauseModel, pause_entity.id)
            assert pause_model is not None
            assert pause_model.resumed_at is not None

    def test_workflow_status_transitions(self, db_session_with_containers):
        """Test workflow status transitions during pause/resume operations."""
        # Arrange
        test_state = self._create_test_state()

        # Initial status should be RUNNING
        workflow_run = db_session_with_containers.get(WorkflowRun, self.test_workflow_run_id)
        assert workflow_run.status == WorkflowExecutionStatus.RUNNING  # Status remains RUNNING during pause

        # Act - Save pause state
        pause_entity = self.workflow_run_service.save_pause_state(self.test_workflow_run, self.test_user_id, test_state)

        # Assert - Status should be PAUSED
        db_session_with_containers.refresh(self.test_workflow_run)
        workflow_run = db_session_with_containers.get(WorkflowRun, self.test_workflow_run_id)
        assert workflow_run.status == WorkflowExecutionStatus.PAUSED
        assert workflow_run.pause_id == pause_entity.id

        # Act - Mark as resumed
        self.workflow_run_service.mark_as_resumed(pause_entity)

        # Assert - Status should be RUNNING
        db_session_with_containers.refresh(self.test_workflow_run)
        workflow_run = db_session_with_containers.get(WorkflowRun, self.test_workflow_run_id)
        assert workflow_run.status == WorkflowExecutionStatus.RUNNING
        assert workflow_run.pause_id is None

    def test_get_pause_state_workflow_not_found(self):
        """Test get_pause_state with non-existent workflow run."""
        # Act & Assert
        with pytest.raises(_WorkflowRunNotFoundError) as exc_info:
            self.workflow_run_service.get_pause_state(str(uuid.uuid4()))  # Use a valid UUID format

        assert "WorkflowRun not found" in str(exc_info.value)

    def test_get_pause_state_no_pause_state(self):
        """Test get_pause_state when workflow run has no pause state."""
        # Act & Assert
        # When there's no pause state, get_pause_state returns None instead of raising an error
        result = self.workflow_run_service.get_pause_state(self.test_workflow_run_id)
        assert result is None

    def test_get_pause_state_missing_state_file(self, db_session_with_containers):
        """Test get_pause_state when state file is missing from database."""
        # Arrange
        test_state = self._create_test_state()
        pause_entity = self.workflow_run_service.save_pause_state(self.test_workflow_run, self.test_user_id, test_state)

        # Manually delete the upload file to simulate missing state file
        pause_model = db_session_with_containers.get(WorkflowPauseModel, pause_entity.id)
        upload_file_id = pause_model.state_file_id
        # Instead of setting to None (which violates NOT NULL constraint),
        # we'll delete the upload file directly
        upload_file = db_session_with_containers.get(UploadFile, upload_file_id)
        if upload_file:
            db_session_with_containers.delete(upload_file)
        db_session_with_containers.commit()

        # Act & Assert
        # The get_pause_state itself should raise the error when it detects the missing file
        with pytest.raises(_StateFileNotExistError) as exc_info:
            self.workflow_run_service.get_pause_state(self.test_workflow_run_id)

        # Verify the error message contains expected information
        error_msg = str(exc_info.value)
        assert "StateFile not exists for PauseState" in error_msg
        assert self.test_workflow_run_id in error_msg

    def test_storage_file_missing(self, db_session_with_containers):
        """Test behavior when storage file is missing but database record exists."""
        # Arrange
        test_state = self._create_test_state()
        pause_entity = self.workflow_run_service.save_pause_state(self.test_workflow_run, self.test_user_id, test_state)

        # Manually delete file from storage
        pause_model = db_session_with_containers.get(WorkflowPauseModel, pause_entity.id)
        upload_file = db_session_with_containers.get(UploadFile, pause_model.state_file_id)
        file_key = upload_file.key
        file_id = upload_file.id

        # Delete file from storage
        storage.delete(file_key)

        # Act & Assert - Should raise an error when trying to get state
        retrieved_entity = self.workflow_run_service.get_pause_state(self.test_workflow_run_id)
        with pytest.raises(FileNotFoundError):
            # This should fail
            retrieved_entity.get_state()

    def test_large_state_handling(self, db_session_with_containers):
        """Test handling of large state data."""
        # Arrange - Create a large state (1MB)
        large_state = "x" * (1024 * 1024)  # 1MB of data
        large_state_json = json.dumps({"large_data": large_state})

        # Act
        pause_entity = self.workflow_run_service.save_pause_state(
            self.test_workflow_run, self.test_user_id, large_state_json
        )

        # Assert
        assert pause_entity is not None
        retrieved_entity = self.workflow_run_service.get_pause_state(self.test_workflow_run_id)
        assert retrieved_entity.get_state() == large_state_json

        # Verify file size in database
        pause_model = db_session_with_containers.get(WorkflowPauseModel, pause_entity.id)
        if pause_model and pause_model.state_file_id:
            upload_file = db_session_with_containers.get(UploadFile, pause_model.state_file_id)
            assert upload_file.size == len(large_state_json)

    def test_concurrent_read_operations(self):
        """Test concurrent read operations on pause state."""
        # Arrange
        test_state = self._create_test_state()
        pause_entity = self.workflow_run_service.save_pause_state(self.test_workflow_run, self.test_user_id, test_state)

        def read_pause_state() -> Any:
            return self.workflow_run_service.get_pause_state(self.test_workflow_run_id)

        # Act - Read concurrently
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(read_pause_state) for _ in range(5)]

            results = []
            for future in as_completed(futures):
                result = future.result()
                results.append(result)

        # Assert - All reads should succeed and return the same data
        assert len(results) == 5
        for result in results:
            assert result is not None
            assert result.id == pause_entity.id
            assert result.get_state() == test_state

    def test_data_integrity_across_sessions(self, db_session_with_containers):
        """Test data integrity across different database sessions."""
        # Arrange
        test_state = self._create_test_state()

        # Act - Save in one session
        pause_entity = self.workflow_run_service.save_pause_state(self.test_workflow_run, self.test_user_id, test_state)

        # Assert - Read in a different session
        new_service = WorkflowRunService(
            db_session_with_containers.get_bind(), FileService(db_session_with_containers.get_bind())
        )
        retrieved_entity = new_service.get_pause_state(self.test_workflow_run_id)

        assert retrieved_entity is not None
        assert retrieved_entity.id == pause_entity.id
        assert retrieved_entity.get_state() == test_state

        # Verify workflow run state in different session
        with Session(bind=db_session_with_containers.get_bind(), expire_on_commit=False) as new_session:
            workflow_run = new_session.get(WorkflowRun, self.test_workflow_run_id)
            assert workflow_run.pause_id == pause_entity.id
            assert workflow_run.status == WorkflowExecutionStatus.PAUSED

    def test_test_isolation(self, db_session_with_containers):
        """Test that tests are properly isolated and don't affect each other."""
        # Arrange
        test_state = self._create_test_state()

        # Act
        pause_entity = self.workflow_run_service.save_pause_state(self.test_workflow_run, self.test_user_id, test_state)

        # Assert - Only one pause state should exist for this workflow run
        pause_states = (
            db_session_with_containers.query(WorkflowPauseModel)
            .filter(WorkflowPauseModel.workflow_run_id == self.test_workflow_run_id)
            .all()
        )
        assert len(pause_states) == 1
        assert pause_states[0].id == pause_entity.id

    def test_file_cleanup_on_resume(self, db_session_with_containers):
        """Test that files are properly handled on resume (not deleted for audit)."""
        # Arrange
        test_state = self._create_test_state()
        pause_entity = self.workflow_run_service.save_pause_state(self.test_workflow_run, self.test_user_id, test_state)

        # Get file info before resume
        pause_model = db_session_with_containers.get(WorkflowPauseModel, pause_entity.id)
        if pause_model and pause_model.state_file_id:
            upload_file = db_session_with_containers.get(UploadFile, pause_model.state_file_id)
            file_key = upload_file.key
            file_id = upload_file.id

        # Act - Resume the workflow
        self.workflow_run_service.mark_as_resumed(pause_entity)

        # Assert - File should still exist (files are not deleted on resume)
        # This is the expected behavior - files are kept for audit purposes
        upload_file = db_session_with_containers.get(UploadFile, file_id)
        assert upload_file is not None  # File should still exist

        # File should still be accessible from storage
        try:
            content = storage.load(file_key).decode()
            assert content == test_state
        except Exception:
            pytest.fail("File should still be accessible from storage after resume")


class TestWorkflowRunServiceTestContainersEdgeCases:
    """TestContainers-based integration tests for edge cases and boundary conditions."""

    @pytest.fixture
    def engine(self, db_session_with_containers):
        """Get database engine from TestContainers session."""
        from sqlalchemy import Engine

        bind = db_session_with_containers.get_bind()
        assert isinstance(bind, Engine)
        return bind

    @pytest.fixture
    def file_service(self, engine):
        """Create FileService instance with TestContainers engine."""
        return FileService(engine)

    @pytest.fixture
    def workflow_run_service(self, engine, file_service):
        """Create WorkflowRunService instance with TestContainers engine and FileService."""
        return WorkflowRunService(engine, file_service)

    @pytest.fixture(autouse=True)
    def setup_test_data(self, db_session_with_containers, file_service, workflow_run_service):
        """Set up test data for edge case tests using TestContainers."""
        # Create test tenant and account
        from models.account import Tenant, TenantAccountJoin, TenantAccountRole

        tenant = Tenant(
            name="Test Tenant Edge Cases",
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        account = Account(
            email="edgecase@example.com",
            name="Edge Case User",
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        # Create tenant-account join
        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(tenant_join)
        db_session_with_containers.commit()

        # Set test data
        self.test_tenant_id = tenant.id
        self.test_user_id = account.id
        self.test_app_id = str(uuid.uuid4())
        self.test_workflow_id = str(uuid.uuid4())

        # Create test workflow
        self.test_workflow = Workflow(
            id=self.test_workflow_id,
            tenant_id=self.test_tenant_id,
            app_id=self.test_app_id,
            type="workflow",
            version="draft",
            graph='{"nodes": [], "edges": []}',
            features='{"file_upload": {"enabled": false}}',
            created_by=self.test_user_id,
            created_at=naive_utc_now(),
        )

        # Store session and service instances
        self.session = db_session_with_containers
        self.file_service = file_service
        self.workflow_run_service = workflow_run_service

        self.session.add(self.test_workflow)
        self.session.commit()

        yield

        # Cleanup
        self._cleanup_test_data()

    def _cleanup_test_data(self):
        """Clean up test data after edge case tests."""
        try:
            self.session.execute(
                delete(WorkflowPauseModel).where(
                    WorkflowPauseModel.tenant_id == self.test_tenant_id,
                    WorkflowPauseModel.app_id == self.test_app_id,
                )
            )
            self.session.execute(
                delete(UploadFile).where(
                    UploadFile.tenant_id == self.test_tenant_id,
                )
            )
            self.session.execute(
                delete(WorkflowRun).where(
                    WorkflowRun.tenant_id == self.test_tenant_id,
                    WorkflowRun.app_id == self.test_app_id,
                )
            )
            self.session.execute(
                delete(Workflow).where(
                    Workflow.tenant_id == self.test_tenant_id,
                    Workflow.app_id == self.test_app_id,
                )
            )
            self.session.commit()
        except Exception as e:
            self.session.rollback()
            raise e

    def test_empty_state_handling(self):
        """Test handling of empty state."""
        # Arrange
        empty_state = ""

        # Create a workflow run for this test
        test_workflow_run = WorkflowRun(
            id=str(uuid.uuid4()),
            tenant_id=self.test_tenant_id,
            app_id=self.test_app_id,
            workflow_id=self.test_workflow_id,
            type="workflow",
            triggered_from="debugging",
            version="draft",
            status=WorkflowExecutionStatus.RUNNING,
            created_by=self.test_user_id,
            created_by_role="account",
            created_at=naive_utc_now(),
        )
        self.session.add(test_workflow_run)
        self.session.commit()

        # Act
        pause_entity = self.workflow_run_service.save_pause_state(test_workflow_run, self.test_user_id, empty_state)

        # Assert
        assert pause_entity is not None
        retrieved_entity = self.workflow_run_service.get_pause_state(test_workflow_run.id)
        assert retrieved_entity.get_state() == empty_state

    def test_multiple_pause_resume_cycles(self):
        """Test multiple pause/resume cycles on the same workflow run."""
        # Create a workflow run for this test
        test_workflow_run = WorkflowRun(
            id=str(uuid.uuid4()),
            tenant_id=self.test_tenant_id,
            app_id=self.test_app_id,
            workflow_id=self.test_workflow_id,
            type="workflow",
            triggered_from="debugging",
            version="draft",
            status=WorkflowExecutionStatus.RUNNING,
            created_by=self.test_user_id,
            created_by_role="account",
            created_at=naive_utc_now(),
        )
        self.session.add(test_workflow_run)
        self.session.commit()

        # Act & Assert - Multiple cycles
        for i in range(3):
            state = json.dumps({"cycle": i, "data": f"state_{i}"})

            # Pause
            pause_entity = self.workflow_run_service.save_pause_state(test_workflow_run, self.test_user_id, state)
            assert pause_entity is not None

            # Verify pause
            retrieved_entity = self.workflow_run_service.get_pause_state(test_workflow_run.id)
            assert retrieved_entity.get_state() == state

            # Resume
            self.workflow_run_service.mark_as_resumed(pause_entity)

            # Verify resume - after resume, get_pause_state returns None
            result = self.workflow_run_service.get_pause_state(test_workflow_run.id)
            assert result is None

    def test_resuming_already_resumed_state(self, db_session_with_containers):
        """Test resuming an already resumed pause state."""
        # Create a workflow run for this test
        test_workflow_run = WorkflowRun(
            id=str(uuid.uuid4()),
            tenant_id=self.test_tenant_id,
            app_id=self.test_app_id,
            workflow_id=self.test_workflow_id,
            type="workflow",
            triggered_from="debugging",
            version="draft",
            status=WorkflowExecutionStatus.RUNNING,
            created_by=self.test_user_id,
            created_by_role="account",
            created_at=naive_utc_now(),
        )
        self.session.add(test_workflow_run)
        self.session.commit()

        # Arrange
        state = json.dumps({"test": "data"})
        pause_entity = self.workflow_run_service.save_pause_state(test_workflow_run, self.test_user_id, state)

        # First resume
        self.workflow_run_service.mark_as_resumed(pause_entity)

        # Act - Try to resume again
        with pytest.raises(_InvalidStateTransitionError):
            # Should raise an `_InvalidStateTransitionError` error
            self.workflow_run_service.mark_as_resumed(pause_entity)

    def test_pause_already_paused_workflow(self):
        """Test pausing an already paused workflow."""
        # Create a workflow run for this test
        test_workflow_run = WorkflowRun(
            id=str(uuid.uuid4()),
            tenant_id=self.test_tenant_id,
            app_id=self.test_app_id,
            workflow_id=self.test_workflow_id,
            type="workflow",
            triggered_from="debugging",
            version="draft",
            status=WorkflowExecutionStatus.PAUSED,
            created_by=self.test_user_id,
            created_by_role="account",
            created_at=naive_utc_now(),
        )
        self.session.add(test_workflow_run)
        self.session.commit()

        # Arrange
        state = json.dumps({"test": "data"})

        # First resume

        # Act - Try to resume again
        with pytest.raises(_InvalidStateTransitionError):
            self.workflow_run_service.save_pause_state(test_workflow_run, self.test_user_id, state)
