import dataclasses
import secrets
from unittest import mock
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.variables.types import SegmentType
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.nodes import NodeType
from models.enums import DraftVariableType
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowNodeExecutionModel
from services.workflow_draft_variable_service import (
    DraftVariableSaver,
    VariableResetError,
    WorkflowDraftVariableService,
)


class TestDraftVariableSaver:
    def _get_test_app_id(self):
        suffix = secrets.token_hex(6)
        return f"test_app_id_{suffix}"

    def test__should_variable_be_visible(self):
        mock_session = mock.MagicMock(spec=Session)
        test_app_id = self._get_test_app_id()
        saver = DraftVariableSaver(
            session=mock_session,
            app_id=test_app_id,
            node_id="test_node_id",
            node_type=NodeType.START,
            invoke_from=InvokeFrom.DEBUGGER,
            node_execution_id="test_execution_id",
        )
        assert saver._should_variable_be_visible("123_456", NodeType.IF_ELSE, "output") == False
        assert saver._should_variable_be_visible("123", NodeType.START, "output") == True

    def test__normalize_variable_for_start_node(self):
        @dataclasses.dataclass(frozen=True)
        class TestCase:
            name: str
            input_node_id: str
            input_name: str
            expected_node_id: str
            expected_name: str

        _NODE_ID = "1747228642872"
        cases = [
            TestCase(
                name="name with `sys.` prefix should return the system node_id",
                input_node_id=_NODE_ID,
                input_name="sys.workflow_id",
                expected_node_id=SYSTEM_VARIABLE_NODE_ID,
                expected_name="workflow_id",
            ),
            TestCase(
                name="name without `sys.` prefix should return the original input node_id",
                input_node_id=_NODE_ID,
                input_name="start_input",
                expected_node_id=_NODE_ID,
                expected_name="start_input",
            ),
            TestCase(
                name="dummy_variable should return the original input node_id",
                input_node_id=_NODE_ID,
                input_name="__dummy__",
                expected_node_id=_NODE_ID,
                expected_name="__dummy__",
            ),
        ]

        mock_session = mock.MagicMock(spec=Session)
        test_app_id = self._get_test_app_id()
        saver = DraftVariableSaver(
            session=mock_session,
            app_id=test_app_id,
            node_id=_NODE_ID,
            node_type=NodeType.START,
            invoke_from=InvokeFrom.DEBUGGER,
            node_execution_id="test_execution_id",
        )
        for idx, c in enumerate(cases, 1):
            fail_msg = f"Test case {c.name} failed, index={idx}"
            node_id, name = saver._normalize_variable_for_start_node(c.input_name)
            assert node_id == c.expected_node_id, fail_msg
            assert name == c.expected_name, fail_msg


class TestWorkflowDraftVariableService:
    def _get_test_app_id(self):
        suffix = secrets.token_hex(6)
        return f"test_app_id_{suffix}"

    def test_reset_conversation_variable(self):
        """Test resetting a conversation variable"""
        mock_session = Mock(spec=Session)
        service = WorkflowDraftVariableService(mock_session)
        mock_workflow = Mock(spec=Workflow)
        mock_workflow.app_id = self._get_test_app_id()

        # Create mock variable
        mock_variable = Mock(spec=WorkflowDraftVariable)
        mock_variable.get_variable_type.return_value = DraftVariableType.CONVERSATION
        mock_variable.id = "var-id"
        mock_variable.name = "test_var"

        # Mock the _reset_conv_var method
        expected_result = Mock(spec=WorkflowDraftVariable)
        with patch.object(service, "_reset_conv_var", return_value=expected_result) as mock_reset_conv:
            result = service.reset_variable(mock_workflow, mock_variable)

            mock_reset_conv.assert_called_once_with(mock_workflow, mock_variable)
            assert result == expected_result

    def test_reset_node_variable_with_no_execution_id(self):
        """Test resetting a node variable with no execution ID - should delete variable"""
        mock_session = Mock(spec=Session)
        service = WorkflowDraftVariableService(mock_session)
        mock_workflow = Mock(spec=Workflow)
        mock_workflow.app_id = self._get_test_app_id()

        # Create mock variable with no execution ID
        mock_variable = Mock(spec=WorkflowDraftVariable)
        mock_variable.get_variable_type.return_value = DraftVariableType.NODE
        mock_variable.node_execution_id = None
        mock_variable.id = "var-id"
        mock_variable.name = "test_var"

        result = service._reset_node_var(mock_workflow, mock_variable)

        # Should delete the variable and return None
        mock_session.delete.assert_called_once_with(instance=mock_variable)
        mock_session.flush.assert_called_once()
        assert result is None

    def test_reset_node_variable_with_missing_execution_record(self):
        """Test resetting a node variable when execution record doesn't exist"""
        mock_session = Mock(spec=Session)
        service = WorkflowDraftVariableService(mock_session)
        mock_workflow = Mock(spec=Workflow)
        mock_workflow.app_id = self._get_test_app_id()

        # Create mock variable with execution ID
        mock_variable = Mock(spec=WorkflowDraftVariable)
        mock_variable.get_variable_type.return_value = DraftVariableType.NODE
        mock_variable.node_execution_id = "exec-id"
        mock_variable.id = "var-id"
        mock_variable.name = "test_var"

        # Mock session.scalars to return None (no execution record found)
        mock_scalars = Mock()
        mock_scalars.first.return_value = None
        mock_session.scalars.return_value = mock_scalars

        result = service._reset_node_var(mock_workflow, mock_variable)

        # Should delete the variable and return None
        mock_session.delete.assert_called_once_with(instance=mock_variable)
        mock_session.flush.assert_called_once()
        assert result is None

    def test_reset_node_variable_with_valid_execution_record(self):
        """Test resetting a node variable with valid execution record - should restore from execution"""
        mock_session = Mock(spec=Session)
        service = WorkflowDraftVariableService(mock_session)
        mock_workflow = Mock(spec=Workflow)
        mock_workflow.app_id = self._get_test_app_id()

        # Create mock variable with execution ID
        mock_variable = Mock(spec=WorkflowDraftVariable)
        mock_variable.get_variable_type.return_value = DraftVariableType.NODE
        mock_variable.node_execution_id = "exec-id"
        mock_variable.id = "var-id"
        mock_variable.name = "test_var"
        mock_variable.node_id = "node-id"
        mock_variable.value_type = SegmentType.STRING

        # Create mock execution record
        mock_execution = Mock(spec=WorkflowNodeExecutionModel)
        mock_execution.process_data_dict = {"test_var": "process_value"}
        mock_execution.outputs_dict = {"test_var": "output_value"}

        # Mock session.scalars to return the execution record
        mock_scalars = Mock()
        mock_scalars.first.return_value = mock_execution
        mock_session.scalars.return_value = mock_scalars

        # Mock workflow methods
        mock_node_config = {"type": "test_node"}
        mock_workflow.get_node_config_by_id.return_value = mock_node_config
        mock_workflow.get_node_type_from_node_config.return_value = NodeType.LLM

        result = service._reset_node_var(mock_workflow, mock_variable)

        # Verify variable.set_value was called with the correct value
        mock_variable.set_value.assert_called_once()
        # Verify last_edited_at was reset
        assert mock_variable.last_edited_at is None
        # Verify session.flush was called
        mock_session.flush.assert_called()

        # Should return the updated variable
        assert result == mock_variable

    def test_reset_system_variable_raises_error(self):
        """Test that resetting a system variable raises an error"""
        mock_session = Mock(spec=Session)
        service = WorkflowDraftVariableService(mock_session)
        mock_workflow = Mock(spec=Workflow)
        mock_workflow.app_id = self._get_test_app_id()

        mock_variable = Mock(spec=WorkflowDraftVariable)
        mock_variable.get_variable_type.return_value = DraftVariableType.SYS  # Not a valid enum value for this test
        mock_variable.id = "var-id"

        with pytest.raises(VariableResetError) as exc_info:
            service.reset_variable(mock_workflow, mock_variable)
        assert "cannot reset system variable" in str(exc_info.value)
        assert "variable_id=var-id" in str(exc_info.value)
