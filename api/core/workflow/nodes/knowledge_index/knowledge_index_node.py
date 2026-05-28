import logging
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from core.rag.index_processor.index_processor import IndexProcessor
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from core.rag.summary_index.summary_index import SummaryIndex
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from core.workflow.system_variables import SystemVariableKey, get_system_segment, get_system_text
from graphon.enums import NodeExecutionType, WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.nodes.base.template import Template

from .entities import KnowledgeIndexNodeData
from .exc import (
    KnowledgeIndexNodeError,
)

if TYPE_CHECKING:
    from graphon.entities import GraphInitParams
    from graphon.runtime import GraphRuntimeState

logger = logging.getLogger(__name__)
_INVOKE_FROM_DEBUGGER = "debugger"


class KnowledgeIndexNode(Node[KnowledgeIndexNodeData]):
    node_type = KNOWLEDGE_INDEX_NODE_TYPE
    execution_type = NodeExecutionType.RESPONSE

    def __init__(
        self,
        node_id: str,
        data: KnowledgeIndexNodeData,
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
        self.index_processor = IndexProcessor()
        self.summary_index_service = SummaryIndex()

    def _run(self) -> NodeRunResult:  # type: ignore
        node_data = self.node_data
        variable_pool = self.graph_runtime_state.variable_pool

        # get dataset id as string
        dataset_id_segment = get_system_segment(variable_pool, SystemVariableKey.DATASET_ID)
        if not dataset_id_segment:
            raise KnowledgeIndexNodeError("Dataset ID is required.")
        dataset_id: str = dataset_id_segment.value

        # get document id as string (may be empty when not provided)
        document_id_segment = get_system_segment(variable_pool, SystemVariableKey.DOCUMENT_ID)
        document_id: str = document_id_segment.value if document_id_segment else ""

        # extract variables
        variable = variable_pool.get(node_data.index_chunk_variable_selector)
        if not variable:
            raise KnowledgeIndexNodeError("Index chunk variable is required.")
        invoke_from_value = get_system_text(variable_pool, SystemVariableKey.INVOKE_FROM)
        is_preview = invoke_from_value == _INVOKE_FROM_DEBUGGER

        chunks = variable.value
        variables = {"chunks": chunks}
        if not chunks:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, inputs=variables, error="Chunks is required."
            )

        try:
            summary_index_setting = node_data.summary_index_setting
            if is_preview:
                # Preview mode: generate summaries for chunks directly without saving to database
                # Format preview and generate summaries on-the-fly
                # Get indexing_technique and summary_index_setting from node_data (workflow graph config)
                # or fallback to dataset if not available in node_data

                outputs = self.index_processor.get_preview_output(
                    chunks, dataset_id, document_id, node_data.chunk_structure, summary_index_setting
                )
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=variables,
                    outputs=outputs.model_dump(exclude_none=True),
                )

            original_document_id_segment = get_system_segment(variable_pool, SystemVariableKey.ORIGINAL_DOCUMENT_ID)
            batch = get_system_segment(variable_pool, SystemVariableKey.BATCH)
            if not batch:
                raise KnowledgeIndexNodeError("Batch is required.")

            results = self._invoke_knowledge_index(
                dataset_id=dataset_id,
                document_id=document_id,
                original_document_id=original_document_id_segment.value if original_document_id_segment else "",
                is_preview=is_preview,
                batch=batch.value,
                chunks=chunks,
                summary_index_setting=summary_index_setting,
            )
            return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, outputs=results)

        except KnowledgeIndexNodeError as e:
            logger.warning("Error when running knowledge index node", exc_info=True)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
            )
        except Exception as e:
            logger.error(e, exc_info=True)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
            )

    def _invoke_knowledge_index(
        self,
        dataset_id: str,
        document_id: str,
        original_document_id: str,
        is_preview: bool,
        batch: Any,
        chunks: Mapping[str, Any],
        summary_index_setting: SummaryIndexSettingDict | None = None,
    ):
        if not document_id:
            raise KnowledgeIndexNodeError("document_id is required.")
        rst = self.index_processor.index_and_clean(
            dataset_id, document_id, original_document_id, chunks, batch, summary_index_setting
        )
        self.summary_index_service.generate_and_vectorize_summary(
            dataset_id, document_id, is_preview, summary_index_setting
        )
        return rst

    @classmethod
    def version(cls) -> str:
        return "1"

    def get_streaming_template(self) -> Template:
        """
        Get the template for streaming.

        Returns:
            Template instance for this knowledge index node
        """
        return Template(segments=[])
