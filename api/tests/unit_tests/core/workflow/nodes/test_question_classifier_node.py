from unittest import mock

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.model_manager import ModelInstance
from dify_graph.entities import GraphInitParams
from dify_graph.model_runtime.entities import ImagePromptMessageContent
from dify_graph.model_runtime.entities.llm_entities import LLMUsage
from dify_graph.model_runtime.entities.message_entities import UserPromptMessage
from dify_graph.node_events import ModelInvokeCompletedEvent
from dify_graph.nodes.llm import LLMNode
from dify_graph.nodes.question_classifier import QuestionClassifierNodeData
from dify_graph.nodes.question_classifier.question_classifier_node import QuestionClassifierNode
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.system_variable import SystemVariable
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


def test_question_classifier_run_passes_node_data_model_to_invoke_llm():
    graph_init_params: GraphInitParams = build_test_graph_init_params(
        workflow_id="wf-1",
        graph_config={},
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="user-1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
        call_depth=0,
    )
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(
            system_variables=SystemVariable.default(),
            user_inputs={},
        ),
        start_at=0,
    )
    graph_runtime_state.variable_pool.add(["test", "query"], "hello")

    node_data = QuestionClassifierNodeData.model_validate(
        {
            "title": "test classifier node",
            "query_variable_selector": ["test", "query"],
            "model": {
                "provider": "openai",
                "name": "gpt-3.5-turbo",
                "mode": "chat",
                "completion_params": {},
            },
            "classes": [{"id": "1", "name": "class 1"}],
            "instruction": "",
        }
    )
    node = QuestionClassifierNode(
        id="test",
        config={"id": "test", "data": node_data.model_dump()},
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        credentials_provider=mock.MagicMock(),
        model_factory=mock.MagicMock(),
        model_instance=mock.MagicMock(spec=ModelInstance),
        llm_file_saver=mock.MagicMock(),
    )
    node.model_instance.stop = []
    node.model_instance.provider = "openai"
    node.model_instance.model_name = "gpt-3.5-turbo"

    with (
        mock.patch.object(node, "_calculate_rest_token", return_value=2000),
        mock.patch.object(node, "_get_prompt_template", return_value=[]),
        mock.patch.object(
            LLMNode,
            "fetch_prompt_messages",
            return_value=([UserPromptMessage(content="hello")], []),
        ),
        mock.patch.object(
            LLMNode,
            "invoke_llm",
            return_value=iter(
                [
                    ModelInvokeCompletedEvent(
                        text='{"category_id":"1","category_name":"class 1"}',
                        usage=LLMUsage.empty_usage(),
                    )
                ]
            ),
        ) as invoke_llm_mock,
    ):
        result = node._run()

    assert result.outputs["class_id"] == "1"
    assert invoke_llm_mock.call_args.kwargs["node_data_model"] == node.node_data.model
