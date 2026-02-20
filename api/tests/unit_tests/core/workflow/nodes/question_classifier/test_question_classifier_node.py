from unittest.mock import MagicMock

import pytest

from core.model_runtime.entities import LLMUsage
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.node_events import ModelInvokeCompletedEvent
from core.workflow.nodes.question_classifier.question_classifier_node import (
    QuestionClassifierNode,
)

# =====================================================
# Fixtures
# =====================================================


@pytest.fixture
def mock_graph_init_params():
    from core.app.entities.app_invoke_entities import InvokeFrom
    from models.enums import UserFrom

    obj = MagicMock()
    obj.user_id = "user-1"
    obj.tenant_id = "tenant-1"
    obj.app_id = "app-1"

    # Required by base Node __init__
    obj.user_from = UserFrom.ACCOUNT
    obj.invoke_from = InvokeFrom.SERVICE_API

    return obj


@pytest.fixture
def mock_variable_pool():
    pool = MagicMock()
    pool.get.return_value = MagicMock(value="hello world")
    pool.convert_template.side_effect = lambda x: MagicMock(text=x)
    return pool


@pytest.fixture
def mock_graph_runtime_state(mock_variable_pool):
    state = MagicMock()
    state.variable_pool = mock_variable_pool
    return state


@pytest.fixture
def base_node(mock_graph_init_params, mock_graph_runtime_state, mocker):
    # Bypass pydantic validation inside Node __init__
    mocker.patch(
        "core.workflow.nodes.question_classifier.question_classifier_node.QuestionClassifierNode._hydrate_node_data",
        return_value=MagicMock(),
    )

    return QuestionClassifierNode(
        id="node-1",
        config={"id": "node-id"},
        graph_init_params=mock_graph_init_params,
        graph_runtime_state=mock_graph_runtime_state,
    )


@pytest.fixture
def mock_class():
    cls = MagicMock()
    cls.id = "1"
    cls.name = "Category1"
    cls.model_copy.side_effect = lambda update: MagicMock(
        id=cls.id,
        name=update["name"],
    )
    return cls


@pytest.fixture
def mock_node_data(mock_class):
    node_data = MagicMock()
    node_data.query_variable_selector = "query_var"
    node_data.model = MagicMock(mode="chat")
    node_data.memory = None
    node_data.instruction = ""
    node_data.vision = MagicMock(enabled=False, configs=MagicMock(variable_selector=None, detail=None))
    node_data.classes = [mock_class]
    return node_data


# =====================================================
# _get_prompt_template
# =====================================================


class TestGetPromptTemplate:
    def test_chat_mode_with_memory(self, base_node, mock_node_data):
        memory = MagicMock()
        memory.get_history_prompt_text.return_value = "history"
        mock_node_data.model.mode = "chat"

        result = base_node._get_prompt_template(
            node_data=mock_node_data,
            query="test",
            memory=memory,
        )

        assert isinstance(result, list)
        assert len(result) > 0

    def test_completion_mode(self, base_node, mock_node_data):
        mock_node_data.model.mode = "completion"
        result = base_node._get_prompt_template(mock_node_data, "abc", None)
        assert "abc" in result.text

    def test_invalid_mode(self, base_node, mock_node_data):
        mock_node_data.model.mode = "invalid"
        # ModelMode enum itself raises ValueError before our custom error
        with pytest.raises(ValueError):
            base_node._get_prompt_template(mock_node_data, "x", None)


# =====================================================
# _calculate_rest_token
# =====================================================


class TestCalculateRestToken:
    def test_no_context_size(self, base_node, mock_node_data, mocker):
        model_config = MagicMock()
        model_config.model_schema.model_properties.get.return_value = None

        mocker.patch.object(base_node, "_get_prompt_template", return_value=[])

        result = base_node._calculate_rest_token(
            node_data=mock_node_data,
            query="test",
            model_config=model_config,
            context=None,
        )
        assert result == 2000

    def test_context_size_with_parameters_and_boundary_zero(self, base_node, mock_node_data, mocker):
        model_config = MagicMock()
        model_config.model_schema.model_properties.get.return_value = 1000
        param_rule = MagicMock()
        param_rule.name = "max_tokens"
        param_rule.use_template = None
        model_config.model_schema.parameter_rules = [param_rule]
        model_config.parameters = {"max_tokens": 900}
        model_config.provider_model_bundle = "bundle"
        model_config.model = "model"

        mock_instance = MagicMock()
        mock_instance.get_llm_num_tokens.return_value = 200

        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.ModelInstance",
            return_value=mock_instance,
        )
        mocker.patch.object(base_node, "_get_prompt_template", return_value=[])

        result = base_node._calculate_rest_token(mock_node_data, "x", model_config, None)

        assert result == 0  # negative boundary handled (1000 - 900 - 200 = -100 -> 0)


# =====================================================
# _run
# =====================================================


class TestRun:
    def _prepare_common_mocks(self, mocker, base_node, mock_node_data):
        base_node._node_data = mock_node_data

        mock_model_config = MagicMock()
        mock_model_config.mode = "chat"
        mock_model_config.provider = "provider"
        mock_model_config.model = "model"
        mock_model_config.model_schema.model_properties.get.return_value = None

        mock_model_instance = MagicMock()

        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.llm_utils.fetch_model_config",
            return_value=(mock_model_instance, mock_model_config),
        )
        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.llm_utils.fetch_memory",
            return_value=None,
        )
        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.LLMNode.fetch_prompt_messages",
            return_value=([], None),
        )

        return mock_model_config

    def test_success_valid_category(self, base_node, mock_node_data, mocker):
        self._prepare_common_mocks(mocker, base_node, mock_node_data)

        usage = LLMUsage.empty_usage()
        event = ModelInvokeCompletedEvent(
            text='{"category_id": "1"}',
            usage=usage,
            finish_reason="stop",
        )

        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.LLMNode.invoke_llm",
            return_value=iter([event]),
        )
        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.parse_and_check_json_markdown",
            return_value={"category_id": "1", "category_name": "Category1"},
        )

        result = base_node._run()
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["class_id"] == "1"

    def test_success_with_think_tag(self, base_node, mock_node_data, mocker):
        self._prepare_common_mocks(mocker, base_node, mock_node_data)

        usage = LLMUsage.empty_usage()
        event = ModelInvokeCompletedEvent(
            text='<think>internal</think>{"category_id": "1"}',
            usage=usage,
            finish_reason="stop",
        )

        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.LLMNode.invoke_llm",
            return_value=iter([event]),
        )
        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.parse_and_check_json_markdown",
            return_value={"category_id": "1"},
        )

        result = base_node._run()
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED

    def test_invalid_category_id_fallback(self, base_node, mock_node_data, mocker):
        self._prepare_common_mocks(mocker, base_node, mock_node_data)

        usage = LLMUsage.empty_usage()
        event = ModelInvokeCompletedEvent(
            text='{"category_id": "999"}',
            usage=usage,
            finish_reason="stop",
        )

        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.LLMNode.invoke_llm",
            return_value=iter([event]),
        )
        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.parse_and_check_json_markdown",
            return_value={"category_id": "999"},
        )

        result = base_node._run()
        assert result.outputs["class_id"] == "1"  # fallback to first

    def test_invalid_json_failure(self, base_node, mock_node_data, mocker):
        self._prepare_common_mocks(mocker, base_node, mock_node_data)

        usage = LLMUsage.empty_usage()
        event = ModelInvokeCompletedEvent(
            text="invalid",
            usage=usage,
            finish_reason="stop",
        )

        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.LLMNode.invoke_llm",
            return_value=iter([event]),
        )
        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.parse_and_check_json_markdown",
            side_effect=ValueError("Invalid JSON"),
        )

        result = base_node._run()
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert result.error_type == "ValueError"

    def test_empty_classes_raises_index_error(self, base_node, mock_node_data, mocker):
        mock_node_data.classes = []
        self._prepare_common_mocks(mocker, base_node, mock_node_data)

        usage = LLMUsage.empty_usage()
        event = ModelInvokeCompletedEvent(
            text='{"category_id": "1"}',
            usage=usage,
            finish_reason="stop",
        )

        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.LLMNode.invoke_llm",
            return_value=iter([event]),
        )
        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.parse_and_check_json_markdown",
            return_value={"category_id": "1"},
        )

        with pytest.raises(IndexError):
            base_node._run()


# =====================================================
# _extract_variable_selector_to_variable_mapping
# =====================================================


class TestExtractVariableMapping:
    def test_basic_mapping(self, mocker):
        mock_model = MagicMock()
        mock_model.query_variable_selector = ["var1"]
        mock_model.instruction = ""

        mocker.patch(
            "core.workflow.nodes.question_classifier.question_classifier_node.QuestionClassifierNodeData.model_validate",
            return_value=mock_model,
        )

        result = QuestionClassifierNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data={},
        )

        assert "node1.query" in result


# =====================================================
# get_default_config
# =====================================================


class TestDefaultConfig:
    def test_default_config(self):
        config = QuestionClassifierNode.get_default_config()
        assert config["type"] == "question-classifier"
        assert config["config"]["instructions"] == ""
