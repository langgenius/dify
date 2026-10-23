from __future__ import annotations

import json
import os
import sys
import time
import types
import uuid
from collections.abc import Generator, Iterator, Mapping
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import override
from unittest.mock import MagicMock, Mock, patch, sentinel
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, grant_retriever_segment_access
from core.app.llm.model_access import DifyCredentialsProvider, DifyModelFactory
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.helper.ssrf_proxy import graphon_ssrf_proxy
from core.llm_generator.output_parser.errors import OutputParserError
from core.llm_generator.output_parser.structured_output import _parse_structured_output
from core.model_manager import QuotaManagedModelInstance
from core.plugin.impl.exc import PluginDaemonClientSideError, PluginInvokeError, PluginLLMPollingUnsupportedError
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.plugin_service import PluginService
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.entities.tool_entities import ToolProviderType as CoreToolProviderType
from core.tools.errors import ToolInvokeError
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ToolParameterConfigurationManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow import node_runtime
from core.workflow.file_reference import parse_file_reference
from core.workflow.human_input_adapter import (
    DeliveryMethodType,
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    WebAppDeliveryMethod,
    _WebAppDeliveryConfig,
)
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.node_runtime import (
    DifyFileReferenceFactory,
    DifyHumanInputNodeRuntime,
    DifyPreparedLLM,
    DifyPreparedPollingLLM,
    DifyPromptMessageSerializer,
    DifyRetrieverAttachmentLoader,
    DifyToolFileManager,
    DifyToolNodeRuntime,
    apply_dify_debug_email_recipient,
    build_dify_llm_file_saver,
    resolve_dify_run_context,
)
from core.workflow.nodes.human_input.entities import FileInputConfig, FileListInputConfig, HumanInputNodeData
from core.workflow.system_variables import build_system_variables
from extensions.ext_database import db
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.graph import Graph
from graphon.model_runtime.entities import (
    AssistantPromptMessage as _parameter_extractor_execution_behavior_AssistantPromptMessage,
)
from graphon.model_runtime.entities import UserPromptMessage
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMPollingResult, LLMPollingStatus, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage as _node_runtime_AssistantPromptMessage,
)
from graphon.model_runtime.entities.message_entities import PromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelFeature, ModelType
from graphon.model_runtime.memory.prompt_message_memory import PromptMessageMemory
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.node_events import StreamCompletedEvent
from graphon.nodes.llm.entities import LLMNodeData
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import LLMPollingCapableProtocol
from graphon.nodes.parameter_extractor.entities import ParameterExtractorNodeData
from graphon.nodes.parameter_extractor.parameter_extractor_node import ParameterExtractorNode
from graphon.nodes.tool.entities import ToolNodeData, ToolProviderType
from graphon.nodes.tool.exc import ToolRuntimeInvocationError, ToolRuntimeResolutionError
from graphon.nodes.tool.tool_node import ToolNode
from graphon.nodes.tool_runtime_entities import ToolRuntimeHandle, ToolRuntimeMessage
from graphon.runtime import RuntimeState, VariablePool
from graphon.variables.segments import ArrayFileSegment, FileSegment
from models.base import TypeBase
from models.dataset import SegmentAttachmentBinding
from models.enums import CreatorUserRole
from models.model import StorageType, UploadFile
from models.tools import ToolFile
from tests.helpers.unit.core.model_fixtures import make_model_config, make_model_instance
from tests.helpers.unit.core.workflow.nodes.parameter_extractor.fixtures.model import get_mocked_fetch_model_instance
from tests.workflow_test_utils import build_test_graph_init_params, build_test_run_context, build_test_variable_pool

pytest_plugins = ("tests.helpers.unit.core.workflow.nodes.parameter_extractor.fixtures.plugin_daemon",)

"""Unit coverage for LLM node execution with model boundaries replaced by test doubles."""


"""FOR MOCK FIXTURES, DO NOT REMOVE"""


def init_llm_node(config: dict[str, object]) -> LLMNode:
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

    # Use proper UUIDs for database compatibility
    tenant_id = "9d2074fc-6f86-45a9-b09d-6ecc63b9056b"
    app_id = "9d2074fc-6f86-45a9-b09d-6ecc63b9056c"
    workflow_id = "9d2074fc-6f86-45a9-b09d-6ecc63b9056d"
    user_id = "9d2074fc-6f86-45a9-b09d-6ecc63b9056e"

    init_params = build_test_graph_init_params(
        workflow_id=workflow_id,
        graph_config=graph_config,
        tenant_id=tenant_id,
        app_id=app_id,
        user_id=user_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(
            user_id="aaa",
            app_id=app_id,
            workflow_id=workflow_id,
            files=[],
            query="what's the weather today?",
            conversation_id="abababa",
        ),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["abc", "output"], "sunny")

    graph_runtime_state = RuntimeState(
        workflow_id=workflow_id, variable_pool=variable_pool, start_at=time.perf_counter()
    )
    run_context = resolve_dify_run_context(init_params.run_context)

    node = LLMNode(
        node_id=str(uuid.uuid4()),
        data=LLMNodeData.model_validate(config["data"]),
        init_params=init_params,
        runtime_state=graph_runtime_state,
        credentials_provider=DifyCredentialsProvider(run_context=run_context),
        model_factory=DifyModelFactory(run_context=run_context),
        model_instance=DifyPreparedLLM(make_model_instance(provider="openai", model="gpt-3.5-turbo")),
        llm_file_saver=build_dify_llm_file_saver(run_context=run_context, http_client=graphon_ssrf_proxy),
        prompt_message_serializer=DifyPromptMessageSerializer(),
        http_client=graphon_ssrf_proxy,
    )

    return node


def _llm_node_execution_behavior_mock_db_session_close(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db.session, "close", MagicMock())


class TestLlmNodeExecutionBehaviorCases:
    @staticmethod
    def test_execute_llm(monkeypatch: pytest.MonkeyPatch) -> None:
        node = init_llm_node(
            config={
                "id": "llm",
                "data": {
                    "title": "123",
                    "type": "llm",
                    "model": {
                        "provider": "openai",
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

        _llm_node_execution_behavior_mock_db_session_close(monkeypatch)

        def build_model_instance() -> DifyPreparedLLM:
            from decimal import Decimal
            from unittest.mock import MagicMock

            from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
            from graphon.model_runtime.entities.message_entities import AssistantPromptMessage

            model_instance = make_model_instance(provider="openai", model="gpt-3.5-turbo")
            schema = make_model_config(provider="openai", model="gpt-3.5-turbo", mode="chat").model_schema
            monkeypatch.setattr(model_instance, "get_model_schema", MagicMock(return_value=schema))
            mock_usage = LLMUsage(
                prompt_tokens=30,
                prompt_unit_price=Decimal("0.001"),
                prompt_price_unit=Decimal(1000),
                prompt_price=Decimal("0.00003"),
                completion_tokens=20,
                completion_unit_price=Decimal("0.002"),
                completion_price_unit=Decimal(1000),
                completion_price=Decimal("0.00004"),
                total_tokens=50,
                total_price=Decimal("0.00007"),
                currency="USD",
                latency=0.5,
            )
            mock_message = AssistantPromptMessage(content="Test response from mock")
            mock_llm_result = LLMResult(
                model="gpt-3.5-turbo",
                prompt_messages=[],
                message=mock_message,
                usage=mock_usage,
            )
            monkeypatch.setattr(model_instance, "invoke_llm", MagicMock(return_value=mock_llm_result))
            return DifyPreparedLLM(model_instance)

        # Mock fetch_prompt_messages to avoid database calls
        def mock_fetch_prompt_messages_1(**_kwargs: object) -> tuple[list[PromptMessage], list[str]]:
            from graphon.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage

            return [
                SystemPromptMessage(content="you are a helpful assistant. today's weather is sunny."),
                UserPromptMessage(content="what's the weather today?"),
            ], []

        node._model_instance = build_model_instance()

        with patch("graphon.nodes.llm.llm_utils.fetch_prompt_messages", mock_fetch_prompt_messages_1):
            # execute node
            result = node._run()
            assert isinstance(result, Generator)

            for item in result:
                if isinstance(item, StreamCompletedEvent):
                    assert item.node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED, (
                        f"{item.node_run_result.error_type}: {item.node_run_result.error}"
                    )
                    assert item.node_run_result.process_data is not None
                    assert item.node_run_result.outputs is not None
                    assert item.node_run_result.outputs.get("text") is not None
                    assert item.node_run_result.outputs.get("usage", {})["total_tokens"] > 0

    @staticmethod
    def test_execute_llm_with_jinja2(monkeypatch: pytest.MonkeyPatch) -> None:
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

        _llm_node_execution_behavior_mock_db_session_close(monkeypatch)

        def build_model_instance() -> DifyPreparedLLM:
            from decimal import Decimal
            from unittest.mock import MagicMock

            from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
            from graphon.model_runtime.entities.message_entities import AssistantPromptMessage

            model_instance = make_model_instance(provider="openai", model="gpt-3.5-turbo")
            schema = make_model_config(provider="openai", model="gpt-3.5-turbo", mode="chat").model_schema
            monkeypatch.setattr(model_instance, "get_model_schema", MagicMock(return_value=schema))
            mock_usage = LLMUsage(
                prompt_tokens=30,
                prompt_unit_price=Decimal("0.001"),
                prompt_price_unit=Decimal(1000),
                prompt_price=Decimal("0.00003"),
                completion_tokens=20,
                completion_unit_price=Decimal("0.002"),
                completion_price_unit=Decimal(1000),
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
            monkeypatch.setattr(model_instance, "invoke_llm", MagicMock(return_value=mock_llm_result))
            return DifyPreparedLLM(model_instance)

        # Mock fetch_prompt_messages to avoid database calls
        def mock_fetch_prompt_messages_2(**_kwargs: object) -> tuple[list[PromptMessage], list[str]]:
            from graphon.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage

            return [
                SystemPromptMessage(content="you are a helpful assistant. today's weather is sunny."),
                UserPromptMessage(content="what's the weather today?"),
            ], []

        node._model_instance = build_model_instance()

        with patch("graphon.nodes.llm.llm_utils.fetch_prompt_messages", mock_fetch_prompt_messages_2):
            # execute node
            result = node._run()

            for item in result:
                if isinstance(item, StreamCompletedEvent):
                    assert item.node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                    assert item.node_run_result.process_data is not None
                    assert "sunny" in json.dumps(item.node_run_result.process_data)
                    assert "what's the weather today?" in json.dumps(item.node_run_result.process_data)

    @staticmethod
    def test_extract_json() -> None:
        llm_texts = [
            '<think>\n\n</think>{"name": "test", "age": 123',  # resoning model (deepseek-r1)
            '{"name":"test","age":123}',  # json schema model (gpt-4o)
            '{\n    "name": "test",\n    "age": 123\n}',  # small model (llama-3.2-1b)
            '```json\n{"name": "test", "age": 123}\n```',  # json markdown (deepseek-chat)
            '{"name":"test",age:123}',  # without quotes (qwen-2.5-0.5b)
        ]
        result = {"name": "test", "age": 123}
        assert all(_parse_structured_output(item) == result for item in llm_texts)


"""Unit coverage for parameter extraction with the plugin-model boundary replaced."""


def get_mocked_fetch_memory(memory_text: str) -> MagicMock:
    class MemoryMock(PromptMessageMemory):
        @override
        def get_history_prompt_messages(
            self,
            max_token_limit: int = 2000,
            message_limit: int | None = None,
        ) -> list[PromptMessage]:
            return [
                UserPromptMessage(content=memory_text),
                _parameter_extractor_execution_behavior_AssistantPromptMessage(content="mocked answer"),
            ]

    return MagicMock(return_value=MemoryMock())


def init_parameter_extractor_node(
    config: dict[str, object], memory: PromptMessageMemory | None = None
) -> ParameterExtractorNode:
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

    init_params = build_test_graph_init_params(
        workflow_id="1",
        graph_config=graph_config,
        tenant_id="1",
        app_id="1",
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(
            user_id="aaa", files=[], query="what's the weather in SF", conversation_id="abababa"
        ),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["a", "args1"], 1)
    variable_pool.add(["a", "args2"], 2)

    graph_runtime_state = RuntimeState(
        workflow_id="test-workflow", variable_pool=variable_pool, start_at=time.perf_counter()
    )

    run_context = resolve_dify_run_context(init_params.run_context)
    node = ParameterExtractorNode(
        node_id=str(uuid.uuid4()),
        data=ParameterExtractorNodeData.model_validate(config["data"]),
        init_params=init_params,
        runtime_state=graph_runtime_state,
        credentials_provider=DifyCredentialsProvider(run_context=run_context),
        model_factory=DifyModelFactory(run_context=run_context),
        model_instance=DifyPreparedLLM(make_model_instance(provider="openai", model="gpt-3.5-turbo")),
        memory=memory,
        prompt_message_serializer=DifyPromptMessageSerializer(),
    )
    return node


def _parameter_extractor_execution_behavior_mock_db_session_close(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db.session, "close", MagicMock())


class TestParameterExtractorExecutionBehaviorCases:
    @staticmethod
    @pytest.mark.usefixtures("setup_model_mock")
    def test_function_calling_parameter_extractor(monkeypatch: pytest.MonkeyPatch) -> None:
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

        node._model_instance = get_mocked_fetch_model_instance(
            provider="langgenius/openai/openai",
            model="gpt-3.5-turbo",
            mode="chat",
            credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
        )()
        _parameter_extractor_execution_behavior_mock_db_session_close(monkeypatch)

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs is not None
        assert result.outputs.get("location") == "kawaii"
        assert result.outputs.get("__reason") is None

    @staticmethod
    @pytest.mark.usefixtures("setup_model_mock")
    def test_instructions(monkeypatch: pytest.MonkeyPatch) -> None:
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

        node._model_instance = get_mocked_fetch_model_instance(
            provider="langgenius/openai/openai",
            model="gpt-3.5-turbo",
            mode="chat",
            credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
        )()
        _parameter_extractor_execution_behavior_mock_db_session_close(monkeypatch)

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs is not None
        assert result.outputs.get("location") == "kawaii"
        assert result.outputs.get("__reason") is None

        process_data = result.process_data

        assert process_data is not None
        process_data.get("prompts")

        for prompt in process_data.get("prompts", []):
            if prompt.get("role") == "system":
                assert "what's the weather in SF" in prompt.get("text")

    @staticmethod
    @pytest.mark.usefixtures("setup_model_mock")
    def test_chat_parameter_extractor(monkeypatch: pytest.MonkeyPatch) -> None:
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

        node._model_instance = get_mocked_fetch_model_instance(
            provider="langgenius/openai/openai",
            model="gpt-3.5-turbo",
            mode="chat",
            credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
        )()
        _parameter_extractor_execution_behavior_mock_db_session_close(monkeypatch)

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

    @staticmethod
    @pytest.mark.usefixtures("setup_model_mock")
    def test_completion_parameter_extractor(monkeypatch: pytest.MonkeyPatch) -> None:
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

        node._model_instance = get_mocked_fetch_model_instance(
            provider="langgenius/openai/openai",
            model="gpt-3.5-turbo-instruct",
            mode="completion",
            credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
        )()
        _parameter_extractor_execution_behavior_mock_db_session_close(monkeypatch)

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

    @staticmethod
    def test_extract_json_response() -> None:
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

    @staticmethod
    def test_extract_json_from_tool_call() -> None:
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
            _parameter_extractor_execution_behavior_AssistantPromptMessage.ToolCall(
                id="llm",
                type="parameter-extractor",
                function=_parameter_extractor_execution_behavior_AssistantPromptMessage.ToolCall.ToolCallFunction(
                    name="foo", arguments="""{"location":"kawaii"}{"location": 1}"""
                ),
            )
        )

        assert result is not None
        assert result["location"] == "kawaii"

    @staticmethod
    @pytest.mark.usefixtures("setup_model_mock")
    def test_chat_parameter_extractor_with_memory(monkeypatch: pytest.MonkeyPatch) -> None:
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
            memory=get_mocked_fetch_memory("customized memory")(),
        )

        node._model_instance = get_mocked_fetch_model_instance(
            provider="langgenius/openai/openai",
            model="gpt-3.5-turbo",
            mode="chat",
            credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
        )()
        _parameter_extractor_execution_behavior_mock_db_session_close(monkeypatch)

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


"""Unit coverage for tool-node invocation with the tool boundary patched."""


def init_tool_node(config: dict[str, object]) -> ToolNode:
    graph_config = {
        "edges": [
            {
                "id": "start-source-next-target",
                "source": "start",
                "target": "1",
            },
        ],
        "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}, config],
    }

    init_params = build_test_graph_init_params(
        workflow_id="1",
        graph_config=graph_config,
        tenant_id="1",
        app_id="1",
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(user_id="aaa", files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )

    graph_runtime_state = RuntimeState(
        workflow_id="test-workflow", variable_pool=variable_pool, start_at=time.perf_counter()
    )

    # Create node factory
    node_factory = DifyNodeFactory(
        init_params=init_params,
        runtime_state=graph_runtime_state,
    )

    Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")

    tool_file_manager = DifyToolFileManager(init_params.run_context)

    node = ToolNode(
        node_id=str(uuid.uuid4()),
        data=ToolNodeData.model_validate(config["data"]),
        init_params=init_params,
        runtime_state=graph_runtime_state,
        tool_file_manager=tool_file_manager,
        runtime=DifyToolNodeRuntime(init_params.run_context),
    )
    node.bind_execution_id(str(uuid.uuid4()))
    return node


class TestToolNodeInvocationBehaviorCases:
    @staticmethod
    def test_tool_variable_invoke() -> None:
        node = init_tool_node(
            config={
                "id": "1",
                "data": {
                    "type": "tool",
                    "title": "a",
                    "desc": "a",
                    "provider_id": "time",
                    "provider_type": "builtin",
                    "provider_name": "time",
                    "tool_name": "current_time",
                    "tool_label": "current_time",
                    "tool_configurations": {},
                    "tool_parameters": {},
                },
            }
        )

        with patch.object(
            ToolParameterConfigurationManager,
            "decrypt_tool_parameters",
            return_value={"format": "%Y-%m-%d %H:%M:%S"},
        ):
            node.runtime_state.variable_pool.add(["1", "args1"], "1+1")

            # execute node
            result = node._run()
            for item in result:
                if isinstance(item, StreamCompletedEvent):
                    assert item.node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                    assert item.node_run_result.outputs is not None
                    assert item.node_run_result.outputs.get("text") is not None

    @staticmethod
    def test_tool_mixed_invoke() -> None:
        node = init_tool_node(
            config={
                "id": "1",
                "data": {
                    "type": "tool",
                    "title": "a",
                    "desc": "a",
                    "provider_id": "time",
                    "provider_type": "builtin",
                    "provider_name": "time",
                    "tool_name": "current_time",
                    "tool_label": "current_time",
                    "tool_configurations": {
                        "format": "%Y-%m-%d %H:%M:%S",
                    },
                    "tool_parameters": {},
                },
            }
        )

        with patch.object(
            ToolParameterConfigurationManager,
            "decrypt_tool_parameters",
            return_value={"format": "%Y-%m-%d %H:%M:%S"},
        ):
            # execute node
            result = node._run()
            for item in result:
                if isinstance(item, StreamCompletedEvent):
                    assert item.node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
                    assert item.node_run_result.outputs is not None
                    assert item.node_run_result.outputs.get("text") is not None


def _build_tool_node_data() -> ToolNodeData:
    return ToolNodeData.model_validate(
        {
            "type": "tool",
            "title": "Tool",
            "provider_id": "provider",
            "provider_type": ToolProviderType.BUILT_IN,
            "provider_name": "provider",
            "tool_name": "lookup",
            "tool_label": "Lookup",
            "tool_configurations": {},
            "tool_parameters": {},
        }
    )


class TestToolNodeRuntimeCases:
    @staticmethod
    @pytest.fixture
    def runtime(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> DifyToolNodeRuntime:
        module_name = "core.ops.ops_trace_manager"
        if module_name not in sys.modules:
            ops_stub = types.ModuleType(module_name)
            ops_stub.TraceQueueManager = object  # pragma: no cover - stub attribute
            ops_stub.TraceTask = object  # pragma: no cover - stub attribute
            monkeypatch.setitem(sys.modules, module_name, ops_stub)

        init_params = build_test_graph_init_params(
            workflow_id="workflow-id",
            graph_config={"nodes": [], "edges": []},
            tenant_id="tenant-id",
            app_id="app-id",
            user_id="user-id",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )
        session_maker = sessionmaker(sqlite_engine, expire_on_commit=False)
        return DifyToolNodeRuntime(init_params.run_context, session_maker=session_maker)

    @staticmethod
    def test_invoke_creates_callback_and_converts_messages(runtime: DifyToolNodeRuntime) -> None:
        core_message = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.LINK,
            message=ToolInvokeMessage.TextMessage(text="https://dify.ai"),
            meta=None,
        )
        variable_pool: VariablePool = build_test_variable_pool(
            variables=build_system_variables(conversation_id="conversation-id")
        )
        workflow_tool = MagicMock()

        with (
            patch.object(ToolManager, "get_workflow_tool_runtime", return_value=workflow_tool),
            patch.object(ToolEngine, "generic_invoke", return_value=iter([core_message])) as generic_invoke_mock,
            patch.object(
                ToolFileMessageTransformer,
                "transform_tool_invoke_messages",
                side_effect=lambda *, messages, **_: messages,
            ) as transform_tool_messages,
        ):
            tool_runtime = runtime.get_runtime(
                node_id="node-id",
                node_data=_build_tool_node_data(),
                variable_pool=variable_pool,
            )
            messages = list(
                runtime.invoke(
                    tool_runtime=tool_runtime,
                    tool_parameters={},
                    workflow_call_depth=0,
                    provider_name="provider",
                )
            )

        assert not hasattr(tool_runtime, "conversation_id")
        assert len(messages) == 1
        graph_message = messages[0]
        assert graph_message.type == ToolRuntimeMessage.MessageType.LINK
        assert isinstance(graph_message.message, ToolRuntimeMessage.TextMessage)
        assert graph_message.message.text == "https://dify.ai"

        callback = generic_invoke_mock.call_args.kwargs["workflow_tool_callback"]
        assert isinstance(callback, DifyWorkflowCallbackHandler)
        assert generic_invoke_mock.call_args.kwargs["session"] is not None
        assert generic_invoke_mock.call_args.kwargs["conversation_id"] == "conversation-id"

        transform_kwargs = transform_tool_messages.call_args.kwargs
        assert transform_kwargs["conversation_id"] == "conversation-id"

    @staticmethod
    def test_invoke_maps_plugin_errors_to_graph_errors(runtime: DifyToolNodeRuntime) -> None:
        invoke_error = PluginInvokeError('{"error_type":"RateLimit","message":"too many"}')

        with patch.object(ToolEngine, "generic_invoke", side_effect=invoke_error):
            with pytest.raises(ToolRuntimeInvocationError, match="An error occurred in the provider"):
                list(
                    runtime.invoke(
                        tool_runtime=ToolRuntimeHandle(raw=MagicMock()),
                        tool_parameters={},
                        workflow_call_depth=0,
                        provider_name="provider",
                    )
                )

    @staticmethod
    def test_get_usage_normalizes_dict_payload(runtime: DifyToolNodeRuntime) -> None:
        usage_payload = LLMUsage.empty_usage().model_dump()
        usage_payload["total_tokens"] = 42

        usage = runtime.get_usage(
            tool_runtime=ToolRuntimeHandle(raw=SimpleNamespace(latest_usage=usage_payload)),
        )

        assert usage.total_tokens == 42

    @staticmethod
    def test_get_runtime_converts_graph_provider_type_for_tool_manager(runtime: DifyToolNodeRuntime) -> None:
        node_data = _build_tool_node_data()

        with patch.object(ToolManager, "get_workflow_tool_runtime", return_value=MagicMock()) as runtime_mock:
            tool_runtime = runtime.get_runtime(node_id="node-id", node_data=node_data, variable_pool=None)

        assert not hasattr(tool_runtime, "conversation_id")
        workflow_tool = runtime_mock.call_args.args[3]
        assert workflow_tool.provider_type == CoreToolProviderType.BUILT_IN

    @staticmethod
    def test_get_runtime_stores_parent_trace_context_for_workflow_tools(
        runtime: DifyToolNodeRuntime,
    ) -> None:
        variable_pool: VariablePool = build_test_variable_pool(
            variables=build_system_variables(
                conversation_id="conversation-id",
                workflow_execution_id="workflow-run-id",
            )
        )
        workflow_runtime = MagicMock()
        workflow_runtime.runtime.runtime_parameters = {}
        node_data = ToolNodeData.model_validate(
            {
                "type": "tool",
                "title": "Tool",
                "provider_id": "provider",
                "provider_type": ToolProviderType.WORKFLOW,
                "provider_name": "provider",
                "tool_name": "lookup",
                "tool_label": "Lookup",
                "tool_configurations": {},
                "tool_parameters": {},
            }
        )

        with patch.object(ToolManager, "get_workflow_tool_runtime", return_value=workflow_runtime):
            tool_runtime = runtime.get_runtime(
                node_id="node-id",
                node_data=node_data,
                variable_pool=variable_pool,
                node_execution_id="node-execution-id",
            )

        assert tool_runtime.raw.parent_trace_context.model_dump() == {
            "parent_workflow_run_id": "workflow-run-id",
            "parent_node_execution_id": "node-execution-id",
        }
        assert workflow_runtime.runtime.runtime_parameters == {}

    @staticmethod
    def test_get_runtime_stores_trace_session_id_for_workflow_tools(
        runtime: DifyToolNodeRuntime,
    ) -> None:
        variable_pool: VariablePool = build_test_variable_pool(
            variables=build_system_variables(
                conversation_id="conversation-id",
                workflow_execution_id="workflow-run-id",
            )
        )
        workflow_runtime = MagicMock()
        workflow_runtime.runtime.runtime_parameters = {}
        runtime._run_context.trace_session_id = "session-1"
        node_data = ToolNodeData.model_validate(
            {
                "type": "tool",
                "title": "Tool",
                "provider_id": "provider",
                "provider_type": ToolProviderType.WORKFLOW,
                "provider_name": "provider",
                "tool_name": "lookup",
                "tool_label": "Lookup",
                "tool_configurations": {},
                "tool_parameters": {},
            }
        )

        with patch.object(ToolManager, "get_workflow_tool_runtime", return_value=workflow_runtime):
            tool_runtime = runtime.get_runtime(
                node_id="node-id",
                node_data=node_data,
                variable_pool=variable_pool,
                node_execution_id="node-execution-id",
            )

        assert tool_runtime.raw.trace_session_id == "session-1"
        assert workflow_runtime.runtime.runtime_parameters == {}

    @staticmethod
    def test_get_runtime_leaves_non_workflow_tool_runtime_parameters_unchanged(
        runtime: DifyToolNodeRuntime,
    ) -> None:
        variable_pool: VariablePool = build_test_variable_pool(
            variables=build_system_variables(
                conversation_id="conversation-id",
                workflow_execution_id="workflow-run-id",
            )
        )
        builtin_runtime = MagicMock()
        builtin_runtime.runtime.runtime_parameters = {}

        with patch.object(ToolManager, "get_workflow_tool_runtime", return_value=builtin_runtime):
            runtime.get_runtime(
                node_id="node-id",
                node_data=_build_tool_node_data(),
                variable_pool=variable_pool,
                node_execution_id="node-execution-id",
            )

        assert builtin_runtime.runtime.runtime_parameters == {}

    @staticmethod
    def test_get_runtime_parameters_reads_required_flags(runtime: DifyToolNodeRuntime) -> None:
        tool_runtime = ToolRuntimeHandle(
            raw=SimpleNamespace(
                get_merged_runtime_parameters=MagicMock(
                    return_value=[
                        SimpleNamespace(name="city", required=True),
                        SimpleNamespace(name="country", required=False),
                    ]
                )
            )
        )

        parameters = runtime.get_runtime_parameters(tool_runtime=tool_runtime)

        assert [(parameter.name, parameter.required) for parameter in parameters] == [
            ("city", True),
            ("country", False),
        ]

    @staticmethod
    def test_get_usage_returns_empty_usage_when_tool_has_no_usage(runtime: DifyToolNodeRuntime) -> None:
        usage = runtime.get_usage(tool_runtime=ToolRuntimeHandle(raw=SimpleNamespace(latest_usage=None)))

        assert usage == LLMUsage.empty_usage()

    @staticmethod
    @pytest.mark.parametrize(
        ("payload", "expected_type"),
        [
            (
                ToolInvokeMessage.JsonMessage(json_object={"ok": True}, suppress_output=True),
                ToolRuntimeMessage.JsonMessage,
            ),
            (ToolInvokeMessage.BlobMessage(blob=b"bytes"), ToolRuntimeMessage.BlobMessage),
            (
                ToolInvokeMessage.BlobChunkMessage(
                    id="blob-id",
                    sequence=1,
                    total_length=5,
                    blob=b"hello",
                    end=True,
                ),
                ToolRuntimeMessage.BlobChunkMessage,
            ),
            (ToolInvokeMessage.FileMessage(file_marker="marker"), ToolRuntimeMessage.FileMessage),
            (
                ToolInvokeMessage.VariableMessage(variable_name="city", variable_value="Tokyo", stream=True),
                ToolRuntimeMessage.VariableMessage,
            ),
            (
                ToolInvokeMessage.LogMessage(
                    id="log-id",
                    label="lookup",
                    status=ToolInvokeMessage.LogMessage.LogStatus.SUCCESS,
                    data={"count": 1},
                    metadata={"source": "tool"},
                ),
                ToolRuntimeMessage.LogMessage,
            ),
        ],
    )
    def test_convert_message_payload_supports_runtime_message_types(
        runtime: DifyToolNodeRuntime,
        payload: object,
        expected_type: type[object],
    ) -> None:
        message = runtime._convert_message_payload(payload)

        assert isinstance(message, expected_type)

    @staticmethod
    def test_convert_message_payload_rejects_unknown_types(runtime: DifyToolNodeRuntime) -> None:
        with pytest.raises(TypeError, match="unsupported tool message payload"):
            runtime._convert_message_payload(object())

    @staticmethod
    def test_resolve_provider_icons_prefers_builtin_tool_icons(runtime: DifyToolNodeRuntime) -> None:
        plugin = SimpleNamespace(
            plugin_id="langgenius/tools",
            name="search",
            declaration=SimpleNamespace(icon={"plugin": "icon"}),
        )
        builtin_tool = SimpleNamespace(
            name="langgenius/tools/search",
            icon={"builtin": "icon"},
            icon_dark={"builtin": "dark"},
        )

        with (
            patch("core.workflow.node_runtime.PluginInstaller") as installer_cls,
            patch(
                "core.workflow.node_runtime.BuiltinToolManageService.list_builtin_tools", return_value=[builtin_tool]
            ),
        ):
            installer_cls.return_value.list_plugins.return_value = [plugin]

            icon, icon_dark = runtime.resolve_provider_icons(provider_name="langgenius/tools/search")

        assert icon == {"builtin": "icon"}
        assert icon_dark == {"builtin": "dark"}

    @staticmethod
    def test_resolve_provider_icons_returns_default_when_provider_is_unknown(runtime: DifyToolNodeRuntime) -> None:
        with (
            patch("core.workflow.node_runtime.PluginInstaller") as installer_cls,
            patch("core.workflow.node_runtime.BuiltinToolManageService.list_builtin_tools", return_value=[]),
        ):
            installer_cls.return_value.list_plugins.return_value = []

            icon, icon_dark = runtime.resolve_provider_icons(provider_name="unknown", default_icon="fallback")

        assert icon == "fallback"
        assert icon_dark is None

    @staticmethod
    @pytest.mark.parametrize(
        ("exc", "message"),
        [
            (PluginDaemonClientSideError("bad request"), "Failed to invoke tool, error: bad request"),
            (ToolInvokeError("broken"), "Failed to invoke tool provider: broken"),
            (RuntimeError("unexpected"), "unexpected"),
        ],
    )
    def test_map_invocation_exception_normalizes_runtime_errors(
        runtime: DifyToolNodeRuntime,
        exc: Exception,
        message: str,
    ) -> None:
        error = runtime._map_invocation_exception(exc, provider_name="provider")

        assert isinstance(error, ToolRuntimeInvocationError)
        assert str(error) == message


def _persist_attachment(
    session: Session,
    *,
    segment_id: str,
    upload_file_id: str,
    upload_file_tenant_id: str = "tenant-id",
) -> UploadFile:
    """Persist an attachment binding for the test tenant and its referenced upload file."""

    upload_file = UploadFile(
        tenant_id=upload_file_tenant_id,
        storage_type=StorageType.LOCAL,
        key="storage-key",
        name="diagram.png",
        size=128,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-id",
        created_at=datetime.now(UTC).replace(tzinfo=None),
        used=False,
        source_url="https://example.com/diagram.png",
    )
    upload_file.id = upload_file_id
    session.add_all(
        [
            upload_file,
            SegmentAttachmentBinding(
                tenant_id="tenant-id",
                dataset_id="dataset-id",
                document_id="document-id",
                segment_id=segment_id,
                attachment_id=upload_file_id,
            ),
        ]
    )
    session.commit()
    return upload_file


def _build_model_schema(*, features: list[ModelFeature] | None = None) -> AIModelEntity:
    return AIModelEntity(
        model="gpt-4o-mini",
        label=I18nObject(en_US="GPT-4o mini"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
        features=features,
    )


class _ModelTypeInstanceStub(LargeLanguageModel):
    def __init__(
        self,
        *,
        model_schema: AIModelEntity | None,
        model_runtime: object | None = None,
    ) -> None:
        self.model_runtime = model_runtime
        self.get_model_schema = Mock(return_value=model_schema)


class _ModelInstanceStub:
    def __init__(
        self,
        *,
        model_schema: AIModelEntity | None,
        model_runtime: object | None = None,
        invoke_llm_result: object = sentinel.result,
        get_llm_num_tokens_result: int = 32,
    ) -> None:
        self.provider = "langgenius/openai/openai"
        self.model_name = "gpt-4o-mini"
        self.parameters = {"temperature": 0.2}
        self.stop = ("stop",)
        self.credentials = {"api_key": "secret"}
        self.model_type_instance = _ModelTypeInstanceStub(
            model_schema=model_schema,
            model_runtime=model_runtime,
        )
        self.get_llm_num_tokens = Mock(return_value=get_llm_num_tokens_result)
        self.invoke_llm = Mock(return_value=invoke_llm_result)


class _QuotaManagedModelInstanceStub(_ModelInstanceStub, QuotaManagedModelInstance):
    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self.reserve_quota = Mock()


def _build_run_context(*, invoke_from: InvokeFrom | str = InvokeFrom.DEBUGGER) -> dict[str, object]:
    return build_test_run_context(
        tenant_id="tenant-id",
        app_id="app-id",
        user_id="user-id",
        user_from=UserFrom.ACCOUNT,
        invoke_from=invoke_from,
    )


def _build_email_method(*, debug_mode: bool = False) -> EmailDeliveryMethod:
    return EmailDeliveryMethod(
        enabled=True,
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(include_bound_group=True, items=[]),
            subject="Subject",
            body="Visit {{#url#}}",
            debug_mode=debug_mode,
        ),
    )


class TestNodeRuntimeCases:
    @staticmethod
    @pytest.fixture
    def attachment_session(sqlite_engine: Engine) -> Iterator[Session]:
        """Provide real attachment and upload-file persistence to node runtime tests."""

        TypeBase.metadata.create_all(sqlite_engine, tables=[SegmentAttachmentBinding.__table__, UploadFile.__table__])
        with Session(sqlite_engine, expire_on_commit=False) as session:
            yield session

    @staticmethod
    def test_resolve_dify_run_context_accepts_mapping_payload() -> None:
        run_context = resolve_dify_run_context(_build_run_context())

        assert run_context.tenant_id == "tenant-id"
        assert run_context.invoke_from == InvokeFrom.DEBUGGER

    @staticmethod
    def test_resolve_dify_run_context_requires_reserved_key() -> None:
        with pytest.raises(ValueError, match=DIFY_RUN_CONTEXT_KEY):
            resolve_dify_run_context({})

    @staticmethod
    def test_apply_dify_debug_email_recipient_rewrites_debug_target() -> None:
        method = _build_email_method(debug_mode=True)

        updated = apply_dify_debug_email_recipient(method, enabled=True, actor_id="actor-id")

        assert isinstance(updated, EmailDeliveryMethod)
        assert updated.config.recipients.include_bound_group is False
        assert len(updated.config.recipients.items) == 1
        assert updated.config.recipients.items[0].reference_id == "actor-id"

    @staticmethod
    @pytest.mark.parametrize(
        ("enabled", "method"),
        [
            (False, _build_email_method(debug_mode=True)),
            (True, _build_email_method(debug_mode=False)),
            (True, WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig())),
        ],
    )
    def test_apply_dify_debug_email_recipient_noops_when_override_is_not_needed(
        enabled: bool,
        method: object,
    ) -> None:
        assert apply_dify_debug_email_recipient(method, enabled=enabled, actor_id="actor-id") is method

    @staticmethod
    def test_dify_file_reference_factory_passes_tenant_id(monkeypatch: pytest.MonkeyPatch) -> None:
        build_from_mapping = MagicMock(return_value=sentinel.file)
        monkeypatch.setattr(node_runtime.file_factory, "build_from_mapping", build_from_mapping)

        factory = DifyFileReferenceFactory(_build_run_context())

        result = factory.build_from_mapping(mapping={"id": "upload-file"})

        assert result is sentinel.file
        build_from_mapping.assert_called_once_with(
            mapping={"id": "upload-file"},
            tenant_id="tenant-id",
            access_controller=node_runtime._file_access_controller,
        )

    @staticmethod
    def test_dify_prepared_llm_wraps_model_instance_calls() -> None:
        model_schema = _build_model_schema()
        model_instance = _ModelInstanceStub(model_schema=model_schema)
        model_type_instance = model_instance.model_type_instance
        prepared = DifyPreparedLLM(model_instance, request_metadata={"app_id": "app-id"})

        assert prepared.provider == "langgenius/openai/openai"
        assert prepared.model_name == "gpt-4o-mini"
        assert prepared.parameters == {"temperature": 0.2}
        assert prepared.stop == ("stop",)
        assert prepared.get_model_schema() == model_schema
        assert prepared.get_llm_num_tokens([]) == 32
        assert (
            prepared.invoke_llm(
                prompt_messages=[],
                model_parameters={"temperature": 0.1},
                tools=None,
                stop=None,
                stream=False,
            )
            is sentinel.result
        )

        model_type_instance.get_model_schema.assert_called_once_with("gpt-4o-mini", {"api_key": "secret"})
        model_instance.invoke_llm.assert_called_once_with(
            prompt_messages=[],
            model_parameters={"temperature": 0.1},
            tools=[],
            stop=[],
            stream=False,
            request_metadata={"app_id": "app-id"},
        )

    @staticmethod
    def test_dify_prepared_llm_requires_model_schema() -> None:
        model_instance = _ModelInstanceStub(model_schema=None)
        model_instance.credentials = {}
        prepared = DifyPreparedLLM(model_instance)

        with pytest.raises(ValueError, match="Model schema not found"):
            prepared.get_model_schema()

    @staticmethod
    def test_dify_prepared_llm_delegates_structured_output_helper(monkeypatch: pytest.MonkeyPatch) -> None:
        model_instance = _ModelInstanceStub(model_schema=_build_model_schema())
        prepared = DifyPreparedLLM(model_instance, request_metadata={"created_by": "workflow"})
        invoke_structured = MagicMock(return_value=sentinel.structured)
        monkeypatch.setattr(node_runtime, "invoke_llm_with_structured_output", invoke_structured)

        result = prepared.invoke_llm_with_structured_output(
            prompt_messages=[],
            json_schema={"type": "object"},
            model_parameters={"temperature": 0.2},
            stop=("done",),
            stream=True,
        )

        assert result is sentinel.structured
        invoke_structured.assert_called_once_with(
            provider="langgenius/openai/openai",
            model_schema=prepared.get_model_schema(),
            model_instance=model_instance,
            prompt_messages=[],
            json_schema={"type": "object"},
            model_parameters={"temperature": 0.2},
            stop=["done"],
            stream=True,
            request_metadata={"created_by": "workflow"},
        )

    @staticmethod
    def test_dify_prepared_llm_identifies_structured_output_errors() -> None:
        prepared = DifyPreparedLLM(SimpleNamespace())

        assert prepared.is_structured_output_parse_error(OutputParserError("bad json")) is True
        assert prepared.is_structured_output_parse_error(ValueError("other")) is False

    @staticmethod
    def test_dify_prepared_polling_llm_delegates_to_plugin_runtime() -> None:
        polling_result = LLMPollingResult(
            status=LLMPollingStatus.RUNNING,
            plugin_state={"task_id": "poll-1"},
            next_check_after_seconds=2,
        )
        plugin_runtime = PluginModelRuntime(
            tenant_id="tenant-id",
            user_id="user-id",
            client=PluginModelClient(),
            plugin_service=PluginService,
        )
        plugin_runtime.start_llm_polling = Mock(return_value=polling_result)  # type: ignore[method-assign]
        plugin_runtime.check_llm_polling = Mock(return_value=polling_result)  # type: ignore[method-assign]
        model_instance = _ModelInstanceStub(
            model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
            model_runtime=plugin_runtime,
        )

        prepared = DifyPreparedPollingLLM(model_instance)

        assert isinstance(prepared, LLMPollingCapableProtocol)
        assert (
            prepared.start_llm_polling(
                prompt_messages=[],
                model_parameters={"temperature": 0.1},
                tools=[],
                stop=("END",),
                json_schema={"type": "object"},
            )
            == polling_result
        )
        assert (
            prepared.check_llm_polling(
                plugin_state={"task_id": "poll-1"},
            )
            == polling_result
        )
        plugin_runtime.start_llm_polling.assert_called_once_with(
            provider="langgenius/openai/openai",
            model="gpt-4o-mini",
            credentials={"api_key": "secret"},
            prompt_messages=[],
            model_parameters={"temperature": 0.1},
            tools=[],
            stop=("END",),
            json_schema={"type": "object"},
        )
        plugin_runtime.check_llm_polling.assert_called_once_with(
            provider="langgenius/openai/openai",
            model="gpt-4o-mini",
            credentials={"api_key": "secret"},
            plugin_state={"task_id": "poll-1"},
        )

    @staticmethod
    def test_dify_prepared_polling_llm_commits_successful_reservation() -> None:
        running_result = LLMPollingResult(
            status=LLMPollingStatus.RUNNING,
            plugin_state={"task_id": "poll-1"},
        )
        usage = node_runtime.LLMUsage.empty_usage().model_copy(update={"total_tokens": 5})
        succeeded_result = LLMPollingResult(
            status=LLMPollingStatus.SUCCEEDED,
            result=node_runtime.LLMResult(
                model="gpt-4o-mini",
                prompt_messages=[],
                message=_node_runtime_AssistantPromptMessage(content="done"),
                usage=usage,
            ),
        )
        plugin_runtime = PluginModelRuntime(
            tenant_id="tenant-id",
            user_id="user-id",
            client=PluginModelClient(),
            plugin_service=PluginService,
        )
        plugin_runtime.start_llm_polling = Mock(return_value=running_result)  # type: ignore[method-assign]
        plugin_runtime.check_llm_polling = Mock(return_value=succeeded_result)  # type: ignore[method-assign]
        reservation = MagicMock()
        model_instance = _QuotaManagedModelInstanceStub(
            model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
            model_runtime=plugin_runtime,
        )
        model_instance.reserve_quota.return_value = reservation
        prepared = DifyPreparedPollingLLM(model_instance)

        prepared.start_llm_polling(
            prompt_messages=[],
            model_parameters={},
            tools=None,
            stop=None,
            json_schema=None,
        )
        prepared.check_llm_polling(plugin_state={"task_id": "poll-1"})

        reservation.commit.assert_called_once_with(usage)
        reservation.release.assert_not_called()

    @staticmethod
    def test_dify_prepared_polling_llm_releases_reservation_when_success_has_no_result(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        succeeded_result = LLMPollingResult.model_construct(status=LLMPollingStatus.SUCCEEDED, result=None)
        polling_runtime = PluginModelRuntime(
            tenant_id="tenant-id",
            user_id="user-id",
            client=PluginModelClient(),
            plugin_service=PluginService,
        )
        started_pollings: list[dict[str, object]] = []

        def start_llm_polling(**kwargs: object) -> LLMPollingResult:
            started_pollings.append(kwargs)
            return succeeded_result

        monkeypatch.setattr(polling_runtime, "start_llm_polling", start_llm_polling)
        reservation = sentinel.quota_reservation
        model_instance = _QuotaManagedModelInstanceStub(
            model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
            model_runtime=polling_runtime,
        )
        model_instance.reserve_quota.return_value = reservation
        prepared = DifyPreparedPollingLLM(model_instance)

        with (
            patch.object(node_runtime.QuotaManagedModelInstance, "release_quota_safely") as release_quota_safely,
            pytest.raises(ValueError, match="must include a model result"),
        ):
            prepared.start_llm_polling(
                prompt_messages=[],
                model_parameters={},
                tools=None,
                stop=None,
                json_schema=None,
            )

        release_quota_safely.assert_called_once_with(reservation)
        assert len(started_pollings) == 1

    @staticmethod
    def test_dify_prepared_polling_llm_releases_previous_reservation_on_restart() -> None:
        running_result = LLMPollingResult(
            status=LLMPollingStatus.RUNNING,
            plugin_state={"task_id": "poll-1"},
        )
        plugin_runtime = PluginModelRuntime(
            tenant_id="tenant-id",
            user_id="user-id",
            client=PluginModelClient(),
            plugin_service=PluginService,
        )
        plugin_runtime.start_llm_polling = Mock(return_value=running_result)  # type: ignore[method-assign]
        first_reservation = MagicMock()
        second_reservation = MagicMock()
        model_instance = _QuotaManagedModelInstanceStub(
            model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
            model_runtime=plugin_runtime,
        )
        model_instance.reserve_quota.side_effect = [first_reservation, second_reservation]
        prepared = DifyPreparedPollingLLM(model_instance)

        for _ in range(2):
            prepared.start_llm_polling(
                prompt_messages=[],
                model_parameters={},
                tools=None,
                stop=None,
                json_schema=None,
            )

        first_reservation.release.assert_called_once_with()
        second_reservation.release.assert_not_called()
        assert model_instance.reserve_quota.call_count == 2

    @staticmethod
    def test_dify_prepared_polling_llm_releases_reservation_when_finalized() -> None:
        running_result = LLMPollingResult(
            status=LLMPollingStatus.RUNNING,
            plugin_state={"task_id": "poll-1"},
        )
        polling_runtime = SimpleNamespace(
            start_llm_polling=Mock(return_value=running_result),
            check_llm_polling=Mock(),
        )
        reservation = MagicMock()
        model_instance = _QuotaManagedModelInstanceStub(
            model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
            model_runtime=polling_runtime,
        )
        model_instance.reserve_quota.return_value = reservation
        prepared = DifyPreparedPollingLLM(model_instance)

        prepared.start_llm_polling(
            prompt_messages=[],
            model_parameters={},
            tools=None,
            stop=None,
            json_schema=None,
        )
        prepared.finalize_llm_polling()
        prepared.finalize_llm_polling()

        reservation.release.assert_called_once_with()

    @staticmethod
    def test_dify_prepared_polling_llm_releases_reservation_when_check_fails() -> None:
        running_result = LLMPollingResult(
            status=LLMPollingStatus.RUNNING,
            plugin_state={"task_id": "poll-1"},
        )
        polling_runtime = SimpleNamespace(
            start_llm_polling=Mock(return_value=running_result),
            check_llm_polling=Mock(side_effect=RuntimeError("polling failed")),
        )
        reservation = MagicMock()
        model_instance = _QuotaManagedModelInstanceStub(
            model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
            model_runtime=polling_runtime,
        )
        model_instance.reserve_quota.return_value = reservation
        prepared = DifyPreparedPollingLLM(model_instance)

        prepared.start_llm_polling(
            prompt_messages=[],
            model_parameters={},
            tools=None,
            stop=None,
            json_schema=None,
        )

        with pytest.raises(RuntimeError, match="polling failed"):
            prepared.check_llm_polling(plugin_state={"task_id": "poll-1"})

        reservation.release.assert_called_once_with()

    @staticmethod
    def test_dify_prepared_polling_llm_raise_exception_when_polling_is_unsupported() -> None:
        llm_result = node_runtime.LLMResult(
            model="gpt-4o-mini",
            prompt_messages=[],
            message=_node_runtime_AssistantPromptMessage(content="sync-result"),
            usage=node_runtime.LLMUsage.empty_usage(),
        )
        plugin_runtime = PluginModelRuntime(
            tenant_id="tenant-id",
            user_id="user-id",
            client=Mock(),
            plugin_service=Mock(),
        )
        plugin_runtime.start_llm_polling = Mock(side_effect=PluginLLMPollingUnsupportedError("Polling unsupported"))  # type: ignore[method-assign]
        model_instance = _ModelInstanceStub(
            model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
            model_runtime=plugin_runtime,
            invoke_llm_result=llm_result,
        )

        prepared = DifyPreparedPollingLLM(model_instance)

        with pytest.raises(PluginLLMPollingUnsupportedError):
            prepared.start_llm_polling(
                prompt_messages=[],
                model_parameters={"temperature": 0.1},
                tools=None,
                stop=None,
                json_schema=None,
            )

    @staticmethod
    def test_dify_prompt_message_serializer_delegates(monkeypatch: pytest.MonkeyPatch) -> None:
        serialize = MagicMock(return_value={"prompt": "value"})
        monkeypatch.setattr(node_runtime.PromptMessageUtil, "prompt_messages_to_prompt_for_saving", serialize)

        result = DifyPromptMessageSerializer().serialize(
            model_mode="chat",
            prompt_messages=[],
        )

        assert result == {"prompt": "value"}
        serialize.assert_called_once_with(
            model_mode="chat",
            prompt_messages=[],
        )

    @staticmethod
    def test_dify_retriever_attachment_loader_builds_graph_files(
        monkeypatch: pytest.MonkeyPatch, attachment_session: Session
    ) -> None:
        _persist_attachment(attachment_session, segment_id="segment-id", upload_file_id="upload-file-id")
        build_from_mapping = MagicMock(return_value=sentinel.file)
        monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=attachment_session.get_bind()))
        loader = DifyRetrieverAttachmentLoader(
            file_reference_factory=SimpleNamespace(build_from_mapping=build_from_mapping)
        )

        files = loader.load(segment_id="segment-id")

        assert files == [sentinel.file]
        build_from_mapping.assert_called_once()
        mapping = build_from_mapping.call_args.kwargs["mapping"]
        assert mapping["id"] == "upload-file-id"
        assert mapping["transfer_method"] == FileTransferMethod.LOCAL_FILE
        assert mapping["type"] == FileType.IMAGE
        assert parse_file_reference(mapping["reference"]).storage_key is None

    @staticmethod
    def test_dify_retriever_attachment_loader_grants_upload_files_for_allowed_segment(
        monkeypatch: pytest.MonkeyPatch,
        attachment_session: Session,
    ) -> None:
        from factories.file_factory import builders as file_builders

        upload_file_id = str(uuid4())
        segment_id = str(uuid4())
        _persist_attachment(attachment_session, segment_id=segment_id, upload_file_id=upload_file_id)
        engine = attachment_session.get_bind()
        assert engine is not None
        monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=engine))
        session_maker = sessionmaker(engine, expire_on_commit=False)
        monkeypatch.setattr(file_builders.session_factory, "create_session", session_maker)

        loader = DifyRetrieverAttachmentLoader(file_reference_factory=DifyFileReferenceFactory(_build_run_context()))
        scope = FileAccessScope(
            tenant_id="tenant-id",
            user_id="end-user-id",
            user_from=UserFrom.END_USER,
            invoke_from=InvokeFrom.WEB_APP,
        )

        with bind_file_access_scope(scope):
            grant_retriever_segment_access([segment_id])
            files = loader.load(segment_id=segment_id)

        assert files[0].related_id == upload_file_id
        assert files[0].filename == "diagram.png"

    @staticmethod
    def test_dify_retriever_attachment_loader_rejects_granted_upload_file_from_another_tenant(
        monkeypatch: pytest.MonkeyPatch,
        attachment_session: Session,
    ) -> None:
        from factories.file_factory import builders as file_builders

        upload_file_id = str(uuid4())
        segment_id = str(uuid4())
        _persist_attachment(
            attachment_session,
            segment_id=segment_id,
            upload_file_id=upload_file_id,
            upload_file_tenant_id="other-tenant-id",
        )
        engine = attachment_session.get_bind()
        assert engine is not None
        monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=engine))
        monkeypatch.setattr(
            file_builders.session_factory, "create_session", sessionmaker(engine, expire_on_commit=False)
        )

        loader = DifyRetrieverAttachmentLoader(file_reference_factory=DifyFileReferenceFactory(_build_run_context()))
        scope = FileAccessScope(
            tenant_id="tenant-id",
            user_id="end-user-id",
            user_from=UserFrom.END_USER,
            invoke_from=InvokeFrom.WEB_APP,
        )

        with bind_file_access_scope(scope):
            grant_retriever_segment_access([segment_id])
            with pytest.raises(ValueError, match="Invalid upload file"):
                loader.load(segment_id=segment_id)

    @staticmethod
    def test_dify_retriever_attachment_loader_skips_ungranted_segment_for_end_user(
        monkeypatch: pytest.MonkeyPatch,
        attachment_session: Session,
    ) -> None:
        build_from_mapping = MagicMock()
        engine = attachment_session.get_bind()
        assert engine is not None
        monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=engine))
        statement_count = 0

        def count_statements(*_args, **_kwargs) -> None:
            nonlocal statement_count
            statement_count += 1

        event.listen(engine, "before_cursor_execute", count_statements)
        loader = DifyRetrieverAttachmentLoader(
            file_reference_factory=SimpleNamespace(build_from_mapping=build_from_mapping)
        )
        scope = FileAccessScope(
            tenant_id="tenant-id",
            user_id="end-user-id",
            user_from=UserFrom.END_USER,
            invoke_from=InvokeFrom.WEB_APP,
        )

        with bind_file_access_scope(scope):
            files = loader.load(segment_id=str(uuid4()))

        try:
            assert files == []
            assert statement_count == 0
            build_from_mapping.assert_not_called()
        finally:
            event.remove(engine, "before_cursor_execute", count_statements)

    @staticmethod
    def test_dify_retriever_attachment_loader_skips_segment_rejected_by_checker(
        monkeypatch: pytest.MonkeyPatch,
        attachment_session: Session,
    ) -> None:
        segment_id = str(uuid4())
        build_from_mapping = MagicMock()
        segment_access_checker = MagicMock(return_value=False)
        engine = attachment_session.get_bind()
        assert engine is not None
        monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=engine))
        statement_count = 0

        def count_statements(*_args, **_kwargs) -> None:
            nonlocal statement_count
            statement_count += 1

        event.listen(engine, "before_cursor_execute", count_statements)
        loader = DifyRetrieverAttachmentLoader(
            file_reference_factory=SimpleNamespace(build_from_mapping=build_from_mapping),
            segment_access_checker=segment_access_checker,
        )
        scope = FileAccessScope(
            tenant_id="tenant-id",
            user_id="end-user-id",
            user_from=UserFrom.END_USER,
            invoke_from=InvokeFrom.WEB_APP,
        )

        with bind_file_access_scope(scope):
            grant_retriever_segment_access([segment_id])
            files = loader.load(segment_id=segment_id)

        try:
            assert files == []
            segment_access_checker.assert_called_once_with(segment_id)
            assert statement_count == 0
            build_from_mapping.assert_not_called()
        finally:
            event.remove(engine, "before_cursor_execute", count_statements)

    @staticmethod
    def test_dify_tool_file_manager_resolves_conversation_id_for_tool_files(monkeypatch: pytest.MonkeyPatch) -> None:
        tool_file = ToolFile(
            user_id="user-id",
            tenant_id="tenant-id",
            conversation_id="conversation-id",
            file_key="tools/tenant-id/tool-file-id.png",
            mimetype="image/png",
            name="diagram.png",
            size=len(b"file-bytes"),
        )
        tool_file.id = "tool-file-id"
        create_file_by_raw = MagicMock(return_value=tool_file)
        manager_instance = SimpleNamespace(create_file_by_raw=create_file_by_raw)
        monkeypatch.setattr(node_runtime, "ToolFileManager", MagicMock(return_value=manager_instance))
        conversation_id_getter = MagicMock(return_value="conversation-id")

        manager = DifyToolFileManager(
            DifyRunContext(
                tenant_id="tenant-id",
                app_id="app-id",
                user_id="user-id",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
            ),
            conversation_id_getter=conversation_id_getter,
        )

        tool_file = manager.create_file_by_raw(
            file_binary=b"file-bytes",
            mimetype="image/png",
            filename="diagram",
        )

        assert tool_file.id == "tool-file-id"
        conversation_id_getter.assert_called_once_with()
        create_file_by_raw.assert_called_once_with(
            user_id="user-id",
            tenant_id="tenant-id",
            conversation_id="conversation-id",
            file_binary=b"file-bytes",
            mimetype="image/png",
            filename="diagram",
        )

    @staticmethod
    def test_dify_tool_file_manager_delegates_file_generator_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
        get_file_generator = MagicMock(return_value=sentinel.generator)
        monkeypatch.setattr(
            node_runtime,
            "ToolFileManager",
            MagicMock(return_value=SimpleNamespace(get_file_generator_by_tool_file_id=get_file_generator)),
        )
        manager = DifyToolFileManager(_build_run_context())

        assert manager.get_file_generator_by_tool_file_id("tool-file-id") is sentinel.generator
        get_file_generator.assert_called_once_with("tool-file-id")

    @staticmethod
    def test_dify_tool_node_runtime_injects_outer_workflow_run_id_for_workflow_tools(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        runtime_tool = SimpleNamespace(runtime=SimpleNamespace(runtime_parameters={}))
        get_runtime = MagicMock(return_value=runtime_tool)
        monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)
        monkeypatch.setattr(
            node_runtime,
            "get_system_text",
            lambda _pool, key: (
                "outer-workflow-run-id" if key == node_runtime.SystemVariableKey.WORKFLOW_EXECUTION_ID else None
            ),
        )

        runtime = node_runtime.DifyToolNodeRuntime(_build_run_context())
        node_data = ToolNodeData(
            title="Workflow Tool Node",
            desc=None,
            provider_id="workflow-provider-id",
            provider_type=ToolProviderType.WORKFLOW,
            provider_name="workflow-provider",
            tool_name="workflow-tool",
            tool_label="Workflow Tool",
            tool_configurations={},
            tool_parameters={},
        )

        handle = runtime.get_runtime(
            node_id="tool-node",
            node_data=node_data,
            variable_pool=object(),
            node_execution_id="node-execution-id",
        )

        assert handle.raw.tool is runtime_tool
        assert handle.raw.parent_trace_context.model_dump() == {
            "parent_workflow_run_id": "outer-workflow-run-id",
            "parent_node_execution_id": "node-execution-id",
        }
        assert runtime_tool.runtime.runtime_parameters == {}
        get_runtime.assert_called_once()

    @staticmethod
    def test_dify_tool_node_runtime_stores_trace_session_id_for_workflow_tools(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        runtime_tool = SimpleNamespace(runtime=SimpleNamespace(runtime_parameters={}))
        get_runtime = MagicMock(return_value=runtime_tool)
        monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)
        monkeypatch.setattr(
            node_runtime,
            "get_system_text",
            lambda _pool, key: (
                "outer-workflow-run-id" if key == node_runtime.SystemVariableKey.WORKFLOW_EXECUTION_ID else None
            ),
        )

        run_context = _build_run_context()
        run_context[DIFY_RUN_CONTEXT_KEY].trace_session_id = "session-1"
        runtime = node_runtime.DifyToolNodeRuntime(run_context)
        node_data = ToolNodeData(
            title="Workflow Tool Node",
            desc=None,
            provider_id="workflow-provider-id",
            provider_type=ToolProviderType.WORKFLOW,
            provider_name="workflow-provider",
            tool_name="workflow-tool",
            tool_label="Workflow Tool",
            tool_configurations={},
            tool_parameters={},
        )

        handle = runtime.get_runtime(
            node_id="tool-node",
            node_data=node_data,
            variable_pool=object(),
            node_execution_id="node-execution-id",
        )

        assert handle.raw.trace_session_id == "session-1"
        assert runtime_tool.runtime.runtime_parameters == {}

    @staticmethod
    def test_dify_tool_node_runtime_does_not_inject_outer_workflow_run_id_for_non_workflow_tools(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        runtime_tool = SimpleNamespace(runtime=SimpleNamespace(runtime_parameters={}))
        get_runtime = MagicMock(return_value=runtime_tool)
        monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)
        monkeypatch.setattr(node_runtime, "get_system_text", lambda _pool, _key: None)

        runtime = node_runtime.DifyToolNodeRuntime(_build_run_context())
        node_data = ToolNodeData(
            title="Builtin Tool Node",
            desc=None,
            provider_id="builtin-provider-id",
            provider_type=ToolProviderType.BUILT_IN,
            provider_name="builtin-provider",
            tool_name="builtin-tool",
            tool_label="Builtin Tool",
            tool_configurations={},
            tool_parameters={},
        )

        handle = runtime.get_runtime(
            node_id="tool-node",
            node_data=node_data,
            variable_pool=object(),
        )

        assert handle.raw.tool is runtime_tool
        assert runtime_tool.runtime.dify_run_context.tenant_id == "tenant-id"
        assert runtime_tool.runtime.dify_run_context.app_id == "app-id"
        assert "outer_workflow_run_id" not in runtime_tool.runtime.runtime_parameters
        get_runtime.assert_called_once()

    @staticmethod
    def test_dify_tool_node_runtime_builds_workflow_tool_container_payload(monkeypatch: pytest.MonkeyPatch) -> None:
        from core.tools.__base.tool_runtime import ToolRuntime
        from core.tools.entities.common_entities import I18nObject
        from core.tools.entities.tool_entities import ToolEntity, ToolIdentity
        from core.tools.workflow_as_tool.tool import WorkflowTool

        tool = WorkflowTool(
            workflow_app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_as_tool_id="workflow-tool-id",
            version="published-version",
            workflow_call_depth=2,
            entity=ToolEntity(
                identity=ToolIdentity(
                    author="test",
                    name="workflow-tool",
                    label=I18nObject(en_US="Workflow Tool"),
                    provider="workflow-provider",
                ),
                parameters=[],
                description=None,
                has_runtime_parameters=False,
            ),
            runtime=ToolRuntime(tenant_id="tenant-id", invoke_from=InvokeFrom.DEBUGGER),
        )
        prepared_parameters: list[Mapping[str, object]] = []

        def prepare_container_inputs(
            parameters: Mapping[str, object],
        ) -> tuple[dict[str, object], list[dict[str, str]]]:
            prepared_parameters.append(parameters)
            return {"amount": Decimal("1.25")}, [{"id": "file-id", "name": "input.txt"}]

        monkeypatch.setattr(tool, "prepare_container_inputs", prepare_container_inputs)
        runtime = DifyToolNodeRuntime(_build_run_context())

        payload = runtime.build_workflow_tool_container_payload(
            tool_runtime=ToolRuntimeHandle(raw=tool),
            tool_parameters={"amount": "1.25"},
            inputs_for_log={"amount": Decimal("1.25")},
            workflow_call_depth=2,
        )

        assert payload.model_dump() == {
            "version": "1",
            "source_app_id": str(tool.workflow_app_id),
            "source_workflow_id": str(tool.workflow_id),
            "source_workflow_version": "published-version",
            "inputs": {"amount": 1.25},
            "system_files": [{"id": "file-id", "name": "input.txt"}],
            "inputs_for_log": {"amount": 1.25},
            "call_depth": 3,
        }
        assert prepared_parameters == [{"amount": "1.25"}]

    @staticmethod
    def test_dify_tool_node_runtime_rejects_non_workflow_tool_container_payload() -> None:
        runtime = DifyToolNodeRuntime(_build_run_context())
        with pytest.raises(ToolRuntimeResolutionError, match="resolved tool is not a Workflow Tool"):
            runtime.build_workflow_tool_container_payload(
                tool_runtime=ToolRuntimeHandle(raw=object()),
                tool_parameters={},
                inputs_for_log={},
                workflow_call_depth=0,
            )

    @staticmethod
    def test_dify_human_input_runtime_builds_debug_repository(monkeypatch: pytest.MonkeyPatch) -> None:
        repository = MagicMock()
        repository_cls = MagicMock(return_value=repository)
        monkeypatch.setattr(node_runtime, "HumanInputFormRepositoryImpl", repository_cls)

        runtime = DifyHumanInputNodeRuntime(
            _build_run_context(),
            workflow_execution_id_getter=lambda: "workflow-execution-id",
        )

        assert runtime.build_form_repository() is repository
        repository_cls.assert_called_once_with(
            tenant_id="tenant-id",
            app_id="app-id",
            workflow_execution_id="workflow-execution-id",
            invoke_source="debugger",
            submission_actor_id="user-id",
        )

    @staticmethod
    def test_dify_tool_runtime_spec_prefers_tool_parameters_for_runtime_form_values() -> None:
        node_data = ToolNodeData(
            provider_id="video-mixcut-agent",
            provider_type=ToolProviderType.PLUGIN,
            provider_name="sawyer-shi/video-mixcut-agent",
            tool_name="mixcut",
            tool_label="MixCut",
            tool_configurations={"count": 2},
            tool_parameters={
                "vision_llm_model": {
                    "type": "constant",
                    "value": {
                        "provider": "langgenius/tongyi/tongyi",
                        "model": "qwen3-vl-plus",
                        "model_type": "llm",
                    },
                }
            },
        )

        spec = DifyToolNodeRuntime._build_tool_runtime_spec(node_data)

        assert spec.tool_configurations == {
            "count": 2,
            "vision_llm_model": {
                "type": "constant",
                "value": {
                    "provider": "langgenius/tongyi/tongyi",
                    "model": "qwen3-vl-plus",
                    "model_type": "llm",
                },
            },
        }

    @staticmethod
    def test_dify_human_input_runtime_create_form_filters_debugger_delivery_methods() -> None:
        repository = MagicMock()
        repository.create_form.return_value = sentinel.form
        node_data = HumanInputNodeData(
            title="Human Input",
            delivery_methods=[
                WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig()),
                _build_email_method(debug_mode=True),
            ],
        )
        runtime = DifyHumanInputNodeRuntime(
            _build_run_context(),
            workflow_execution_id_getter=lambda: "workflow-execution-id",
            form_repository=repository,
        )

        result = runtime.create_form(
            node_id="human-input-node",
            node_data=node_data,
            rendered_content="<p>Rendered</p>",
            resolved_default_values={"answer": "default"},
        )

        assert result is sentinel.form
        repository.create_form.assert_called_once()
        params = repository.create_form.call_args.args[0]
        assert params.node_id == "human-input-node"
        assert params.workflow_execution_id == "workflow-execution-id"
        # No conversation_id_getter wired -> a pure workflow run leaves it None.
        assert params.conversation_id is None
        assert params.display_in_ui is True
        assert len(params.delivery_methods) == 1
        assert params.delivery_methods[0].type == DeliveryMethodType.EMAIL
        assert params.delivery_methods[0].config.recipients.items[0].reference_id == "user-id"

    @staticmethod
    def test_dify_human_input_runtime_create_form_tags_conversation_id_for_chatflow() -> None:
        # ENG-635 (review): a chatflow (advanced-chat) run carries a conversation, so its
        # Human Input form is tagged with BOTH its workflow run and its conversation —
        # making the form queryable per conversation without changing resume routing.
        repository = MagicMock()
        repository.create_form.return_value = sentinel.form
        node_data = HumanInputNodeData(
            title="Human Input",
            delivery_methods=[WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig())],
        )
        runtime = DifyHumanInputNodeRuntime(
            _build_run_context(),
            workflow_execution_id_getter=lambda: "workflow-execution-id",
            conversation_id_getter=lambda: "conversation-id",
            form_repository=repository,
        )

        runtime.create_form(
            node_id="human-input-node",
            node_data=node_data,
            rendered_content="<p>Rendered</p>",
            resolved_default_values={},
        )

        params = repository.create_form.call_args.args[0]
        assert params.workflow_execution_id == "workflow-execution-id"
        assert params.conversation_id == "conversation-id"

    @staticmethod
    def test_dify_human_input_runtime_preserves_webapp_delivery_for_web_invocations() -> None:
        repository = MagicMock()
        repository.create_form.return_value = sentinel.form
        node_data = HumanInputNodeData(
            title="Human Input",
            delivery_methods=[
                WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig()),
                _build_email_method(debug_mode=True),
            ],
        )
        runtime = DifyHumanInputNodeRuntime(
            _build_run_context(invoke_from=InvokeFrom.WEB_APP),
            form_repository=repository,
        )

        runtime.create_form(
            node_id="human-input-node",
            node_data=node_data,
            rendered_content="<p>Rendered</p>",
            resolved_default_values={},
        )

        params = repository.create_form.call_args.args[0]
        assert params.display_in_ui is True
        assert [method.type for method in params.delivery_methods] == [
            DeliveryMethodType.WEBAPP,
            DeliveryMethodType.EMAIL,
        ]
        assert params.delivery_methods[1].config.recipients.include_bound_group is True

    @staticmethod
    def test_dify_human_input_runtime_restore_submitted_data_rehydrates_files() -> None:
        runtime = DifyHumanInputNodeRuntime(_build_run_context())
        file_value = File(
            file_id="file-1",
            file_type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="upload-1",
            filename="resume.pdf",
            extension=".pdf",
            mime_type="application/pdf",
            size=128,
        )
        file_list_value = [
            File(
                file_id="file-2",
                file_type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                related_id="upload-2",
                filename="first.pdf",
                extension=".pdf",
                mime_type="application/pdf",
                size=64,
            ),
            File(
                file_id="file-3",
                file_type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.REMOTE_URL,
                remote_url="https://example.com/second.pdf",
                filename="second.pdf",
                extension=".pdf",
                mime_type="application/pdf",
                size=96,
            ),
        ]
        runtime._file_reference_factory.build_from_mapping = MagicMock(side_effect=[file_value, *file_list_value])  # type: ignore[method-assign]

        restored = runtime.restore_submitted_data(
            inputs=[
                FileInputConfig(output_variable_name="attachment"),
                FileListInputConfig(output_variable_name="attachments", number_limits=2),
            ],
            submitted_data={
                "attachment": {"upload_file_id": "upload-1", "type": "document", "transfer_method": "local_file"},
                "attachments": [
                    {"upload_file_id": "upload-2", "type": "document", "transfer_method": "local_file"},
                    {
                        "url": "https://example.com/second.pdf",
                        "type": "document",
                        "transfer_method": "remote_url",
                    },
                ],
            },
        )

        assert restored["attachment"] is file_value
        assert restored["attachments"] == file_list_value
        assert isinstance(FileSegment(value=restored["attachment"]), FileSegment)
        assert isinstance(ArrayFileSegment(value=restored["attachments"]), ArrayFileSegment)

    @staticmethod
    def test_build_dify_llm_file_saver_wires_runtime_adapters(monkeypatch: pytest.MonkeyPatch) -> None:
        file_saver_cls = MagicMock(return_value=sentinel.file_saver)
        monkeypatch.setattr("graphon.nodes.llm.file_saver.FileSaverImpl", file_saver_cls)
        http_client = MagicMock()

        saver = build_dify_llm_file_saver(
            run_context=_build_run_context(),
            http_client=http_client,
            conversation_id_getter=lambda: "conversation-id",
        )

        assert saver is sentinel.file_saver
        tool_file_manager = file_saver_cls.call_args.kwargs["tool_file_manager"]
        file_reference_factory = file_saver_cls.call_args.kwargs["file_reference_factory"]
        assert isinstance(tool_file_manager, DifyToolFileManager)
        assert isinstance(file_reference_factory, DifyFileReferenceFactory)
        assert file_saver_cls.call_args.kwargs["http_client"] is http_client
