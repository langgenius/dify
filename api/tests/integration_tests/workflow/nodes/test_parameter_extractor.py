import os
import time
import uuid
from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import InvokeFrom
from core.model_runtime.entities import AssistantPromptMessage
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.nodes.parameter_extractor.parameter_extractor_node import ParameterExtractorNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from extensions.ext_database import db
from models.enums import UserFrom
from tests.integration_tests.workflow.nodes.__mock.model import get_mocked_fetch_model_config

"""FOR MOCK FIXTURES, DO NOT REMOVE"""
from tests.integration_tests.model_runtime.__mock.plugin_daemon import setup_model_mock


def get_mocked_fetch_memory(memory_text: str):
    class MemoryMock:
        def get_history_prompt_text(
            self,
            human_prefix: str = "Human",
            ai_prefix: str = "Assistant",
            max_token_limit: int = 2000,
            message_limit: int | None = None,
        ):
            return memory_text

    return MagicMock(return_value=MemoryMock())


def init_parameter_extractor_node(config: dict):
    graph_config = {
        "edges": [
            {
                "id": "start-source-next-target",
                "source": "start",
                "target": "llm",
            },
        ],
        "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}, config],
    }

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    variable_pool = VariablePool(
        system_variables=SystemVariable(
            user_id="aaa", files=[], query="what's the weather in SF", conversation_id="abababa"
        ),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["a", "args1"], 1)
    variable_pool.add(["a", "args2"], 2)

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    # Create node factory
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )

    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node = ParameterExtractorNode(
        id=str(uuid.uuid4()),
        config=config,
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    node.init_node_data(config.get("data", {}))
    return node


def test_function_calling_parameter_extractor(setup_model_mock):
    """
    Test function calling for parameter extractor.
    """
    node = init_parameter_extractor_node(
        config={
            "id": "llm",
            "data": {
                "title": "123",
                "type": "parameter-extractor",
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {},
                },
                "query": ["sys", "query"],
                "parameters": [{"name": "location", "type": "string", "description": "location", "required": True}],
                "instruction": "",
                "reasoning_mode": "function_call",
                "memory": None,
            },
        }
    )

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider="langgenius/openai/openai",
        model="gpt-3.5-turbo",
        mode="chat",
        credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
    )
    db.session.close = MagicMock()

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs.get("location") == "kawaii"
    assert result.outputs.get("__reason") == None


def test_instructions(setup_model_mock):
    """
    Test chat parameter extractor.
    """
    node = init_parameter_extractor_node(
        config={
            "id": "llm",
            "data": {
                "title": "123",
                "type": "parameter-extractor",
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {},
                },
                "query": ["sys", "query"],
                "parameters": [{"name": "location", "type": "string", "description": "location", "required": True}],
                "reasoning_mode": "function_call",
                "instruction": "{{#sys.query#}}",
                "memory": None,
            },
        },
    )

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider="langgenius/openai/openai",
        model="gpt-3.5-turbo",
        mode="chat",
        credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
    )
    db.session.close = MagicMock()

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs.get("location") == "kawaii"
    assert result.outputs.get("__reason") == None

    process_data = result.process_data

    assert process_data is not None
    process_data.get("prompts")

    for prompt in process_data.get("prompts", []):
        if prompt.get("role") == "system":
            assert "what's the weather in SF" in prompt.get("text")


def test_chat_parameter_extractor(setup_model_mock):
    """
    Test chat parameter extractor.
    """
    node = init_parameter_extractor_node(
        config={
            "id": "llm",
            "data": {
                "title": "123",
                "type": "parameter-extractor",
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {},
                },
                "query": ["sys", "query"],
                "parameters": [{"name": "location", "type": "string", "description": "location", "required": True}],
                "reasoning_mode": "prompt",
                "instruction": "",
                "memory": None,
            },
        },
    )

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider="langgenius/openai/openai",
        model="gpt-3.5-turbo",
        mode="chat",
        credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
    )
    db.session.close = MagicMock()

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs.get("location") == ""
    assert (
        result.outputs.get("__reason")
        == "Failed to extract result from function call or text response, using empty result."
    )
    assert result.process_data is not None
    prompts = result.process_data.get("prompts", [])

    for prompt in prompts:
        if prompt.get("role") == "user":
            if "<structure>" in prompt.get("text"):
                assert '<structure>\n{"type": "object"' in prompt.get("text")


def test_completion_parameter_extractor(setup_model_mock):
    """
    Test completion parameter extractor.
    """
    node = init_parameter_extractor_node(
        config={
            "id": "llm",
            "data": {
                "title": "123",
                "type": "parameter-extractor",
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-3.5-turbo-instruct",
                    "mode": "completion",
                    "completion_params": {},
                },
                "query": ["sys", "query"],
                "parameters": [{"name": "location", "type": "string", "description": "location", "required": True}],
                "reasoning_mode": "prompt",
                "instruction": "{{#sys.query#}}",
                "memory": None,
            },
        },
    )

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider="langgenius/openai/openai",
        model="gpt-3.5-turbo-instruct",
        mode="completion",
        credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
    )
    db.session.close = MagicMock()

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs.get("location") == ""
    assert (
        result.outputs.get("__reason")
        == "Failed to extract result from function call or text response, using empty result."
    )
    assert result.process_data is not None
    assert len(result.process_data.get("prompts", [])) == 1
    assert "SF" in result.process_data.get("prompts", [])[0].get("text")


def test_extract_json_response():
    """
    Test extract json response.
    """

    node = init_parameter_extractor_node(
        config={
            "id": "llm",
            "data": {
                "title": "123",
                "type": "parameter-extractor",
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-3.5-turbo-instruct",
                    "mode": "completion",
                    "completion_params": {},
                },
                "query": ["sys", "query"],
                "parameters": [{"name": "location", "type": "string", "description": "location", "required": True}],
                "reasoning_mode": "prompt",
                "instruction": "{{#sys.query#}}",
                "memory": None,
            },
        },
    )

    result = node._extract_complete_json_response("""
        uwu{ovo}
        {
            "location": "kawaii"
        }
        hello world.
    """)

    assert result is not None
    assert result["location"] == "kawaii"


def test_extract_json_from_tool_call():
    """
    Test extract json response.
    """

    node = init_parameter_extractor_node(
        config={
            "id": "llm",
            "data": {
                "title": "123",
                "type": "parameter-extractor",
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-3.5-turbo-instruct",
                    "mode": "completion",
                    "completion_params": {},
                },
                "query": ["sys", "query"],
                "parameters": [{"name": "location", "type": "string", "description": "location", "required": True}],
                "reasoning_mode": "prompt",
                "instruction": "{{#sys.query#}}",
                "memory": None,
            },
        },
    )

    result = node._extract_json_from_tool_call(
        AssistantPromptMessage.ToolCall(
            id="llm",
            type="parameter-extractor",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                name="foo", arguments="""{"location":"kawaii"}{"location": 1}"""
            ),
        )
    )

    assert result is not None
    assert result["location"] == "kawaii"


def test_chat_parameter_extractor_with_memory(setup_model_mock, monkeypatch):
    """
    Test chat parameter extractor with memory.
    """
    node = init_parameter_extractor_node(
        config={
            "id": "llm",
            "data": {
                "title": "123",
                "type": "parameter-extractor",
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {},
                },
                "query": ["sys", "query"],
                "parameters": [{"name": "location", "type": "string", "description": "location", "required": True}],
                "reasoning_mode": "prompt",
                "instruction": "",
                "memory": {"window": {"enabled": True, "size": 50}},
            },
        },
    )

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider="langgenius/openai/openai",
        model="gpt-3.5-turbo",
        mode="chat",
        credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
    )
    # Test the mock before running the actual test
    monkeypatch.setattr("core.workflow.nodes.llm.llm_utils.fetch_memory", get_mocked_fetch_memory("customized memory"))
    db.session.close = MagicMock()

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs is not None
    assert result.outputs.get("location") == ""
    assert (
        result.outputs.get("__reason")
        == "Failed to extract result from function call or text response, using empty result."
    )
    assert result.process_data is not None
    prompts = result.process_data.get("prompts", [])

    latest_role = None
    for prompt in prompts:
        if prompt.get("role") == "user":
            if "<structure>" in prompt.get("text"):
                assert '<structure>\n{"type": "object"' in prompt.get("text")
        elif prompt.get("role") == "system":
            assert "customized memory" in prompt.get("text")

        if latest_role is not None:
            assert latest_role != prompt.get("role")

        if prompt.get("role") in {"user", "assistant"}:
            latest_role = prompt.get("role")
