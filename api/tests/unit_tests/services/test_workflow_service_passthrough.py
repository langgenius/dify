"""
Unit tests for workflow service passthrough functionality
"""

from unittest.mock import MagicMock

from core.services.workflow_service import _setup_variable_pool

from core.workflow.enums import NodeType, WorkflowType


class TestWorkflowServicePassthrough:
    """Test workflow service passthrough functionality"""

    def test_setup_variable_pool_with_passthrough(self):
        """Test _setup_variable_pool with passthrough in user_inputs"""
        # Mock workflow
        mock_workflow = MagicMock()
        mock_workflow.app_id = "test_app"
        mock_workflow.id = "test_workflow"
        mock_workflow.type = WorkflowType.WORKFLOW
        mock_workflow.environment_variables = []

        # Test with passthrough in user_inputs
        user_inputs_with_passthrough = {"query": "test query", "passthrough": "test_passthrough_data"}

        variable_pool = _setup_variable_pool(
            query="test query",
            files=[],
            user_id="test_user",
            user_inputs=user_inputs_with_passthrough,
            workflow=mock_workflow,
            node_type=NodeType.START,
            conversation_id="test_conversation",
            conversation_variables=[],
        )

        # Verify passthrough was extracted
        assert variable_pool.system_variables.passthrough == "test_passthrough_data"

    def test_setup_variable_pool_without_passthrough(self):
        """Test _setup_variable_pool without passthrough in user_inputs"""
        # Mock workflow
        mock_workflow = MagicMock()
        mock_workflow.app_id = "test_app"
        mock_workflow.id = "test_workflow"
        mock_workflow.type = WorkflowType.WORKFLOW
        mock_workflow.environment_variables = []

        # Test without passthrough in user_inputs
        user_inputs_without_passthrough = {"query": "test query"}

        variable_pool = _setup_variable_pool(
            query="test query",
            files=[],
            user_id="test_user",
            user_inputs=user_inputs_without_passthrough,
            workflow=mock_workflow,
            node_type=NodeType.START,
            conversation_id="test_conversation",
            conversation_variables=[],
        )

        # Verify passthrough was None
        assert variable_pool.system_variables.passthrough is None

    def test_setup_variable_pool_with_empty_user_inputs(self):
        """Test _setup_variable_pool with empty user_inputs"""
        # Mock workflow
        mock_workflow = MagicMock()
        mock_workflow.app_id = "test_app"
        mock_workflow.id = "test_workflow"
        mock_workflow.type = WorkflowType.WORKFLOW
        mock_workflow.environment_variables = []

        # Test with empty user_inputs
        variable_pool = _setup_variable_pool(
            query="test query",
            files=[],
            user_id="test_user",
            user_inputs={},
            workflow=mock_workflow,
            node_type=NodeType.START,
            conversation_id="test_conversation",
            conversation_variables=[],
        )

        # Verify passthrough was None
        assert variable_pool.system_variables.passthrough is None

    def test_setup_variable_pool_with_none_user_inputs(self):
        """Test _setup_variable_pool with None user_inputs"""
        # Mock workflow
        mock_workflow = MagicMock()
        mock_workflow.app_id = "test_app"
        mock_workflow.id = "test_workflow"
        mock_workflow.type = WorkflowType.WORKFLOW
        mock_workflow.environment_variables = []

        # Test with None user_inputs
        variable_pool = _setup_variable_pool(
            query="test query",
            files=[],
            user_id="test_user",
            user_inputs=None,
            workflow=mock_workflow,
            node_type=NodeType.START,
            conversation_id="test_conversation",
            conversation_variables=[],
        )

        # Verify passthrough was None
        assert variable_pool.system_variables.passthrough is None

    def test_setup_variable_pool_non_start_node(self):
        """Test _setup_variable_pool with non-START node type"""
        # Mock workflow
        mock_workflow = MagicMock()
        mock_workflow.app_id = "test_app"
        mock_workflow.id = "test_workflow"
        mock_workflow.type = WorkflowType.WORKFLOW
        mock_workflow.environment_variables = []

        # Test with non-START node type
        user_inputs_with_passthrough = {"query": "test query", "passthrough": "test_passthrough_data"}

        variable_pool = _setup_variable_pool(
            query="test query",
            files=[],
            user_id="test_user",
            user_inputs=user_inputs_with_passthrough,
            workflow=mock_workflow,
            node_type=NodeType.LLM,  # Non-START node
            conversation_id="test_conversation",
            conversation_variables=[],
        )

        # Verify passthrough was None (non-START nodes don't extract passthrough)
        assert variable_pool.system_variables.passthrough is None
