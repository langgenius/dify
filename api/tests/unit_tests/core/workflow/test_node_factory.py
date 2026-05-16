from collections.abc import Mapping
from types import SimpleNamespace
from unittest.mock import MagicMock, patch, sentinel

import pytest

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.workflow import node_factory
from core.workflow import template_rendering as workflow_template_rendering
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.nodes.code.entities import CodeLanguage
from graphon.nodes.llm.entities import LLMNodeData
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.parameter_extractor.entities import ParameterExtractorNodeData
from graphon.variables.segments import ArrayObjectSegment, StringSegment


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
    @pytest.mark.parametrize(
        ("conversation_id", "memory_config"),
        [
            (None, object()),
            ("conversation-id", None),
        ],
    )
    def test_returns_none_when_memory_or_conversation_is_missing(self, conversation_id, memory_config):
        result = node_factory.fetch_memory(
            conversation_id=conversation_id,
            app_id="app-id",
            node_data_memory=memory_config,
            model_instance=sentinel.model_instance,
        )

        assert result is None

    def test_returns_none_when_conversation_does_not_exist(self, monkeypatch: pytest.MonkeyPatch):
        class FakeSelect:
            def where(self, *_args):
                return self

        class FakeSession:
            def __init__(self, *_args, **_kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def scalar(self, _stmt):
                return None

        monkeypatch.setattr(node_factory, "session_factory", SimpleNamespace(create_session=FakeSession))
        monkeypatch.setattr(node_factory, "select", MagicMock(return_value=FakeSelect()))

        result = node_factory.fetch_memory(
            conversation_id="conversation-id",
            app_id="app-id",
            node_data_memory=object(),
            model_instance=sentinel.model_instance,
        )

        assert result is None

    def test_builds_token_buffer_memory_for_existing_conversation(self, monkeypatch: pytest.MonkeyPatch):
        conversation = sentinel.conversation
        memory = sentinel.memory

        class FakeSelect:
            def where(self, *_args):
                return self

        class FakeSession:
            def __init__(self, *_args, **_kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def scalar(self, _stmt):
                return conversation

        token_buffer_memory = MagicMock(return_value=memory)
        monkeypatch.setattr(node_factory, "session_factory", SimpleNamespace(create_session=FakeSession))
        monkeypatch.setattr(node_factory, "select", MagicMock(return_value=FakeSelect()))
        monkeypatch.setattr(node_factory, "TokenBufferMemory", token_buffer_memory)

        result = node_factory.fetch_memory(
            conversation_id="conversation-id",
            app_id="app-id",
            node_data_memory=object(),
            model_instance=sentinel.model_instance,
        )

        assert result is memory
        token_buffer_memory.assert_called_once_with(
            conversation=conversation,
            model_instance=sentinel.model_instance,
        )

    def test_uses_configured_session_factory_without_flask_app_context(self, monkeypatch: pytest.MonkeyPatch):
        class FakeSelect:
            def where(self, *_args):
                return self

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def scalar(self, _stmt):
                return sentinel.conversation

        class RaisingDB:
            @property
            def engine(self):
                raise RuntimeError("Working outside of application context.")

        token_buffer_memory = MagicMock(return_value=sentinel.memory)
        monkeypatch.setattr(node_factory, "db", RaisingDB(), raising=False)
        monkeypatch.setattr(node_factory, "session_factory", SimpleNamespace(create_session=FakeSession))
        monkeypatch.setattr(node_factory, "select", MagicMock(return_value=FakeSelect()))
        monkeypatch.setattr(node_factory, "TokenBufferMemory", token_buffer_memory)

        result = node_factory.fetch_memory(
            conversation_id="conversation-id",
            app_id="app-id",
            node_data_memory=object(),
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


class TestDifyNodeFactoryInit:
    def test_from_graph_init_context_translates_before_init(self):
        graph_init_context = MagicMock()
        graph_init_context.to_graph_init_params.return_value = sentinel.graph_init_params

        with patch.object(node_factory.DifyNodeFactory, "__init__", return_value=None) as init:
            factory = node_factory.DifyNodeFactory.from_graph_init_context(
                graph_init_context=graph_init_context,
                graph_runtime_state=sentinel.graph_runtime_state,
            )

        assert isinstance(factory, node_factory.DifyNodeFactory)
        graph_init_context.to_graph_init_params.assert_called_once_with()
        init.assert_called_once_with(
            graph_init_params=sentinel.graph_init_params,
            graph_runtime_state=sentinel.graph_runtime_state,
        )

    def test_init_builds_default_dependencies(self):
        graph_init_params = SimpleNamespace(run_context={"context": "value"})
        graph_runtime_state = sentinel.graph_runtime_state
        dify_context = SimpleNamespace(tenant_id="tenant-id", app_id="app-id", user_id="user-id")
        jinja2_template_renderer = sentinel.jinja2_template_renderer
        unstructured_api_config = sentinel.unstructured_api_config
        http_request_config = sentinel.http_request_config
        file_reference_factory = sentinel.file_reference_factory
        prompt_message_serializer = sentinel.prompt_message_serializer
        retriever_attachment_loader = sentinel.retriever_attachment_loader
        llm_file_saver = sentinel.llm_file_saver
        credentials_provider = sentinel.credentials_provider
        model_factory = sentinel.model_factory
        human_input_runtime = sentinel.human_input_runtime
        tool_runtime = sentinel.tool_runtime

        with (
            patch.object(
                node_factory.DifyNodeFactory,
                "_resolve_dify_context",
                return_value=dify_context,
            ) as resolve_dify_context,
            patch.object(
                node_factory,
                "CodeExecutorJinja2TemplateRenderer",
                return_value=jinja2_template_renderer,
            ) as renderer_factory,
            patch.object(
                node_factory,
                "UnstructuredApiConfig",
                return_value=unstructured_api_config,
            ),
            patch.object(
                node_factory,
                "build_http_request_config",
                return_value=http_request_config,
            ),
            patch.object(
                node_factory,
                "DifyFileReferenceFactory",
                return_value=file_reference_factory,
            ),
            patch.object(
                node_factory,
                "DifyPromptMessageSerializer",
                return_value=prompt_message_serializer,
            ),
            patch.object(
                node_factory,
                "DifyRetrieverAttachmentLoader",
                return_value=retriever_attachment_loader,
            ),
            patch.object(
                node_factory,
                "build_dify_llm_file_saver",
                return_value=llm_file_saver,
            ),
            patch.object(
                node_factory,
                "DifyHumanInputNodeRuntime",
                return_value=human_input_runtime,
            ),
            patch.object(
                node_factory,
                "DifyToolNodeRuntime",
                return_value=tool_runtime,
            ),
            patch.object(
                node_factory,
                "build_dify_model_access",
                return_value=(credentials_provider, model_factory),
            ) as build_dify_model_access,
        ):
            factory = node_factory.DifyNodeFactory(
                graph_init_params=graph_init_params,
                graph_runtime_state=graph_runtime_state,
            )

        resolve_dify_context.assert_called_once_with(graph_init_params.run_context)
        build_dify_model_access.assert_called_once_with(dify_context)
        renderer_factory.assert_called_once_with()
        assert factory.graph_init_params is graph_init_params
        assert factory.graph_runtime_state is graph_runtime_state
        assert factory._dify_context is dify_context
        assert factory._jinja2_template_renderer is jinja2_template_renderer
        assert factory._document_extractor_unstructured_api_config is unstructured_api_config
        assert factory._http_request_config is http_request_config
        assert factory._file_reference_factory is file_reference_factory
        assert factory._prompt_message_serializer is prompt_message_serializer
        assert factory._retriever_attachment_loader is retriever_attachment_loader
        assert factory._llm_file_saver is llm_file_saver
        assert factory._human_input_runtime is human_input_runtime
        assert factory._tool_runtime is tool_runtime
        assert factory._llm_credentials_provider is credentials_provider
        assert factory._llm_model_factory is model_factory


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
    def factory(self):
        factory = object.__new__(node_factory.DifyNodeFactory)
        factory.graph_init_params = sentinel.graph_init_params
        factory.graph_runtime_state = SimpleNamespace(variable_pool=MagicMock())
        factory._dify_context = SimpleNamespace(
            tenant_id="tenant-id",
            app_id="app-id",
            user_id="user-id",
            invoke_from=InvokeFrom.DEBUGGER,
        )
        factory._code_executor = sentinel.code_executor
        factory._code_limits = sentinel.code_limits
        factory._jinja2_template_renderer = sentinel.jinja2_template_renderer
        factory._template_transform_max_output_length = 2048
        factory._http_request_http_client = sentinel.http_client
        factory._bound_tool_file_manager_factory = sentinel.tool_file_manager_factory
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
        monkeypatch.setattr(
            factory,
            "_resolve_node_class",
            MagicMock(return_value=matched_node_class),
        )

        result = factory.create_node({"id": "node-id", "data": {"type": BuiltinNodeTypes.START, "version": "9"}})

        assert result is matched_node
        matched_node_class.assert_called_once()
        kwargs = matched_node_class.call_args.kwargs
        assert kwargs["node_id"] == "node-id"
        _assert_constructor_node_data(kwargs["data"], node_id="node-id", node_type=BuiltinNodeTypes.START, version="9")
        assert kwargs["graph_init_params"] is sentinel.graph_init_params
        assert kwargs["graph_runtime_state"] is factory.graph_runtime_state
        latest_node_class.assert_not_called()

    def test_falls_back_to_latest_class_when_version_specific_mapping_is_missing(
        self, monkeypatch: pytest.MonkeyPatch, factory
    ):
        latest_node = sentinel.latest_node
        latest_node_class = _node_constructor(return_value=latest_node)
        monkeypatch.setattr(
            factory,
            "_resolve_node_class",
            MagicMock(return_value=latest_node_class),
        )

        result = factory.create_node({"id": "node-id", "data": {"type": BuiltinNodeTypes.START, "version": "9"}})

        assert result is latest_node
        latest_node_class.assert_called_once()
        kwargs = latest_node_class.call_args.kwargs
        assert kwargs["node_id"] == "node-id"
        _assert_constructor_node_data(kwargs["data"], node_id="node-id", node_type=BuiltinNodeTypes.START, version="9")
        assert kwargs["graph_init_params"] is sentinel.graph_init_params
        assert kwargs["graph_runtime_state"] is factory.graph_runtime_state

    @pytest.mark.parametrize(
        ("node_type", "constructor_name"),
        [
            (BuiltinNodeTypes.CODE, "CodeNode"),
            (BuiltinNodeTypes.TEMPLATE_TRANSFORM, "TemplateTransformNode"),
            (BuiltinNodeTypes.HTTP_REQUEST, "HttpRequestNode"),
            (BuiltinNodeTypes.HUMAN_INPUT, "HumanInputNode"),
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
        monkeypatch.setattr(
            factory,
            "_resolve_node_class",
            MagicMock(return_value=constructor),
        )

        if constructor_name == "HumanInputNode":
            form_repository = sentinel.form_repository
            factory._human_input_runtime = MagicMock()
            factory._human_input_runtime.build_form_repository.return_value = form_repository

        node_config = {"id": "node-id", "data": {"type": node_type}}
        result = factory.create_node(node_config)

        assert result is created_node
        kwargs = constructor.call_args.kwargs
        assert kwargs["node_id"] == "node-id"
        _assert_constructor_node_data(kwargs["data"], node_id="node-id", node_type=node_type)
        assert kwargs["graph_init_params"] is sentinel.graph_init_params
        assert kwargs["graph_runtime_state"] is factory.graph_runtime_state

        if constructor_name == "CodeNode":
            assert kwargs["code_executor"] is sentinel.code_executor
            assert kwargs["code_limits"] is sentinel.code_limits
        elif constructor_name == "TemplateTransformNode":
            assert kwargs["jinja2_template_renderer"] is sentinel.jinja2_template_renderer
            assert kwargs["max_output_length"] == 2048
        elif constructor_name == "HttpRequestNode":
            assert kwargs["http_request_config"] is sentinel.http_request_config
            assert kwargs["http_client"] is sentinel.http_client
            assert kwargs["tool_file_manager_factory"] is sentinel.tool_file_manager_factory
            assert kwargs["file_manager"] is sentinel.file_manager
            assert kwargs["file_reference_factory"] is sentinel.file_reference_factory
        elif constructor_name == "HumanInputNode":
            assert kwargs["form_repository"] is form_repository
            assert kwargs["runtime"] is factory._human_input_runtime
            factory._human_input_runtime.build_form_repository.assert_called_once_with()
        elif constructor_name == "DocumentExtractorNode":
            assert kwargs["unstructured_api_config"] is sentinel.unstructured_api_config
            assert kwargs["http_client"] is sentinel.http_client

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
                    "schema": {
                        "type": "object",
                        "properties": {"type": {"type": "string"}},
                        "required": ["type"],
                    }
                },
            }
        )
        wrapped_model_instance = sentinel.wrapped_model_instance
        memory = sentinel.memory
        factory._build_model_instance_for_llm_node = MagicMock(return_value=sentinel.model_instance)
        factory._build_memory_for_llm_node = MagicMock(return_value=memory)
        with patch.object(node_factory, "DifyPreparedLLM", return_value=wrapped_model_instance) as prepared_llm:
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
            node_data=node_data,
            model_instance=sentinel.model_instance,
        )
        prepared_llm.assert_called_once_with(sentinel.model_instance)
        assert kwargs["model_instance"] is wrapped_model_instance

    def test_create_node_passes_alias_preserving_llm_data_to_constructor(self, monkeypatch, factory):
        created_node = object()
        constructor = _node_constructor(return_value=created_node)
        constructor.validate_node_data.side_effect = lambda node_data: LLMNodeData.model_validate(
            node_data.model_dump(mode="python") if isinstance(node_data, BaseNodeData) else node_data
        )
        monkeypatch.setattr(factory, "_resolve_node_class", MagicMock(return_value=constructor))
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
                    "schema": {
                        "type": "object",
                        "properties": {"type": {"type": "string"}},
                        "required": ["type"],
                    }
                },
            },
        }

        factory.create_node(node_config)

        data = constructor.call_args.kwargs["data"]
        assert isinstance(data, Mapping)
        assert data["structured_output_enabled"] is True
        assert "structured_output_switch_on" not in data
        assert LLMNodeData.model_validate(data).structured_output_enabled is True

    def test_create_node_preserves_structured_output_switch_after_graphon_constructor(self, monkeypatch, factory):
        factory.graph_init_params = SimpleNamespace(
            workflow_id="workflow-id",
            graph_config={},
            run_context={},
            call_depth=0,
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
                    "schema": {
                        "type": "object",
                        "properties": {"type": {"type": "string"}},
                        "required": ["type"],
                    }
                },
            },
        }

        node = factory.create_node(node_config)

        assert node.node_data.structured_output_switch_on is True
        assert node.node_data.structured_output_enabled is True

    @pytest.mark.parametrize(
        ("node_type", "constructor_name", "expected_extra_kwargs"),
        [
            (
                BuiltinNodeTypes.LLM,
                "LLMNode",
                {
                    "http_client": sentinel.http_client,
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
                    "http_client": sentinel.http_client,
                    "llm_file_saver": sentinel.llm_file_saver,
                    "prompt_message_serializer": sentinel.prompt_message_serializer,
                    "template_renderer": sentinel.jinja2_template_renderer,
                },
            ),
            (
                BuiltinNodeTypes.PARAMETER_EXTRACTOR,
                "ParameterExtractorNode",
                {
                    "prompt_message_serializer": sentinel.prompt_message_serializer,
                },
            ),
        ],
    )
    def test_creates_model_backed_nodes(
        self,
        monkeypatch: pytest.MonkeyPatch,
        factory,
        node_type,
        constructor_name,
        expected_extra_kwargs,
    ):
        created_node = object()
        constructor = _node_constructor(return_value=created_node)
        constructor._mock_name = constructor_name
        monkeypatch.setattr(
            factory,
            "_resolve_node_class",
            MagicMock(return_value=constructor),
        )
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
        assert constructor_kwargs["graph_init_params"] is sentinel.graph_init_params
        assert constructor_kwargs["graph_runtime_state"] is factory.graph_runtime_state
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
                "parameters": [
                    {
                        "name": "topic",
                        "type": "string",
                        "description": "Topic",
                        "required": True,
                    }
                ],
                "reasoning_mode": "prompt",
            }
        )
        factory._build_model_instance_for_llm_node = MagicMock(return_value=sentinel.model_instance)
        factory._build_memory_for_llm_node = MagicMock(return_value=sentinel.memory)
        factory._build_retriever_attachment_loader = MagicMock(side_effect=AssertionError("unexpected loader build"))

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
    def factory(self):
        factory = object.__new__(node_factory.DifyNodeFactory)
        factory.graph_runtime_state = SimpleNamespace(variable_pool=MagicMock())
        return factory

    def test_retriever_attachment_loader_is_typed_for_llm_node_data_only(self):
        annotations = node_factory.DifyNodeFactory._build_retriever_attachment_loader.__annotations__

        assert annotations["node_data"] is LLMNodeData

    def test_build_retriever_attachment_loader_uses_llm_context_selector(self, factory):
        factory._file_reference_factory = sentinel.file_reference_factory
        factory.graph_runtime_state.variable_pool.get.return_value = ArrayObjectSegment(
            value=[
                {
                    "metadata": {
                        "_source": "knowledge",
                        "segment_id": "allowed-segment",
                    }
                }
            ]
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
        factory.graph_runtime_state.variable_pool.get.assert_called_once_with(["knowledge-node", "result"])

    def test_checker_rejects_missing_context_selector_without_reading_variable_pool(self, factory):
        checker = factory._build_retriever_segment_access_checker(None)

        assert checker("segment-id") is False
        factory.graph_runtime_state.variable_pool.get.assert_not_called()

    def test_checker_rejects_non_knowledge_context_items(self, factory):
        factory.graph_runtime_state.variable_pool.get.return_value = ArrayObjectSegment.model_construct(
            value=[
                "plain-text",
                {"metadata": "not-a-mapping"},
            ]
        )

        checker = factory._build_retriever_segment_access_checker(["knowledge-node", "result"])

        assert checker("segment-id") is False

    def test_checker_rejects_non_array_context_value(self, factory):
        factory.graph_runtime_state.variable_pool.get.return_value = StringSegment(value="not knowledge context")

        checker = factory._build_retriever_segment_access_checker(["knowledge-node", "result"])

        assert checker("segment-id") is False

    def test_checker_allows_only_segments_from_selected_knowledge_context(self, factory):
        factory.graph_runtime_state.variable_pool.get.return_value = ArrayObjectSegment(
            value=[
                {
                    "metadata": {
                        "_source": "knowledge",
                        "segment_id": "allowed-segment",
                    }
                }
            ]
        )

        checker = factory._build_retriever_segment_access_checker(["knowledge-node", "result"])

        assert checker("allowed-segment") is True
        assert checker("other-segment") is False
        factory.graph_runtime_state.variable_pool.get.assert_any_call(["knowledge-node", "result"])


class TestDifyNodeFactoryModelInstance:
    @pytest.fixture
    def factory(self):
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
            model_type_instance=model_type_instance,
            parameters={"temperature": 0.3},
            stop=("Human:",),
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
    def factory(self):
        factory = object.__new__(node_factory.DifyNodeFactory)
        factory._dify_context = SimpleNamespace(app_id="app-id")
        factory.graph_runtime_state = SimpleNamespace(variable_pool=MagicMock())
        return factory

    def test_returns_none_when_memory_is_not_configured(self, factory):
        result = factory._build_memory_for_llm_node(
            node_data=SimpleNamespace(memory=None),
            model_instance=sentinel.model_instance,
        )

        assert result is None
        factory.graph_runtime_state.variable_pool.get.assert_not_called()

    def test_uses_string_segment_conversation_id(self, monkeypatch: pytest.MonkeyPatch, factory):
        memory_config = sentinel.memory_config
        factory.graph_runtime_state.variable_pool.get.return_value = StringSegment(value="conversation-id")
        fetch_memory = MagicMock(return_value=sentinel.memory)
        monkeypatch.setattr(node_factory, "fetch_memory", fetch_memory)

        result = factory._build_memory_for_llm_node(
            node_data=SimpleNamespace(memory=memory_config),
            model_instance=sentinel.model_instance,
        )

        assert result is sentinel.memory
        factory.graph_runtime_state.variable_pool.get.assert_called_once_with(("sys", "conversation_id"))
        fetch_memory.assert_called_once_with(
            conversation_id="conversation-id",
            app_id="app-id",
            node_data_memory=memory_config,
            model_instance=sentinel.model_instance,
        )

    def test_ignores_non_string_segment_conversation_ids(self, monkeypatch: pytest.MonkeyPatch, factory):
        memory_config = sentinel.memory_config
        factory.graph_runtime_state.variable_pool.get.return_value = sentinel.segment
        fetch_memory = MagicMock(return_value=sentinel.memory)
        monkeypatch.setattr(node_factory, "fetch_memory", fetch_memory)

        result = factory._build_memory_for_llm_node(
            node_data=SimpleNamespace(memory=memory_config),
            model_instance=sentinel.model_instance,
        )

        assert result is sentinel.memory
        fetch_memory.assert_called_once_with(
            conversation_id=None,
            app_id="app-id",
            node_data_memory=memory_config,
            model_instance=sentinel.model_instance,
        )
