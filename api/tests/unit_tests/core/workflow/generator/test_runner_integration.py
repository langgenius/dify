from unittest.mock import MagicMock, patch

import pytest

from core.workflow.generator.runner import WorkflowGenerator


@pytest.fixture
def mock_model_instance():
    """Create a mock model instance."""
    mock = MagicMock()
    mock.model_type_instance.model_properties.return_value = {"tool_call": False}
    return mock


@pytest.fixture
def mock_model_manager(mock_model_instance):
    """Mock ModelManager to return our mock instance."""
    with patch("core.workflow.generator.runner.ModelManager") as MockManager:
        instance = MockManager.return_value
        instance.get_model_instance.return_value = mock_model_instance
        yield MockManager


def test_generate_returns_structured_error_on_failure(mock_model_manager, mock_model_instance):
    """Test that failures return structured errors."""
    mock_model_instance.invoke_llm.side_effect = Exception("API Error")

    result = WorkflowGenerator.generate_workflow_flowchart(
        tenant_id="test_tenant",
        instruction="Create a workflow",
        model_config={"provider": "openai", "name": "gpt-4"},
    )

    assert result["intent"] == "error"
    assert "error_code" in result or "error" in result


def test_generate_validates_graph(mock_model_manager, mock_model_instance):
    """Test that graph validation is always performed."""
    # Mock a response with disconnected nodes
    mock_response = MagicMock()
    mock_response.message.content = """
    {
        "intent": "generate",
        "nodes": [
            {"id": "start", "type": "start"},
            {"id": "orphan", "type": "llm"},
            {"id": "end", "type": "end"}
        ],
        "edges": [
            {"source": "start", "target": "end"}
        ]
    }
    """
    mock_model_instance.invoke_llm.return_value = mock_response

    result = WorkflowGenerator.generate_workflow_flowchart(
        tenant_id="test_tenant",
        instruction="Create a workflow",
        model_config={"provider": "openai", "name": "gpt-4"},
    )

    # Should have warnings about orphan node
    assert "warnings" in result
