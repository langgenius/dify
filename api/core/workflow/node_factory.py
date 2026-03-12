from collections.abc import Callable, Mapping
from typing import TYPE_CHECKING, Any, TypeAlias, cast, final

from sqlalchemy import select
from sqlalchemy.orm import Session
from typing_extensions import override

from configs import dify_config
from core.app.entities.app_invoke_entities import DifyRunContext
from core.app.llm.model_access import build_dify_model_access
from core.datasource.datasource_manager import DatasourceManager
from core.helper.code_executor.code_executor import (
    CodeExecutionError,
    CodeExecutor,
)
from core.helper.ssrf_proxy import ssrf_proxy
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.rag.index_processor.index_processor import IndexProcessor
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.rag.summary_index.summary_index import SummaryIndex
from core.repositories.human_input_repository import HumanInputFormRepositoryImpl
from core.tools.tool_file_manager import ToolFileManager
from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from dify_graph.entities.graph_init_params import DIFY_RUN_CONTEXT_KEY
from dify_graph.enums import NodeType, SystemVariableKey
from dify_graph.file.file_manager import file_manager
from dify_graph.graph.graph import NodeFactory
from dify_graph.model_runtime.entities.model_entities import ModelType
from dify_graph.model_runtime.memory import PromptMessageMemory
from dify_graph.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from dify_graph.nodes.base.node import Node
from dify_graph.nodes.code.code_node import WorkflowCodeExecutor
from dify_graph.nodes.code.entities import CodeLanguage
from dify_graph.nodes.code.limits import CodeNodeLimits
from dify_graph.nodes.document_extractor import UnstructuredApiConfig
from dify_graph.nodes.http_request import build_http_request_config
from dify_graph.nodes.llm.entities import LLMNodeData
from dify_graph.nodes.llm.exc import LLMModeRequiredError, ModelNotExistError
from dify_graph.nodes.node_mapping import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING
from dify_graph.nodes.parameter_extractor.entities import ParameterExtractorNodeData
from dify_graph.nodes.question_classifier.entities import QuestionClassifierNodeData
from dify_graph.nodes.template_transform.template_renderer import (
    CodeExecutorJinja2TemplateRenderer,
)
from dify_graph.variables.segments import StringSegment
from extensions.ext_database import db
from models.model import Conversation

if TYPE_CHECKING:
    from dify_graph.entities import GraphInitParams
    from dify_graph.runtime import GraphRuntimeState


LLMCompatibleNodeData: TypeAlias = LLMNodeData | QuestionClassifierNodeData | ParameterExtractorNodeData


def fetch_memory(
    *,
    conversation_id: str | None,
    app_id: str,
    node_data_memory: MemoryConfig | None,
    model_instance: ModelInstance,
) -> TokenBufferMemory | None:
    if not node_data_memory or not conversation_id:
        return None

    with Session(db.engine, expire_on_commit=False) as session:
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
    Default implementation of NodeFactory that uses the traditional node mapping.

    This factory creates nodes by looking up their types in NODE_TYPE_CLASSES_MAPPING
    and instantiating the appropriate node class.
    """

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
        self._template_renderer = CodeExecutorJinja2TemplateRenderer(code_executor=self._code_executor)
        self._template_transform_max_output_length = dify_config.TEMPLATE_TRANSFORM_MAX_LENGTH
        self._http_request_http_client = ssrf_proxy
        self._http_request_tool_file_manager_factory = ToolFileManager
        self._http_request_file_manager = file_manager
        self._rag_retrieval = DatasetRetrieval()
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

        self._llm_credentials_provider, self._llm_model_factory = build_dify_model_access(self._dify_context.tenant_id)

    @staticmethod
    def _resolve_dify_context(run_context: Mapping[str, Any]) -> DifyRunContext:
        raw_ctx = run_context.get(DIFY_RUN_CONTEXT_KEY)
        if raw_ctx is None:
            raise ValueError(f"run_context missing required key: {DIFY_RUN_CONTEXT_KEY}")
        if isinstance(raw_ctx, DifyRunContext):
            return raw_ctx
        return DifyRunContext.model_validate(raw_ctx)

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
        typed_node_config = NodeConfigDictAdapter.validate_python(node_config)
        node_id = typed_node_config["id"]
        node_data = typed_node_config["data"]
        node_class = self._resolve_node_class(node_type=node_data.type, node_version=str(node_data.version))
        node_type = node_data.type
        node_init_kwargs_factories: Mapping[NodeType, Callable[[], dict[str, object]]] = {
            NodeType.CODE: lambda: {
                "code_executor": self._code_executor,
                "code_limits": self._code_limits,
            },
            NodeType.TEMPLATE_TRANSFORM: lambda: {
                "template_renderer": self._template_renderer,
                "max_output_length": self._template_transform_max_output_length,
            },
            NodeType.HTTP_REQUEST: lambda: {
                "http_request_config": self._http_request_config,
                "http_client": self._http_request_http_client,
                "tool_file_manager_factory": self._http_request_tool_file_manager_factory,
                "file_manager": self._http_request_file_manager,
            },
            NodeType.HUMAN_INPUT: lambda: {
                "form_repository": HumanInputFormRepositoryImpl(tenant_id=self._dify_context.tenant_id),
            },
            NodeType.KNOWLEDGE_INDEX: lambda: {
                "index_processor": IndexProcessor(),
                "summary_index_service": SummaryIndex(),
            },
            NodeType.LLM: lambda: self._build_llm_compatible_node_init_kwargs(
                node_class=node_class,
                node_data=node_data,
                include_http_client=True,
            ),
            NodeType.DATASOURCE: lambda: {
                "datasource_manager": DatasourceManager,
            },
            NodeType.KNOWLEDGE_RETRIEVAL: lambda: {
                "rag_retrieval": self._rag_retrieval,
            },
            NodeType.DOCUMENT_EXTRACTOR: lambda: {
                "unstructured_api_config": self._document_extractor_unstructured_api_config,
                "http_client": self._http_request_http_client,
            },
            NodeType.QUESTION_CLASSIFIER: lambda: self._build_llm_compatible_node_init_kwargs(
                node_class=node_class,
                node_data=node_data,
                include_http_client=True,
            ),
            NodeType.PARAMETER_EXTRACTOR: lambda: self._build_llm_compatible_node_init_kwargs(
                node_class=node_class,
                node_data=node_data,
                include_http_client=False,
            ),
            NodeType.TOOL: lambda: {
                "tool_file_manager_factory": self._http_request_tool_file_manager_factory(),
            },
        }
        node_init_kwargs = node_init_kwargs_factories.get(node_type, lambda: {})()
        return node_class(
            id=node_id,
            config=typed_node_config,
            graph_init_params=self.graph_init_params,
            graph_runtime_state=self.graph_runtime_state,
            **node_init_kwargs,
        )

    @staticmethod
    def _validate_resolved_node_data(node_class: type[Node], node_data: BaseNodeData) -> BaseNodeData:
        """
        Re-validate the permissive graph payload with the concrete NodeData model declared by the resolved node class.
        """
        return node_class.validate_node_data(node_data)

    @staticmethod
    def _resolve_node_class(*, node_type: NodeType, node_version: str) -> type[Node]:
        node_mapping = NODE_TYPE_CLASSES_MAPPING.get(node_type)
        if not node_mapping:
            raise ValueError(f"No class mapping found for node type: {node_type}")

        latest_node_class = node_mapping.get(LATEST_VERSION)
        matched_node_class = node_mapping.get(node_version)
        node_class = matched_node_class or latest_node_class
        if not node_class:
            raise ValueError(f"No latest version class found for node type: {node_type}")
        return node_class

    def _build_llm_compatible_node_init_kwargs(
        self,
        *,
        node_class: type[Node],
        node_data: BaseNodeData,
        include_http_client: bool,
    ) -> dict[str, object]:
        validated_node_data = cast(
            LLMCompatibleNodeData,
            self._validate_resolved_node_data(node_class=node_class, node_data=node_data),
        )
        model_instance = self._build_model_instance_for_llm_node(validated_node_data)
        node_init_kwargs: dict[str, object] = {
            "credentials_provider": self._llm_credentials_provider,
            "model_factory": self._llm_model_factory,
            "model_instance": model_instance,
            "memory": self._build_memory_for_llm_node(
                node_data=validated_node_data,
                model_instance=model_instance,
            ),
        }
        if include_http_client:
            node_init_kwargs["http_client"] = self._http_request_http_client
        return node_init_kwargs

    def _build_model_instance_for_llm_node(self, node_data: LLMCompatibleNodeData) -> ModelInstance:
        node_data_model = node_data.model
        if not node_data_model.mode:
            raise LLMModeRequiredError("LLM mode is required.")

        credentials = self._llm_credentials_provider.fetch(node_data_model.provider, node_data_model.name)
        model_instance = self._llm_model_factory.init_model_instance(node_data_model.provider, node_data_model.name)
        provider_model_bundle = model_instance.provider_model_bundle

        provider_model = provider_model_bundle.configuration.get_provider_model(
            model=node_data_model.name,
            model_type=ModelType.LLM,
        )
        if provider_model is None:
            raise ModelNotExistError(f"Model {node_data_model.name} not exist.")
        provider_model.raise_for_status()

        completion_params = dict(node_data_model.completion_params)
        stop = completion_params.pop("stop", [])
        if not isinstance(stop, list):
            stop = []

        model_schema = model_instance.model_type_instance.get_model_schema(node_data_model.name, credentials)
        if not model_schema:
            raise ModelNotExistError(f"Model {node_data_model.name} not exist.")

        model_instance.provider = node_data_model.provider
        model_instance.model_name = node_data_model.name
        model_instance.credentials = credentials
        model_instance.parameters = completion_params
        model_instance.stop = tuple(stop)
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

        conversation_id_variable = self.graph_runtime_state.variable_pool.get(
            ["sys", SystemVariableKey.CONVERSATION_ID]
        )
        conversation_id = (
            conversation_id_variable.value if isinstance(conversation_id_variable, StringSegment) else None
        )
        return fetch_memory(
            conversation_id=conversation_id,
            app_id=self._dify_context.app_id,
            node_data_memory=node_data.memory,
            model_instance=model_instance,
        )
