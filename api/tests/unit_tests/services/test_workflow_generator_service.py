"""
Unit tests for WorkflowGeneratorService

Tests the service layer that bridges workflow generation and model management.
"""

from unittest.mock import MagicMock, patch

import pytest

from services.workflow_generator_service import WorkflowGeneratorService


class TestWorkflowGeneratorService:
    """Test WorkflowGeneratorService"""

    @patch("services.workflow_generator_service.ModelManager")
    @patch("services.workflow_generator_service.WorkflowGenerator")
    def test_generate_workflow_flowchart_calls_workflow_generator_with_model_instance(
        self, mock_workflow_generator, mock_model_manager_class
    ):
        """
        Test that service correctly:
        1. Creates model instance from ModelManager
        2. Calls WorkflowGenerator with injected model_instance
        """
        # Arrange
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        mock_model_instance = MagicMock()
        mock_model_manager.get_model_instance.return_value = mock_model_instance

        mock_workflow_generator.generate_workflow_flowchart.return_value = {
            "intent": "generate",
            "flowchart": "graph TD",
            "nodes": [],
            "edges": [],
        }

        model_config = {
            "provider": "openai",
            "name": "gpt-4",
            "completion_params": {"temperature": 0.7},
        }

        # Act
        result = WorkflowGeneratorService.generate_workflow_flowchart(
            tenant_id="test-tenant",
            instruction="Create a workflow",
            model_config=model_config,
        )

        # Assert - ModelManager called correctly
        mock_model_manager_class.assert_called_once()
        mock_model_manager.get_model_instance.assert_called_once()

        # Assert - WorkflowGenerator called with model_instance (not config)
        mock_workflow_generator.generate_workflow_flowchart.assert_called_once()
        call_kwargs = mock_workflow_generator.generate_workflow_flowchart.call_args.kwargs

        assert call_kwargs["model_instance"] == mock_model_instance
        assert call_kwargs["model_parameters"] == {"temperature": 0.7}
        assert call_kwargs["instruction"] == "Create a workflow"

        # Assert - Result returned correctly
        assert result["intent"] == "generate"

    @patch("services.workflow_generator_service.ModelManager")
    def test_generate_workflow_flowchart_propagates_model_manager_errors(self, mock_model_manager_class):
        """Test that ModelManager errors are propagated"""
        # Arrange
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager
        mock_model_manager.get_model_instance.side_effect = ValueError("Model not found")

        # Act & Assert
        with pytest.raises(ValueError, match="Model not found"):
            WorkflowGeneratorService.generate_workflow_flowchart(
                tenant_id="test-tenant",
                instruction="Create a workflow",
                model_config={"provider": "invalid", "name": "invalid"},
            )
