"""
Unit tests for human input node implementation.
"""

import uuid
from unittest.mock import Mock, patch

import pytest

from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.human_input import HumanInputNode, HumanInputNodeData


class TestHumanInputNode:
    """Test HumanInputNode implementation."""

    @pytest.fixture
    def mock_graph_init_params(self):
        """Create mock graph initialization parameters."""
        mock_params = Mock()
        mock_params.tenant_id = "tenant-123"
        mock_params.app_id = "app-456"
        mock_params.user_id = "user-789"
        mock_params.user_from = "web"
        mock_params.invoke_from = "web_app"
        mock_params.call_depth = 0
        return mock_params

    @pytest.fixture
    def mock_graph(self):
        """Create mock graph."""
        return Mock()

    @pytest.fixture
    def mock_graph_runtime_state(self):
        """Create mock graph runtime state."""
        return Mock()

    @pytest.fixture
    def sample_node_config(self):
        """Create sample node configuration."""
        return {
            "id": "human_input_123",
            "data": {
                "title": "User Confirmation",
                "desc": "Please confirm the action",
                "delivery_methods": [{"type": "webapp", "enabled": True, "config": {}}],
                "form_content": "# Confirmation\n\nPlease confirm: {{#$output.confirmation#}}",
                "inputs": [
                    {
                        "type": "text-input",
                        "output_variable_name": "confirmation",
                        "placeholder": {"type": "constant", "value": "Type 'yes' to confirm"},
                    }
                ],
                "user_actions": [
                    {"id": "confirm", "title": "Confirm", "button_style": "primary"},
                    {"id": "cancel", "title": "Cancel", "button_style": "default"},
                ],
                "timeout": 24,
                "timeout_unit": "hour",
            },
        }

    @pytest.fixture
    def human_input_node(self, sample_node_config, mock_graph_init_params, mock_graph, mock_graph_runtime_state):
        """Create HumanInputNode instance."""
        node = HumanInputNode(
            id="node_123",
            config=sample_node_config,
            graph_init_params=mock_graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )
        return node

    def test_node_initialization(self, human_input_node):
        """Test node initialization."""
        assert human_input_node.node_id == "human_input_123"
        assert human_input_node.tenant_id == "tenant-123"
        assert human_input_node.app_id == "app-456"
        assert isinstance(human_input_node.node_data, HumanInputNodeData)
        assert human_input_node.node_data.title == "User Confirmation"

    def test_node_type_and_version(self, human_input_node):
        """Test node type and version."""
        assert human_input_node.type_.value == "human_input"
        assert human_input_node.version() == "1"

    def test_node_properties(self, human_input_node):
        """Test node properties access."""
        assert human_input_node.title == "User Confirmation"
        assert human_input_node.description == "Please confirm the action"
        assert human_input_node.error_strategy is None
        assert human_input_node.retry_config.retry_enabled is False

    @patch("uuid.uuid4")
    def test_node_run_success(self, mock_uuid, human_input_node):
        """Test successful node execution."""
        # Setup mocks
        mock_form_id = uuid.UUID("12345678-1234-5678-9abc-123456789012")
        mock_token = uuid.UUID("87654321-4321-8765-cba9-876543210987")
        mock_uuid.side_effect = [mock_form_id, mock_token]

        # Execute the node
        result = human_input_node._run()

        # Verify result
        assert result.status == WorkflowNodeExecutionStatus.RUNNING
        assert result.metadata["suspended"] is True
        assert result.metadata["form_id"] == str(mock_form_id)
        assert result.metadata["web_app_form_token"] == str(mock_token).replace("-", "")

        # Verify event data in metadata
        human_input_event = result.metadata["human_input_event"]
        assert human_input_event["form_id"] == str(mock_form_id)
        assert human_input_event["node_id"] == "human_input_123"
        assert human_input_event["form_content"] == "# Confirmation\n\nPlease confirm: {{#$output.confirmation#}}"
        assert len(human_input_event["inputs"]) == 1

        suspended_event = result.metadata["suspended_event"]
        assert suspended_event["suspended_at_node_ids"] == ["human_input_123"]

    def test_node_run_without_webapp_delivery(self, human_input_node):
        """Test node execution without webapp delivery method."""
        # Modify node data to disable webapp delivery
        human_input_node.node_data.delivery_methods[0].enabled = False

        result = human_input_node._run()

        # Should still work, but without web app token
        assert result.status == WorkflowNodeExecutionStatus.RUNNING
        assert result.metadata["web_app_form_token"] is None

    def test_resume_from_human_input_success(self, human_input_node):
        """Test successful resume from human input."""
        form_submission_data = {"inputs": {"confirmation": "yes"}, "action": "confirm"}

        result = human_input_node.resume_from_human_input(form_submission_data)

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["confirmation"] == "yes"
        assert result.outputs["_action"] == "confirm"
        assert result.metadata["form_submitted"] is True
        assert result.metadata["submitted_action"] == "confirm"

    def test_resume_from_human_input_partial_inputs(self, human_input_node):
        """Test resume with partial inputs."""
        form_submission_data = {
            "inputs": {},  # Empty inputs
            "action": "cancel",
        }

        result = human_input_node.resume_from_human_input(form_submission_data)

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "confirmation" not in result.outputs  # Field not provided
        assert result.outputs["_action"] == "cancel"

    def test_resume_from_human_input_missing_data(self, human_input_node):
        """Test resume with missing submission data."""
        form_submission_data = {}  # Missing required fields

        result = human_input_node.resume_from_human_input(form_submission_data)

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["_action"] == ""  # Default empty action

    def test_get_default_config(self):
        """Test getting default configuration."""
        config = HumanInputNode.get_default_config()

        assert config["type"] == "human_input"
        assert "config" in config
        config_data = config["config"]

        assert len(config_data["delivery_methods"]) == 1
        assert config_data["delivery_methods"][0]["type"] == "webapp"
        assert config_data["delivery_methods"][0]["enabled"] is True

        assert config_data["form_content"] == "# Human Input\n\nPlease provide your input:\n\n{{#$output.input#}}"
        assert len(config_data["inputs"]) == 1
        assert config_data["inputs"][0]["output_variable_name"] == "input"

        assert len(config_data["user_actions"]) == 1
        assert config_data["user_actions"][0]["id"] == "submit"

        assert config_data["timeout"] == 24
        assert config_data["timeout_unit"] == "hour"

    def test_process_form_content(self, human_input_node):
        """Test form content processing."""
        # This is a placeholder test since the actual variable substitution
        # logic is marked as TODO in the implementation
        processed_content = human_input_node._process_form_content()

        # For now, should return the raw content
        expected_content = "# Confirmation\n\nPlease confirm: {{#$output.confirmation#}}"
        assert processed_content == expected_content

    def test_extract_variable_selector_mapping(self):
        """Test variable selector extraction."""
        graph_config = {}
        node_data = {
            "form_content": "Hello {{#node_123.output#}}",
            "inputs": [
                {
                    "type": "text-input",
                    "output_variable_name": "test",
                    "placeholder": {"type": "variable", "selector": ["node_456", "var_name"]},
                }
            ],
        }

        # This is a placeholder test since the actual extraction logic
        # is marked as TODO in the implementation
        mapping = HumanInputNode._extract_variable_selector_to_variable_mapping(
            graph_config=graph_config, node_id="test_node", node_data=node_data
        )

        # For now, should return empty dict
        assert mapping == {}


class TestHumanInputNodeValidation:
    """Test validation scenarios for HumanInputNode."""

    def test_node_with_invalid_config(self):
        """Test node creation with invalid configuration."""
        invalid_config = {
            "id": "test_node",
            "data": {
                "title": "Test",
                "delivery_methods": [
                    {
                        "type": "invalid_type",  # Invalid delivery method type
                        "enabled": True,
                        "config": {},
                    }
                ],
            },
        }

        mock_params = Mock()
        mock_params.tenant_id = "tenant-123"
        mock_params.app_id = "app-456"
        mock_params.user_id = "user-789"
        mock_params.user_from = "web"
        mock_params.invoke_from = "web_app"
        mock_params.call_depth = 0

        with pytest.raises(ValueError):
            HumanInputNode(
                id="node_123",
                config=invalid_config,
                graph_init_params=mock_params,
                graph=Mock(),
                graph_runtime_state=Mock(),
            )

    def test_node_with_missing_node_id(self):
        """Test node creation with missing node ID in config."""
        invalid_config = {
            # Missing "id" field
            "data": {"title": "Test"}
        }

        mock_params = Mock()
        mock_params.tenant_id = "tenant-123"
        mock_params.app_id = "app-456"
        mock_params.user_id = "user-789"
        mock_params.user_from = "web"
        mock_params.invoke_from = "web_app"
        mock_params.call_depth = 0

        with pytest.raises(ValueError, match="Node ID is required"):
            HumanInputNode(
                id="node_123",
                config=invalid_config,
                graph_init_params=mock_params,
                graph=Mock(),
                graph_runtime_state=Mock(),
            )
