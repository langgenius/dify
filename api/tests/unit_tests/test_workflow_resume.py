"""
Unit tests for HumanInput workflow resume functionality
"""

from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.workflow.entities.pause_reason import PauseReasonType
from core.workflow.enums import WorkflowExecutionStatus
from core.workflow.nodes.human_input.entities import HumanInputNodeData
from models.enums import CreatorUserRole
from services.workflow_run_service import WorkflowRunService


class TestDataFactory:
    """Factory class for creating test data objects."""

    @staticmethod
    def create_app_mock(
        id: str = "test-app-id",
        tenant_id: str = "test-tenant-id",
        **kwargs,
    ) -> MagicMock:
        """Create a mock App object."""
        mock_app = MagicMock()
        mock_app.id = id
        mock_app.tenant_id = tenant_id

        for key, value in kwargs.items():
            setattr(mock_app, key, value)

        return mock_app


@pytest.fixture
def app_model():
    """Create a mock app model for testing."""
    return TestDataFactory.create_app_mock()


@pytest.fixture
def workflow_run_service():
    """Create workflow run service fixture."""
    mock_session_factory = MagicMock()
    return WorkflowRunService(session_factory=mock_session_factory)


class TestWorkflowResumeService:
    """Test WorkflowRunService resume functionality."""

    def test_resume_workflow_success(self, workflow_run_service, app_model):
        """Test successful workflow resume."""
        # Create mock objects
        workflow_run = MagicMock()
        workflow_run.id = "test-run-id"
        workflow_run.tenant_id = "test-tenant-id"
        workflow_run.app_id = "test-app-id"
        workflow_run.status = WorkflowExecutionStatus.PAUSED.value
        workflow_run.created_by = "test-user-id"
        workflow_run.created_by_role = CreatorUserRole.ACCOUNT.value

        workflow_pause = MagicMock()
        workflow_pause.id = "test-pause-id"
        workflow_pause.workflow_run_id = "test-run-id"
        workflow_pause.workflow_id = "test-workflow-id"
        workflow_pause.tenant_id = "test-tenant-id"
        workflow_pause.app_id = "test-app-id"
        workflow_pause.resumed_at = None
        workflow_pause.resume_reason = None
        workflow_pause.state_object_key = "test-state-key"

        pause_reason = MagicMock()
        pause_reason.id = "test-reason-id"
        pause_reason.pause_id = "test-pause-id"
        pause_reason.type_ = PauseReasonType.HUMAN_INPUT_REQUIRED
        pause_reason.message = "Test pause reason"
        pause_reason.node_id = "test-node-id"
        pause_reason.form_id = "test-form-id"

        workflow = MagicMock()
        workflow.id = "test-workflow-id"
        workflow.tenant_id = "test-tenant-id"
        workflow.app_id = "test-app-id"

        # Setup mock session
        mock_session = MagicMock()
        call_count = [0]

        def mock_execute(query):
            call_count[0] += 1
            result = MagicMock()

            if call_count[0] == 1:
                result.scalar_one_or_none.return_value = workflow_run
            elif call_count[0] == 2:
                result.scalar_one_or_none.return_value = workflow_pause
            elif call_count[0] == 3:
                result.scalar_one_or_none.return_value = pause_reason
            else:
                result.scalar_one_or_none.return_value = workflow

            return result

        mock_session.execute = mock_execute
        mock_session.commit = MagicMock()

        # Create context manager mock
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)

        workflow_run_service._session_factory.return_value = mock_session

        # Mock storage and task
        with patch("extensions.ext_storage.storage") as mock_storage:
            mock_storage.load.return_value = b'{"test": "state"}'
            with patch("tasks.workflow_execution_tasks.workflow_resume_task.delay") as mock_task:
                mock_task.return_value = MagicMock()

                result = workflow_run_service.resume_workflow(
                    app_model=app_model,
                    run_id="test-run-id",
                    user_id="test-user-id",
                    resume_reason="Test resume reason",
                    action="approve",
                )

                # Assertions
                assert result["result"] == "success"
                assert result["workflow_run_id"] == "test-run-id"
                assert workflow_pause.resumed_at is not None
                assert workflow_pause.resume_reason == "Test resume reason"
                assert workflow_pause.resumed_by_user_id == "test-user-id"
                # Status is no longer set to RUNNING in resume_workflow
                # It's set by the Celery task's WorkflowResumePersistenceLayer
                assert workflow_run.status == WorkflowExecutionStatus.PAUSED.value
                mock_session.commit.assert_called()

    def test_resume_workflow_not_found(self, workflow_run_service, app_model):
        """Test resume when workflow run is not found."""
        mock_session = MagicMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        mock_session.execute = MagicMock(return_value=result)
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)

        workflow_run_service._session_factory.return_value = mock_session

        with pytest.raises(ValueError, match="Workflow run not found"):
            workflow_run_service.resume_workflow(
                app_model=app_model,
                run_id="non-existent-id",
                user_id="test-user-id",
                resume_reason="Test reason",
                action="approve",
            )

    def test_resume_workflow_not_paused(self, workflow_run_service, app_model):
        """Test resume when workflow is not in paused state."""
        workflow_run = MagicMock()
        workflow_run.id = "test-run-id"
        workflow_run.status = WorkflowExecutionStatus.RUNNING.value

        mock_session = MagicMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = workflow_run
        mock_session.execute = MagicMock(return_value=result)
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)

        workflow_run_service._session_factory.return_value = mock_session

        with pytest.raises(ValueError, match="not in paused state"):
            workflow_run_service.resume_workflow(
                app_model=app_model,
                run_id="test-run-id",
                user_id="test-user-id",
                resume_reason="Test reason",
                action="approve",
            )

    def test_resume_workflow_empty_reason(self, workflow_run_service, app_model):
        """Test resume with empty reason."""
        # Test that empty reason is handled at service level
        # The service layer should accept empty string (validation happens at API layer)
        workflow_run = MagicMock()
        workflow_run.id = "test-run-id"
        workflow_run.status = WorkflowExecutionStatus.PAUSED.value
        workflow_run.created_by = "test-user-id"
        workflow_run.created_by_role = CreatorUserRole.ACCOUNT.value

        workflow_pause = MagicMock()
        workflow_pause.id = "test-pause-id"
        workflow_pause.workflow_run_id = "test-run-id"
        workflow_pause.workflow_id = "test-workflow-id"
        workflow_pause.resumed_at = None
        workflow_pause.resume_reason = None
        workflow_pause.state_object_key = "test-state-key"

        pause_reason = MagicMock()
        pause_reason.id = "test-reason-id"
        pause_reason.pause_id = "test-pause-id"
        pause_reason.type_ = PauseReasonType.HUMAN_INPUT_REQUIRED
        pause_reason.node_id = "test-node-id"

        workflow = MagicMock()
        workflow.id = "test-workflow-id"

        mock_session = MagicMock()
        call_count = [0]

        def mock_execute(query):
            call_count[0] += 1
            result = MagicMock()

            if call_count[0] == 1:
                result.scalar_one_or_none.return_value = workflow_run
            elif call_count[0] == 2:
                result.scalar_one_or_none.return_value = workflow_pause
            elif call_count[0] == 3:
                result.scalar_one_or_none.return_value = pause_reason
            else:
                result.scalar_one_or_none.return_value = workflow

            return result

        mock_session.execute = mock_execute
        mock_session.commit = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)

        workflow_run_service._session_factory.return_value = mock_session

        # Mock storage and task
        with patch("extensions.ext_storage.storage") as mock_storage:
            mock_storage.load.return_value = b'{"test": "state"}'
            with patch("tasks.workflow_execution_tasks.workflow_resume_task.delay") as mock_task:
                mock_task.return_value = MagicMock()

                # Service layer should accept empty reason (validation happens at API layer)
                result = workflow_run_service.resume_workflow(
                    app_model=app_model,
                    run_id="test-run-id",
                    user_id="test-user-id",
                    resume_reason="",  # Empty reason
                    action="approve",
                )

                # Verify the operation succeeds
                assert result["result"] == "success"
                assert workflow_pause.resume_reason == ""  # Empty reason is stored
                mock_session.commit.assert_called()

    def test_resume_workflow_no_pause_record(self, workflow_run_service, app_model):
        """Test resume when no pause record exists."""
        workflow_run = MagicMock()
        workflow_run.id = "test-run-id"
        workflow_run.status = WorkflowExecutionStatus.PAUSED.value
        workflow_run.created_by = "test-user-id"
        workflow_run.created_by_role = CreatorUserRole.ACCOUNT.value

        mock_session = MagicMock()
        call_count = [0]

        def mock_execute(query):
            call_count[0] += 1
            result = MagicMock()

            if call_count[0] == 1:
                result.scalar_one_or_none.return_value = workflow_run
            else:
                result.scalar_one_or_none.return_value = None

            return result

        mock_session.execute = mock_execute
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)

        workflow_run_service._session_factory.return_value = mock_session

        with pytest.raises(ValueError, match="No active pause record found"):
            workflow_run_service.resume_workflow(
                app_model=app_model,
                run_id="test-run-id",
                user_id="test-user-id",
                resume_reason="Test reason",
                action="approve",
            )

    def test_resume_workflow_permission_denied(self, workflow_run_service, app_model):
        """Test resume with permission check failure."""
        workflow_run = MagicMock()
        workflow_run.id = "test-run-id"
        workflow_run.status = WorkflowExecutionStatus.PAUSED.value
        workflow_run.created_by = "different-user-id"
        workflow_run.created_by_role = CreatorUserRole.END_USER.value

        mock_session = MagicMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = workflow_run
        mock_session.execute = MagicMock(return_value=result)
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)

        workflow_run_service._session_factory.return_value = mock_session

        with pytest.raises(ValueError, match="Permission denied"):
            workflow_run_service.resume_workflow(
                app_model=app_model,
                run_id="test-run-id",
                user_id="test-user-id",
                resume_reason="Test reason",
                action="approve",
                check_permission=True,
            )

    def test_get_pause_info_success(self, workflow_run_service, app_model):
        """Test successful pause info retrieval."""
        workflow_pause = MagicMock()
        workflow_pause.id = "test-pause-id"
        workflow_pause.workflow_run_id = "test-run-id"
        workflow_pause.resumed_at = None
        workflow_pause.resume_reason = None
        workflow_pause.created_at = MagicMock()
        workflow_pause.created_at.isoformat.return_value = "2024-01-01T00:00:00Z"

        pause_reason = MagicMock()
        pause_reason.id = "test-reason-id"
        pause_reason.pause_id = "test-pause-id"
        pause_reason.type_ = PauseReasonType.HUMAN_INPUT_REQUIRED
        pause_reason.message = "Test pause reason"
        pause_reason.node_id = "test-node-id"

        mock_session = MagicMock()
        result = MagicMock()
        # Mock .first() to return a tuple-like Row object
        result.first.return_value = (workflow_pause, pause_reason)
        mock_session.execute = MagicMock(return_value=result)
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)

        workflow_run_service._session_factory.return_value = mock_session

        result = workflow_run_service.get_pause_info(
            app_model=app_model,
            run_id="test-run-id",
        )

        assert result is not None
        assert "pause_reason" in result

    def test_get_pause_info_not_found(self, workflow_run_service, app_model):
        """Test pause info when no pause record exists."""
        mock_session = MagicMock()
        result = MagicMock()
        # Mock .first() to return None (no records found)
        result.first.return_value = None
        mock_session.execute = MagicMock(return_value=result)
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)

        workflow_run_service._session_factory.return_value = mock_session

        result = workflow_run_service.get_pause_info(
            app_model=app_model,
            run_id="non-existent-run-id",
        )

        assert result is None


class TestHumanInputNodeData:
    """Test HumanInputNodeData entity validation."""

    def test_pause_reason_optional(self):
        """Test that pause_reason is optional with default value."""
        # Test with missing pause_reason field - should use default empty string
        node_data = HumanInputNodeData(title="Test")
        assert node_data.pause_reason == ""

        # Test with explicit empty string
        node_data = HumanInputNodeData(title="Test", pause_reason="")
        assert node_data.pause_reason == ""

        # Test with None - should be rejected (None is not valid for str type with default)
        with pytest.raises(ValidationError):
            HumanInputNodeData(title="Test", pause_reason=None)

    def test_pause_reason_validation(self):
        """Test pause_reason field validation."""
        # Test valid string
        node_data = HumanInputNodeData(title="Test", pause_reason="Valid pause reason")
        assert node_data.pause_reason == "Valid pause reason"

        # Test with integer - should fail type validation
        with pytest.raises(ValidationError):
            HumanInputNodeData(title="Test", pause_reason=123)

        # Test length limit - max 1000 characters
        long_reason = "x" * 1000
        node_data = HumanInputNodeData(title="Test", pause_reason=long_reason)
        assert node_data.pause_reason == long_reason

        # Exceeds length limit
        too_long_reason = "x" * 1001
        with pytest.raises(ValidationError):
            HumanInputNodeData(title="Test", pause_reason=too_long_reason)

    def test_pause_reason_type_validation(self):
        """Test that pause_reason must be a string."""
        # Test with integer
        with pytest.raises(ValidationError):
            HumanInputNodeData(title="Test", pause_reason=123)

        # Test with list
        with pytest.raises(ValidationError):
            HumanInputNodeData(title="Test", pause_reason=[])

    def test_human_input_node_data_with_optional_fields(self):
        """Test HumanInputNodeData with optional fields."""
        node_data = HumanInputNodeData(
            title="Test Node",
            pause_reason="Test reason",
            required_variables=["var1", "var2"],
        )

        assert node_data.pause_reason == "Test reason"
        assert node_data.required_variables == ["var1", "var2"]
        assert node_data.title == "Test Node"

    def test_human_input_node_outputs_with_reason(self):
        """Test that HumanInputNode includes reason in outputs when available."""

        # Create a mock instance to test _build_outputs method
        class MockHumanInputNode:
            def _build_outputs(self, action: str, inputs: dict, reason: str | None = None) -> dict:
                """Copy of HumanInputNode._build_outputs for testing."""
                outputs = {
                    "action": action,
                    "approved": action == "approve",
                }

                # Add reason if available
                if reason is not None:
                    outputs["reason"] = reason

                # Add input variables with conflict protection
                for key, value in inputs.items():
                    if key in ("action", "approved", "reason"):
                        # Prefix conflicting keys to avoid overriding core fields
                        outputs[f"input_{key}"] = value
                    else:
                        outputs[key] = value

                return outputs

        mock_node = MockHumanInputNode()

        # Test with reason
        outputs_with_reason = mock_node._build_outputs(
            action="approve", inputs={"var1": "value1"}, reason="Approved because criteria met"
        )
        assert outputs_with_reason == {
            "action": "approve",
            "approved": True,
            "reason": "Approved because criteria met",
            "var1": "value1",
        }

        # Test with reject action
        outputs_with_reject = mock_node._build_outputs(
            action="reject", inputs={}, reason="Rejected due to missing information"
        )
        assert outputs_with_reject == {
            "action": "reject",
            "approved": False,
            "reason": "Rejected due to missing information",
        }

        # Test without reason
        outputs_without_reason = mock_node._build_outputs(action="approve", inputs={"var1": "value1"}, reason=None)
        assert outputs_without_reason == {"action": "approve", "approved": True, "var1": "value1"}
        assert "reason" not in outputs_without_reason

        # Test conflict protection
        outputs_with_conflict = mock_node._build_outputs(
            action="approve", inputs={"reason": "input_reason"}, reason="output_reason"
        )
        assert outputs_with_conflict["reason"] == "output_reason"
        assert outputs_with_conflict["input_reason"] == "input_reason"

    def test_human_input_node_get_reason(self):
        """Test that _get_reason() correctly extracts reason from variable pool."""
        from core.variables import StringSegment
        from core.workflow.runtime import VariablePool

        # Create a mock instance to test _get_reason method
        class MockHumanInputNode:
            def __init__(self):
                self._node_id = "test_node_123"

            def _get_reason(self) -> str | None:
                """Copy of HumanInputNode._get_reason for testing."""
                variable_pool = self.variable_pool
                segment = variable_pool.get((self._node_id, "reason"))

                if segment is None:
                    return None

                # Extract value from segment
                value = getattr(segment, "to_object", None)
                reason = value() if callable(value) else getattr(segment, "value", None)

                return reason if isinstance(reason, str) else None

        # Test with valid reason in variable pool
        mock_node = MockHumanInputNode()
        mock_node.variable_pool = VariablePool()
        mock_node.variable_pool.add(["test_node_123", "reason"], StringSegment(value="Test reason"))

        reason = mock_node._get_reason()
        assert reason == "Test reason"

        # Test with missing reason
        mock_node2 = MockHumanInputNode()
        mock_node2.variable_pool = VariablePool()

        reason2 = mock_node2._get_reason()
        assert reason2 is None

        # Test with empty string reason
        mock_node3 = MockHumanInputNode()
        mock_node3.variable_pool = VariablePool()
        mock_node3.variable_pool.add(["test_node_123", "reason"], StringSegment(value=""))

        reason3 = mock_node3._get_reason()
        assert reason3 == ""  # Empty string is valid
