import json
import os
import time
import uuid
from collections.abc import Generator
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.llm_generator.output_parser.structured_output import _parse_structured_output
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.entities.message_entities import AssistantPromptMessage
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.event import RunCompletedEvent
from core.workflow.nodes.llm.node import LLMNode
from extensions.ext_database import db
from models.enums import UserFrom
from models.workflow import WorkflowType

"""FOR MOCK FIXTURES, DO NOT REMOVE"""
from tests.integration_tests.model_runtime.__mock.plugin_daemon import setup_model_mock
from tests.integration_tests.workflow.nodes.__mock.code_executor import setup_code_executor_mock


def init_llm_node(config: dict) -> LLMNode:
    graph_config = {
        "edges": [
            {
                "id": "start-source-next-target",
                "source": "start",
                "target": "llm",
            },
        ],
        "nodes": [{"data": {"type": "start"}, "id": "start"}, config],
    }

    graph = Graph.init(graph_config=graph_config)

    # Use proper UUIDs for database compatibility
    tenant_id = "9d2074fc-6f86-45a9-b09d-6ecc63b9056b"
    app_id = "9d2074fc-6f86-45a9-b09d-6ecc63b9056c"
    workflow_id = "9d2074fc-6f86-45a9-b09d-6ecc63b9056d"
    user_id = "9d2074fc-6f86-45a9-b09d-6ecc63b9056e"

    init_params = GraphInitParams(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_type=WorkflowType.WORKFLOW,
        workflow_id=workflow_id,
        graph_config=graph_config,
        user_id=user_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    variable_pool = VariablePool(
        system_variables={
            SystemVariableKey.QUERY: "what's the weather today?",
            SystemVariableKey.FILES: [],
            SystemVariableKey.CONVERSATION_ID: "abababa",
            SystemVariableKey.USER_ID: "aaa",
        },
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["abc", "output"], "sunny")

    node = LLMNode(
        id=str(uuid.uuid4()),
        graph_init_params=init_params,
        graph=graph,
        graph_runtime_state=GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter()),
        config=config,
    )

    return node


def test_execute_llm(flask_req_ctx):
    node = init_llm_node(
        config={
            "id": "llm",
            "data": {
                "title": "123",
                "type": "llm",
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-3.5-turbo",
                    "mode": "chat",
                    "completion_params": {},
                },
                "prompt_template": [
                    {
                        "role": "system",
                        "text": "you are a helpful assistant.\ntoday's weather is {{#abc.output#}}.",
                    },
                    {"role": "user", "text": "{{#sys.query#}}"},
                ],
                "memory": None,
                "context": {"enabled": False},
                "vision": {"enabled": False},
            },
        },
    )

    credentials = {"openai_api_key": os.environ.get("OPENAI_API_KEY")}

    # Create a proper LLM result with real entities
    mock_usage = LLMUsage(
        prompt_tokens=30,
        prompt_unit_price=Decimal("0.001"),
        prompt_price_unit=Decimal("1000"),
        prompt_price=Decimal("0.00003"),
        completion_tokens=20,
        completion_unit_price=Decimal("0.002"),
        completion_price_unit=Decimal("1000"),
        completion_price=Decimal("0.00004"),
        total_tokens=50,
        total_price=Decimal("0.00007"),
        currency="USD",
        latency=0.5,
    )

    mock_message = AssistantPromptMessage(content="This is a test response from the mocked LLM.")

    mock_llm_result = LLMResult(
        model="gpt-3.5-turbo",
        prompt_messages=[],
        message=mock_message,
        usage=mock_usage,
    )

    # Create a simple mock model instance that doesn't call real providers
    mock_model_instance = MagicMock()
    mock_model_instance.invoke_llm.return_value = mock_llm_result

    # Create a simple mock model config with required attributes
    mock_model_config = MagicMock()
    mock_model_config.mode = "chat"
    mock_model_config.provider = "langgenius/openai/openai"
    mock_model_config.model = "gpt-3.5-turbo"
    mock_model_config.provider_model_bundle.configuration.tenant_id = "9d2074fc-6f86-45a9-b09d-6ecc63b9056b"

    # Mock the _fetch_model_config method
    def mock_fetch_model_config_func(_node_data_model):
        return mock_model_instance, mock_model_config

    # Also mock ModelManager.get_model_instance to avoid database calls
    def mock_get_model_instance(_self, **kwargs):
        return mock_model_instance

    with (
        patch.object(node, "_fetch_model_config", mock_fetch_model_config_func),
        patch("core.model_manager.ModelManager.get_model_instance", mock_get_model_instance),
    ):
        # execute node
        result = node._run()
        assert isinstance(result, Generator)

        for item in result:
            if isinstance(item, RunCompletedEvent):
                assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                assert item.run_result.process_data is not None
                assert item.run_result.outputs is not None
                assert item.run_result.outputs.get("text") is not None
                assert item.run_result.outputs.get("usage", {})["total_tokens"] > 0


@pytest.mark.parametrize("setup_code_executor_mock", [["none"]], indirect=True)
def test_execute_llm_with_jinja2(flask_req_ctx, setup_code_executor_mock):
    """
    Test execute LLM node with jinja2
    """
    node = init_llm_node(
        config={
            "id": "llm",
            "data": {
                "title": "123",
                "type": "llm",
                "model": {"provider": "openai", "name": "gpt-3.5-turbo", "mode": "chat", "completion_params": {}},
                "prompt_config": {
                    "jinja2_variables": [
                        {"variable": "sys_query", "value_selector": ["sys", "query"]},
                        {"variable": "output", "value_selector": ["abc", "output"]},
                    ]
                },
                "prompt_template": [
                    {
                        "role": "system",
                        "text": "you are a helpful assistant.\ntoday's weather is {{#abc.output#}}",
                        "jinja2_text": "you are a helpful assistant.\ntoday's weather is {{output}}.",
                        "edition_type": "jinja2",
                    },
                    {
                        "role": "user",
                        "text": "{{#sys.query#}}",
                        "jinja2_text": "{{sys_query}}",
                        "edition_type": "basic",
                    },
                ],
                "memory": None,
                "context": {"enabled": False},
                "vision": {"enabled": False},
            },
        },
    )

    # Mock db.session.close()
    db.session.close = MagicMock()

    # Create a proper LLM result with real entities
    mock_usage = LLMUsage(
        prompt_tokens=30,
        prompt_unit_price=Decimal("0.001"),
        prompt_price_unit=Decimal("1000"),
        prompt_price=Decimal("0.00003"),
        completion_tokens=20,
        completion_unit_price=Decimal("0.002"),
        completion_price_unit=Decimal("1000"),
        completion_price=Decimal("0.00004"),
        total_tokens=50,
        total_price=Decimal("0.00007"),
        currency="USD",
        latency=0.5,
    )

    mock_message = AssistantPromptMessage(content="Test response: sunny weather and what's the weather today?")

    mock_llm_result = LLMResult(
        model="gpt-3.5-turbo",
        prompt_messages=[],
        message=mock_message,
        usage=mock_usage,
    )

    # Create a simple mock model instance that doesn't call real providers
    mock_model_instance = MagicMock()
    mock_model_instance.invoke_llm.return_value = mock_llm_result

    # Create a simple mock model config with required attributes
    mock_model_config = MagicMock()
    mock_model_config.mode = "chat"
    mock_model_config.provider = "openai"
    mock_model_config.model = "gpt-3.5-turbo"
    mock_model_config.provider_model_bundle.configuration.tenant_id = "9d2074fc-6f86-45a9-b09d-6ecc63b9056b"

    # Mock the _fetch_model_config method
    def mock_fetch_model_config_func(_node_data_model):
        return mock_model_instance, mock_model_config

    # Also mock ModelManager.get_model_instance to avoid database calls
    def mock_get_model_instance(_self, **kwargs):
        return mock_model_instance

    with (
        patch.object(node, "_fetch_model_config", mock_fetch_model_config_func),
        patch("core.model_manager.ModelManager.get_model_instance", mock_get_model_instance),
    ):
        # execute node
        result = node._run()

        for item in result:
            if isinstance(item, RunCompletedEvent):
                assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                assert item.run_result.process_data is not None
                assert "sunny" in json.dumps(item.run_result.process_data)
                assert "what's the weather today?" in json.dumps(item.run_result.process_data)


def test_extract_json():
    llm_texts = [
        '<think>\n\n</think>{"name": "test", "age": 123',  # resoning model (deepseek-r1)
        '{"name":"test","age":123}',  # json schema model (gpt-4o)
        '{\n    "name": "test",\n    "age": 123\n}',  # small model (llama-3.2-1b)
        '```json\n{"name": "test", "age": 123}\n```',  # json markdown (deepseek-chat)
        '{"name":"test",age:123}',  # without quotes (qwen-2.5-0.5b)
    ]
    result = {"name": "test", "age": 123}
    assert all(_parse_structured_output(item) == result for item in llm_texts)


@pytest.mark.parametrize(
    ("thinking_tags_enabled", "should_preserve_tags"),
    [
        ("true", True),  # LLM_NODE_THINKING_TAGS_ENABLED=true -> tags should be preserved
        ("false", False),  # LLM_NODE_THINKING_TAGS_ENABLED=false -> tags should be removed
    ],
)
def test_execute_llm_with_thinking_tags(flask_req_ctx, thinking_tags_enabled, should_preserve_tags):
    """Test LLM node with thinking tags removal controlled via environment variable."""
    import os

    with patch.dict(os.environ, {"LLM_NODE_THINKING_TAGS_ENABLED": thinking_tags_enabled}):
        # Reload the module to pick up the environment variable change
        import importlib

        from core.workflow.nodes.llm import node

        importlib.reload(node)

        node_instance = init_llm_node(
            config={
                "id": "llm",
                "data": {
                    "title": f"thinking tags test ({'preserved' if should_preserve_tags else 'removed'})",
                    "type": "llm",
                    "model": {
                        "provider": "langgenius/openrouter",
                        "name": "qwen/qwen-2.5-72b-instruct",
                        "mode": "chat",
                        "completion_params": {},
                    },
                    "prompt_template": [
                        {
                            "role": "system",
                            "text": "you are a helpful assistant.",
                        },
                        {"role": "user", "text": "Say hello"},
                    ],
                    "memory": None,
                    "context": {"enabled": False},
                    "vision": {"enabled": False},
                },
            },
        )

        # Create mock LLM result with thinking tags
        mock_usage = LLMUsage(
            prompt_tokens=10,
            prompt_unit_price=Decimal("0.001"),
            prompt_price_unit=Decimal("1000"),
            prompt_price=Decimal("0.00001"),
            completion_tokens=15,
            completion_unit_price=Decimal("0.002"),
            completion_price_unit=Decimal("1000"),
            completion_price=Decimal("0.00003"),
            total_tokens=25,
            total_price=Decimal("0.00004"),
            currency="USD",
            latency=0.3,
        )

        # Mock response with thinking tags (simulating Qwen reasoning behavior)
        mock_message = AssistantPromptMessage(
            content="<think>Let me think about this greeting...</think>Hello! How can I help you today?"
        )

        mock_llm_result = LLMResult(
            model="qwen/qwen-2.5-72b-instruct",
            prompt_messages=[],
            message=mock_message,
            usage=mock_usage,
        )

        mock_model_instance = MagicMock()
        mock_model_instance.invoke_llm.return_value = mock_llm_result

        mock_model_config = MagicMock()
        mock_model_config.mode = "chat"
        mock_model_config.provider = "langgenius/openrouter"
        mock_model_config.model = "qwen/qwen-2.5-72b-instruct"
        mock_model_config.provider_model_bundle.configuration.tenant_id = "9d2074fc-6f86-45a9-b09d-6ecc63b9056b"

        def mock_fetch_model_config_func(_node_data_model):
            return mock_model_instance, mock_model_config

        def mock_get_model_instance(_self, **kwargs):
            return mock_model_instance

        with (
            patch.object(node_instance, "_fetch_model_config", mock_fetch_model_config_func),
            patch("core.model_manager.ModelManager.get_model_instance", mock_get_model_instance),
        ):
            # Execute node
            result = node_instance._run()
            assert isinstance(result, Generator)

            # Verify behavior based on the parameter
            for item in result:
                if isinstance(item, RunCompletedEvent):
                    assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                    output_text = item.run_result.outputs.get("text")
                    assert output_text is not None

                    if should_preserve_tags:
                        # Verify thinking tags are preserved when enabled
                        assert "<think>" in output_text
                        assert "</think>" in output_text
                        assert "Let me think about this greeting..." in output_text
                        assert "Hello! How can I help you today?" in output_text
                    else:
                        # Verify thinking tags are removed when disabled
                        assert "<think>" not in output_text
                        assert "</think>" not in output_text
                        assert "Hello! How can I help you today?" in output_text
                        # Verify thinking content is not in output
                        assert "Let me think about this greeting..." not in output_text
