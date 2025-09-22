"""Unit tests for workflow node execution conflict handling."""

from unittest.mock import MagicMock, Mock

import psycopg2.errors
import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from core.repositories.sqlalchemy_workflow_node_execution_repository import (
    SQLAlchemyWorkflowNodeExecutionRepository,
)
from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
)
from core.workflow.enums import NodeType
from libs.datetime_utils import naive_utc_now
from models import Account, WorkflowNodeExecutionTriggeredFrom


class TestWorkflowNodeExecutionConflictHandling:
    """Test cases for handling duplicate key conflicts in workflow node execution."""

    def setup_method(self):
        """Set up test fixtures."""
        # Create a mock user with tenant_id
        self.mock_user = Mock(spec=Account)
        self.mock_user.id = "test-user-id"
        self.mock_user.current_tenant_id = "test-tenant-id"

        # Create mock session factory
        self.mock_session_factory = Mock(spec=sessionmaker)

        # Create repository instance
        self.repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=self.mock_session_factory,
            user=self.mock_user,
            app_id="test-app-id",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

    def test_save_with_duplicate_key_retries_with_new_uuid(self):
        """Test that save retries with a new UUID v7 when encountering duplicate key error."""
        # Create a mock session
        mock_session = MagicMock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)
        self.mock_session_factory.return_value = mock_session

        # Mock session.get to return None (no existing record)
        mock_session.get.return_value = None

        # Create IntegrityError for duplicate key with proper psycopg2.errors.UniqueViolation
        mock_unique_violation = Mock(spec=psycopg2.errors.UniqueViolation)
        duplicate_error = IntegrityError(
            "duplicate key value violates unique constraint",
            params=None,
            orig=mock_unique_violation,
        )

        # First call to session.add raises IntegrityError, second succeeds
        mock_session.add.side_effect = [duplicate_error, None]
        mock_session.commit.side_effect = [None, None]

        # Create test execution
        execution = WorkflowNodeExecution(
            id="original-id",
            workflow_id="test-workflow-id",
            workflow_execution_id="test-workflow-execution-id",
            node_execution_id="test-node-execution-id",
            node_id="test-node-id",
            node_type=NodeType.START,
            title="Test Node",
            index=1,
            status=WorkflowNodeExecutionStatus.RUNNING,
            created_at=naive_utc_now(),
        )

        original_id = execution.id

        # Save should succeed after retry
        self.repository.save(execution)

        # Verify that session.add was called twice (initial attempt + retry)
        assert mock_session.add.call_count == 2

        # Verify that the ID was changed (new UUID v7 generated)
        assert execution.id != original_id

    def test_save_with_existing_record_updates_instead_of_insert(self):
        """Test that save updates existing record instead of inserting duplicate."""
        # Create a mock session
        mock_session = MagicMock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)
        self.mock_session_factory.return_value = mock_session

        # Mock existing record
        mock_existing = MagicMock()
        mock_session.get.return_value = mock_existing
        mock_session.commit.return_value = None

        # Create test execution
        execution = WorkflowNodeExecution(
            id="existing-id",
            workflow_id="test-workflow-id",
            workflow_execution_id="test-workflow-execution-id",
            node_execution_id="test-node-execution-id",
            node_id="test-node-id",
            node_type=NodeType.START,
            title="Test Node",
            index=1,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            created_at=naive_utc_now(),
        )

        # Save should update existing record
        self.repository.save(execution)

        # Verify that session.add was not called (update path)
        mock_session.add.assert_not_called()

        # Verify that session.commit was called
        mock_session.commit.assert_called_once()

    def test_save_exceeds_max_retries_raises_error(self):
        """Test that save raises error after exceeding max retries."""
        # Create a mock session
        mock_session = MagicMock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)
        self.mock_session_factory.return_value = mock_session

        # Mock session.get to return None (no existing record)
        mock_session.get.return_value = None

        # Create IntegrityError for duplicate key with proper psycopg2.errors.UniqueViolation
        mock_unique_violation = Mock(spec=psycopg2.errors.UniqueViolation)
        duplicate_error = IntegrityError(
            "duplicate key value violates unique constraint",
            params=None,
            orig=mock_unique_violation,
        )

        # All attempts fail with duplicate error
        mock_session.add.side_effect = duplicate_error

        # Create test execution
        execution = WorkflowNodeExecution(
            id="test-id",
            workflow_id="test-workflow-id",
            workflow_execution_id="test-workflow-execution-id",
            node_execution_id="test-node-execution-id",
            node_id="test-node-id",
            node_type=NodeType.START,
            title="Test Node",
            index=1,
            status=WorkflowNodeExecutionStatus.RUNNING,
            created_at=naive_utc_now(),
        )

        # Save should raise IntegrityError after max retries
        with pytest.raises(IntegrityError):
            self.repository.save(execution)

        # Verify that session.add was called 3 times (max_retries)
        assert mock_session.add.call_count == 3

    def test_save_non_duplicate_integrity_error_raises_immediately(self):
        """Test that non-duplicate IntegrityErrors are raised immediately without retry."""
        # Create a mock session
        mock_session = MagicMock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)
        self.mock_session_factory.return_value = mock_session

        # Mock session.get to return None (no existing record)
        mock_session.get.return_value = None

        # Create IntegrityError for non-duplicate constraint
        other_error = IntegrityError(
            "null value in column violates not-null constraint",
            params=None,
            orig=None,
        )

        # First call raises non-duplicate error
        mock_session.add.side_effect = other_error

        # Create test execution
        execution = WorkflowNodeExecution(
            id="test-id",
            workflow_id="test-workflow-id",
            workflow_execution_id="test-workflow-execution-id",
            node_execution_id="test-node-execution-id",
            node_id="test-node-id",
            node_type=NodeType.START,
            title="Test Node",
            index=1,
            status=WorkflowNodeExecutionStatus.RUNNING,
            created_at=naive_utc_now(),
        )

        # Save should raise error immediately
        with pytest.raises(IntegrityError):
            self.repository.save(execution)

        # Verify that session.add was called only once (no retry)
        assert mock_session.add.call_count == 1
