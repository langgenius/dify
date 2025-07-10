import dataclasses
import secrets
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.variables import StringSegment
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.nodes.enums import NodeType
from models.enums import DraftVariableType
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowNodeExecutionModel, is_system_variable_editable
from services.workflow_draft_variable_service import (
    DraftVariableSaver,
    VariableResetError,
    WorkflowDraftVariableService,
)


@pytest.fixture
def mock_engine() -> Engine:
    return Mock(spec=Engine)


@pytest.fixture
def mock_session(mock_engine) -> Session:
    mock_session = Mock(spec=Session)
    mock_session.get_bind.return_value = mock_engine
    return mock_session


class TestDraftVariableSaver:
    def _get_test_app_id(self):
        suffix = secrets.token_hex(6)
        return f"test_app_id_{suffix}"

    def test__should_variable_be_visible(self):
        mock_session = MagicMock(spec=Session)
        test_app_id = self._get_test_app_id()
        saver = DraftVariableSaver(
            session=mock_session,
            app_id=test_app_id,
            node_id="test_node_id",
            node_type=NodeType.START,
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

        mock_session = MagicMock(spec=Session)
        test_app_id = self._get_test_app_id()
        saver = DraftVariableSaver(
            session=mock_session,
            app_id=test_app_id,
            node_id=_NODE_ID,
            node_type=NodeType.START,
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

    def _create_test_workflow(self, app_id: str) -> Workflow:
        """Create a real Workflow instance for testing"""
        return Workflow.new(
            tenant_id="test_tenant_id",
            app_id=app_id,
            type="workflow",
            version="draft",
            graph='{"nodes": [], "edges": []}',
            features="{}",
            created_by="test_user_id",
            environment_variables=[],
            conversation_variables=[],
        )

    def test_reset_conversation_variable(self, mock_session):
        """Test resetting a conversation variable"""
        service = WorkflowDraftVariableService(mock_session)

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create real conversation variable
        test_value = StringSegment(value="test_value")
        variable = WorkflowDraftVariable.new_conversation_variable(
            app_id=test_app_id, name="test_var", value=test_value, description="Test conversation variable"
        )

        # Mock the _reset_conv_var method
        expected_result = WorkflowDraftVariable.new_conversation_variable(
            app_id=test_app_id,
            name="test_var",
            value=StringSegment(value="reset_value"),
        )
        with patch.object(service, "_reset_conv_var", return_value=expected_result) as mock_reset_conv:
            result = service.reset_variable(workflow, variable)

            mock_reset_conv.assert_called_once_with(workflow, variable)
            assert result == expected_result

    def test_reset_node_variable_with_no_execution_id(self, mock_session):
        """Test resetting a node variable with no execution ID - should delete variable"""
        service = WorkflowDraftVariableService(mock_session)

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create real node variable with no execution ID
        test_value = StringSegment(value="test_value")
        variable = WorkflowDraftVariable.new_node_variable(
            app_id=test_app_id,
            node_id="test_node_id",
            name="test_var",
            value=test_value,
            node_execution_id="exec-id",  # Set initially
        )
        # Manually set to None to simulate the test condition
        variable.node_execution_id = None

        result = service._reset_node_var_or_sys_var(workflow, variable)

        # Should delete the variable and return None
        mock_session.delete.assert_called_once_with(instance=variable)
        mock_session.flush.assert_called_once()
        assert result is None

    def test_reset_node_variable_with_missing_execution_record(
        self,
        mock_engine,
        mock_session,
        monkeypatch,
    ):
        """Test resetting a node variable when execution record doesn't exist"""
        mock_repo_session = Mock(spec=Session)

        mock_session_maker = MagicMock()
        # Mock the context manager protocol for sessionmaker
        mock_session_maker.return_value.__enter__.return_value = mock_repo_session
        mock_session_maker.return_value.__exit__.return_value = None
        monkeypatch.setattr("services.workflow_draft_variable_service.sessionmaker", mock_session_maker)
        service = WorkflowDraftVariableService(mock_session)

        # Mock the repository to return None (no execution record found)
        service._api_node_execution_repo = Mock()
        service._api_node_execution_repo.get_execution_by_id.return_value = None

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create real node variable with execution ID
        test_value = StringSegment(value="test_value")
        variable = WorkflowDraftVariable.new_node_variable(
            app_id=test_app_id, node_id="test_node_id", name="test_var", value=test_value, node_execution_id="exec-id"
        )
        # Variable is editable by default from factory method

        result = service._reset_node_var_or_sys_var(workflow, variable)

        mock_session_maker.assert_called_once_with(bind=mock_engine, expire_on_commit=False)
        # Should delete the variable and return None
        mock_session.delete.assert_called_once_with(instance=variable)
        mock_session.flush.assert_called_once()
        assert result is None

    def test_reset_node_variable_with_valid_execution_record(
        self,
        mock_session,
        monkeypatch,
    ):
        """Test resetting a node variable with valid execution record - should restore from execution"""
        mock_repo_session = Mock(spec=Session)

        mock_session_maker = MagicMock()
        # Mock the context manager protocol for sessionmaker
        mock_session_maker.return_value.__enter__.return_value = mock_repo_session
        mock_session_maker.return_value.__exit__.return_value = None
        mock_session_maker = monkeypatch.setattr(
            "services.workflow_draft_variable_service.sessionmaker", mock_session_maker
        )
        service = WorkflowDraftVariableService(mock_session)

        # Create mock execution record
        mock_execution = Mock(spec=WorkflowNodeExecutionModel)
        mock_execution.outputs_dict = {"test_var": "output_value"}

        # Mock the repository to return the execution record
        service._api_node_execution_repo = Mock()
        service._api_node_execution_repo.get_execution_by_id.return_value = mock_execution

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create real node variable with execution ID
        test_value = StringSegment(value="original_value")
        variable = WorkflowDraftVariable.new_node_variable(
            app_id=test_app_id, node_id="test_node_id", name="test_var", value=test_value, node_execution_id="exec-id"
        )
        # Variable is editable by default from factory method

        # Mock workflow methods
        mock_node_config = {"type": "test_node"}
        with (
            patch.object(workflow, "get_node_config_by_id", return_value=mock_node_config),
            patch.object(workflow, "get_node_type_from_node_config", return_value=NodeType.LLM),
        ):
            result = service._reset_node_var_or_sys_var(workflow, variable)

            # Verify last_edited_at was reset
            assert variable.last_edited_at is None
            # Verify session.flush was called
            mock_session.flush.assert_called()

            # Should return the updated variable
            assert result == variable

    def test_reset_non_editable_system_variable_raises_error(self, mock_session):
        """Test that resetting a non-editable system variable raises an error"""
        service = WorkflowDraftVariableService(mock_session)

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create a non-editable system variable (workflow_id is not editable)
        test_value = StringSegment(value="test_workflow_id")
        variable = WorkflowDraftVariable.new_sys_variable(
            app_id=test_app_id,
            name="workflow_id",  # This is not in _EDITABLE_SYSTEM_VARIABLE
            value=test_value,
            node_execution_id="exec-id",
            editable=False,  # Non-editable system variable
        )

        with pytest.raises(VariableResetError) as exc_info:
            service.reset_variable(workflow, variable)
        assert "cannot reset system variable" in str(exc_info.value)
        assert f"variable_id={variable.id}" in str(exc_info.value)

    def test_reset_editable_system_variable_succeeds(self, mock_session):
        """Test that resetting an editable system variable succeeds"""
        service = WorkflowDraftVariableService(mock_session)

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create an editable system variable (files is editable)
        test_value = StringSegment(value="[]")
        variable = WorkflowDraftVariable.new_sys_variable(
            app_id=test_app_id,
            name="files",  # This is in _EDITABLE_SYSTEM_VARIABLE
            value=test_value,
            node_execution_id="exec-id",
            editable=True,  # Editable system variable
        )

        # Create mock execution record
        mock_execution = Mock(spec=WorkflowNodeExecutionModel)
        mock_execution.outputs_dict = {"sys.files": "[]"}

        # Mock the repository to return the execution record
        service._api_node_execution_repo = Mock()
        service._api_node_execution_repo.get_execution_by_id.return_value = mock_execution

        result = service._reset_node_var_or_sys_var(workflow, variable)

        # Should succeed and return the variable
        assert result == variable
        assert variable.last_edited_at is None
        mock_session.flush.assert_called()

    def test_reset_query_system_variable_succeeds(self, mock_session):
        """Test that resetting query system variable (another editable one) succeeds"""
        service = WorkflowDraftVariableService(mock_session)

        test_app_id = self._get_test_app_id()
        workflow = self._create_test_workflow(test_app_id)

        # Create an editable system variable (query is editable)
        test_value = StringSegment(value="original query")
        variable = WorkflowDraftVariable.new_sys_variable(
            app_id=test_app_id,
            name="query",  # This is in _EDITABLE_SYSTEM_VARIABLE
            value=test_value,
            node_execution_id="exec-id",
            editable=True,  # Editable system variable
        )

        # Create mock execution record
        mock_execution = Mock(spec=WorkflowNodeExecutionModel)
        mock_execution.outputs_dict = {"sys.query": "reset query"}

        # Mock the repository to return the execution record
        service._api_node_execution_repo = Mock()
        service._api_node_execution_repo.get_execution_by_id.return_value = mock_execution

        result = service._reset_node_var_or_sys_var(workflow, variable)

        # Should succeed and return the variable
        assert result == variable
        assert variable.last_edited_at is None
        mock_session.flush.assert_called()

    def test_system_variable_editability_check(self):
        """Test the system variable editability function directly"""
        # Test editable system variables
        assert is_system_variable_editable("files") == True
        assert is_system_variable_editable("query") == True

        # Test non-editable system variables
        assert is_system_variable_editable("workflow_id") == False
        assert is_system_variable_editable("conversation_id") == False
        assert is_system_variable_editable("user_id") == False

    def test_workflow_draft_variable_factory_methods(self):
        """Test that factory methods create proper instances"""
        test_app_id = self._get_test_app_id()
        test_value = StringSegment(value="test_value")

        # Test conversation variable factory
        conv_var = WorkflowDraftVariable.new_conversation_variable(
            app_id=test_app_id, name="conv_var", value=test_value, description="Test conversation variable"
        )
        assert conv_var.get_variable_type() == DraftVariableType.CONVERSATION
        assert conv_var.editable == True
        assert conv_var.node_execution_id is None

        # Test system variable factory
        sys_var = WorkflowDraftVariable.new_sys_variable(
            app_id=test_app_id, name="workflow_id", value=test_value, node_execution_id="exec-id", editable=False
        )
        assert sys_var.get_variable_type() == DraftVariableType.SYS
        assert sys_var.editable == False
        assert sys_var.node_execution_id == "exec-id"

        # Test node variable factory
        node_var = WorkflowDraftVariable.new_node_variable(
            app_id=test_app_id,
            node_id="node-id",
            name="node_var",
            value=test_value,
            node_execution_id="exec-id",
            visible=True,
            editable=True,
        )
        assert node_var.get_variable_type() == DraftVariableType.NODE
        assert node_var.visible == True
        assert node_var.editable == True
        assert node_var.node_execution_id == "exec-id"
