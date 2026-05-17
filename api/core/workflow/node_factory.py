import importlib
import pkgutil
from collections.abc import Callable, Iterator, Mapping, MutableMapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import TYPE_CHECKING, Any, cast, final, override

from sqlalchemy import select

from configs import dify_config
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.app.llm.model_access import build_dify_model_access, fetch_model_config
from core.db.session_factory import session_factory
from core.helper.code_executor.code_executor import (
    CodeExecutionError,
    CodeExecutor,
)
from core.helper.ssrf_proxy import graphon_ssrf_proxy
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.trigger.constants import TRIGGER_NODE_TYPES
from core.workflow.human_input_adapter import adapt_node_config_for_graph
from core.workflow.node_runtime import (
    DifyFileReferenceFactory,
    DifyHumanInputNodeRuntime,
    DifyPreparedLLM,
    DifyPromptMessageSerializer,
    DifyRetrieverAttachmentLoader,
    DifyToolFileManager,
    DifyToolNodeRuntime,
    build_dify_llm_file_saver,
)
from core.workflow.nodes.agent.message_transformer import AgentMessageTransformer
from core.workflow.nodes.agent.plugin_strategy_adapter import (
    PluginAgentStrategyPresentationProvider,
    PluginAgentStrategyResolver,
)
from core.workflow.nodes.agent.runtime_support import AgentRuntimeSupport
from core.workflow.system_variables import SystemVariableKey, get_system_text, system_variable_selector
from core.workflow.template_rendering import CodeExecutorJinja2TemplateRenderer
from graphon.entities.base_node_data import BaseNodeData
from graphon.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.file.file_manager import file_manager
from graphon.graph.graph import NodeFactory
from graphon.model_runtime.memory import PromptMessageMemory
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.nodes.base.node import Node
from graphon.nodes.code.code_node import WorkflowCodeExecutor
from graphon.nodes.code.entities import CodeLanguage
from graphon.nodes.code.limits import CodeNodeLimits
from graphon.nodes.document_extractor import UnstructuredApiConfig
from graphon.nodes.http_request import build_http_request_config
from graphon.nodes.llm.entities import LLMNodeData
from graphon.nodes.parameter_extractor.entities import ParameterExtractorNodeData
from graphon.nodes.question_classifier.entities import QuestionClassifierNodeData
from graphon.variables.segments import ArrayObjectSegment
from models.model import Conversation

if TYPE_CHECKING:
    from graphon.entities import GraphInitParams
    from graphon.runtime import GraphRuntimeState

LATEST_VERSION = "latest"
_START_NODE_TYPES: frozenset[NodeType] = frozenset(
    (BuiltinNodeTypes.START, BuiltinNodeTypes.DATASOURCE, *TRIGGER_NODE_TYPES)
)


@dataclass(frozen=True, slots=True)
class DifyGraphInitContext:
    """Explicit graph-init values owned by the workflow layer.

    Dify is gradually removing direct `GraphInitParams` construction from its
    production call sites. Keep the translation here until `graphon` exposes an
    equivalent explicit API.
    """

    workflow_id: str
    graph_config: Mapping[str, Any]
    run_context: Mapping[str, Any]
    call_depth: int

    def to_graph_init_params(self) -> "GraphInitParams":
        from graphon.entities import GraphInitParams

        return GraphInitParams(
            workflow_id=self.workflow_id,
            graph_config=self.graph_config,
            run_context=self.run_context,
            call_depth=self.call_depth,
        )


def _import_node_package(package_name: str, *, excluded_modules: frozenset[str] = frozenset()) -> None:
    package = importlib.import_module(package_name)
    for _, module_name, _ in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
        if module_name in excluded_modules:
            continue
        importlib.import_module(module_name)


@lru_cache(maxsize=1)
def register_nodes() -> None:
    """Import production node modules so they self-register with ``Node``."""
    _import_node_package("graphon.nodes")
    _import_node_package("core.workflow.nodes")


def get_node_type_classes_mapping() -> Mapping[NodeType, Mapping[str, type[Node]]]:
    """Return a read-only snapshot of the current production node registry.

    The workflow layer owns node bootstrap because it must compose built-in
    `graphon.nodes.*` implementations with workflow-local nodes under
    `core.workflow.nodes.*`. Keeping this import side effect here avoids
    reintroducing registry bootstrapping into lower-level graph primitives.
    """
    register_nodes()
    return Node.get_node_type_classes_mapping()


def resolve_workflow_node_class(*, node_type: NodeType, node_version: str) -> type[Node]:
    """Resolve the production node class for the requested type/version."""
    node_mapping = get_node_type_classes_mapping().get(node_type)
    if not node_mapping:
        raise ValueError(f"No class mapping found for node type: {node_type}")

    latest_node_class = node_mapping.get(LATEST_VERSION)
    matched_node_class = node_mapping.get(node_version)
    node_class = matched_node_class or latest_node_class
    if not node_class:
        raise ValueError(f"No latest version class found for node type: {node_type}")
    return node_class


def is_start_node_type(node_type: NodeType) -> bool:
    """Return True when the node type can serve as a workflow entry point."""
    return node_type in _START_NODE_TYPES


def get_default_root_node_id(graph_config: Mapping[str, Any]) -> str:
    """Resolve the default entry node for a persisted top-level workflow graph.

    This workflow-layer helper depends on start-node semantics defined by
    `is_start_node_type`, so it intentionally lives next to the node registry
    instead of in the raw `graphon.entities.graph_config` schema module.
    """
    nodes = graph_config.get("nodes")
    if not isinstance(nodes, list):
        raise ValueError("nodes in workflow graph must be a list")

    for node in nodes:
        if not isinstance(node, Mapping):
            continue

        if node.get("type") == "custom-note":
            continue

        node_id = node.get("id")
        data = node.get("data")
        if not isinstance(node_id, str) or not isinstance(data, Mapping):
            continue

        node_type = data.get("type")
        if isinstance(node_type, str) and is_start_node_type(node_type):
            return node_id

    raise ValueError("Unable to determine default root node ID from workflow graph")


class _LazyNodeTypeClassesMapping(MutableMapping[NodeType, Mapping[str, type[Node]]]):
    """Mutable dict-like view over the current node registry."""

    def __init__(self) -> None:
        self._cached_snapshot: dict[NodeType, Mapping[str, type[Node]]] = {}
        self._cached_version = -1
        self._deleted: set[NodeType] = set()
        self._overrides: dict[NodeType, Mapping[str, type[Node]]] = {}

    def _snapshot(self) -> dict[NodeType, Mapping[str, type[Node]]]:
        current_version = Node.get_registry_version()
        if self._cached_version != current_version:
            self._cached_snapshot = dict(get_node_type_classes_mapping())
            self._cached_version = current_version
        if not self._deleted and not self._overrides:
            return self._cached_snapshot

        snapshot = {key: value for key, value in self._cached_snapshot.items() if key not in self._deleted}
        snapshot.update(self._overrides)
        return snapshot

    def __getitem__(self, key: NodeType) -> Mapping[str, type[Node]]:
        return self._snapshot()[key]

    def __setitem__(self, key: NodeType, value: Mapping[str, type[Node]]) -> None:
        self._deleted.discard(key)
        self._overrides[key] = value

    def __delitem__(self, key: NodeType) -> None:
        if key in self._overrides:
            del self._overrides[key]
            return
        if key in self._cached_snapshot:
            self._deleted.add(key)
            return
        raise KeyError(key)

    def __iter__(self) -> Iterator[NodeType]:
        return iter(self._snapshot())

    def __len__(self) -> int:
        return len(self._snapshot())


# Keep the canonical node-class mapping in the workflow layer that also bootstraps
# legacy `core.workflow.nodes.*` registrations.
NODE_TYPE_CLASSES_MAPPING: MutableMapping[NodeType, Mapping[str, type[Node]]] = _LazyNodeTypeClassesMapping()


type LLMCompatibleNodeData = LLMNodeData | QuestionClassifierNodeData | ParameterExtractorNodeData


def fetch_memory(
    *,
    conversation_id: str | None,
    app_id: str,
    node_data_memory: MemoryConfig | None,
    model_instance: ModelInstance,
) -> TokenBufferMemory | None:
    """Build prompt memory for node construction without requiring Flask-local state."""
    if not node_data_memory or not conversation_id:
        return None

    # Node construction can happen in graph initialization paths where Flask's
    # app context is not active. Use the app-configured session factory instead
    # of resolving db.engine through Flask-SQLAlchemy's current_app proxy.
    with session_factory.create_session() as session:
        stmt = select(Conversation).where(Conversation.app_id == app_id, Conversation.id == conversation_id)
        conversation = session.scalar(stmt)
        if not conversation:
            return None

    return TokenBufferMemory(conversation=conversation, model_instance=model_instance)


class DefaultWorkflowCodeExecutor:
    def execute(
        self,
        *,
        language: CodeLanguage,
        code: str,
        inputs: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        return CodeExecutor.execute_workflow_code_template(
            language=language,
            code=code,
            inputs=inputs,
        )

    def is_execution_error(self, error: Exception) -> bool:
        return isinstance(error, CodeExecutionError)


@final
class DifyNodeFactory(NodeFactory):
    """
    Default implementation of NodeFactory that resolves node classes from the live registry.
    """

    @classmethod
    def from_graph_init_context(
        cls,
        *,
        graph_init_context: DifyGraphInitContext,
        graph_runtime_state: "GraphRuntimeState",
    ) -> "DifyNodeFactory":
        """Bridge Dify's explicit init context into the current `graphon` API."""
        return cls(
            graph_init_params=graph_init_context.to_graph_init_params(),
            graph_runtime_state=graph_runtime_state,
        )

    def __init__(
        self,
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
    ) -> None:
        self.graph_init_params = graph_init_params
        self.graph_runtime_state = graph_runtime_state
        self._dify_context = self._resolve_dify_context(graph_init_params.run_context)
        self._code_executor: WorkflowCodeExecutor = DefaultWorkflowCodeExecutor()
        self._code_limits = CodeNodeLimits(
            max_string_length=dify_config.CODE_MAX_STRING_LENGTH,
            max_number=dify_config.CODE_MAX_NUMBER,
            min_number=dify_config.CODE_MIN_NUMBER,
            max_precision=dify_config.CODE_MAX_PRECISION,
            max_depth=dify_config.CODE_MAX_DEPTH,
            max_number_array_length=dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH,
            max_string_array_length=dify_config.CODE_MAX_STRING_ARRAY_LENGTH,
            max_object_array_length=dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH,
        )
        self._jinja2_template_renderer = CodeExecutorJinja2TemplateRenderer()
        self._template_transform_max_output_length = dify_config.TEMPLATE_TRANSFORM_MAX_LENGTH
        self._http_request_http_client = graphon_ssrf_proxy
        self._bound_tool_file_manager_factory = lambda: DifyToolFileManager(
            self._dify_context,
            conversation_id_getter=self._conversation_id,
        )
        self._file_reference_factory = DifyFileReferenceFactory(self._dify_context)
        self._prompt_message_serializer = DifyPromptMessageSerializer()
        self._retriever_attachment_loader = DifyRetrieverAttachmentLoader(
            file_reference_factory=self._file_reference_factory,
        )
        self._llm_file_saver = build_dify_llm_file_saver(
            run_context=self._dify_context,
            http_client=self._http_request_http_client,
            conversation_id_getter=self._conversation_id,
        )
        self._human_input_runtime = DifyHumanInputNodeRuntime(
            self._dify_context,
            workflow_execution_id_getter=lambda: get_system_text(
                self.graph_runtime_state.variable_pool,
                SystemVariableKey.WORKFLOW_EXECUTION_ID,
            ),
        )
        self._tool_runtime = DifyToolNodeRuntime(self._dify_context)
        self._http_request_file_manager = file_manager
        self._document_extractor_unstructured_api_config = UnstructuredApiConfig(
            api_url=dify_config.UNSTRUCTURED_API_URL,
            api_key=dify_config.UNSTRUCTURED_API_KEY or "",
        )
        self._http_request_config = build_http_request_config(
            max_connect_timeout=dify_config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT,
            max_read_timeout=dify_config.HTTP_REQUEST_MAX_READ_TIMEOUT,
            max_write_timeout=dify_config.HTTP_REQUEST_MAX_WRITE_TIMEOUT,
            max_binary_size=dify_config.HTTP_REQUEST_NODE_MAX_BINARY_SIZE,
            max_text_size=dify_config.HTTP_REQUEST_NODE_MAX_TEXT_SIZE,
            ssl_verify=dify_config.HTTP_REQUEST_NODE_SSL_VERIFY,
            ssrf_default_max_retries=dify_config.SSRF_DEFAULT_MAX_RETRIES,
        )

        self._llm_credentials_provider, self._llm_model_factory = build_dify_model_access(self._dify_context)
        self._agent_strategy_resolver = PluginAgentStrategyResolver()
        self._agent_strategy_presentation_provider = PluginAgentStrategyPresentationProvider()
        self._agent_runtime_support = AgentRuntimeSupport()
        self._agent_message_transformer = AgentMessageTransformer()

    @staticmethod
    def _resolve_dify_context(run_context: Mapping[str, Any]) -> DifyRunContext:
        raw_ctx = run_context.get(DIFY_RUN_CONTEXT_KEY)
        if raw_ctx is None:
            raise ValueError(f"run_context missing required key: {DIFY_RUN_CONTEXT_KEY}")
        if isinstance(raw_ctx, DifyRunContext):
            return raw_ctx
        return DifyRunContext.model_validate(raw_ctx)

    def _conversation_id(self) -> str | None:
        return get_system_text(self.graph_runtime_state.variable_pool, SystemVariableKey.CONVERSATION_ID)

    @override
    def create_node(self, node_config: dict[str, Any] | NodeConfigDict) -> Node:
        """
        Create a Node instance from node configuration data using the traditional mapping.

        :param node_config: node configuration dictionary containing type and other data
        :return: initialized Node instance
        :raises ValueError: if node_config fails NodeConfigDict/BaseNodeData validation
            (including pydantic ValidationError, which subclasses ValueError),
            if node type is unknown, or if no implementation exists for the resolved version
        """
        adapted_node_config = adapt_node_config_for_graph(node_config)
        typed_node_config = NodeConfigDictAdapter.validate_python(adapted_node_config)
        node_id = typed_node_config["id"]
        node_data = typed_node_config["data"]
        node_class = self._resolve_node_class(node_type=node_data.type, node_version=str(node_data.version))
        # Graph configs are initially validated against permissive shared node data.
        # Re-validate using the resolved node class so workflow-local node schemas
        # stay explicit and constructors receive the concrete typed payload.
        resolved_node_data = self._validate_resolved_node_data(node_class, node_data)
        node_type = node_data.type
        node_init_kwargs_factories: Mapping[NodeType, Callable[[], dict[str, object]]] = {
            BuiltinNodeTypes.CODE: lambda: {
                "code_executor": self._code_executor,
                "code_limits": self._code_limits,
            },
            BuiltinNodeTypes.TEMPLATE_TRANSFORM: lambda: {
                "jinja2_template_renderer": self._jinja2_template_renderer,
                "max_output_length": self._template_transform_max_output_length,
            },
            BuiltinNodeTypes.HTTP_REQUEST: lambda: {
                "http_request_config": self._http_request_config,
                "http_client": self._http_request_http_client,
                "tool_file_manager_factory": self._bound_tool_file_manager_factory,
                "file_manager": self._http_request_file_manager,
                "file_reference_factory": self._file_reference_factory,
            },
            BuiltinNodeTypes.HUMAN_INPUT: lambda: {
                "runtime": self._human_input_runtime,
                "form_repository": self._human_input_runtime.build_form_repository(),
            },
            BuiltinNodeTypes.LLM: lambda: self._build_llm_compatible_node_init_kwargs(
                node_class=node_class,
                node_data=resolved_node_data,
                wrap_model_instance=True,
                include_http_client=True,
                include_llm_file_saver=True,
                include_prompt_message_serializer=True,
                include_retriever_attachment_loader=True,
                include_jinja2_template_renderer=True,
            ),
            BuiltinNodeTypes.DOCUMENT_EXTRACTOR: lambda: {
                "unstructured_api_config": self._document_extractor_unstructured_api_config,
                "http_client": self._http_request_http_client,
            },
            BuiltinNodeTypes.QUESTION_CLASSIFIER: lambda: self._build_llm_compatible_node_init_kwargs(
                node_class=node_class,
                node_data=resolved_node_data,
                wrap_model_instance=True,
                include_http_client=True,
                include_llm_file_saver=True,
                include_prompt_message_serializer=True,
                include_retriever_attachment_loader=False,
                include_jinja2_template_renderer=False,
            ),
            BuiltinNodeTypes.PARAMETER_EXTRACTOR: lambda: self._build_llm_compatible_node_init_kwargs(
                node_class=node_class,
                node_data=resolved_node_data,
                wrap_model_instance=True,
                include_http_client=False,
                include_llm_file_saver=False,
                include_prompt_message_serializer=True,
                include_retriever_attachment_loader=False,
                include_jinja2_template_renderer=False,
            ),
            BuiltinNodeTypes.TOOL: lambda: {
                "tool_file_manager_factory": self._bound_tool_file_manager_factory(),
                "runtime": self._tool_runtime,
            },
            BuiltinNodeTypes.AGENT: lambda: {
                "strategy_resolver": self._agent_strategy_resolver,
                "presentation_provider": self._agent_strategy_presentation_provider,
                "runtime_support": self._agent_runtime_support,
                "message_transformer": self._agent_message_transformer,
            },
        }
        node_init_kwargs = node_init_kwargs_factories.get(node_type, lambda: {})()
        constructor_node_data = resolved_node_data.model_dump(mode="python", by_alias=True)
        return node_class(
            node_id=node_id,
            data=constructor_node_data,
            graph_init_params=self.graph_init_params,
            graph_runtime_state=self.graph_runtime_state,
            **node_init_kwargs,
        )

    @staticmethod
    def _validate_resolved_node_data(node_class: type[Node], node_data: BaseNodeData) -> BaseNodeData:
        """
        Re-validate the permissive graph payload with the concrete NodeData model declared by the resolved node class.
        """
        validate_node_data = getattr(node_class, "validate_node_data", None)
        if callable(validate_node_data):
            return cast("BaseNodeData", validate_node_data(node_data))
        return node_data

    @staticmethod
    def _resolve_node_class(*, node_type: NodeType, node_version: str) -> type[Node]:
        return resolve_workflow_node_class(node_type=node_type, node_version=node_version)

    def _build_llm_compatible_node_init_kwargs(
        self,
        *,
        node_class: type[Node],
        node_data: BaseNodeData,
        wrap_model_instance: bool,
        include_http_client: bool,
        include_llm_file_saver: bool,
        include_prompt_message_serializer: bool,
        include_retriever_attachment_loader: bool,
        include_jinja2_template_renderer: bool,
    ) -> dict[str, object]:
        validated_node_data = cast(LLMCompatibleNodeData, node_data)
        model_instance = self._build_model_instance_for_llm_node(validated_node_data)
        node_init_kwargs: dict[str, object] = {
            "credentials_provider": self._llm_credentials_provider,
            "model_factory": self._llm_model_factory,
            "model_instance": DifyPreparedLLM(model_instance) if wrap_model_instance else model_instance,
            "memory": self._build_memory_for_llm_node(
                node_data=validated_node_data,
                model_instance=model_instance,
            ),
        }
        if validated_node_data.type == BuiltinNodeTypes.QUESTION_CLASSIFIER:
            node_init_kwargs["template_renderer"] = self._jinja2_template_renderer
        if include_http_client:
            node_init_kwargs["http_client"] = self._http_request_http_client
        if include_llm_file_saver:
            node_init_kwargs["llm_file_saver"] = self._llm_file_saver
        if include_prompt_message_serializer:
            node_init_kwargs["prompt_message_serializer"] = self._prompt_message_serializer
        if include_retriever_attachment_loader:
            node_init_kwargs["retriever_attachment_loader"] = self._build_retriever_attachment_loader(
                cast(LLMNodeData, validated_node_data)
            )
        if include_jinja2_template_renderer:
            node_init_kwargs["jinja2_template_renderer"] = self._jinja2_template_renderer
        if validated_node_data.type == BuiltinNodeTypes.LLM:
            node_init_kwargs["default_query_selector"] = system_variable_selector(SystemVariableKey.QUERY)
        return node_init_kwargs

    def _build_retriever_attachment_loader(self, node_data: LLMNodeData) -> DifyRetrieverAttachmentLoader:
        return DifyRetrieverAttachmentLoader(
            file_reference_factory=self._file_reference_factory,
            segment_access_checker=self._build_retriever_segment_access_checker(
                node_data.context.variable_selector if node_data.context.enabled else None
            ),
        )

    def _build_retriever_segment_access_checker(
        self,
        context_variable_selector: Sequence[str] | None,
    ) -> Callable[[str], bool]:
        def checker(segment_id: str) -> bool:
            if not context_variable_selector:
                return False

            context_value = self.graph_runtime_state.variable_pool.get(context_variable_selector)
            if not isinstance(context_value, ArrayObjectSegment):
                return False

            for item in context_value.value:
                if not isinstance(item, Mapping):
                    continue
                metadata = item.get("metadata")
                if not isinstance(metadata, Mapping):
                    continue
                if metadata.get("_source") == "knowledge" and str(metadata.get("segment_id")) == str(segment_id):
                    return True
            return False

        return checker

    def _build_model_instance_for_llm_node(self, node_data: LLMCompatibleNodeData) -> ModelInstance:
        node_data_model = node_data.model
        model_instance, _ = fetch_model_config(
            node_data_model=node_data_model,
            credentials_provider=self._llm_credentials_provider,
            model_factory=self._llm_model_factory,
        )
        model_instance.model_type_instance = cast(LargeLanguageModel, model_instance.model_type_instance)
        return model_instance

    def _build_memory_for_llm_node(
        self,
        *,
        node_data: LLMCompatibleNodeData,
        model_instance: ModelInstance,
    ) -> PromptMessageMemory | None:
        if node_data.memory is None:
            return None

        conversation_id = get_system_text(self.graph_runtime_state.variable_pool, SystemVariableKey.CONVERSATION_ID)
        return fetch_memory(
            conversation_id=conversation_id,
            app_id=self._dify_context.app_id,
            node_data_memory=node_data.memory,
            model_instance=model_instance,
        )
