import pytest
from pytest_mock import MockerFixture

from core.app.app_config.workflow_ui_based_app.variables.manager import (
    WorkflowVariablesConfigManager,
)

# =============================
# Fixtures
# =============================


@pytest.fixture
def mock_workflow(mocker: MockerFixture):
    workflow = mocker.MagicMock()
    workflow.graph_dict = {"nodes": []}
    return workflow


@pytest.fixture
def mock_variable_entity(mocker: MockerFixture):
    return mocker.patch("core.app.app_config.workflow_ui_based_app.variables.manager.VariableEntity")


@pytest.fixture
def mock_rag_entity(mocker: MockerFixture):
    return mocker.patch("core.app.app_config.workflow_ui_based_app.variables.manager.RagPipelineVariableEntity")


# =============================
# Test Convert (user_input_form)
# =============================


class TestWorkflowVariablesConfigManagerConvert:
    def test_convert_success_multiple_variables(self, mock_workflow, mock_variable_entity):
        # Arrange
        input_variables = [{"name": "var1"}, {"name": "var2"}]
        mock_workflow.user_input_form.return_value = input_variables
        mock_variable_entity.model_validate.side_effect = lambda x: {"validated": x}

        # Act
        result = WorkflowVariablesConfigManager.convert(mock_workflow)

        # Assert
        assert result == [{"validated": v} for v in input_variables]
        assert mock_variable_entity.model_validate.call_count == 2

    def test_convert_empty_list(self, mock_workflow, mock_variable_entity):
        # Arrange
        mock_workflow.user_input_form.return_value = []

        # Act
        result = WorkflowVariablesConfigManager.convert(mock_workflow)

        # Assert
        assert result == []
        mock_variable_entity.model_validate.assert_not_called()

    def test_convert_none_returned_raises(self, mock_workflow):
        # Arrange
        mock_workflow.user_input_form.return_value = None

        # Act & Assert
        with pytest.raises(TypeError):
            WorkflowVariablesConfigManager.convert(mock_workflow)

    def test_convert_validation_error_propagates(self, mock_workflow, mock_variable_entity):
        # Arrange
        mock_workflow.user_input_form.return_value = [{"invalid": "data"}]
        mock_variable_entity.model_validate.side_effect = ValueError("validation error")

        # Act & Assert
        with pytest.raises(ValueError):
            WorkflowVariablesConfigManager.convert(mock_workflow)


# =============================
# Test convert_rag_pipeline_variable
# =============================


class TestWorkflowVariablesConfigManagerConvertRag:
    def test_no_rag_pipeline_variables(self, mock_workflow):
        # Arrange
        mock_workflow.rag_pipeline_variables = []

        # Act
        result = WorkflowVariablesConfigManager.convert_rag_pipeline_variable(mock_workflow, "node1")

        # Assert
        assert result == []

    def test_rag_pipeline_none(self, mock_workflow):
        # Arrange
        mock_workflow.rag_pipeline_variables = None

        # Act
        result = WorkflowVariablesConfigManager.convert_rag_pipeline_variable(mock_workflow, "node1")

        # Assert
        assert result == []

    def test_no_matching_node_keeps_all(self, mock_workflow, mock_rag_entity):
        # Arrange
        mock_workflow.rag_pipeline_variables = [
            {"variable": "var1", "belong_to_node_id": "node1"},
        ]
        mock_workflow.graph_dict = {"nodes": []}
        mock_rag_entity.model_validate.side_effect = lambda x: {"validated": x}

        # Act
        result = WorkflowVariablesConfigManager.convert_rag_pipeline_variable(mock_workflow, "node1")

        # Assert
        assert result == [{"validated": mock_workflow.rag_pipeline_variables[0]}]

    def test_string_pattern_removes_variable(self, mock_workflow, mock_rag_entity):
        # Arrange
        mock_workflow.rag_pipeline_variables = [
            {"variable": "var1", "belong_to_node_id": "node1"},
            {"variable": "var2", "belong_to_node_id": "node1"},
        ]

        mock_workflow.graph_dict = {
            "nodes": [
                {
                    "id": "node1",
                    "data": {"datasource_parameters": {"param1": {"value": "{{#parent.var1#}}"}}},
                }
            ]
        }

        mock_rag_entity.model_validate.side_effect = lambda x: {"validated": x}

        # Act
        result = WorkflowVariablesConfigManager.convert_rag_pipeline_variable(mock_workflow, "node1")

        # Assert
        assert len(result) == 1
        assert result[0]["validated"]["variable"] == "var2"

    def test_list_value_removes_variable(self, mock_workflow, mock_rag_entity):
        # Arrange
        mock_workflow.rag_pipeline_variables = [
            {"variable": "var1", "belong_to_node_id": "node1"},
            {"variable": "var2", "belong_to_node_id": "node1"},
        ]

        mock_workflow.graph_dict = {
            "nodes": [
                {
                    "id": "node1",
                    "data": {"datasource_parameters": {"param1": {"value": ["x", "var1"]}}},
                }
            ]
        }

        mock_rag_entity.model_validate.side_effect = lambda x: {"validated": x}

        # Act
        result = WorkflowVariablesConfigManager.convert_rag_pipeline_variable(mock_workflow, "node1")

        # Assert
        assert len(result) == 1
        assert result[0]["validated"]["variable"] == "var2"

    @pytest.mark.parametrize(
        ("belong_to_node_id", "expected_count"),
        [
            ("node1", 1),
            ("shared", 1),
            ("other_node", 0),
        ],
    )
    def test_belong_to_node_filtering(self, mock_workflow, mock_rag_entity, belong_to_node_id, expected_count):
        # Arrange
        mock_workflow.rag_pipeline_variables = [
            {"variable": "var1", "belong_to_node_id": belong_to_node_id},
        ]
        mock_workflow.graph_dict = {"nodes": []}
        mock_rag_entity.model_validate.side_effect = lambda x: {"validated": x}

        # Act
        result = WorkflowVariablesConfigManager.convert_rag_pipeline_variable(mock_workflow, "node1")

        # Assert
        assert len(result) == expected_count

    def test_invalid_pattern_does_not_remove(self, mock_workflow, mock_rag_entity):
        # Arrange
        mock_workflow.rag_pipeline_variables = [
            {"variable": "var1", "belong_to_node_id": "node1"},
        ]

        mock_workflow.graph_dict = {
            "nodes": [
                {
                    "id": "node1",
                    "data": {"datasource_parameters": {"param1": {"value": "invalid_pattern"}}},
                }
            ]
        }

        mock_rag_entity.model_validate.side_effect = lambda x: {"validated": x}

        # Act
        result = WorkflowVariablesConfigManager.convert_rag_pipeline_variable(mock_workflow, "node1")

        # Assert
        assert len(result) == 1

    def test_validation_error_propagates(self, mock_workflow, mock_rag_entity):
        # Arrange
        mock_workflow.rag_pipeline_variables = [
            {"variable": "var1", "belong_to_node_id": "node1"},
        ]
        mock_workflow.graph_dict = {"nodes": []}
        mock_rag_entity.model_validate.side_effect = RuntimeError("validation failed")

        # Act & Assert
        with pytest.raises(RuntimeError):
            WorkflowVariablesConfigManager.convert_rag_pipeline_variable(mock_workflow, "node1")
