from unittest.mock import MagicMock

import pytest

from core.workflow.enums import NodeType, WorkflowType
from services.workflow_service import _setup_variable_pool


class TestWorkflowServicePassthrough:
    """Test workflow service passthrough functionality"""

    def test_setup_variable_pool_with_passthrough(self):
        """Test _setup_variable_pool with passthrough parameter"""
        # Mock workflow
        mock_workflow = MagicMock()
        mock_workflow.app_id = "test_app"
        mock_workflow.id = "test_workflow"
        mock_workflow.type = WorkflowType.WORKFLOW
        mock_workflow.environment_variables = []

        # Test with passthrough parameter
        user_inputs = {"query": "test query", "passthrough": "test_passthrough_data"}
        variable_pool = _setup_variable_pool(
            query="test query",
            files=[],
            user_id="test_user",
            user_inputs=user_inputs,
            workflow=mock_workflow,
            node_type=NodeType.START,
            conversation_id="test_conversation",
            conversation_variables=[],
        )

        # Verify passthrough is set correctly
        assert variable_pool.system_variables.passthrough == "test_passthrough_data"

    def test_setup_variable_pool_without_passthrough(self):
        """Test _setup_variable_pool without passthrough parameter"""
        # Mock workflow
        mock_workflow = MagicMock()
        mock_workflow.app_id = "test_app"
        mock_workflow.id = "test_workflow"
        mock_workflow.type = WorkflowType.WORKFLOW
        mock_workflow.environment_variables = []

        # Test without passthrough parameter
        user_inputs = {"query": "test query"}
        variable_pool = _setup_variable_pool(
            query="test query",
            files=[],
            user_id="test_user",
            user_inputs=user_inputs,
            workflow=mock_workflow,
            node_type=NodeType.START,
            conversation_id="test_conversation",
            conversation_variables=[],
        )

        # Verify passthrough is None
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

        # Verify passthrough is None
        assert variable_pool.system_variables.passthrough is None

    def test_setup_variable_pool_with_none_user_inputs(self):
        """Test _setup_variable_pool with None user_inputs - this should be handled gracefully"""
        # Mock workflow
        mock_workflow = MagicMock()
        mock_workflow.app_id = "test_app"
        mock_workflow.id = "test_workflow"
        mock_workflow.type = WorkflowType.WORKFLOW
        mock_workflow.environment_variables = []

        # Test with None user_inputs - this should raise a validation error
        # since user_inputs is expected to be a Mapping[str, Any], not None
        with pytest.raises(ValueError):  # Should raise validation error
            _setup_variable_pool(
                query="test query",
                files=[],
                user_id="test_user",
                user_inputs=None,  # This should cause validation error
                workflow=mock_workflow,
                node_type=NodeType.START,
                conversation_id="test_conversation",
                conversation_variables=[],
            )
