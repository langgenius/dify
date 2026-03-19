from types import SimpleNamespace
from unittest.mock import MagicMock

from dify_graph.model_runtime.entities import ImagePromptMessageContent
from dify_graph.nodes.llm.protocols import CredentialsProvider, ModelFactory, TemplateRenderer
from dify_graph.nodes.protocols import HttpClientProtocol
from dify_graph.nodes.question_classifier import (
    QuestionClassifierNode,
    QuestionClassifierNodeData,
)
from tests.workflow_test_utils import build_test_graph_init_params


def test_init_question_classifier_node_data():
    data = {
        "title": "test classifier node",
        "query_variable_selector": ["id", "name"],
        "model": {"provider": "openai", "name": "gpt-3.5-turbo", "mode": "completion", "completion_params": {}},
        "classes": [{"id": "1", "name": "class 1"}],
        "instruction": "This is a test instruction",
        "memory": {
            "role_prefix": {"user": "Human:", "assistant": "AI:"},
            "window": {"enabled": True, "size": 5},
            "query_prompt_template": "Previous conversation:\n{history}\n\nHuman: {query}\nAI:",
        },
        "vision": {"enabled": True, "configs": {"variable_selector": ["image"], "detail": "low"}},
    }

    node_data = QuestionClassifierNodeData.model_validate(data)

    assert node_data.query_variable_selector == ["id", "name"]
    assert node_data.model.provider == "openai"
    assert node_data.classes[0].id == "1"
    assert node_data.instruction == "This is a test instruction"
    assert node_data.memory is not None
    assert node_data.memory.role_prefix is not None
    assert node_data.memory.role_prefix.user == "Human:"
    assert node_data.memory.role_prefix.assistant == "AI:"
    assert node_data.memory.window.enabled == True
    assert node_data.memory.window.size == 5
    assert node_data.memory.query_prompt_template == "Previous conversation:\n{history}\n\nHuman: {query}\nAI:"
    assert node_data.vision.enabled == True
    assert node_data.vision.configs.variable_selector == ["image"]
    assert node_data.vision.configs.detail == ImagePromptMessageContent.DETAIL.LOW


def test_init_question_classifier_node_data_without_vision_config():
    data = {
        "title": "test classifier node",
        "query_variable_selector": ["id", "name"],
        "model": {"provider": "openai", "name": "gpt-3.5-turbo", "mode": "completion", "completion_params": {}},
        "classes": [{"id": "1", "name": "class 1"}],
        "instruction": "This is a test instruction",
        "memory": {
            "role_prefix": {"user": "Human:", "assistant": "AI:"},
            "window": {"enabled": True, "size": 5},
            "query_prompt_template": "Previous conversation:\n{history}\n\nHuman: {query}\nAI:",
        },
    }

    node_data = QuestionClassifierNodeData.model_validate(data)

    assert node_data.query_variable_selector == ["id", "name"]
    assert node_data.model.provider == "openai"
    assert node_data.classes[0].id == "1"
    assert node_data.instruction == "This is a test instruction"
    assert node_data.memory is not None
    assert node_data.memory.role_prefix is not None
    assert node_data.memory.role_prefix.user == "Human:"
    assert node_data.memory.role_prefix.assistant == "AI:"
    assert node_data.memory.window.enabled == True
    assert node_data.memory.window.size == 5
    assert node_data.memory.query_prompt_template == "Previous conversation:\n{history}\n\nHuman: {query}\nAI:"
    assert node_data.vision.enabled == False
    assert node_data.vision.configs.variable_selector == ["sys", "files"]
    assert node_data.vision.configs.detail == ImagePromptMessageContent.DETAIL.HIGH


def test_question_classifier_calculate_rest_token_uses_shared_prompt_builder(monkeypatch):
    node_data = QuestionClassifierNodeData.model_validate(
        {
            "title": "test classifier node",
            "query_variable_selector": ["id", "name"],
            "model": {"provider": "openai", "name": "gpt-3.5-turbo", "mode": "completion", "completion_params": {}},
            "classes": [{"id": "1", "name": "class 1"}],
            "instruction": "This is a test instruction",
        }
    )
    template_renderer = MagicMock(spec=TemplateRenderer)
    node = QuestionClassifierNode(
        id="node-id",
        config={"id": "node-id", "data": node_data.model_dump(mode="json")},
        graph_init_params=build_test_graph_init_params(
            workflow_id="workflow-id",
            graph_config={},
            tenant_id="tenant-id",
            app_id="app-id",
            user_id="user-id",
        ),
        graph_runtime_state=SimpleNamespace(variable_pool=MagicMock()),
        credentials_provider=MagicMock(spec=CredentialsProvider),
        model_factory=MagicMock(spec=ModelFactory),
        model_instance=MagicMock(),
        http_client=MagicMock(spec=HttpClientProtocol),
        llm_file_saver=MagicMock(),
        template_renderer=template_renderer,
    )
    fetch_prompt_messages = MagicMock(return_value=([], None))
    monkeypatch.setattr(
        "dify_graph.nodes.question_classifier.question_classifier_node.llm_utils.fetch_prompt_messages",
        fetch_prompt_messages,
    )
    monkeypatch.setattr(
        "dify_graph.nodes.question_classifier.question_classifier_node.llm_utils.fetch_model_schema",
        MagicMock(return_value=SimpleNamespace(model_properties={}, parameter_rules=[])),
    )

    node._calculate_rest_token(
        node_data=node_data,
        query="hello",
        model_instance=MagicMock(stop=(), parameters={}),
        context="",
    )

    assert fetch_prompt_messages.call_args.kwargs["template_renderer"] is template_renderer
