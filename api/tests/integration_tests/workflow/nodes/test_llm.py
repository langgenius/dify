import json
import os
import time
import uuid
from collections.abc import Generator
from unittest.mock import MagicMock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.event import RunCompletedEvent
from core.workflow.nodes.llm.node import LLMNode
from extensions.ext_database import db
from models.enums import UserFrom
from models.workflow import WorkflowNodeExecutionStatus, WorkflowType
from tests.integration_tests.workflow.nodes.__mock.model import get_mocked_fetch_model_config

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

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
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


def test_execute_llm(setup_model_mock):
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
                    {"role": "system", "text": "you are a helpful assistant.\ntoday's weather is {{#abc.output#}}."},
                    {"role": "user", "text": "{{#sys.query#}}"},
                ],
                "memory": None,
                "context": {"enabled": False},
                "vision": {"enabled": False},
            },
        },
    )

    credentials = {"openai_api_key": os.environ.get("OPENAI_API_KEY")}

    # Mock db.session.close()
    db.session.close = MagicMock()

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider="langgenius/openai/openai",
        model="gpt-3.5-turbo",
        mode="chat",
        credentials=credentials,
    )

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
def test_execute_llm_with_jinja2(setup_code_executor_mock, setup_model_mock):
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

    credentials = {"openai_api_key": os.environ.get("OPENAI_API_KEY")}

    # Mock db.session.close()
    db.session.close = MagicMock()

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider="langgenius/openai/openai",
        model="gpt-3.5-turbo",
        mode="chat",
        credentials=credentials,
    )

    # execute node
    result = node._run()

    for item in result:
        if isinstance(item, RunCompletedEvent):
            assert item.run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
            assert item.run_result.process_data is not None
            assert "sunny" in json.dumps(item.run_result.process_data)
            assert "what's the weather today?" in json.dumps(item.run_result.process_data)


def test_extract_json():
    node = init_llm_node(
        config={
            "id": "llm",
            "data": {
                "title": "123",
                "type": "llm",
                "model": {"provider": "openai", "name": "gpt-3.5-turbo", "mode": "chat", "completion_params": {}},
                "prompt_config": {
                    "structured_output": {
                        "enabled": True,
                        "schema": {
                            "type": "object",
                            "properties": {"name": {"type": "string"}, "age": {"type": "number"}},
                        },
                    }
                },
                "prompt_template": [{"role": "user", "text": "{{#sys.query#}}"}],
                "memory": None,
                "context": {"enabled": False},
                "vision": {"enabled": False},
            },
        },
    )
    llm_texts = [
        '<think>\n\n</think>{"name": "test", "age": 123',  # resoning model (deepseek-r1)
        '{"name":"test","age":123}',  # json schema model (gpt-4o)
        '{\n    "name": "test",\n    "age": 123\n}',  # small model (llama-3.2-1b)
        '```json\n{"name": "test", "age": 123}\n```',  # json markdown (deepseek-chat)
        '{"name":"test",age:123}',  # without quotes (qwen-2.5-0.5b)
    ]
    result = {"name": "test", "age": 123}
    assert all(node._parse_structured_output(item) == result for item in llm_texts)
