import logging
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from core.rag.index_processor.index_processor import IndexProcessor
from core.rag.summary_index.summary_index import SummaryIndex
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from dify_graph.entities.graph_config import NodeConfigDict
from dify_graph.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from dify_graph.enums import NodeExecutionType, SystemVariableKey
from dify_graph.node_events import NodeRunResult
from dify_graph.nodes.base.node import Node
from dify_graph.nodes.base.template import Template

from .entities import DocMetadata, KnowledgeIndexNodeData
from .exc import (
    KnowledgeIndexNodeError,
)

# Constant for built-in metadata identifier
BUILT_IN_METADATA_ID = "built-in"

if TYPE_CHECKING:
    from dify_graph.entities import GraphInitParams
    from dify_graph.runtime import GraphRuntimeState

logger = logging.getLogger(__name__)
_INVOKE_FROM_DEBUGGER = "debugger"


class KnowledgeIndexNode(Node[KnowledgeIndexNodeData]):
    node_type = KNOWLEDGE_INDEX_NODE_TYPE
    execution_type = NodeExecutionType.EXECUTABLE

    def __init__(
        self,
        id: str,
        config: NodeConfigDict,
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
    ) -> None:
        super().__init__(id, config, graph_init_params, graph_runtime_state)
        self.index_processor = IndexProcessor()
        self.summary_index_service = SummaryIndex()

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
        invoke_from_value = str(invoke_from.value) if invoke_from else None
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

            original_document_id_segment = variable_pool.get(["sys", SystemVariableKey.ORIGINAL_DOCUMENT_ID])
            batch = variable_pool.get(["sys", SystemVariableKey.BATCH])
            if not batch:
                raise KnowledgeIndexNodeError("Batch is required.")

            # Resolve metadata before indexing
            resolved_doc_metadata: dict[str, Any] = {}
            metadata_binding_ids: list[str] = []
            if node_data.doc_metadata:
                resolved_doc_metadata, metadata_binding_ids = self._resolve_doc_metadata_values(
                    dataset_id=dataset_id,
                    doc_metadata_items=node_data.doc_metadata,
                )

            results = self._invoke_knowledge_index(
                dataset_id=dataset_id,
                document_id=document_id,
                original_document_id=original_document_id_segment.value if original_document_id_segment else "",
                is_preview=is_preview,
                batch=batch.value,
                chunks=chunks,
                summary_index_setting=summary_index_setting,
                doc_metadata=resolved_doc_metadata,
                metadata_binding_ids=metadata_binding_ids,
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
        summary_index_setting: dict | None = None,
        doc_metadata: Mapping[str, Any] | None = None,
        metadata_binding_ids: list[str] | None = None,
    ):
        if not document_id:
            raise KnowledgeIndexNodeError("document_id is required.")
        rst = self.index_processor.index_and_clean(
            dataset_id,
            document_id,
            original_document_id,
            chunks,
            batch,
            summary_index_setting,
            doc_metadata=doc_metadata,
            metadata_binding_ids=metadata_binding_ids,
            user_id=self.require_dify_context().user_id,
        )
        self.summary_index_service.generate_and_vectorize_summary(
            dataset_id, document_id, is_preview, summary_index_setting
        )
        return rst

    def _resolve_doc_metadata_values(
        self,
        *,
        dataset_id: str,
        doc_metadata_items: Sequence[DocMetadata],
    ) -> tuple[dict[str, Any], list[str]]:
        """
        Resolve metadata variable values from the variable pool.

        Returns a dict of {metadata_id: resolved_value} and a list of metadata_binding_ids.
        The IndexProcessor will handle looking up metadata names from DB.
        """
        variable_pool = self.graph_runtime_state.variable_pool
        resolved_metadata: dict[str, Any] = {}
        metadata_binding_ids: list[str] = []

        for item in doc_metadata_items:
            if item.metadata_id == BUILT_IN_METADATA_ID:
                continue

            value = item.value
            if isinstance(value, list):
                variable = variable_pool.get(value)
                if not variable:
                    variable_path = ".".join(value)
                    raise KnowledgeIndexNodeError(
                        f"Variable '{variable_path}' not found for metadata '{item.metadata_id}'. "
                        f"Please check your variable configuration."
                    )
                value = variable.to_object()

            if value is not None:
                resolved_metadata[item.metadata_id] = value

            metadata_binding_ids.append(item.metadata_id)

        return resolved_metadata, metadata_binding_ids

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: KnowledgeIndexNodeData,
    ) -> Mapping[str, Sequence[str]]:
        variable_mapping: dict[str, Sequence[str]] = {}

        # index chunk variable
        variable_mapping[node_id + ".index_chunk_variable_selector"] = node_data.index_chunk_variable_selector

        # doc_metadata variables
        if node_data.doc_metadata:
            for item in node_data.doc_metadata:
                if isinstance(item.value, list):
                    variable_mapping[node_id + "." + item.metadata_id] = item.value

        return variable_mapping

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
