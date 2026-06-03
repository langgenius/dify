"""Knowledge retrieval workflow node implementation.

This node now lives under ``core.workflow.nodes`` and is discovered directly by
the workflow node registry.
"""

import logging
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.rag.data_post_processor.data_post_processor import RerankingModelDict, WeightsDict
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.file_reference import parse_file_reference
from graphon.entities import GraphInitParams
from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.node_events import NodeRunResult
from graphon.nodes.base import LLMUsageTrackingMixin
from graphon.nodes.base.node import Node
from graphon.variables import (
    ArrayFileSegment,
    FileSegment,
    StringSegment,
)
from graphon.variables.segments import ArrayObjectSegment

from .entities import (
    Condition,
    KnowledgeRetrievalNodeData,
    MetadataFilteringCondition,
)
from .exc import (
    KnowledgeRetrievalNodeError,
    RateLimitExceededError,
)
from .retrieval import KnowledgeRetrievalRequest, Source

if TYPE_CHECKING:
    from graphon.file import File
    from graphon.runtime import GraphRuntimeState

logger = logging.getLogger(__name__)


def _normalize_metadata_filter_scalar(value: object) -> str | int | float | None:
    if value is None or isinstance(value, (str, float)):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return str(value)


def _normalize_metadata_filter_sequence_item(value: object) -> str:
    return value if isinstance(value, str) else str(value)


class KnowledgeRetrievalNode(LLMUsageTrackingMixin, Node[KnowledgeRetrievalNodeData]):
    node_type = BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL

    # Instance attributes specific to LLMNode.
    # Output variable for file
    _file_outputs: list["File"]

    def __init__(
        self,
        node_id: str,
        data: KnowledgeRetrievalNodeData,
        *,
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        # LLM file outputs, used for MultiModal outputs.
        self._file_outputs = []
        self._rag_retrieval = DatasetRetrieval()

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
            outputs = {"result": ArrayObjectSegment(value=[item.model_dump(by_alias=True) for item in results])}
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
        dify_ctx = DifyRunContext.model_validate(self.require_run_context_value(DIFY_RUN_CONTEXT_KEY))
        dataset_ids = node_data.dataset_ids
        query = variables.get("query")
        attachments = variables.get("attachments")
        retrieval_resource_list = []

        metadata_filtering_mode: Literal["disabled", "automatic", "manual"] = "disabled"
        if node_data.metadata_filtering_mode is not None:
            metadata_filtering_mode = node_data.metadata_filtering_mode

        resolved_metadata_conditions = (
            self._resolve_metadata_filtering_conditions(node_data.metadata_filtering_conditions)
            if node_data.metadata_filtering_conditions
            else None
        )

        if str(node_data.retrieval_mode) == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE and query:
            # fetch model config
            if node_data.single_retrieval_config is None:
                raise ValueError("single_retrieval_config is required for single retrieval mode")
            model = node_data.single_retrieval_config.model
            retrieval_resource_list = self._rag_retrieval.knowledge_retrieval(
                request=KnowledgeRetrievalRequest(
                    tenant_id=dify_ctx.tenant_id,
                    user_id=dify_ctx.user_id,
                    app_id=dify_ctx.app_id,
                    user_from=dify_ctx.user_from.value,
                    dataset_ids=dataset_ids,
                    retrieval_mode=DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE.value,
                    completion_params=model.completion_params,
                    model_provider=model.provider,
                    model_mode=model.mode,
                    model_name=model.name,
                    metadata_model_config=node_data.metadata_model_config,
                    metadata_filtering_conditions=resolved_metadata_conditions,
                    metadata_filtering_mode=metadata_filtering_mode,
                    query=query,
                )
            )
        elif str(node_data.retrieval_mode) == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE:
            if node_data.multiple_retrieval_config is None:
                raise ValueError("multiple_retrieval_config is required")
            reranking_model: RerankingModelDict | None = None
            weights: WeightsDict | None = None
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
                    app_id=dify_ctx.app_id,
                    tenant_id=dify_ctx.tenant_id,
                    user_id=dify_ctx.user_id,
                    user_from=dify_ctx.user_from.value,
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
                    metadata_filtering_conditions=resolved_metadata_conditions,
                    metadata_filtering_mode=metadata_filtering_mode,
                    attachment_ids=[
                        parsed_reference.record_id
                        for attachment in attachments
                        if (parsed_reference := parse_file_reference(attachment.reference)) is not None
                    ]
                    if attachments
                    else None,
                )
            )

        usage = self._rag_retrieval.llm_usage
        return retrieval_resource_list, usage

    def _resolve_metadata_filtering_conditions(
        self, conditions: MetadataFilteringCondition
    ) -> MetadataFilteringCondition:
        if conditions.conditions is None:
            return MetadataFilteringCondition(
                logical_operator=conditions.logical_operator,
                conditions=None,
            )

        variable_pool = self.graph_runtime_state.variable_pool
        resolved_conditions: list[Condition] = []
        for cond in conditions.conditions or []:
            value = cond.value
            resolved_value: str | Sequence[str] | int | float | None
            if isinstance(value, str):
                segment_group = variable_pool.convert_template(value)
                if len(segment_group.value) == 1:
                    resolved_value = _normalize_metadata_filter_scalar(segment_group.value[0].to_object())
                else:
                    resolved_value = segment_group.text
            elif isinstance(value, Sequence) and all(isinstance(v, str) for v in value):
                resolved_values: list[str] = []
                for v in value:
                    segment_group = variable_pool.convert_template(v)
                    if len(segment_group.value) == 1:
                        resolved_values.append(
                            _normalize_metadata_filter_sequence_item(segment_group.value[0].to_object())
                        )
                    else:
                        resolved_values.append(segment_group.text)
                resolved_value = resolved_values
            else:
                resolved_value = value
            resolved_conditions.append(
                Condition(
                    name=cond.name,
                    comparison_operator=cond.comparison_operator,
                    value=resolved_value,
                )
            )
        return MetadataFilteringCondition(
            logical_operator=conditions.logical_operator or "and",
            conditions=resolved_conditions,
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: KnowledgeRetrievalNodeData,
    ) -> Mapping[str, Sequence[str]]:
        # graph_config is not used in this node type
        variable_mapping = {}
        if node_data.query_variable_selector:
            variable_mapping[node_id + ".query"] = node_data.query_variable_selector
        if node_data.query_attachment_selector:
            variable_mapping[node_id + ".queryAttachment"] = node_data.query_attachment_selector
        return variable_mapping
