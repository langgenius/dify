from types import SimpleNamespace
from unittest.mock import MagicMock, patch, sentinel

import pytest

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.workflow import node_factory
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.entities.graph_init_params import DIFY_RUN_CONTEXT_KEY
from dify_graph.enums import BuiltinNodeTypes, NodeType, SystemVariableKey
from dify_graph.nodes.code.entities import CodeLanguage
from dify_graph.variables.segments import StringSegment


def _assert_typed_node_config(config, *, node_id: str, node_type: NodeType, version: str = "1") -> None:
    assert config["id"] == node_id
    assert isinstance(config["data"], BaseNodeData)
    assert config["data"].type == node_type
    assert config["data"].version == version


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

    def test_returns_none_when_conversation_does_not_exist(self, monkeypatch):
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

        monkeypatch.setattr(node_factory, "db", SimpleNamespace(engine=sentinel.engine))
        monkeypatch.setattr(node_factory, "select", MagicMock(return_value=FakeSelect()))
        monkeypatch.setattr(node_factory, "Session", FakeSession)

        result = node_factory.fetch_memory(
            conversation_id="conversation-id",
            app_id="app-id",
            node_data_memory=object(),
            model_instance=sentinel.model_instance,
        )

        assert result is None

    def test_builds_token_buffer_memory_for_existing_conversation(self, monkeypatch):
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
        monkeypatch.setattr(node_factory, "db", SimpleNamespace(engine=sentinel.engine))
        monkeypatch.setattr(node_factory, "select", MagicMock(return_value=FakeSelect()))
        monkeypatch.setattr(node_factory, "Session", FakeSession)
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


class TestDefaultWorkflowCodeExecutor:
    def test_execute_delegates_to_code_executor(self, monkeypatch):
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


class TestDefaultLLMTemplateRenderer:
    def test_render_jinja2_delegates_to_code_executor(self, monkeypatch):
        renderer = node_factory.DefaultLLMTemplateRenderer()
        execute_workflow_code_template = MagicMock(return_value={"result": "hello world"})
        monkeypatch.setattr(
            node_factory.CodeExecutor,
            "execute_workflow_code_template",
            execute_workflow_code_template,
        )

        result = renderer.render_jinja2(
            template="Hello {{ name }}",
            inputs={"name": "world"},
        )

        assert result == "hello world"
        execute_workflow_code_template.assert_called_once_with(
            language=CodeLanguage.JINJA2,
            code="Hello {{ name }}",
            inputs={"name": "world"},
        )


class TestDifyNodeFactoryInit:
    def test_init_builds_default_dependencies(self):
        graph_init_params = SimpleNamespace(run_context={"context": "value"})
        graph_runtime_state = sentinel.graph_runtime_state
        dify_context = SimpleNamespace(tenant_id="tenant-id")
        template_renderer = sentinel.template_renderer
        unstructured_api_config = sentinel.unstructured_api_config
        http_request_config = sentinel.http_request_config
        credentials_provider = sentinel.credentials_provider
        model_factory = sentinel.model_factory
        llm_template_renderer = sentinel.llm_template_renderer

        with (
            patch.object(
                node_factory.DifyNodeFactory,
                "_resolve_dify_context",
                return_value=dify_context,
            ) as resolve_dify_context,
            patch.object(
                node_factory,
                "CodeExecutorJinja2TemplateRenderer",
                return_value=template_renderer,
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
                "DefaultLLMTemplateRenderer",
                return_value=llm_template_renderer,
            ) as llm_renderer_factory,
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
        build_dify_model_access.assert_called_once_with("tenant-id")
        renderer_factory.assert_called_once()
        llm_renderer_factory.assert_called_once()
        assert renderer_factory.call_args.kwargs["code_executor"] is factory._code_executor
        assert factory.graph_init_params is graph_init_params
        assert factory.graph_runtime_state is graph_runtime_state
        assert factory._dify_context is dify_context
        assert factory._template_renderer is template_renderer

        assert factory._llm_template_renderer is llm_template_renderer
        assert factory._document_extractor_unstructured_api_config is unstructured_api_config
        assert factory._http_request_config is http_request_config
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
        factory.graph_runtime_state = sentinel.graph_runtime_state
        factory._dify_context = SimpleNamespace(tenant_id="tenant-id", app_id="app-id")
        factory._code_executor = sentinel.code_executor
        factory._code_limits = sentinel.code_limits
        factory._template_renderer = sentinel.template_renderer
        factory._llm_template_renderer = sentinel.llm_template_renderer
        factory._template_transform_max_output_length = 2048
        factory._http_request_http_client = sentinel.http_client
        factory._http_request_tool_file_manager_factory = sentinel.tool_file_manager_factory
        factory._http_request_file_manager = sentinel.file_manager
        factory._document_extractor_unstructured_api_config = sentinel.unstructured_api_config
        factory._http_request_config = sentinel.http_request_config
        factory._llm_credentials_provider = sentinel.credentials_provider
        factory._llm_model_factory = sentinel.model_factory
        return factory

    def test_rejects_unknown_node_type(self, factory):
        with pytest.raises(ValueError, match="No class mapping found for node type: missing"):
            factory.create_node({"id": "node-id", "data": {"type": "missing"}})

    def test_rejects_missing_class_mapping(self, monkeypatch, factory):
        monkeypatch.setattr(
            factory,
            "_resolve_node_class",
            MagicMock(side_effect=ValueError("No class mapping found for node type: start")),
        )

        with pytest.raises(ValueError, match="No class mapping found for node type: start"):
            factory.create_node({"id": "node-id", "data": {"type": BuiltinNodeTypes.START}})

    def test_rejects_missing_latest_class(self, monkeypatch, factory):
        monkeypatch.setattr(
            factory,
            "_resolve_node_class",
            MagicMock(side_effect=ValueError("No latest version class found for node type: start")),
        )

        with pytest.raises(ValueError, match="No latest version class found for node type: start"):
            factory.create_node({"id": "node-id", "data": {"type": BuiltinNodeTypes.START}})

    def test_uses_version_specific_class_when_available(self, monkeypatch, factory):
        matched_node = sentinel.matched_node
        latest_node_class = MagicMock(return_value=sentinel.latest_node)
        matched_node_class = MagicMock(return_value=matched_node)
        monkeypatch.setattr(
            factory,
            "_resolve_node_class",
            MagicMock(return_value=matched_node_class),
        )

        result = factory.create_node({"id": "node-id", "data": {"type": BuiltinNodeTypes.START, "version": "9"}})

        assert result is matched_node
        matched_node_class.assert_called_once()
        kwargs = matched_node_class.call_args.kwargs
        assert kwargs["id"] == "node-id"
        _assert_typed_node_config(kwargs["config"], node_id="node-id", node_type=BuiltinNodeTypes.START, version="9")
        assert kwargs["graph_init_params"] is sentinel.graph_init_params
        assert kwargs["graph_runtime_state"] is sentinel.graph_runtime_state
        latest_node_class.assert_not_called()

    def test_falls_back_to_latest_class_when_version_specific_mapping_is_missing(self, monkeypatch, factory):
        latest_node = sentinel.latest_node
        latest_node_class = MagicMock(return_value=latest_node)
        monkeypatch.setattr(
            factory,
            "_resolve_node_class",
            MagicMock(return_value=latest_node_class),
        )

        result = factory.create_node({"id": "node-id", "data": {"type": BuiltinNodeTypes.START, "version": "9"}})

        assert result is latest_node
        latest_node_class.assert_called_once()
        kwargs = latest_node_class.call_args.kwargs
        assert kwargs["id"] == "node-id"
        _assert_typed_node_config(kwargs["config"], node_id="node-id", node_type=BuiltinNodeTypes.START, version="9")
        assert kwargs["graph_init_params"] is sentinel.graph_init_params
        assert kwargs["graph_runtime_state"] is sentinel.graph_runtime_state

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
    def test_creates_specialized_nodes(self, monkeypatch, factory, node_type, constructor_name):
        created_node = object()
        constructor = MagicMock(name=constructor_name, return_value=created_node)
        monkeypatch.setattr(
            factory,
            "_resolve_node_class",
            MagicMock(return_value=constructor),
        )

        if constructor_name == "HumanInputNode":
            form_repository = sentinel.form_repository
            form_repository_impl = MagicMock(return_value=form_repository)
            monkeypatch.setattr(
                node_factory,
                "HumanInputFormRepositoryImpl",
                form_repository_impl,
            )

        node_config = {"id": "node-id", "data": {"type": node_type}}
        result = factory.create_node(node_config)

        assert result is created_node
        kwargs = constructor.call_args.kwargs
        assert kwargs["id"] == "node-id"
        _assert_typed_node_config(kwargs["config"], node_id="node-id", node_type=node_type)
        assert kwargs["graph_init_params"] is sentinel.graph_init_params
        assert kwargs["graph_runtime_state"] is sentinel.graph_runtime_state

        if constructor_name == "CodeNode":
            assert kwargs["code_executor"] is sentinel.code_executor
            assert kwargs["code_limits"] is sentinel.code_limits
        elif constructor_name == "TemplateTransformNode":
            assert kwargs["template_renderer"] is sentinel.template_renderer
            assert kwargs["max_output_length"] == 2048
        elif constructor_name == "HttpRequestNode":
            assert kwargs["http_request_config"] is sentinel.http_request_config
            assert kwargs["http_client"] is sentinel.http_client
            assert kwargs["tool_file_manager_factory"] is sentinel.tool_file_manager_factory
            assert kwargs["file_manager"] is sentinel.file_manager
        elif constructor_name == "HumanInputNode":
            assert kwargs["form_repository"] is form_repository
            form_repository_impl.assert_called_once_with(tenant_id="tenant-id")
        elif constructor_name == "DocumentExtractorNode":
            assert kwargs["unstructured_api_config"] is sentinel.unstructured_api_config
            assert kwargs["http_client"] is sentinel.http_client

    @pytest.mark.parametrize(
        ("node_type", "constructor_name", "expected_extra_kwargs"),
        [
            (
                BuiltinNodeTypes.LLM,
                "LLMNode",
                {
                    "http_client": sentinel.http_client,
                    "template_renderer": sentinel.llm_template_renderer,
                },
            ),
            (
                BuiltinNodeTypes.QUESTION_CLASSIFIER,
                "QuestionClassifierNode",
                {
                    "http_client": sentinel.http_client,
                    "template_renderer": sentinel.llm_template_renderer,
                },
            ),
            (BuiltinNodeTypes.PARAMETER_EXTRACTOR, "ParameterExtractorNode", {}),
        ],
    )
    def test_creates_model_backed_nodes(
        self,
        monkeypatch,
        factory,
        node_type,
        constructor_name,
        expected_extra_kwargs,
    ):
        created_node = object()
        constructor = MagicMock(name=constructor_name, return_value=created_node)
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
        assert helper_kwargs["include_http_client"] is (node_type != BuiltinNodeTypes.PARAMETER_EXTRACTOR)

        constructor_kwargs = constructor.call_args.kwargs
        assert constructor_kwargs["id"] == "node-id"
        _assert_typed_node_config(constructor_kwargs["config"], node_id="node-id", node_type=node_type)
        assert constructor_kwargs["graph_init_params"] is sentinel.graph_init_params
        assert constructor_kwargs["graph_runtime_state"] is sentinel.graph_runtime_state
        assert constructor_kwargs["credentials_provider"] is sentinel.credentials_provider
        assert constructor_kwargs["model_factory"] is sentinel.model_factory
        assert constructor_kwargs["model_instance"] is sentinel.model_instance
        assert constructor_kwargs["memory"] is sentinel.memory
        for key, value in expected_extra_kwargs.items():
            assert constructor_kwargs[key] is value


class TestDifyNodeFactoryModelInstance:
    @pytest.fixture
    def factory(self):
        factory = object.__new__(node_factory.DifyNodeFactory)
        factory._llm_credentials_provider = MagicMock()
        factory._llm_model_factory = MagicMock()
        return factory

    @pytest.fixture
    def llm_model_setup(self, factory):
        def _configure(
            *,
            completion_params=None,
            has_provider_model=True,
            model_schema=sentinel.model_schema,
        ):
            credentials = {"api_key": "secret"}
            node_data_model = SimpleNamespace(
                provider="provider",
                name="model",
                mode="chat",
                completion_params=completion_params or {},
            )
            node_data = SimpleNamespace(model=node_data_model)
            provider_model = MagicMock() if has_provider_model else None
            provider_model_bundle = SimpleNamespace(
                configuration=SimpleNamespace(get_provider_model=MagicMock(return_value=provider_model))
            )
            model_type_instance = MagicMock()
            model_type_instance.get_model_schema.return_value = model_schema
            model_instance = SimpleNamespace(
                provider_model_bundle=provider_model_bundle,
                model_type_instance=model_type_instance,
                provider=None,
                model_name=None,
                credentials=None,
                parameters=None,
                stop=None,
            )
            factory._llm_credentials_provider.fetch.return_value = credentials
            factory._llm_model_factory.init_model_instance.return_value = model_instance
            return SimpleNamespace(
                node_data=node_data,
                credentials=credentials,
                provider_model=provider_model,
                model_type_instance=model_type_instance,
                model_instance=model_instance,
            )

        return _configure

    def test_requires_llm_mode(self, factory):
        node_data = SimpleNamespace(
            model=SimpleNamespace(
                provider="provider",
                name="model",
                mode="",
                completion_params={},
            )
        )

        with pytest.raises(node_factory.LLMModeRequiredError, match="LLM mode is required"):
            factory._build_model_instance_for_llm_node(node_data)

    def test_raises_when_provider_model_is_missing(self, factory, llm_model_setup):
        setup = llm_model_setup(has_provider_model=False)

        with pytest.raises(node_factory.ModelNotExistError, match="Model model not exist"):
            factory._build_model_instance_for_llm_node(setup.node_data)

    def test_raises_when_model_schema_is_missing(self, factory, llm_model_setup):
        setup = llm_model_setup(model_schema=None)

        with pytest.raises(node_factory.ModelNotExistError, match="Model model not exist"):
            factory._build_model_instance_for_llm_node(setup.node_data)

        setup.provider_model.raise_for_status.assert_called_once()

    def test_builds_model_instance_and_normalizes_stop_tokens(self, factory, llm_model_setup):
        setup = llm_model_setup(
            completion_params={"temperature": 0.3, "stop": "not-a-list"},
            model_schema={"schema": "value"},
        )

        result = factory._build_model_instance_for_llm_node(setup.node_data)

        assert result is setup.model_instance
        assert result.provider == "provider"
        assert result.model_name == "model"
        assert result.credentials == setup.credentials
        assert result.parameters == {"temperature": 0.3}
        assert result.stop == ()
        assert result.model_type_instance is setup.model_type_instance
        setup.provider_model.raise_for_status.assert_called_once()


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

    def test_uses_string_segment_conversation_id(self, monkeypatch, factory):
        memory_config = sentinel.memory_config
        factory.graph_runtime_state.variable_pool.get.return_value = StringSegment(value="conversation-id")
        fetch_memory = MagicMock(return_value=sentinel.memory)
        monkeypatch.setattr(node_factory, "fetch_memory", fetch_memory)

        result = factory._build_memory_for_llm_node(
            node_data=SimpleNamespace(memory=memory_config),
            model_instance=sentinel.model_instance,
        )

        assert result is sentinel.memory
        factory.graph_runtime_state.variable_pool.get.assert_called_once_with(
            ["sys", SystemVariableKey.CONVERSATION_ID]
        )
        fetch_memory.assert_called_once_with(
            conversation_id="conversation-id",
            app_id="app-id",
            node_data_memory=memory_config,
            model_instance=sentinel.model_instance,
        )

    def test_ignores_non_string_segment_conversation_ids(self, monkeypatch, factory):
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
