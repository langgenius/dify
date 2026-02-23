import logging
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.utils.encoders import jsonable_encoder
from core.variables import (
    ArrayFileSegment,
    FileSegment,
    StringSegment,
)
from core.variables.segments import ArrayObjectSegment
from core.workflow.entities import GraphInitParams
from core.workflow.enums import (
    NodeType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base import LLMUsageTrackingMixin
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.llm.file_saver import FileSaverImpl, LLMFileSaver
from core.workflow.repositories.rag_retrieval_protocol import KnowledgeRetrievalRequest, RAGRetrievalProtocol, Source

from .entities import KnowledgeRetrievalNodeData
from .exc import (
    KnowledgeRetrievalNodeError,
    RateLimitExceededError,
)

if TYPE_CHECKING:
    from core.workflow.file.models import File
    from core.workflow.runtime import GraphRuntimeState

logger = logging.getLogger(__name__)


class KnowledgeRetrievalNode(LLMUsageTrackingMixin, Node[KnowledgeRetrievalNodeData]):
    node_type = NodeType.KNOWLEDGE_RETRIEVAL

    # Instance attributes specific to LLMNode.
    # Output variable for file
    _file_outputs: list["File"]

    _llm_file_saver: LLMFileSaver

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        rag_retrieval: RAGRetrievalProtocol,
        *,
        llm_file_saver: LLMFileSaver | None = None,
    ):
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        # LLM file outputs, used for MultiModal outputs.
        self._file_outputs = []
        self._rag_retrieval = rag_retrieval

        if llm_file_saver is None:
            llm_file_saver = FileSaverImpl(
                user_id=graph_init_params.user_id,
                tenant_id=graph_init_params.tenant_id,
            )
        self._llm_file_saver = llm_file_saver

    @classmethod
    def version(cls):
        return "1"

    def _run(self) -> NodeRunResult:
        usage = LLMUsage.empty_usage()
        if not self._node_data.query_variable_selector and not self._node_data.query_attachment_selector:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={},
                process_data={},
                outputs={},
                metadata={},
                llm_usage=usage,
            )
        variables: dict[str, Any] = {}
        # extract variables
        if self._node_data.query_variable_selector:
            variable = self.graph_runtime_state.variable_pool.get(self._node_data.query_variable_selector)
            if not isinstance(variable, StringSegment):
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    error="Query variable is not string type.",
                )
            query = variable.value
            variables["query"] = query

        if self._node_data.query_attachment_selector:
            variable = self.graph_runtime_state.variable_pool.get(self._node_data.query_attachment_selector)
            if not isinstance(variable, ArrayFileSegment) and not isinstance(variable, FileSegment):
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    error="Attachments variable is not array file or file type.",
                )
            if isinstance(variable, ArrayFileSegment):
                variables["attachments"] = variable.value
            else:
                variables["attachments"] = [variable.value]

        try:
            results, usage = self._fetch_dataset_retriever(node_data=self._node_data, variables=variables)
            outputs = {"result": ArrayObjectSegment(value=[item.model_dump() for item in results])}
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=variables,
                process_data={"usage": jsonable_encoder(usage)},
                outputs=outputs,  # type: ignore
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
                },
                llm_usage=usage,
            )
        except RateLimitExceededError as e:
            logger.warning(e, exc_info=True)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
                llm_usage=usage,
            )
        except KnowledgeRetrievalNodeError as e:
            logger.warning("Error when running knowledge retrieval node", exc_info=True)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
                llm_usage=usage,
            )
        # Temporary handle all exceptions from DatasetRetrieval class here.
        except Exception as e:
            logger.warning(e, exc_info=True)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
                llm_usage=usage,
            )

    def _fetch_dataset_retriever(
        self, node_data: KnowledgeRetrievalNodeData, variables: dict[str, Any]
    ) -> tuple[list[Source], LLMUsage]:
        dataset_ids = node_data.dataset_ids
        query = variables.get("query")
        attachments = variables.get("attachments")
        retrieval_resource_list = []

        metadata_filtering_mode: Literal["disabled", "automatic", "manual"] = "disabled"
        if node_data.metadata_filtering_mode is not None:
            metadata_filtering_mode = node_data.metadata_filtering_mode

        if str(node_data.retrieval_mode) == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE and query:
            # fetch model config
            if node_data.single_retrieval_config is None:
                raise ValueError("single_retrieval_config is required for single retrieval mode")
            model = node_data.single_retrieval_config.model
            retrieval_resource_list = self._rag_retrieval.knowledge_retrieval(
                request=KnowledgeRetrievalRequest(
                    tenant_id=self.tenant_id,
                    user_id=self.user_id,
                    app_id=self.app_id,
                    user_from=self.user_from.value,
                    dataset_ids=dataset_ids,
                    retrieval_mode=DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE.value,
                    completion_params=model.completion_params,
                    model_provider=model.provider,
                    model_mode=model.mode,
                    model_name=model.name,
                    metadata_model_config=node_data.metadata_model_config,
                    metadata_filtering_conditions=node_data.metadata_filtering_conditions,
                    metadata_filtering_mode=metadata_filtering_mode,
                    query=query,
                )
            )
        elif str(node_data.retrieval_mode) == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE:
            if node_data.multiple_retrieval_config is None:
                raise ValueError("multiple_retrieval_config is required")
            reranking_model = None
            weights = None
            match node_data.multiple_retrieval_config.reranking_mode:
                case "reranking_model":
                    if node_data.multiple_retrieval_config.reranking_model:
                        reranking_model = {
                            "reranking_provider_name": node_data.multiple_retrieval_config.reranking_model.provider,
                            "reranking_model_name": node_data.multiple_retrieval_config.reranking_model.model,
                        }
                    else:
                        reranking_model = None
                    weights = None
                case "weighted_score":
                    if node_data.multiple_retrieval_config.weights is None:
                        raise ValueError("weights is required")
                    reranking_model = None
                    vector_setting = node_data.multiple_retrieval_config.weights.vector_setting
                    weights = {
                        "vector_setting": {
                            "vector_weight": vector_setting.vector_weight,
                            "embedding_provider_name": vector_setting.embedding_provider_name,
                            "embedding_model_name": vector_setting.embedding_model_name,
                        },
                        "keyword_setting": {
                            "keyword_weight": node_data.multiple_retrieval_config.weights.keyword_setting.keyword_weight
                        },
                    }
                case _:
                    # Handle any other reranking_mode values
                    reranking_model = None
                    weights = None

            retrieval_resource_list = self._rag_retrieval.knowledge_retrieval(
                request=KnowledgeRetrievalRequest(
                    app_id=self.app_id,
                    tenant_id=self.tenant_id,
                    user_id=self.user_id,
                    user_from=self.user_from.value,
                    dataset_ids=dataset_ids,
                    query=query,
                    retrieval_mode=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE.value,
                    top_k=node_data.multiple_retrieval_config.top_k,
                    score_threshold=node_data.multiple_retrieval_config.score_threshold
                    if node_data.multiple_retrieval_config.score_threshold is not None
                    else 0.0,
                    reranking_mode=node_data.multiple_retrieval_config.reranking_mode,
                    reranking_model=reranking_model,
                    weights=weights,
                    reranking_enable=node_data.multiple_retrieval_config.reranking_enable,
                    metadata_model_config=node_data.metadata_model_config,
                    metadata_filtering_conditions=node_data.metadata_filtering_conditions,
                    metadata_filtering_mode=metadata_filtering_mode,
                    attachment_ids=[attachment.related_id for attachment in attachments] if attachments else None,
                )
            )

        usage = self._rag_retrieval.llm_usage
        return retrieval_resource_list, usage

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        # graph_config is not used in this node type
        # Create typed NodeData from dict
        typed_node_data = KnowledgeRetrievalNodeData.model_validate(node_data)

        variable_mapping = {}
        if typed_node_data.query_variable_selector:
            variable_mapping[node_id + ".query"] = typed_node_data.query_variable_selector
        if typed_node_data.query_attachment_selector:
            variable_mapping[node_id + ".queryAttachment"] = typed_node_data.query_attachment_selector
        return variable_mapping
