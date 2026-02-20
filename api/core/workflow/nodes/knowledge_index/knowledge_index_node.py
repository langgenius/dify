import logging
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import NodeExecutionType, NodeType, SystemVariableKey
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.template import Template
from core.workflow.repositories.index_processor_protocol import IndexProcessorProtocol
from core.workflow.repositories.summary_index_service_protocol import SummaryIndexServiceProtocol

from .entities import KnowledgeIndexNodeData
from .exc import (
    KnowledgeIndexNodeError,
)

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState

logger = logging.getLogger(__name__)


class KnowledgeIndexNode(Node[KnowledgeIndexNodeData]):
    node_type = NodeType.KNOWLEDGE_INDEX
    execution_type = NodeExecutionType.RESPONSE

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        index_processor: IndexProcessorProtocol,
        summary_index_service: SummaryIndexServiceProtocol,
    ) -> None:
        super().__init__(id, config, graph_init_params, graph_runtime_state)
        self.index_processor = index_processor
        self.summary_index_service = summary_index_service

    def _run(self) -> NodeRunResult:  # type: ignore
        node_data = self.node_data
        variable_pool = self.graph_runtime_state.variable_pool

        # get dataset id as string
        dataset_id_segment = variable_pool.get(["sys", SystemVariableKey.DATASET_ID])
        if not dataset_id_segment:
            raise KnowledgeIndexNodeError("Dataset ID is required.")
        dataset_id: str = dataset_id_segment.value

        # get document id as string (may be empty when not provided)
        document_id_segment = variable_pool.get(["sys", SystemVariableKey.DOCUMENT_ID])
        document_id: str = document_id_segment.value if document_id_segment else ""

        # extract variables
        variable = variable_pool.get(node_data.index_chunk_variable_selector)
        if not variable:
            raise KnowledgeIndexNodeError("Index chunk variable is required.")
        invoke_from = variable_pool.get(["sys", SystemVariableKey.INVOKE_FROM])
        is_preview = invoke_from.value == InvokeFrom.DEBUGGER if invoke_from else False

        chunks = variable.value
        variables = {"chunks": chunks}
        if not chunks:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, inputs=variables, error="Chunks is required."
            )

        # index knowledge
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

            original_document_id_segment = variable_pool.get(["sys", SystemVariableKey.ORIGINAL_DOCUMENT_ID])
            batch = variable_pool.get(["sys", SystemVariableKey.BATCH])
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
        # Temporary handle all exceptions from DatasetRetrieval class here.
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
        summary_index_setting: dict | None = None,
    ):
        self.summary_index_service.generate_and_vectorize_summary(
            dataset_id, document_id, is_preview, summary_index_setting
        )
        return self.index_processor.index_and_clean(
            dataset_id, document_id, original_document_id, chunks, batch, summary_index_setting
        )

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
