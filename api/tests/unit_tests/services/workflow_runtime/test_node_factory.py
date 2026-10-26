"""Real Graphon engine and Dify factory, with row-backed restricted receipts."""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
import time
import types
from collections.abc import Callable, Mapping, Sequence
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from typing import NoReturn, cast, override
from unittest.mock import MagicMock, patch, sentinel
from uuid import uuid4

import pytest
import yaml
from pydantic import ValidationError
from sqlalchemy import Engine, Table, event, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import (
    DIFY_RUN_CONTEXT_KEY,
    DifyRunContext,
    InvokeFrom,
    UserFrom,
    build_dify_run_context,
)
from core.dify_builder.models import Graph as BuilderGraph
from core.dify_builder.models import Inputs
from core.dify_builder.real_call_consent import ConsentReceipt
from core.model_manager import ModelInstance
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.plugin_service import PluginService
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.workflow import template_rendering as workflow_template_rendering
from core.workflow.llm_node import DifyLLMNode
from core.workflow.node_runtime import DifyPreparedLLM
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool
from graphon.engine import Engine as GraphonEngine
from graphon.engine.command import InMemoryChannel
from graphon.engine.layer import Layer
from graphon.engine_events import (
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunSucceededEvent,
    NodeRunSucceededEvent,
)
from graphon.engine_events.base import EngineEvent
from graphon.entities.base_node_data import BaseNodeData, DefaultValue, DefaultValueType
from graphon.enums import BuiltinNodeTypes, ErrorStrategy, NodeExecutionType, NodeType
from graphon.graph import Graph
from graphon.graph.validation import GraphValidationError
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelFeature, ModelType
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.nodes.base.node import Node
from graphon.nodes.code.entities import CodeLanguage
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.http_request.node import HttpRequestNode
from graphon.nodes.llm.entities import LLMNodeData
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import LLMPollingCapableProtocol
from graphon.nodes.parameter_extractor.entities import ParameterExtractorNodeData
from graphon.nodes.question_classifier.entities import QuestionClassifierNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.nodes.tool.tool_node import ToolNode
from graphon.nodes.variable_assigner.v1.node import VariableAssignerNode as VariableAssignerV1
from graphon.nodes.variable_assigner.v2.node import VariableAssignerNode as VariableAssignerV2
from graphon.runtime import InitParams, RuntimeState, VariablePool
from graphon.variables.segments import ArrayObjectSegment, ObjectSegment, StringSegment
from models.base import TypeBase
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.model import AppMode, Conversation, ConversationFromSource
from models.workflow import Workflow
from services.dify_builder.application.execution_policy import (
    BuilderExecutionContext,
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    BuilderExecutionRecorder,
    HttpResponseFixtureV1,
    canonical_digest,
)
from services.dify_builder.execution_policy_service import (
    BuilderExecutionPolicyService,
)
from services.dify_builder.revision import execution_revision
from services.workflow_runtime import node_factory
from services.workflow_runtime.base_runner import WorkflowBasedAppRunner
from services.workflow_runtime.entry import iter_dify_graph_engine_events
from services.workflow_runtime.node_factory import DifyNodeFactory, get_node_type_classes_mapping
from services.workflow_runtime.workflow_queue import WorkflowAppQueueManager
from tests.helpers.unit.core.model_fixtures import make_model_config, make_model_instance
from tests.unit_tests.core.dify_builder.test_execution_policy import fixture
from tests.unit_tests.services.dify_builder.test_execution_policy_service import Owned
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414
from tests.unit_tests.services.dify_builder.test_real_call_consent_service import Owner
from tests.unit_tests.services.dify_builder.test_real_call_consent_service import consent_owner as consent_owner  # noqa: PLC0414
from tests.workflow_test_utils import build_test_graph_init_params


class DummyNode:
    def __init__(self, *, node_id, data, init_params, runtime_state, **kwargs):
        self.id = node_id
        self.data = data
        self.init_params = init_params
        self.runtime_state = runtime_state
        self.kwargs = kwargs


class DummyCodeNode(DummyNode):
    @classmethod
    def default_code_providers(cls):
        return ()


class DummyTemplateTransformNode(DummyNode):
    pass


class DummyHttpRequestNode(DummyNode):
    pass


class DummyKnowledgeRetrievalNode(DummyNode):
    pass


class DummyDocumentExtractorNode(DummyNode):
    pass


class TestNodeFactoryCases:
    class TestDifyNodeFactory:
        @pytest.fixture(autouse=True)
        def _node_config(self, config_overrides: Callable[..., None]) -> None:
            config_overrides(
                CODE_MAX_STRING_LENGTH=10,
                CODE_MAX_NUMBER=10,
                CODE_MIN_NUMBER=-10,
                CODE_MAX_PRECISION=4,
                CODE_MAX_DEPTH=2,
                CODE_MAX_NUMBER_ARRAY_LENGTH=2,
                CODE_MAX_STRING_ARRAY_LENGTH=2,
                CODE_MAX_OBJECT_ARRAY_LENGTH=2,
                TEMPLATE_TRANSFORM_MAX_LENGTH=100,
                UNSTRUCTURED_API_URL="http://u",
                UNSTRUCTURED_API_KEY="key",
            )

        @staticmethod
        def _stub_node_resolution(monkeypatch: pytest.MonkeyPatch, node_class):
            monkeypatch.setattr(
                "services.workflow_runtime.node_factory.resolve_workflow_node_class", lambda **_kwargs: node_class
            )

        def _factory(self):
            run_context = build_dify_run_context(
                tenant_id="tenant",
                app_id="app",
                user_id="user",
                user_from=UserFrom.END_USER,
                invoke_from=InvokeFrom.WEB_APP,
            )
            return DifyNodeFactory(
                init_params=InitParams(workflow_id="workflow", graph_config={}, run_context=run_context, call_depth=0),
                runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0),
            )

        def test_create_node_unknown_type(self):
            factory = self._factory()
            with pytest.raises(ValueError, match="No class mapping found for node type: unknown"):
                factory.create_node({"id": "node-1", "data": {"type": "unknown"}})

        def test_create_node_missing_mapping(self, monkeypatch: pytest.MonkeyPatch):
            factory = self._factory()
            monkeypatch.setattr("services.workflow_runtime.node_factory.get_node_type_classes_mapping", lambda: {})
            with pytest.raises(ValueError, match="No class mapping found for node type: start"):
                factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.START}})

        def test_create_node_missing_latest_class(self, monkeypatch: pytest.MonkeyPatch):
            factory = self._factory()
            monkeypatch.setattr(
                "services.workflow_runtime.node_factory.get_node_type_classes_mapping",
                lambda: {BuiltinNodeTypes.START: {"1": None}},
            )
            monkeypatch.setattr("services.workflow_runtime.node_factory.LATEST_VERSION", "latest")
            with pytest.raises(ValueError, match="No latest version class found for node type: start"):
                factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.START}})

        def test_create_node_selects_versioned_class(self, monkeypatch: pytest.MonkeyPatch):
            factory = self._factory()
            selected_versions: list[tuple[str, str]] = []

            class DummyNodeV2(DummyNode):
                pass

            def _get_mapping():
                selected_versions.append(("snapshot", "called"))
                return {BuiltinNodeTypes.START: {"1": DummyNode, "2": DummyNodeV2}}

            monkeypatch.setattr("services.workflow_runtime.node_factory.get_node_type_classes_mapping", _get_mapping)
            node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.START, "version": "2"}})
            assert isinstance(node, DummyNodeV2)
            assert node.id == "node-1"
            assert selected_versions == [("snapshot", "called")]

        def test_create_node_code_branch(self, monkeypatch: pytest.MonkeyPatch):
            factory = self._factory()
            self._stub_node_resolution(monkeypatch, DummyCodeNode)
            node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.CODE}})
            assert isinstance(node, DummyCodeNode)
            assert node.id == "node-1"

        def test_create_node_template_transform_branch(self, monkeypatch: pytest.MonkeyPatch):
            factory = self._factory()
            self._stub_node_resolution(monkeypatch, DummyTemplateTransformNode)
            node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.TEMPLATE_TRANSFORM}})
            assert isinstance(node, DummyTemplateTransformNode)
            assert "jinja2_template_renderer" in node.kwargs

        def test_create_node_http_request_branch(self, monkeypatch: pytest.MonkeyPatch):
            factory = self._factory()
            self._stub_node_resolution(monkeypatch, DummyHttpRequestNode)
            node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.HTTP_REQUEST}})
            assert isinstance(node, DummyHttpRequestNode)
            assert "http_request_config" in node.kwargs

        def test_create_node_knowledge_retrieval_branch(self, monkeypatch: pytest.MonkeyPatch):
            factory = self._factory()
            self._stub_node_resolution(monkeypatch, DummyKnowledgeRetrievalNode)
            node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}})
            assert isinstance(node, DummyKnowledgeRetrievalNode)
            assert node.kwargs == {}

        def test_create_node_document_extractor_branch(self, monkeypatch: pytest.MonkeyPatch):
            factory = self._factory()
            self._stub_node_resolution(monkeypatch, DummyDocumentExtractorNode)
            node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.DOCUMENT_EXTRACTOR}})
            assert isinstance(node, DummyDocumentExtractorNode)
            assert "unstructured_api_config" in node.kwargs


class TestGetNodeTypeClassesMappingCases:
    @staticmethod
    def test_variable_assigner_latest_prefers_highest_numeric_version():
        # Act
        mapping: Mapping[NodeType, Mapping[str, type[Node]]] = get_node_type_classes_mapping()

        # Assert basic presence
        assert BuiltinNodeTypes.VARIABLE_ASSIGNER in mapping
        va_versions = mapping[BuiltinNodeTypes.VARIABLE_ASSIGNER]

        # Both concrete versions must be present
        assert va_versions.get("1") is VariableAssignerV1
        assert va_versions.get("2") is VariableAssignerV2

        # And latest should point to numerically-highest version ("2")
        assert va_versions.get("latest") is VariableAssignerV2

    @staticmethod
    def test_latest_prefers_highest_numeric_version():
        # Arrange: define two ephemeral subclasses with numeric versions under a NodeType
        # that has no concrete implementations in production to avoid interference.
        class _Version1(Node[BaseNodeData]):  # type: ignore[misc]
            node_type = BuiltinNodeTypes.LEGACY_VARIABLE_AGGREGATOR

            def init_node_data(self, data):
                pass

            def _run(self):
                raise NotImplementedError

            @classmethod
            def version(cls) -> str:
                return "1"

            def _get_error_strategy(self):
                return None

            def _get_retry_config(self):
                return types.SimpleNamespace()  # not used

            def _get_title(self) -> str:
                return "version1"

            def _get_description(self):
                return None

            def _get_default_value_dict(self):
                return {}

            def get_base_node_data(self):
                return types.SimpleNamespace(title="version1")

        class _Version2(_Version1):  # type: ignore[misc]
            @classmethod
            def version(cls) -> str:
                return "2"

            def _get_title(self) -> str:
                return "version2"

        # Act: build a fresh mapping (it should now see our ephemeral subclasses)
        mapping: Mapping[NodeType, Mapping[str, type[Node]]] = get_node_type_classes_mapping()

        # Assert: both numeric versions exist for this NodeType; 'latest' points to the higher numeric version
        assert BuiltinNodeTypes.LEGACY_VARIABLE_AGGREGATOR in mapping
        legacy_versions = mapping[BuiltinNodeTypes.LEGACY_VARIABLE_AGGREGATOR]

        assert legacy_versions.get("1") is _Version1
        assert legacy_versions.get("2") is _Version2
        assert legacy_versions.get("latest") is _Version2


@pytest.fixture
def memory_session_maker(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> sessionmaker[Session]:
    """Bind node memory lookup to an explicit SQLite session factory."""

    TypeBase.metadata.create_all(sqlite_engine, tables=[cast(Table, Conversation.__table__)])
    session_maker = sessionmaker(sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(node_factory.session_factory, "create_session", session_maker)
    return session_maker


def _persist_conversation(session_maker: sessionmaker[Session]) -> None:
    with session_maker.begin() as session:
        session.add(
            Conversation(
                id="conversation-id",
                app_id="app-id",
                mode=AppMode.ADVANCED_CHAT,
                name="Conversation",
                _inputs={},
                from_source=ConversationFromSource.API,
                from_end_user_id="end-user-id",
            )
        )


def _assert_constructor_node_data(data, *, node_id: str, node_type: NodeType, version: str = "1") -> None:
    _ = node_id
    if isinstance(data, BaseNodeData):
        assert data.type == node_type
        assert data.version == version
        return

    assert isinstance(data, Mapping)
    assert data["type"] == node_type
    assert data.get("version", "1") == version


def _node_constructor(*, return_value):
    constructor = MagicMock(return_value=return_value)
    constructor.validate_node_data.side_effect = lambda node_data: node_data
    return constructor


def _build_llm_model_schema(*, features: list[ModelFeature] | None = None) -> AIModelEntity:
    return AIModelEntity(
        model="model",
        label=I18nObject(en_US="Model"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
        features=features,
    )


class _ModelInstanceStub(ModelInstance):
    def __init__(
        self,
        *,
        model_runtime: PluginModelRuntime,
        model_schema: AIModelEntity,
    ) -> None:
        config = make_model_config(provider="langgenius/openai/openai", model="model", mode="chat")
        config.provider_model_bundle.model_type_instance = LargeLanguageModel(
            provider_schema=config.provider_model_bundle.configuration.provider,
            model_runtime=model_runtime,
        )
        super().__init__(
            provider_model_bundle=config.provider_model_bundle, model="model", credentials={"api_key": "secret"}
        )
        self._model_schema = model_schema

    @override
    def get_model_schema(self) -> AIModelEntity:
        return self._model_schema


class TestNodeFactoryCasesWorkflow:
    @staticmethod
    @pytest.fixture
    def memory_session_maker(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> sessionmaker[Session]:
        """Bind node memory lookup to an explicit SQLite session factory."""

        TypeBase.metadata.create_all(sqlite_engine, tables=[Conversation.__table__])
        session_maker = sessionmaker(sqlite_engine, expire_on_commit=False)
        monkeypatch.setattr(node_factory.session_factory, "create_session", session_maker)
        return session_maker

    class TestResolveWorkflowNodeClass:
        def test_matching_version_uses_registry_mapping(self, monkeypatch) -> None:
            document_extractor_class = sentinel.document_extractor_class
            latest_node_class = sentinel.latest_document_extractor_class
            monkeypatch.setattr(
                node_factory,
                "get_node_type_classes_mapping",
                lambda: {
                    BuiltinNodeTypes.DOCUMENT_EXTRACTOR: {
                        "1": document_extractor_class,
                        node_factory.LATEST_VERSION: latest_node_class,
                    }
                },
            )

            resolved = node_factory.resolve_workflow_node_class(
                node_type=BuiltinNodeTypes.DOCUMENT_EXTRACTOR,
                node_version="1",
            )

            assert resolved is document_extractor_class

        def test_document_extractor_latest_falls_back_to_registry_mapping(self, monkeypatch) -> None:
            latest_node_class = sentinel.latest_document_extractor_class
            monkeypatch.setattr(
                node_factory,
                "get_node_type_classes_mapping",
                lambda: {BuiltinNodeTypes.DOCUMENT_EXTRACTOR: {node_factory.LATEST_VERSION: latest_node_class}},
            )

            resolved = node_factory.resolve_workflow_node_class(
                node_type=BuiltinNodeTypes.DOCUMENT_EXTRACTOR,
                node_version=node_factory.LATEST_VERSION,
            )

            assert resolved is latest_node_class

    class TestFetchMemory:
        @pytest.mark.parametrize(("conversation_id", "memory_config"), [(None, object()), ("conversation-id", None)])
        def test_returns_none_when_memory_or_conversation_is_missing(self, conversation_id, memory_config):
            result = node_factory.fetch_memory(
                conversation_id=conversation_id,
                app_id="app-id",
                node_data_memory=memory_config,
                model_instance=sentinel.model_instance,
            )
            assert result is None

        def test_returns_none_when_conversation_does_not_exist(self, memory_session_maker: sessionmaker[Session]):
            result = node_factory.fetch_memory(
                conversation_id="conversation-id",
                app_id="app-id",
                node_data_memory=MemoryConfig(window=MemoryConfig.WindowConfig(enabled=False)),
                model_instance=sentinel.model_instance,
            )
            assert result is None

        def test_builds_token_buffer_memory_for_existing_conversation(
            self, monkeypatch: pytest.MonkeyPatch, memory_session_maker: sessionmaker[Session]
        ):
            memory = sentinel.memory
            _persist_conversation(memory_session_maker)
            token_buffer_memory = MagicMock(return_value=memory)
            monkeypatch.setattr(node_factory, "TokenBufferMemory", token_buffer_memory)
            result = node_factory.fetch_memory(
                conversation_id="conversation-id",
                app_id="app-id",
                node_data_memory=MemoryConfig(window=MemoryConfig.WindowConfig(enabled=False)),
                model_instance=sentinel.model_instance,
            )
            assert result is memory
            loaded_conversation = token_buffer_memory.call_args.kwargs["conversation"]
            assert isinstance(loaded_conversation, Conversation)
            assert loaded_conversation.id == "conversation-id"
            assert token_buffer_memory.call_args.kwargs["model_instance"] is sentinel.model_instance

        def test_uses_configured_session_factory_without_flask_app_context(
            self, monkeypatch: pytest.MonkeyPatch, memory_session_maker: sessionmaker[Session]
        ):

            class RaisingDB:
                @property
                def engine(self):
                    raise RuntimeError("Working outside of application context.")

            token_buffer_memory = MagicMock(return_value=sentinel.memory)
            _persist_conversation(memory_session_maker)
            monkeypatch.setattr(node_factory, "db", RaisingDB(), raising=False)
            monkeypatch.setattr(node_factory, "TokenBufferMemory", token_buffer_memory)
            result = node_factory.fetch_memory(
                conversation_id="conversation-id",
                app_id="app-id",
                node_data_memory=MemoryConfig(window=MemoryConfig.WindowConfig(enabled=False)),
                model_instance=sentinel.model_instance,
            )
            assert result is sentinel.memory

    class TestDifyGraphInitContext:
        def test_to_graph_init_params_preserves_explicit_values(self):
            run_context = {
                DIFY_RUN_CONTEXT_KEY: DifyRunContext(
                    tenant_id="tenant-id",
                    app_id="app-id",
                    user_id="user-id",
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                ),
                "extra": "value",
            }
            graph_config = {"nodes": [], "edges": []}
            graph_init_context = node_factory.DifyGraphInitContext(
                workflow_id="workflow-id",
                graph_config=graph_config,
                run_context=run_context,
                call_depth=2,
            )

            result = graph_init_context.to_graph_init_params()

            assert result.workflow_id == "workflow-id"
            assert result.graph_config == graph_config
            assert result.run_context == run_context
            assert result.call_depth == 2

    @staticmethod
    @pytest.mark.parametrize(
        "invalid_kind",
        [None, "CYCLE", "MISSING_NODE", "INVALID_EDGE", "DUPLICATE_NODE_ID", "DUPLICATE_EDGE_ID"],
    )
    def test_graph_validation_with_dify_node_factory(invalid_kind, monkeypatch):
        graph_config = {
            "nodes": [
                {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
                *[
                    {
                        "id": node_id,
                        "data": {"type": "template-transform", "title": node_id, "template": node_id, "variables": []},
                    }
                    for node_id in ("left", "right")
                ],
                {"id": "end", "data": {"type": "end", "title": "End", "outputs": []}},
            ],
            "edges": [
                {"id": f"{source}-{target}", "source": source, "target": target}
                for source, target in (("start", "left"), ("start", "right"), ("left", "end"), ("right", "end"))
            ],
        }
        match invalid_kind:
            case "CYCLE":
                graph_config["edges"].append({"source": "end", "target": "left"})
            case "MISSING_NODE":
                graph_config["edges"][0]["target"] = "missing"
            case "INVALID_EDGE":
                graph_config["edges"][0]["sourceHandle"] = None
            case "DUPLICATE_NODE_ID":
                graph_config["nodes"].append(graph_config["nodes"][0])
            case "DUPLICATE_EDGE_ID":
                graph_config["edges"].append(graph_config["edges"][0])

        factory = node_factory.DifyNodeFactory(
            build_test_graph_init_params(graph_config=graph_config),
            RuntimeState(variable_pool=VariablePool(), start_at=0, workflow_id="workflow"),
        )
        if invalid_kind is None:
            graph = Graph.init(graph_config=graph_config, node_factory=factory, root_node_id="start")
            assert set(graph.nodes) == {"start", "left", "right", "end"}
            assert len(graph.edges) == 4
        else:

            def reject_node_creation(*_args, **_kwargs):
                pytest.fail("Invalid graphs must fail before node construction")

            monkeypatch.setattr(node_factory.DifyNodeFactory, "create_node", reject_node_creation)
            with pytest.raises(GraphValidationError) as error:
                Graph.init(graph_config=graph_config, node_factory=factory, root_node_id="start")
            assert [issue.code for issue in error.value.issues] == [invalid_kind]

    class TestDefaultWorkflowCodeExecutor:
        def test_execute_delegates_to_code_executor(self, monkeypatch: pytest.MonkeyPatch):
            executor = node_factory.DefaultWorkflowCodeExecutor()
            execute_workflow_code_template = MagicMock(return_value={"answer": "ok"})
            monkeypatch.setattr(
                node_factory.CodeExecutor,
                "execute_workflow_code_template",
                execute_workflow_code_template,
            )

            result = executor.execute(
                language=CodeLanguage.PYTHON3,
                code="print('ok')",
                inputs={"name": "workflow"},
            )

            assert result == {"answer": "ok"}
            execute_workflow_code_template.assert_called_once_with(
                language=CodeLanguage.PYTHON3,
                code="print('ok')",
                inputs={"name": "workflow"},
            )

        def test_is_execution_error_checks_code_execution_error_type(self):
            executor = node_factory.DefaultWorkflowCodeExecutor()

            assert executor.is_execution_error(node_factory.CodeExecutionError("boom")) is True
            assert executor.is_execution_error(RuntimeError("boom")) is False

    class TestCodeExecutorJinja2TemplateRenderer:
        def test_render_template_delegates_to_code_executor(self, monkeypatch: pytest.MonkeyPatch):
            renderer = workflow_template_rendering.CodeExecutorJinja2TemplateRenderer()
            execute_workflow_code_template = MagicMock(return_value={"result": "Hello workflow"})
            monkeypatch.setattr(
                workflow_template_rendering.CodeExecutor,
                "execute_workflow_code_template",
                execute_workflow_code_template,
            )

            result = renderer.render_template("Hello {{ name }}", {"name": "workflow"})

            assert result == "Hello workflow"
            execute_workflow_code_template.assert_called_once_with(
                language=CodeLanguage.JINJA2,
                code="Hello {{ name }}",
                inputs={"name": "workflow"},
            )

        def test_render_template_wraps_code_execution_errors(self, monkeypatch: pytest.MonkeyPatch):
            renderer = workflow_template_rendering.CodeExecutorJinja2TemplateRenderer()
            monkeypatch.setattr(
                workflow_template_rendering.CodeExecutor,
                "execute_workflow_code_template",
                MagicMock(side_effect=workflow_template_rendering.CodeExecutionError("sandbox failed")),
            )

            with pytest.raises(workflow_template_rendering.TemplateRenderError, match="sandbox failed"):
                renderer.render_template("{{ broken }}", {})

    class TestDifyNodeFactoryResolveContext:
        def test_requires_reserved_context_key(self):
            with pytest.raises(ValueError, match=DIFY_RUN_CONTEXT_KEY):
                node_factory.DifyNodeFactory._resolve_dify_context({})

        def test_returns_existing_dify_context(self):
            dify_context = DifyRunContext(
                tenant_id="tenant-id",
                app_id="app-id",
                user_id="user-id",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
            )

            result = node_factory.DifyNodeFactory._resolve_dify_context({DIFY_RUN_CONTEXT_KEY: dify_context})

            assert result is dify_context

        def test_validates_mapping_context(self):
            raw_context = {
                DIFY_RUN_CONTEXT_KEY: {
                    "tenant_id": "tenant-id",
                    "app_id": "app-id",
                    "user_id": "user-id",
                    "user_from": UserFrom.ACCOUNT,
                    "invoke_from": InvokeFrom.DEBUGGER,
                }
            }

            result = node_factory.DifyNodeFactory._resolve_dify_context(raw_context)

            assert isinstance(result, DifyRunContext)
            assert result.tenant_id == "tenant-id"

    class TestDifyNodeFactoryCreateNode:
        @pytest.fixture
        def factory(self, mocker):
            factory = object.__new__(node_factory.DifyNodeFactory)
            factory._native_runtime = None
            factory.init_params = sentinel.init_params
            factory.runtime_state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0.0)
            mocker.patch.object(VariablePool, "get")
            factory._dify_context = DifyRunContext(
                builder_execution=None,
                tenant_id="tenant-id",
                app_id="app-id",
                user_id="user-id",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                app_type=None,
                created_by=None,
            )
            factory._use_workflow_tool_containers = True
            factory._code_executor = sentinel.code_executor
            factory._code_limits = sentinel.code_limits
            factory._jinja2_template_renderer = sentinel.jinja2_template_renderer
            factory._template_transform_max_output_length = 2048
            factory._http_request_http_client = sentinel.http_client
            factory._remote_file_http_client = sentinel.remote_file_http_client
            factory._bound_tool_file_manager_factory = MagicMock(return_value=sentinel.tool_file_manager)
            factory._file_reference_factory = sentinel.file_reference_factory
            factory._prompt_message_serializer = sentinel.prompt_message_serializer
            factory._retriever_attachment_loader = sentinel.retriever_attachment_loader
            factory._llm_file_saver = sentinel.llm_file_saver
            factory._human_input_runtime = sentinel.human_input_runtime
            factory._tool_runtime = sentinel.tool_runtime
            factory._http_request_file_manager = sentinel.file_manager
            factory._document_extractor_unstructured_api_config = sentinel.unstructured_api_config
            factory._http_request_config = sentinel.http_request_config
            factory._llm_credentials_provider = sentinel.credentials_provider
            factory._llm_model_factory = sentinel.model_factory
            factory._build_retriever_attachment_loader = MagicMock(return_value=sentinel.retriever_attachment_loader)
            return factory

        def test_rejects_unknown_node_type(self, factory):
            with pytest.raises(ValueError, match="No class mapping found for node type: missing"):
                factory.create_node({"id": "node-id", "data": {"type": "missing"}})

        def test_validate_node_resolves_schema_without_constructing_node(
            self, monkeypatch: pytest.MonkeyPatch, factory
        ):
            constructor = _node_constructor(return_value=sentinel.node)
            constructor.execution_type = NodeExecutionType.BRANCH
            monkeypatch.setattr(factory, "_resolve_node_class", MagicMock(return_value=constructor))
            execution_type = factory.validate_node({"id": "node-id", "data": {"type": BuiltinNodeTypes.START}})
            assert execution_type == NodeExecutionType.BRANCH
            constructor.validate_node_data.assert_called_once()
            constructor.assert_not_called()

        def test_validate_node_rejects_invalid_human_input_delivery_config(
            self, monkeypatch: pytest.MonkeyPatch, factory
        ):
            constructor = _node_constructor(return_value=sentinel.node)
            monkeypatch.setattr(factory, "_resolve_node_class", MagicMock(return_value=constructor))
            with pytest.raises(
                ValueError,
                match="(?s)0\\.email\\.config\\.subject.*valid string.*0\\.email\\.config\\.body.*valid string",
            ):
                factory.validate_node(
                    {
                        "id": "human-input",
                        "data": {
                            "type": BuiltinNodeTypes.HUMAN_INPUT,
                            "delivery_methods": [
                                {"type": "email", "config": {"recipients": {"items": []}, "subject": 123, "body": []}}
                            ],
                        },
                    }
                )
            constructor.assert_not_called()

        def test_rejects_missing_class_mapping(self, monkeypatch: pytest.MonkeyPatch, factory):
            monkeypatch.setattr(
                factory,
                "_resolve_node_class",
                MagicMock(side_effect=ValueError("No class mapping found for node type: start")),
            )
            with pytest.raises(ValueError, match="No class mapping found for node type: start"):
                factory.create_node({"id": "node-id", "data": {"type": BuiltinNodeTypes.START}})

        def test_rejects_missing_latest_class(self, monkeypatch: pytest.MonkeyPatch, factory):
            monkeypatch.setattr(
                factory,
                "_resolve_node_class",
                MagicMock(side_effect=ValueError("No latest version class found for node type: start")),
            )
            with pytest.raises(ValueError, match="No latest version class found for node type: start"):
                factory.create_node({"id": "node-id", "data": {"type": BuiltinNodeTypes.START}})

        def test_uses_version_specific_class_when_available(self, monkeypatch: pytest.MonkeyPatch, factory):
            matched_node = sentinel.matched_node
            latest_node_class = _node_constructor(return_value=sentinel.latest_node)
            matched_node_class = _node_constructor(return_value=matched_node)
            monkeypatch.setattr(factory, "_resolve_node_class", MagicMock(return_value=matched_node_class))
            result = factory.create_node({"id": "node-id", "data": {"type": BuiltinNodeTypes.START, "version": "9"}})
            assert result is matched_node
            matched_node_class.assert_called_once()
            kwargs = matched_node_class.call_args.kwargs
            assert kwargs["node_id"] == "node-id"
            _assert_constructor_node_data(
                kwargs["data"], node_id="node-id", node_type=BuiltinNodeTypes.START, version="9"
            )
            assert kwargs["init_params"] is sentinel.init_params
            assert kwargs["runtime_state"] is factory.runtime_state
            latest_node_class.assert_not_called()

        def test_falls_back_to_latest_class_when_version_specific_mapping_is_missing(
            self, monkeypatch: pytest.MonkeyPatch, factory
        ):
            latest_node = sentinel.latest_node
            latest_node_class = _node_constructor(return_value=latest_node)
            monkeypatch.setattr(factory, "_resolve_node_class", MagicMock(return_value=latest_node_class))
            result = factory.create_node({"id": "node-id", "data": {"type": BuiltinNodeTypes.START, "version": "9"}})
            assert result is latest_node
            latest_node_class.assert_called_once()
            kwargs = latest_node_class.call_args.kwargs
            assert kwargs["node_id"] == "node-id"
            _assert_constructor_node_data(
                kwargs["data"], node_id="node-id", node_type=BuiltinNodeTypes.START, version="9"
            )
            assert kwargs["init_params"] is sentinel.init_params
            assert kwargs["runtime_state"] is factory.runtime_state

        @pytest.mark.parametrize(
            ("node_type", "constructor_name"),
            [
                (BuiltinNodeTypes.CODE, "CodeNode"),
                (BuiltinNodeTypes.TEMPLATE_TRANSFORM, "TemplateTransformNode"),
                (BuiltinNodeTypes.HTTP_REQUEST, "HttpRequestNode"),
                (BuiltinNodeTypes.HUMAN_INPUT, "HumanInputNode"),
                (BuiltinNodeTypes.TOOL, "ToolNode"),
                (KNOWLEDGE_INDEX_NODE_TYPE, "KnowledgeIndexNode"),
                (BuiltinNodeTypes.DATASOURCE, "DatasourceNode"),
                (BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, "KnowledgeRetrievalNode"),
                (BuiltinNodeTypes.DOCUMENT_EXTRACTOR, "DocumentExtractorNode"),
            ],
        )
        def test_creates_specialized_nodes(self, monkeypatch: pytest.MonkeyPatch, factory, node_type, constructor_name):
            created_node = object()
            constructor = _node_constructor(return_value=created_node)
            constructor._mock_name = constructor_name
            monkeypatch.setattr(factory, "_resolve_node_class", MagicMock(return_value=constructor))
            if constructor_name == "HumanInputNode":
                factory._build_human_input_callback = MagicMock(return_value=sentinel.hitl_callback)
            node_config = {"id": "node-id", "data": {"type": node_type}}
            result = factory.create_node(node_config)
            assert result is created_node
            kwargs = constructor.call_args.kwargs
            assert kwargs["node_id"] == "node-id"
            _assert_constructor_node_data(kwargs["data"], node_id="node-id", node_type=node_type)
            assert kwargs["init_params"] is sentinel.init_params
            assert kwargs["runtime_state"] is factory.runtime_state
            if constructor_name == "CodeNode":
                assert kwargs["code_executor"] is sentinel.code_executor
                assert kwargs["code_limits"] is sentinel.code_limits
            elif constructor_name == "TemplateTransformNode":
                assert kwargs["jinja2_template_renderer"] is sentinel.jinja2_template_renderer
                assert kwargs["max_output_length"] == 2048
            elif constructor_name == "HttpRequestNode":
                assert kwargs["http_request_config"] is sentinel.http_request_config
                assert kwargs["http_client"] is sentinel.http_client
                assert kwargs["tool_file_manager_factory"] is factory._bound_tool_file_manager_factory
                assert kwargs["file_manager"] is sentinel.file_manager
                assert kwargs["file_reference_factory"] is sentinel.file_reference_factory
                factory._bound_tool_file_manager_factory.assert_not_called()
            elif constructor_name == "HumanInputNode":
                assert kwargs["hitl_callback"] is sentinel.hitl_callback
                factory._build_human_input_callback.assert_called_once()
            elif constructor_name == "ToolNode":
                assert kwargs["tool_file_manager"] is sentinel.tool_file_manager
                assert kwargs["runtime"] is sentinel.tool_runtime
                factory._bound_tool_file_manager_factory.assert_called_once_with()
            elif constructor_name == "DocumentExtractorNode":
                assert kwargs["unstructured_api_config"] is sentinel.unstructured_api_config
                assert kwargs["http_client"] is sentinel.remote_file_http_client

        def test_human_input_node_receives_built_hitl_callback(self, monkeypatch: pytest.MonkeyPatch, factory) -> None:
            created_node = object()
            constructor = _node_constructor(return_value=created_node)
            factory._build_human_input_callback = MagicMock(return_value=sentinel.hitl_callback)
            monkeypatch.setattr(factory, "_resolve_node_class", MagicMock(return_value=constructor))
            result = factory.create_node({"id": "human-node", "data": {"type": BuiltinNodeTypes.HUMAN_INPUT}})
            assert result is created_node
            kwargs = constructor.call_args.kwargs
            assert kwargs["hitl_callback"] is sentinel.hitl_callback
            factory._build_human_input_callback.assert_called_once()

        def test_tool_node_receives_tool_file_manager(self, monkeypatch: pytest.MonkeyPatch, factory) -> None:
            created_node = object()
            constructor = _node_constructor(return_value=created_node)
            factory._bound_tool_file_manager_factory = MagicMock(return_value=sentinel.tool_file_manager)
            monkeypatch.setattr(factory, "_resolve_node_class", MagicMock(return_value=constructor))
            result = factory.create_node({"id": "tool-node", "data": {"type": BuiltinNodeTypes.TOOL}})
            assert result is created_node
            kwargs = constructor.call_args.kwargs
            assert kwargs["tool_file_manager"] is sentinel.tool_file_manager
            assert kwargs["runtime"] is sentinel.tool_runtime
            assert "tool_file_manager_factory" not in kwargs
            factory._bound_tool_file_manager_factory.assert_called_once_with()

        def test_build_llm_compatible_node_init_kwargs_preserves_structured_output_switch(self, factory):
            node_data = LLMNodeData.model_validate(
                {
                    "type": BuiltinNodeTypes.LLM,
                    "title": "LLM",
                    "model": {"provider": "provider", "name": "model", "mode": "chat", "completion_params": {}},
                    "prompt_template": [{"role": "system", "text": "x"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                    "structured_output_enabled": True,
                    "structured_output": {
                        "schema": {"type": "object", "properties": {"type": {"type": "string"}}, "required": ["type"]}
                    },
                }
            )
            wrapped_model_instance = DifyPreparedLLM(make_model_instance(provider="openai", model="gpt-4"))
            memory = sentinel.memory
            factory._build_model_instance_for_llm_node = MagicMock(return_value=sentinel.model_instance)
            factory._build_memory_for_llm_node = MagicMock(return_value=memory)
            with patch.object(
                factory, "_wrap_model_instance_for_node", return_value=wrapped_model_instance
            ) as wrap_model:
                kwargs = factory._build_llm_compatible_node_init_kwargs(
                    node_class=sentinel.node_class,
                    node_data=node_data,
                    wrap_model_instance=True,
                    include_http_client=True,
                    include_llm_file_saver=True,
                    include_prompt_message_serializer=True,
                    include_retriever_attachment_loader=True,
                    include_jinja2_template_renderer=True,
                )
            assert node_data.structured_output_switch_on is True
            assert node_data.structured_output_enabled is True
            factory._build_model_instance_for_llm_node.assert_called_once_with(node_data)
            factory._build_memory_for_llm_node.assert_called_once_with(
                node_data=node_data, model_instance=sentinel.model_instance
            )
            wrap_model.assert_called_once_with(
                node_data=node_data, model_instance=sentinel.model_instance, request_metadata={"app_id": "app-id"}
            )
            assert kwargs["model_instance"] is wrapped_model_instance
            assert kwargs["polling_finalizer"] == wrapped_model_instance.finalize_llm_polling

        def test_resolve_llm_model_reference_uses_shared_model_and_parameters(self, factory):
            node_data = LLMNodeData.model_validate(
                {
                    "type": BuiltinNodeTypes.LLM,
                    "title": "LLM",
                    "model": {
                        "provider": "old-provider",
                        "name": "old-model",
                        "mode": "chat",
                        "completion_params": {"temperature": 0.2},
                    },
                    "model_selector": ["env", "for_summarize"],
                    "prompt_template": [{"role": "system", "text": "x"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                }
            )
            factory.runtime_state.variable_pool.get.return_value = ObjectSegment(
                value={
                    "provider": "new-provider",
                    "name": "new-model",
                    "mode": "chat",
                    "completion_params": {"temperature": 0.8},
                }
            )
            result = factory._resolve_llm_model_reference(node_data)
            assert result.model.provider == "new-provider"
            assert result.model.name == "new-model"
            assert result.model.mode == node_data.model.mode
            assert result.model.completion_params == {"temperature": 0.8}
            factory.runtime_state.variable_pool.get.assert_called_once_with(("env", "for_summarize"))

        def test_resolve_llm_model_reference_keeps_node_parameters_for_legacy_variable(self, factory):
            node_data = LLMNodeData.model_validate(
                {
                    "type": BuiltinNodeTypes.LLM,
                    "title": "LLM",
                    "model": {
                        "provider": "old-provider",
                        "name": "old-model",
                        "mode": "chat",
                        "completion_params": {"temperature": 0.2},
                    },
                    "model_selector": ["env", "for_summarize"],
                    "prompt_template": [{"role": "system", "text": "x"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                }
            )
            factory.runtime_state.variable_pool.get.return_value = ObjectSegment(
                value={"provider": "new-provider", "name": "new-model", "mode": "chat"}
            )
            result = factory._resolve_llm_model_reference(node_data)
            assert result.model.completion_params == {"temperature": 0.2}

        def test_resolve_llm_model_reference_rejects_mode_mismatch(self, factory):
            node_data = LLMNodeData.model_validate(
                {
                    "type": BuiltinNodeTypes.LLM,
                    "title": "LLM",
                    "model": {"provider": "provider", "name": "model", "mode": "chat"},
                    "model_selector": ["env", "shared_model"],
                    "prompt_template": [{"role": "system", "text": "x"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                }
            )
            factory.runtime_state.variable_pool.get.return_value = ObjectSegment(
                value={"provider": "provider", "name": "model", "mode": "completion"}
            )
            with pytest.raises(ValueError, match="uses mode 'completion'.*uses mode 'chat'"):
                factory._resolve_llm_model_reference(node_data)

        def test_resolve_llm_model_reference_rejects_missing_variable(self, factory):
            node_data = LLMNodeData.model_validate(
                {
                    "type": BuiltinNodeTypes.LLM,
                    "title": "LLM",
                    "model": {"provider": "provider", "name": "model", "mode": "chat"},
                    "model_selector": ["env", "shared_model"],
                    "prompt_template": [{"role": "system", "text": "x"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                }
            )
            factory.runtime_state.variable_pool.get.return_value = None
            with pytest.raises(ValueError, match="shared_model.*not found"):
                factory._resolve_llm_model_reference(node_data)

        def test_resolve_llm_model_reference_keeps_static_model_for_legacy_non_environment_selector(self, factory):
            node_data = LLMNodeData.model_validate(
                {
                    "type": BuiltinNodeTypes.LLM,
                    "title": "LLM",
                    "model": {"provider": "provider", "name": "model", "mode": "chat"},
                    "model_selector": ["conversation", "shared_model"],
                    "prompt_template": [{"role": "system", "text": "x"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                }
            )
            result = factory._resolve_llm_model_reference(node_data)
            assert result is node_data
            factory.runtime_state.variable_pool.get.assert_not_called()

        def test_build_llm_compatible_node_init_kwargs_uses_polling_wrapper_for_polling_llm_node(self, factory):
            node_data = LLMNodeData.model_validate(
                {
                    "type": BuiltinNodeTypes.LLM,
                    "title": "LLM",
                    "model": {"provider": "provider", "name": "model", "mode": "chat", "completion_params": {}},
                    "prompt_template": [{"role": "system", "text": "x"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                }
            )
            plugin_runtime = PluginModelRuntime(
                tenant_id="tenant-id", user_id="user-id", client=PluginModelClient(), plugin_service=PluginService
            )
            model_instance = _ModelInstanceStub(
                model_runtime=plugin_runtime, model_schema=_build_llm_model_schema(features=[ModelFeature.POLLING])
            )
            factory._build_model_instance_for_llm_node = MagicMock(return_value=model_instance)
            factory._build_memory_for_llm_node = MagicMock(return_value=sentinel.memory)
            kwargs = factory._build_llm_compatible_node_init_kwargs(
                node_class=sentinel.node_class,
                node_data=node_data,
                wrap_model_instance=True,
                include_http_client=False,
                include_llm_file_saver=False,
                include_prompt_message_serializer=False,
                include_retriever_attachment_loader=False,
                include_jinja2_template_renderer=False,
            )
            assert isinstance(kwargs["model_instance"], LLMPollingCapableProtocol)

        @pytest.mark.parametrize(
            "node_type", [BuiltinNodeTypes.QUESTION_CLASSIFIER, BuiltinNodeTypes.PARAMETER_EXTRACTOR]
        )
        def test_wrap_model_instance_keeps_non_llm_graph_nodes_on_plain_wrapper(self, node_type):
            plugin_runtime = PluginModelRuntime(
                tenant_id="tenant-id", user_id="user-id", client=PluginModelClient(), plugin_service=PluginService
            )
            model_instance = _ModelInstanceStub(
                model_runtime=plugin_runtime, model_schema=_build_llm_model_schema(features=[ModelFeature.POLLING])
            )
            node_data = (
                QuestionClassifierNodeData.model_construct(type=node_type)
                if node_type == BuiltinNodeTypes.QUESTION_CLASSIFIER
                else ParameterExtractorNodeData.model_construct(type=node_type)
            )
            wrapped = node_factory.DifyNodeFactory._wrap_model_instance_for_node(
                node_data=node_data, model_instance=model_instance
            )
            assert type(wrapped) is DifyPreparedLLM
            assert not isinstance(wrapped, LLMPollingCapableProtocol)

        def test_create_node_passes_canonical_llm_data_to_constructor(self, monkeypatch, factory):
            created_node = object()
            constructor = _node_constructor(return_value=created_node)
            constructor.validate_node_data.side_effect = lambda node_data: LLMNodeData.model_validate(
                node_data.model_dump(mode="python") if isinstance(node_data, BaseNodeData) else node_data
            )
            monkeypatch.setattr(factory, "_resolve_node_class", lambda **_kwargs: constructor)
            monkeypatch.setattr(factory, "_build_llm_compatible_node_init_kwargs", MagicMock(return_value={}))
            node_config = {
                "id": "llm-node-id",
                "data": {
                    "type": BuiltinNodeTypes.LLM,
                    "title": "LLM",
                    "model": {"provider": "provider", "name": "model", "mode": "chat", "completion_params": {}},
                    "prompt_template": [{"role": "system", "text": "x"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                    "structured_output_enabled": True,
                    "structured_output": {
                        "schema": {"type": "object", "properties": {"type": {"type": "string"}}, "required": ["type"]}
                    },
                },
            }
            factory.create_node(node_config)
            data = constructor.call_args.kwargs["data"]
            assert isinstance(data, Mapping)
            assert data["structured_output_switch_on"] is True
            assert "structured_output_enabled" not in data
            assert LLMNodeData.model_validate(data).structured_output_enabled is True

        def test_create_node_preserves_structured_output_switch_after_graphon_constructor(self, monkeypatch, factory):
            factory.init_params = SimpleNamespace(
                workflow_id="workflow-id", graph_config={}, run_context={}, call_depth=0
            )
            monkeypatch.setattr(factory, "_resolve_node_class", MagicMock(return_value=LLMNode))
            monkeypatch.setattr(
                factory,
                "_build_llm_compatible_node_init_kwargs",
                MagicMock(
                    return_value={
                        "model_instance": sentinel.model_instance,
                        "llm_file_saver": sentinel.llm_file_saver,
                        "prompt_message_serializer": sentinel.prompt_message_serializer,
                    }
                ),
            )
            node_config = {
                "id": "llm-node-id",
                "data": {
                    "type": BuiltinNodeTypes.LLM,
                    "title": "LLM",
                    "model": {"provider": "provider", "name": "model", "mode": "chat", "completion_params": {}},
                    "prompt_template": [{"role": "system", "text": "x"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                    "structured_output_enabled": True,
                    "structured_output": {
                        "schema": {"type": "object", "properties": {"type": {"type": "string"}}, "required": ["type"]}
                    },
                },
            }
            node = factory.create_node(node_config)
            assert node.node_data.structured_output_switch_on is True
            assert node.node_data.structured_output_enabled is True

        def test_create_node_uses_dify_llm_node_for_persisted_version_one(self, monkeypatch, factory):
            factory.init_params = SimpleNamespace(
                workflow_id="workflow-id", graph_config={}, run_context={}, call_depth=0
            )
            monkeypatch.setattr(
                factory,
                "_build_llm_compatible_node_init_kwargs",
                MagicMock(
                    return_value={
                        "model_instance": sentinel.model_instance,
                        "llm_file_saver": sentinel.llm_file_saver,
                        "prompt_message_serializer": sentinel.prompt_message_serializer,
                        "polling_finalizer": MagicMock(),
                    }
                ),
            )
            node = factory.create_node(
                {
                    "id": "llm-node-id",
                    "data": {
                        "type": BuiltinNodeTypes.LLM,
                        "version": "1",
                        "title": "LLM",
                        "model": {"provider": "provider", "name": "model", "mode": "chat"},
                        "prompt_template": [{"role": "system", "text": "x"}],
                        "context": {"enabled": False, "variable_selector": []},
                        "vision": {"enabled": False},
                    },
                }
            )
            assert isinstance(node, DifyLLMNode)
            assert node.version() == "1"

        @pytest.mark.parametrize(
            ("node_type", "constructor_name", "expected_extra_kwargs"),
            [
                (
                    BuiltinNodeTypes.LLM,
                    "LLMNode",
                    {
                        "http_client": sentinel.remote_file_http_client,
                        "llm_file_saver": sentinel.llm_file_saver,
                        "prompt_message_serializer": sentinel.prompt_message_serializer,
                        "retriever_attachment_loader": sentinel.retriever_attachment_loader,
                        "jinja2_template_renderer": sentinel.jinja2_template_renderer,
                    },
                ),
                (
                    BuiltinNodeTypes.QUESTION_CLASSIFIER,
                    "QuestionClassifierNode",
                    {
                        "http_client": sentinel.remote_file_http_client,
                        "llm_file_saver": sentinel.llm_file_saver,
                        "prompt_message_serializer": sentinel.prompt_message_serializer,
                        "template_renderer": sentinel.jinja2_template_renderer,
                    },
                ),
                (
                    BuiltinNodeTypes.PARAMETER_EXTRACTOR,
                    "ParameterExtractorNode",
                    {"prompt_message_serializer": sentinel.prompt_message_serializer},
                ),
            ],
        )
        def test_creates_model_backed_nodes(
            self, monkeypatch: pytest.MonkeyPatch, factory, node_type, constructor_name, expected_extra_kwargs
        ):
            created_node = object()
            constructor = _node_constructor(return_value=created_node)
            constructor._mock_name = constructor_name
            monkeypatch.setattr(factory, "_resolve_node_class", lambda **_kwargs: constructor)
            llm_init_kwargs = {
                "credentials_provider": sentinel.credentials_provider,
                "model_factory": sentinel.model_factory,
                "model_instance": sentinel.model_instance,
                "memory": sentinel.memory,
                **expected_extra_kwargs,
            }
            build_llm_init_kwargs = MagicMock(return_value=llm_init_kwargs)
            factory._build_llm_compatible_node_init_kwargs = build_llm_init_kwargs
            node_config = {"id": "node-id", "data": {"type": node_type}}
            result = factory.create_node(node_config)
            assert result is created_node
            build_llm_init_kwargs.assert_called_once()
            helper_kwargs = build_llm_init_kwargs.call_args.kwargs
            assert helper_kwargs["node_class"] is constructor
            assert isinstance(helper_kwargs["node_data"], BaseNodeData)
            assert helper_kwargs["node_data"].type == node_type
            assert helper_kwargs["wrap_model_instance"] is True
            assert helper_kwargs["include_http_client"] is (node_type != BuiltinNodeTypes.PARAMETER_EXTRACTOR)
            assert helper_kwargs["include_llm_file_saver"] is (node_type != BuiltinNodeTypes.PARAMETER_EXTRACTOR)
            assert helper_kwargs["include_prompt_message_serializer"] is True
            assert helper_kwargs["include_retriever_attachment_loader"] is (node_type == BuiltinNodeTypes.LLM)
            assert helper_kwargs["include_jinja2_template_renderer"] is (node_type == BuiltinNodeTypes.LLM)
            constructor_kwargs = constructor.call_args.kwargs
            assert constructor_kwargs["node_id"] == "node-id"
            _assert_constructor_node_data(constructor_kwargs["data"], node_id="node-id", node_type=node_type)
            assert constructor_kwargs["init_params"] is sentinel.init_params
            assert constructor_kwargs["runtime_state"] is factory.runtime_state
            assert constructor_kwargs["credentials_provider"] is sentinel.credentials_provider
            assert constructor_kwargs["model_factory"] is sentinel.model_factory
            assert constructor_kwargs["model_instance"] is sentinel.model_instance
            assert constructor_kwargs["memory"] is sentinel.memory
            for key, value in expected_extra_kwargs.items():
                assert constructor_kwargs[key] is value

        def test_parameter_extractor_init_does_not_require_retriever_context(self, factory):
            node_data = ParameterExtractorNodeData.model_validate(
                {
                    "type": BuiltinNodeTypes.PARAMETER_EXTRACTOR,
                    "title": "Parameter Extractor",
                    "model": {"provider": "provider", "name": "model", "mode": "chat", "completion_params": {}},
                    "query": ["sys", "query"],
                    "parameters": [{"name": "topic", "type": "string", "description": "Topic", "required": True}],
                    "reasoning_mode": "prompt",
                }
            )
            factory._build_model_instance_for_llm_node = MagicMock(return_value=sentinel.model_instance)
            factory._build_memory_for_llm_node = MagicMock(return_value=sentinel.memory)
            factory._build_retriever_attachment_loader = MagicMock(
                side_effect=AssertionError("unexpected loader build")
            )
            kwargs = factory._build_llm_compatible_node_init_kwargs(
                node_class=sentinel.node_class,
                node_data=node_data,
                wrap_model_instance=True,
                include_http_client=False,
                include_llm_file_saver=False,
                include_prompt_message_serializer=True,
                include_retriever_attachment_loader=False,
                include_jinja2_template_renderer=False,
            )
            assert "retriever_attachment_loader" not in kwargs
            assert kwargs["prompt_message_serializer"] is sentinel.prompt_message_serializer
            factory._build_retriever_attachment_loader.assert_not_called()

    class TestDifyNodeFactoryRetrieverAttachmentAccess:
        @pytest.fixture
        def factory(self, mocker):
            factory = object.__new__(node_factory.DifyNodeFactory)
            factory.runtime_state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0.0)
            mocker.patch.object(VariablePool, "get")
            return factory

        def test_retriever_attachment_loader_is_typed_for_llm_node_data_only(self):
            annotations = node_factory.DifyNodeFactory._build_retriever_attachment_loader.__annotations__
            assert annotations["node_data"] is LLMNodeData

        def test_build_retriever_attachment_loader_uses_llm_context_selector(self, factory):
            factory._file_reference_factory = sentinel.file_reference_factory
            factory.runtime_state.variable_pool.get.return_value = ArrayObjectSegment(
                value=[{"metadata": {"_source": "knowledge", "segment_id": "allowed-segment"}}]
            )
            node_data = LLMNodeData.model_validate(
                {
                    "type": BuiltinNodeTypes.LLM,
                    "title": "LLM",
                    "model": {"provider": "provider", "name": "model", "mode": "chat", "completion_params": {}},
                    "prompt_template": [{"role": "system", "text": "x"}],
                    "context": {"enabled": True, "variable_selector": ["knowledge-node", "result"]},
                    "vision": {"enabled": False},
                }
            )
            loader = factory._build_retriever_attachment_loader(node_data)
            assert loader._segment_access_checker is not None
            assert loader._segment_access_checker("allowed-segment") is True
            factory.runtime_state.variable_pool.get.assert_called_once_with(["knowledge-node", "result"])

        def test_checker_rejects_missing_context_selector_without_reading_variable_pool(self, factory):
            checker = factory._build_retriever_segment_access_checker(None)
            assert checker("segment-id") is False
            factory.runtime_state.variable_pool.get.assert_not_called()

        def test_checker_rejects_non_knowledge_context_items(self, factory):
            factory.runtime_state.variable_pool.get.return_value = ArrayObjectSegment.model_construct(
                value=["plain-text", {"metadata": "not-a-mapping"}]
            )
            checker = factory._build_retriever_segment_access_checker(["knowledge-node", "result"])
            assert checker("segment-id") is False

        def test_checker_rejects_non_array_context_value(self, factory):
            factory.runtime_state.variable_pool.get.return_value = StringSegment(value="not knowledge context")
            checker = factory._build_retriever_segment_access_checker(["knowledge-node", "result"])
            assert checker("segment-id") is False

        def test_checker_allows_only_segments_from_selected_knowledge_context(self, factory):
            factory.runtime_state.variable_pool.get.return_value = ArrayObjectSegment(
                value=[{"metadata": {"_source": "knowledge", "segment_id": "allowed-segment"}}]
            )
            checker = factory._build_retriever_segment_access_checker(["knowledge-node", "result"])
            assert checker("allowed-segment") is True
            assert checker("other-segment") is False
            factory.runtime_state.variable_pool.get.assert_any_call(["knowledge-node", "result"])

    class TestDifyNodeFactoryModelInstance:
        @pytest.fixture
        def factory(self, mocker):
            factory = object.__new__(node_factory.DifyNodeFactory)
            factory._llm_credentials_provider = sentinel.credentials_provider
            factory._llm_model_factory = sentinel.model_factory
            return factory

        def test_delegates_to_fetch_model_config(self, monkeypatch: pytest.MonkeyPatch, factory):
            node_data_model = SimpleNamespace(
                provider="provider",
                name="model",
                mode="chat",
                completion_params={"temperature": 0.3, "stop": ["Human:"]},
            )
            node_data = SimpleNamespace(model=node_data_model)
            model_type_instance = MagicMock()
            model_instance = SimpleNamespace(
                model_type_instance=model_type_instance, parameters={"temperature": 0.3}, stop=("Human:",)
            )
            fetch_model_config = MagicMock(return_value=(model_instance, sentinel.model_config))
            monkeypatch.setattr(node_factory, "fetch_model_config", fetch_model_config)
            result = factory._build_model_instance_for_llm_node(node_data)
            assert result is model_instance
            assert result.parameters == {"temperature": 0.3}
            assert result.stop == ("Human:",)
            assert result.model_type_instance is model_type_instance
            fetch_model_config.assert_called_once_with(
                node_data_model=node_data_model,
                credentials_provider=sentinel.credentials_provider,
                model_factory=sentinel.model_factory,
            )

        def test_propagates_fetch_model_config_errors(self, monkeypatch: pytest.MonkeyPatch, factory):
            fetch_model_config = MagicMock(side_effect=ValueError("broken model config"))
            monkeypatch.setattr(node_factory, "fetch_model_config", fetch_model_config)
            with pytest.raises(ValueError, match="broken model config"):
                factory._build_model_instance_for_llm_node(SimpleNamespace(model=sentinel.node_data_model))

    class TestDifyNodeFactoryMemory:
        @pytest.fixture
        def factory(self, mocker):
            factory = object.__new__(node_factory.DifyNodeFactory)
            factory._dify_context = DifyRunContext(
                tenant_id="tenant-id",
                app_id="app-id",
                user_id="user-id",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
            )
            factory.runtime_state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0.0)
            mocker.patch.object(VariablePool, "get")
            return factory

        def test_returns_none_when_memory_is_not_configured(self, factory):
            result = factory._build_memory_for_llm_node(
                node_data=SimpleNamespace(memory=None), model_instance=sentinel.model_instance
            )
            assert result is None
            factory.runtime_state.variable_pool.get.assert_not_called()

        def test_uses_string_segment_conversation_id(self, monkeypatch: pytest.MonkeyPatch, factory):
            memory_config = sentinel.memory_config
            factory.runtime_state.variable_pool.get.return_value = StringSegment(value="conversation-id")
            fetch_memory = MagicMock(return_value=sentinel.memory)
            monkeypatch.setattr(node_factory, "fetch_memory", fetch_memory)
            result = factory._build_memory_for_llm_node(
                node_data=SimpleNamespace(memory=memory_config), model_instance=sentinel.model_instance
            )
            assert result is sentinel.memory
            factory.runtime_state.variable_pool.get.assert_called_once_with(("sys", "conversation_id"))
            fetch_memory.assert_called_once_with(
                conversation_id="conversation-id",
                app_id="app-id",
                node_data_memory=memory_config,
                model_instance=sentinel.model_instance,
            )

        def test_ignores_non_string_segment_conversation_ids(self, monkeypatch: pytest.MonkeyPatch, factory):
            memory_config = sentinel.memory_config
            factory.runtime_state.variable_pool.get.return_value = sentinel.segment
            fetch_memory = MagicMock(return_value=sentinel.memory)
            monkeypatch.setattr(node_factory, "fetch_memory", fetch_memory)
            result = factory._build_memory_for_llm_node(
                node_data=SimpleNamespace(memory=memory_config), model_instance=sentinel.model_instance
            )
            assert result is sentinel.memory
            fetch_memory.assert_called_once_with(
                conversation_id=None,
                app_id="app-id",
                node_data_memory=memory_config,
                model_instance=sentinel.model_instance,
            )


class TestNodeConfigErrorsNameTheNode:
    """ESQ1-302: a graph-init failure surfaced as "2 validation errors for
    HttpRequestNodeData ..." -- the model class, never the node. The Builder (and
    anyone reading the run's error) had to guess which node it was. Every
    node-config error now starts with ``node <id> (<type>):``. This wrapping is
    in ``DifyNodeFactory.create_node``, so it changes the error text of EVERY
    workflow run that fails at graph init, not only the Builder's."""

    # The http-request node exactly as the ESQ1-302 draft stored it (dev app
    # a26c8d2b, node4): a json body whose items lack ``type``.
    ESQ1_302_HTTP_NODE = {
        "id": "node4",
        "type": "custom",
        "data": {
            "type": "http-request",
            "title": "Call PPT API",
            "desc": "Call external PPT generation API with the validated slide content.",
            "method": "post",
            "url": "https://api.example.com/ppt/generate",
            "authorization": {"config": None, "type": "no-auth"},
            "headers": "",
            "params": "",
            "ssl_verify": True,
            "timeout": {"max_connect_timeout": 0, "max_write_timeout": 0, "max_read_timeout": 0},
            "retry_config": {"max_retries": 3, "retry_interval": 100, "retry_enabled": True},
            "variables": [
                {"variable": "slide_content", "value_selector": ["node3", "text"]},
                {"variable": "output_filename", "value_selector": ["node1", "output_filename"]},
            ],
            "body": {
                "type": "json",
                "data": [
                    {"value": "{{#node3.text#}}", "key": "slides"},
                    {"value": "{{#node1.output_filename#}}", "key": "filename"},
                ],
            },
        },
    }

    # The if-else node exactly as the ESQ1-303 draft stored it (dev app
    # 0f11bedc, node2): ``value`` is the JSON number 60.
    ESQ1_303_IF_ELSE_NODE = {
        "id": "node2",
        "type": "custom",
        "data": {
            "type": "if-else",
            "title": "判断分数",
            "_targetBranches": [{"id": "true", "name": "IF"}, {"id": "false", "name": "ELSE"}],
            "logical_operator": "and",
            "cases": [
                {
                    "case_id": "true",
                    "logical_operator": "and",
                    "conditions": [
                        {
                            "id": "c1",
                            "variable_selector": ["node1", "score"],
                            "comparison_operator": "=",
                            "value": 60,
                        }
                    ],
                }
            ],
        },
    }

    @pytest.fixture
    def factory(self, mocker):
        factory = object.__new__(node_factory.DifyNodeFactory)
        factory.init_params = sentinel.init_params
        factory._use_workflow_tool_containers = True
        factory._native_runtime = None
        factory.runtime_state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0.0)
        mocker.patch.object(VariablePool, "get")
        factory._dify_context = DifyRunContext(
            tenant_id="tenant-id",
            app_id="app-id",
            user_id="user-id",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            builder_execution=None,
        )
        return factory

    def test_create_node_names_the_node_that_failed_validation(self, factory):
        with pytest.raises(ValueError, match=r"^node 'node4' \(http-request\): ") as excinfo:
            factory.create_node(self.ESQ1_302_HTTP_NODE)

        assert "body.data.0.type" in str(excinfo.value)
        assert "body.data.1.type" in str(excinfo.value)

    def test_create_node_rejects_human_input_delivery_uuid_before_runtime_setup(self, factory):
        # The factory has no callback/runtime/repository dependencies installed.
        # Delivery refusal must happen in shared validation before any are used.
        node_config = {
            "id": "review",
            "data": {
                "type": "human-input",
                "title": "Review",
                "delivery_methods": [{"id": "webapp", "type": "webapp", "enabled": True}],
                "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
            },
        }

        with pytest.raises(ValueError, match=r"^node 'review' \(human-input\): ") as excinfo:
            factory.create_node(node_config)

        assert isinstance(excinfo.value.__cause__, ValidationError)
        assert excinfo.value.__cause__.errors()[0]["loc"] == (0, "webapp", "id")
        assert excinfo.value.__cause__.errors()[0]["type"] == "uuid_parsing"

    def test_create_node_still_names_the_node_for_an_unknown_type(self, factory):
        with pytest.raises(
            ValueError, match=r"^node 'node-id' \(missing\): No class mapping found for node type: missing"
        ):
            factory.create_node({"id": "node-id", "data": {"type": "missing"}})

    def test_validate_node_config_rejects_the_esq1_303_numeric_value_with_the_node_id(self):
        with pytest.raises(ValueError, match=r"^node 'node2' \(if-else\): ") as excinfo:
            node_factory.validate_node_config(self.ESQ1_303_IF_ELSE_NODE)

        assert "Input should be a valid string" in str(excinfo.value)

    def test_validate_node_config_accepts_the_same_node_once_the_value_is_a_string(self):
        healed = copy.deepcopy(self.ESQ1_303_IF_ELSE_NODE)
        condition = cast(dict[str, object], healed["data"]["cases"][0]["conditions"][0])
        condition["value"] = "60"

        data = node_factory.validate_node_config(healed)

        assert data.type == BuiltinNodeTypes.IF_ELSE

    def test_validate_node_config_needs_no_factory_instance(self):
        # No init_params / runtime state anywhere: a pure, dry check.
        data = node_factory.validate_node_config(
            {"id": "s", "data": {"type": BuiltinNodeTypes.START, "title": "Start"}}
        )

        assert data.type == BuiltinNodeTypes.START


_EAGER_EFFECTS = (
    "DefaultWorkflowCodeExecutor",
    "CodeExecutorJinja2TemplateRenderer",
    "build_dify_model_access",
    "build_dify_llm_file_saver",
    "DifyHumanInputNodeRuntime",
    "DifyToolFileManager",
    "PluginAgentStrategyResolver",
)


def _forbid_eager_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("unrelated effect collaborator constructed for a confirmed run")

    for name in _EAGER_EFFECTS:
        monkeypatch.setattr(node_factory, name, forbidden)


class _PlainRecorder:
    """A healthy restricted-style recorder that cannot issue a confirmed guard."""

    @property
    def healthy(self) -> bool:
        return True

    def record(self, observation: BuilderExecutionObservation) -> None:
        raise AssertionError(f"unexpected observation {observation.kind}")


class _UnhealthyIssuer(_PlainRecorder):
    @property
    @override
    def healthy(self) -> bool:
        return False

    def confirmed_guard(self, *, node_id: str, native_run_id: str, native_node_execution_id: str) -> NoReturn:
        raise AssertionError(f"guard requested for {node_id}/{native_run_id}/{native_node_execution_id}")


def _confirmed_factory(
    owner: Owner,
    *,
    state_run_id: str | None = None,
    recorder: BuilderExecutionRecorder | None = None,
    user_id: str | None = None,
    workflow_id: str | None = None,
) -> tuple[node_factory.DifyNodeFactory, BuilderGraph, ConsentReceipt, str]:
    """Real SQLite reservation + existing launch fixture, then the native factory boundary.

    The run context is handed to the factory as an already-built ``DifyRunContext``
    so this exercises the factory's own admission; the JSON/entity boundary is
    covered by ``test_reserved_confirmed_context_crosses_the_run_context_entity``.
    The native Run ID is the fixture's launch claim, not a Graphon-allocated ID.
    """
    from core.workflow.system_variables import build_bootstrap_variables, build_system_variables
    from core.workflow.variable_pool_initializer import add_variables_to_pool
    from graphon.runtime import RuntimeState, VariablePool
    from models.workflow import Workflow
    from tests.unit_tests.services.dify_builder.test_confirmed_tool_launch import (
        ServiceGuardRecorder,
        launched_with_existing_apis,
    )

    reserved, context, run_id = launched_with_existing_apis(owner)
    if recorder is None:
        recorder = ServiceGuardRecorder(owner.service(), context, run_id)
    with owner.factory() as db:
        workflow = db.get(Workflow, owner.workflow_id)
        assert workflow is not None
        graph = json.loads(workflow.graph)
    run_context = DifyRunContext.model_construct(
        builder_execution=context,
        tenant_id=owner.actor.tenant_id,
        app_id=owner.app_id,
        user_id=user_id or owner.actor.account_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        app_type=None,
        created_by=None,
        trace_session_id=None,
    )
    params = InitParams(
        workflow_id=workflow_id or owner.workflow_id,
        graph_config=graph,
        call_depth=0,
        run_context={DIFY_RUN_CONTEXT_KEY: run_context},
    )
    pool = VariablePool()
    add_variables_to_pool(
        pool,
        build_bootstrap_variables(
            system_variables=build_system_variables(
                user_id=owner.actor.account_id,
                app_id=owner.app_id,
                workflow_id=owner.workflow_id,
                workflow_execution_id=state_run_id or run_id,
            )
        ),
    )
    state = RuntimeState(workflow_id=owner.workflow_id, variable_pool=pool, start_at=0.0)
    factory = node_factory.DifyNodeFactory(init_params=params, runtime_state=state, execution_recorder=recorder)
    return factory, graph, reserved, run_id


def _tool_config(graph: BuilderGraph) -> dict[str, object]:
    return next(node for node in graph["nodes"] if node["id"] == "tool")


def _tool_node(node: object) -> ToolNode:
    assert isinstance(node, ToolNode)
    return node


class TestConfirmedToolFactory:
    def test_admitted_factory_claims_at_bound_native_id_before_tool_manager(
        self, consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from core.tools.tool_manager import ToolManager
        from services.dify_builder.real_call_consent_service import ServiceConfirmedToolGuard

        _forbid_eager_effects(monkeypatch)
        factory, graph, reserved, run_id = _confirmed_factory(consent_owner)
        resolved: list[tuple[object, ...]] = []

        def resolve(*_args: object, confirmed_guard: object = None, **_kwargs: object):
            row = consent_owner.consent_row(reserved.consent_id)
            resolved.append((row.state, row.native_run_id, row.native_node_execution_id, confirmed_guard))
            from tests.unit_tests.core.tools.plugin_tool.test_confirmed_plugin_tool import _tool

            return _tool(confirmed_guard)

        monkeypatch.setattr(ToolManager, "get_workflow_tool_runtime", resolve)
        nodes = [factory.create_node(copy.deepcopy(node)) for node in graph["nodes"]]
        tool = _tool_node(nodes[1])
        # Graphon has not bound an execution ID during construction: nothing is claimed yet.
        assert consent_owner.consent_row(reserved.consent_id).claimed_at is None

        tool._runtime.get_runtime(
            node_id="tool", node_data=tool.node_data, variable_pool=None, node_execution_id="node-exec-1"
        )

        [(state, claimed_run, claimed_node, guard)] = resolved
        assert (state, claimed_run, claimed_node) == ("claimed", run_id, "node-exec-1")
        assert isinstance(guard, ServiceConfirmedToolGuard)
        # A second resolution never reconstructs or re-claims the guard.
        with pytest.raises(Exception, match="confirmed_runtime_replayed"):
            tool._runtime.get_runtime(
                node_id="tool", node_data=tool.node_data, variable_pool=None, node_execution_id="node-exec-2"
            )
        assert len(resolved) == 1

    @pytest.mark.parametrize("grant", ["wrong_run", "unlaunched"])
    def test_missing_or_wrong_grant_fails_before_tool_manager(
        self, consent_owner: Owner, monkeypatch: pytest.MonkeyPatch, grant: str
    ) -> None:
        from core.tools.tool_manager import ToolManager
        from graphon.nodes.tool.exc import ToolRuntimeResolutionError
        from models.dify_builder import DifyBuilderExecutionRequest

        _forbid_eager_effects(monkeypatch)
        calls: list[object] = []
        monkeypatch.setattr(ToolManager, "get_workflow_tool_runtime", lambda *a, **_k: calls.append(a))
        state_run = str(uuid4()) if grant == "wrong_run" else None
        factory, graph, reserved, _run_id = _confirmed_factory(consent_owner, state_run_id=state_run)
        # Built only after the admitted factory exists, so this asserts the claim boundary.
        if grant == "unlaunched":
            with consent_owner.factory.begin() as db:
                request = db.get(DifyBuilderExecutionRequest, reserved.execution_request_id)
                assert request is not None
                request.state, request.native_run_id, request.task_id = "prepared", None, None
        tool = _tool_node(factory.create_node(copy.deepcopy(_tool_config(graph))))

        with pytest.raises(ToolRuntimeResolutionError):
            tool._runtime.get_runtime(
                node_id="tool", node_data=tool.node_data, variable_pool=None, node_execution_id="node-exec-1"
            )
        assert calls == []
        assert consent_owner.consent_row(reserved.consent_id).claimed_at is None

    def test_recorder_without_service_guard_issuer_refuses_construction(
        self, consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError

        _forbid_eager_effects(monkeypatch)
        with pytest.raises(BuilderExecutionPolicyError, match="missing_confirmed_tool_guard"):
            _confirmed_factory(consent_owner, recorder=_PlainRecorder())

    @pytest.mark.parametrize("forgery", ["actor", "workflow"])
    def test_forged_actor_or_scope_refuses_before_any_effect(
        self, consent_owner: Owner, monkeypatch: pytest.MonkeyPatch, forgery: str
    ) -> None:
        from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError

        _forbid_eager_effects(monkeypatch)
        forged_user = str(uuid4()) if forgery == "actor" else None
        forged_workflow = str(uuid4()) if forgery == "workflow" else None
        with pytest.raises(BuilderExecutionPolicyError, match="execution_owner_mismatch"):
            _confirmed_factory(consent_owner, user_id=forged_user, workflow_id=forged_workflow)

    def test_unhealthy_recorder_refuses_construction(
        self, consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError

        _forbid_eager_effects(monkeypatch)
        with pytest.raises(BuilderExecutionPolicyError, match="missing_execution_recorder"):
            _confirmed_factory(consent_owner, recorder=_UnhealthyIssuer())

    def test_reserved_confirmed_context_crosses_the_run_context_entity(self, consent_owner: Owner) -> None:
        from core.app.entities.app_invoke_entities import build_dify_run_context
        from tests.unit_tests.services.dify_builder.test_confirmed_tool_launch import launched_with_existing_apis

        _reserved, context, _run_id = launched_with_existing_apis(consent_owner)
        run_context = build_dify_run_context(
            tenant_id=consent_owner.actor.tenant_id,
            app_id=consent_owner.app_id,
            user_id=consent_owner.actor.account_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            builder_execution=context,
        )
        decoded = DifyRunContext.model_validate(run_context[DIFY_RUN_CONTEXT_KEY].model_dump(mode="json"))
        assert decoded.builder_execution == context

    def test_unknown_policy_version_cannot_build_run_context(self, consent_owner: Owner) -> None:
        from tests.unit_tests.services.dify_builder.test_confirmed_tool_launch import launched_with_existing_apis

        _reserved, context, _run_id = launched_with_existing_apis(consent_owner)
        raw = context.model_dump(mode="json")
        raw["policy_version"] = "builder-unknown-v9"
        with pytest.raises(ValidationError):
            DifyRunContext.model_validate(
                {
                    "builder_execution": raw,
                    "tenant_id": "t",
                    "app_id": "a",
                    "user_id": "u",
                    "user_from": UserFrom.ACCOUNT,
                    "invoke_from": InvokeFrom.DEBUGGER,
                }
            )

    def test_only_the_exact_admitted_nodes_are_constructed(
        self, consent_owner: Owner, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError

        _forbid_eager_effects(monkeypatch)
        factory, graph, _reserved, _run_id = _confirmed_factory(consent_owner)
        tool = copy.deepcopy(_tool_config(graph))
        data = cast(dict[str, object], tool["data"])
        parameters = cast(dict[str, object], data["tool_parameters"])
        changed_data = {
            **data,
            "tool_parameters": {**parameters, "message_id": {"type": "constant", "value": "other_1"}},
        }
        with pytest.raises(BuilderExecutionPolicyError):
            factory.create_node({"id": "tool", "data": changed_data})
        with pytest.raises(BuilderExecutionPolicyError):
            factory.create_node({"id": "tool", "data": {"type": "llm", "title": "LLM"}})

    def test_ordinary_published_tool_keeps_native_runtime_without_consent(self) -> None:
        from core.workflow.node_runtime import DifyToolNodeRuntime

        runtime = DifyToolNodeRuntime(
            DifyRunContext(
                tenant_id="t", app_id="a", user_id="u", user_from=UserFrom.ACCOUNT, invoke_from=InvokeFrom.SERVICE_API
            )
        )
        assert runtime._confirmed is False


RESTRICTED_FIXTURES = Path(__file__).parents[3] / "fixtures/workflow/builder_restricted"


class ThrowingLayer(Layer):
    @override
    def on_graph_start(self) -> None:
        pass

    @override
    def on_event(self, event: EngineEvent) -> None:
        pass

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        pass

    @override
    def on_node_run_start(self, node: Node[BaseNodeData]) -> NoReturn:
        _ = node
        raise RuntimeError("observer is unavailable")


def prepare_native(
    owned: Owned,
    name: str,
    *,
    samples: Sequence[HttpResponseFixtureV1] = (),
    inputs: Inputs | None = None,
    http_data: dict[str, object] | None = None,
    graph_config: BuilderGraph | None = None,
) -> tuple[DifyNodeFactory, BuilderExecutionContext, BuilderExecutionRecorder]:
    db_factory, actor, app, workflow, sid, tid = owned
    if graph_config is None:
        graph_config = yaml.safe_load((RESTRICTED_FIXTURES / name).read_text())
    if http_data is not None:
        graph_config["nodes"][1]["data"].update(http_data)
    inputs = inputs if inputs is not None else {"path": "resolved-secret"}
    workflow.graph = json.dumps(graph_config)
    service = BuilderExecutionPolicyService(db_factory)
    with db_factory.begin() as db:
        stored_workflow = db.get(Workflow, workflow.id)
        test_input = db.get(DifyBuilderTestInput, tid)
        assert stored_workflow is not None
        assert test_input is not None
        stored_workflow.graph = workflow.graph
        test_input.inputs = inputs
    if samples:
        envelope = service.stamp_http_fixtures(
            app.id, actor, base_app_revision=execution_revision(workflow), fixtures=tuple(samples)
        )
        with db_factory.begin() as db:
            test_input = db.get(DifyBuilderTestInput, tid)
            assert test_input is not None
            test_input.http_fixtures = envelope.model_dump(mode="json")
    context = service.prepare(
        session_id=sid,
        test_input_id=tid,
        app_id=app.id,
        actor=actor,
        workflow=workflow,
        submitted_inputs=inputs,
        effective_inputs=inputs,
    )
    assert isinstance(context, BuilderExecutionContext)
    service.claim_launch(context=context, native_run_id="native-run", task_id="native-task")
    recorder = service.recorder(context=context, native_run_id="native-run", task_id="native-task")
    params = InitParams(
        workflow_id=workflow.id,
        graph_config=graph_config,
        call_depth=0,
        run_context=build_dify_run_context(
            tenant_id=actor.tenant_id,
            app_id=app.id,
            user_id=actor.account_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            builder_execution=context,
        ),
    )
    pool = VariablePool()
    add_node_inputs_to_pool(pool, node_id="start", inputs=inputs)
    state = RuntimeState(workflow_id=workflow.id, variable_pool=pool, start_at=time.perf_counter())
    factory = DifyNodeFactory(init_params=params, runtime_state=state, execution_recorder=recorder)
    return factory, context, recorder


def init_runner_graph(
    owned: Owned, factory: DifyNodeFactory, context: BuilderExecutionContext, recorder: BuilderExecutionRecorder
) -> Graph:
    _, actor, app, workflow, _, _ = owned
    runner = WorkflowBasedAppRunner(
        queue_manager=WorkflowAppQueueManager(
            task_id="task", user_id=actor.account_id, invoke_from=InvokeFrom.DEBUGGER, app_mode="workflow"
        ),
        app_id=app.id,
    )
    return runner._init_graph(
        graph_config=factory.init_params.graph_config,
        graph_runtime_state=factory.runtime_state,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_id=workflow.id,
        tenant_id=actor.tenant_id,
        user_id=actor.account_id,
        builder_execution=context,
        execution_recorder=recorder,
        call_depth=0,
    )


def execute_native(
    factory: DifyNodeFactory, *, throwing: bool = False, graph: Graph | None = None
) -> tuple[Graph, list[EngineEvent], RuntimeError | None]:
    if graph is None:
        graph = Graph.init(graph_config=factory.init_params.graph_config, node_factory=factory, root_node_id="start")
    engine = GraphonEngine(
        graph=graph,
        runtime_state=factory.runtime_state,
        command_channel=InMemoryChannel(),
        workers=1,
    )
    if throwing:
        engine.add_layer(ThrowingLayer())
    events: list[EngineEvent] = []
    error = None
    try:
        events.extend(iter_dify_graph_engine_events(engine))
    except RuntimeError as caught:
        error = caught
    return graph, events, error


def receipts(owned: Owned) -> list[dict[str, object]]:
    with owned[0]() as db:
        row = db.scalar(select(DifyBuilderExecutionRequest))
        assert row is not None
        assert (row.native_run_id, row.task_id) == ("native-run", "native-task")
        return row.observations


@pytest.fixture
def forbid_live(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    import services.workflow_runtime.node_factory as module
    from core.helper import ssrf_proxy
    from core.helper.code_executor.code_executor import CodeExecutor
    from core.plugin.impl import oauth
    from core.tools.tool_manager import ToolManager

    calls: list[str] = []

    def forbidden(*_args: object, **_kwargs: object) -> NoReturn:
        calls.append("live owner reached")
        raise AssertionError("live owner reached")

    for name in (
        "build_dify_model_access",
        "DefaultWorkflowCodeExecutor",
        "DifyFileReferenceFactory",
        "DifyToolFileManager",
        "DifyToolNodeRuntime",
        "DifyHumanInputNodeRuntime",
        "CodeExecutorJinja2TemplateRenderer",
        "PluginAgentStrategyResolver",
        "PluginAgentStrategyPresentationProvider",
        "AgentRuntimeSupport",
        "DifyPromptMessageSerializer",
        "DifyRetrieverAttachmentLoader",
        "build_dify_llm_file_saver",
    ):
        monkeypatch.setattr(module, name, forbidden)
    for name in ("get", "head", "post", "put", "patch", "delete"):
        monkeypatch.setattr(ssrf_proxy.graphon_ssrf_proxy, name, forbidden)
    monkeypatch.setattr(CodeExecutor, "execute_workflow_code_template", forbidden)
    monkeypatch.setattr(ToolManager, "get_workflow_tool_runtime", forbidden)
    monkeypatch.setattr(oauth, "OAuthHandler", forbidden)
    return calls


@pytest.mark.usefixtures("forbid_live")
@pytest.mark.parametrize("throwing", [False, True])
def test_native_scalar_outputs_survive_throwing_observers(owned: Owned, throwing: bool) -> None:
    factory, context, recorder = prepare_native(owned, "scalar.yml", inputs={"text": "真实 native"})
    graph, events, error = execute_native(factory, throwing=throwing)
    assert error is None
    assert type(graph.nodes["start"]) is StartNode
    assert type(graph.nodes["end"]) is EndNode
    assert [e.outputs for e in events if isinstance(e, GraphRunSucceededEvent)] == [{"out": "真实 native"}]
    assert {e.node_id for e in events if isinstance(e, NodeRunSucceededEvent)} == {"start", "end"}
    assert recorder.healthy
    assert receipts(owned) == []


@pytest.mark.usefixtures("forbid_live")
@pytest.mark.parametrize(("body", "content_type"), [('{"sample":true}', "application/json"), ("你好 🌍", "text/plain")])
def test_native_dynamic_http_fixture_outputs_and_durable_binding(owned: Owned, body: str, content_type: str) -> None:
    factory, context, recorder = prepare_native(
        owned, "http_text.yml", samples=(fixture(body=body, content_type=content_type),)
    )
    graph, events, error = execute_native(factory)
    assert type(graph.nodes["http"]) is HttpRequestNode
    assert error is None
    assert [e.outputs for e in events if isinstance(e, GraphRunSucceededEvent)] == [{"status": 201, "text": body}]
    assert {e.node_id for e in events if isinstance(e, NodeRunSucceededEvent)} == {"start", "http", "end"}
    observations = receipts(owned)
    assert len(observations) == 1
    receipt = observations[0]
    assert receipt["kind"] == "fixture_served"
    assert receipt["request_id"] == context.request_id
    assert receipt["node_id"] == "http"
    assert receipt["implementation_version"] == "graphon.nodes.http_request.node.HttpRequestNode:1"
    assert receipt["fixture_digest"] == context.fixture_digest
    expected_request = canonical_digest(
        {
            "method": "GET",
            "url": "https://sample.invalid/resolved-secret",
            "kwargs": {
                "max_retries": 0,
                "data": None,
                "files": None,
                "json": None,
                "content": "",
                "headers": {},
                "params": None,
                "timeout": (10, 10, 10),
                "ssl_verify": True,
                "follow_redirects": True,
            },
            "context_digest": context.context_digest,
            "node_id": "http",
            "invocation_id": receipt["invocation_id"],
        }
    )
    assert (
        receipt["request_hmac"]
        == hmac.new(factory._request_hmac_key, expected_request.encode("ascii"), hashlib.sha256).hexdigest()
    )
    assert "resolved-secret" not in json.dumps(observations)
    assert recorder.healthy


@pytest.mark.usefixtures("forbid_live")
@pytest.mark.parametrize(
    "headers",
    [
        "Content-Type: application/json; charset=utf-8",
        "Content-Type: APPLICATION/JSON; CHARSET=UTF-8",
        "CONTENT-TYPE: APPLICATION/JSON",
        "Content-Type: TEXT/PLAIN; CHARSET=UTF-8",
        "content-type: TEXT/PLAIN",
    ],
)
def test_admitted_fixed_header_case_serves_actual_native_fixture(owned: Owned, headers: str) -> None:
    body = '{"sample":true}'
    factory, _, recorder = prepare_native(
        owned,
        "http_text.yml",
        samples=(fixture(body=body, content_type="application/json"),),
        http_data={"headers": headers},
    )
    graph, events, error = execute_native(factory)
    assert type(graph.nodes["http"]) is HttpRequestNode
    assert error is None
    assert [e.outputs for e in events if isinstance(e, GraphRunSucceededEvent)] == [{"status": 201, "text": body}]
    assert {e.node_id for e in events if isinstance(e, NodeRunSucceededEvent)} == {"start", "http", "end"}
    observations = receipts(owned)
    assert len(observations) == 1
    assert observations[0]["kind"] == "fixture_served"
    assert recorder.healthy


@pytest.mark.usefixtures("forbid_live")
@pytest.mark.parametrize("throwing", [False, True])
def test_reached_native_http_denial_has_durable_evidence(owned: Owned, throwing: bool) -> None:
    factory, context, recorder = prepare_native(owned, "http_text.yml")
    graph, events, error = execute_native(factory, throwing=throwing)
    assert type(graph.nodes["http"]) is HttpRequestNode
    assert isinstance(error, RuntimeError)
    assert str(error) == "execution_policy: http_fixture_missing"
    assert any(isinstance(e, GraphRunFailedEvent) for e in events)
    assert not any(isinstance(e, GraphRunSucceededEvent) for e in events)
    assert receipts(owned)[0]["kind"] == "effect_blocked"
    assert receipts(owned)[0]["reason_code"] == "http_fixture_missing"
    assert "resolved-secret" not in str(events[-1])


@pytest.mark.usefixtures("forbid_live")
@pytest.mark.parametrize("throwing", [False, True])
def test_native_default_output_success_keeps_blocked_evidence(owned: Owned, throwing: bool) -> None:
    factory, context, recorder = prepare_native(owned, "http_default_output.yml")
    _, events, error = execute_native(factory, throwing=throwing)
    assert error is None
    assert error is None
    assert [e.outputs for e in events if isinstance(e, GraphRunPartialSucceededEvent)] == [
        {"status": 599, "text": "denied default"}
    ]
    assert any(isinstance(e, NodeRunSucceededEvent) and e.node_id == "end" for e in events)
    assert [e.exceptions_count for e in events if isinstance(e, GraphRunPartialSucceededEvent)] == [1]
    assert receipts(owned)[0]["kind"] == "effect_blocked"


@pytest.mark.usefixtures("forbid_live")
def test_runner_default_output_executes_native_partial_and_preserves_raw_graph(
    owned: Owned, forbid_live: list[str]
) -> None:
    graph_config = yaml.safe_load((RESTRICTED_FIXTURES / "http_default_output.yml").read_text())
    for target in (graph_config, graph_config["nodes"][1], graph_config["nodes"][1]["data"], graph_config["edges"][0]):
        target["undeclared_metadata"] = {"nested": ["preserved", 1]}
    factory, context, recorder = prepare_native(owned, "http_default_output.yml", graph_config=graph_config)
    raw_graph = factory.init_params.graph_config
    original = deepcopy(raw_graph)
    graph = init_runner_graph(owned, factory, context, recorder)
    _, events, error = execute_native(factory, graph=graph)
    assert error is None
    assert type(graph.nodes["http"]) is HttpRequestNode
    assert type(graph.nodes["end"]) is EndNode
    assert graph.nodes["http"].init_params.graph_config == graph.graph_config
    assert raw_graph == original
    assert type(raw_graph["nodes"][1]["data"]["error_strategy"]) is str
    assert type(raw_graph["nodes"][1]["data"]["default_value"][0]["type"]) is str
    assert type(raw_graph["nodes"][1]["data"]["default_value"][0]["value"]) is int
    assert [e.outputs for e in events if isinstance(e, GraphRunPartialSucceededEvent)] == [
        {"status": 599, "text": "denied default"}
    ]
    assert [e.exceptions_count for e in events if isinstance(e, GraphRunPartialSucceededEvent)] == [1]
    assert any(isinstance(e, NodeRunSucceededEvent) and e.node_id == "end" for e in events)
    observations = receipts(owned)
    assert len(observations) == 1
    assert observations[0]["kind"] == "effect_blocked"
    assert observations[0]["reason_code"] == "http_fixture_missing"
    assert observations[0]["request_id"] == context.request_id
    assert recorder.healthy
    assert forbid_live == []


@pytest.mark.usefixtures("forbid_live")
def test_runner_rejects_changed_raw_node_data_extras_before_execution(owned: Owned, forbid_live: list[str]) -> None:
    factory, context, recorder = prepare_native(owned, "http_default_output.yml")
    raw_graph = factory.init_params.graph_config
    raw_graph["nodes"][1]["data"]["undeclared_metadata"] = {"nested": ["changed", 1]}
    changed = deepcopy(raw_graph)
    with pytest.raises(BuilderExecutionPolicyError, match="execution_binding_mismatch"):
        init_runner_graph(owned, factory, context, recorder)
    assert raw_graph == changed
    assert receipts(owned) == []
    assert recorder.healthy
    assert forbid_live == []


@pytest.mark.usefixtures("forbid_live")
@pytest.mark.parametrize("value", ["strategy_enum", "default_type_enum", "default_model"])
def test_runner_refuses_non_json_objects_even_when_json_serialization_is_equivalent(
    owned: Owned, forbid_live: list[str], value: str
) -> None:
    factory, context, recorder = prepare_native(owned, "http_default_output.yml")
    data = factory.init_params.graph_config["nodes"][1]["data"]
    if value == "strategy_enum":
        data["error_strategy"] = ErrorStrategy.DEFAULT_VALUE
    elif value == "default_type_enum":
        data["default_value"][0]["type"] = DefaultValueType.NUMBER
    else:
        data["default_value"][0] = DefaultValue.model_validate(data["default_value"][0])
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_canonical_json"):
        init_runner_graph(owned, factory, context, recorder)
    assert receipts(owned) == []
    assert recorder.healthy
    assert forbid_live == []


@pytest.mark.usefixtures("forbid_live")
def test_recorder_db_failure_prevents_fixture_return_and_poisons_shared_latch(owned: Owned) -> None:
    factory, context, recorder = prepare_native(owned, "http_text.yml", samples=(fixture(),))
    engine = owned[0].kw["bind"]

    def fail_append(
        _connection, _cursor, statement: str, parameters: tuple[object, ...], _context, _executemany
    ) -> None:
        if statement.startswith("UPDATE dify_builder_execution_requests"):
            raise OperationalError(statement, parameters, RuntimeError("database append unavailable"))

    event.listen(engine, "before_cursor_execute", fail_append)
    try:
        _, events, error = execute_native(factory)
        assert isinstance(error, RuntimeError)
        assert "execution_recorder_failed" in str(error)
        assert not any(isinstance(e, GraphRunSucceededEvent) for e in events)
        assert not recorder.healthy
        assert receipts(owned) == []
        from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError

        with pytest.raises(BuilderExecutionPolicyError, match="missing_execution_recorder"):
            factory.with_runtime_state(factory.runtime_state)
    finally:
        event.remove(engine, "before_cursor_execute", fail_append)


@pytest.mark.usefixtures("forbid_live")
@pytest.mark.parametrize(
    "body",
    [
        {"type": "raw-text", "data": [{"type": "text", "value": "{{#start.path#}}"}]},
        {"type": "json", "data": [{"type": "text", "value": '{"path":"{{#start.path#}}"}'}]},
    ],
)
def test_native_text_request_bodies_and_params_resolve_without_file_capabilities(
    owned: Owned, body: dict[str, object]
) -> None:
    factory, _, _ = prepare_native(
        owned,
        "http_text.yml",
        samples=(fixture(),),
        http_data={"method": "POST", "body": body, "params": "path: {{#start.path#}}"},
    )
    _, events, error = execute_native(factory)
    assert error is None
    assert [e.outputs for e in events if isinstance(e, GraphRunSucceededEvent)] == [{"status": 201, "text": "sample"}]
    assert receipts(owned)[0]["kind"] == "fixture_served"


@pytest.mark.usefixtures("forbid_live")
def test_native_retries_append_distinct_denials_without_outbound_calls(owned: Owned) -> None:
    factory, _, _ = prepare_native(
        owned,
        "http_text.yml",
        http_data={"retry_config": {"retry_enabled": True, "max_retries": 1, "retry_interval": 1}},
    )
    _, events, error = execute_native(factory)
    assert isinstance(error, RuntimeError)
    assert any(isinstance(e, GraphRunFailedEvent) for e in events)
    observations = receipts(owned)
    assert len(observations) == 2
    assert {o["kind"] for o in observations} == {"effect_blocked"}
    assert len({o["invocation_id"] for o in observations}) == 2
    assert len({o["observation_id"] for o in observations}) == 2
