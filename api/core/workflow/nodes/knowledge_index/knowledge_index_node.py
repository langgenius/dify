import datetime
import logging
from collections.abc import Mapping
from typing import Any, cast

from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes.enums import NodeType
from extensions.ext_database import db
from models.dataset import Dataset, Document, DocumentSegment
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus

from ..base import BaseNode
from .entities import KnowledgeIndexNodeData
from .exc import (
    KnowledgeIndexNodeError,
)

logger = logging.getLogger(__name__)

default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH.value,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 2,
    "score_threshold_enabled": False,
}


class KnowledgeIndexNode(BaseNode[KnowledgeIndexNodeData]):
    _node_data_cls = KnowledgeIndexNodeData  # type: ignore
    _node_type = NodeType.KNOWLEDGE_INDEX

    def _run(self) -> NodeRunResult:  # type: ignore
        node_data = cast(KnowledgeIndexNodeData, self.node_data)
        variable_pool = self.graph_runtime_state.variable_pool
        dataset_id = variable_pool.get(["sys", SystemVariableKey.DATASET_ID])
        if not dataset_id:
            raise KnowledgeIndexNodeError("Dataset ID is required.")
        dataset = db.session.query(Dataset).filter_by(id=dataset_id.value).first()
        if not dataset:
            raise KnowledgeIndexNodeError(f"Dataset {dataset_id.value} not found.")

        # extract variables
        variable = variable_pool.get(node_data.index_chunk_variable_selector)
        if not variable:
            raise KnowledgeIndexNodeError("Index chunk variable is required.")
        invoke_from = variable_pool.get(["sys", SystemVariableKey.INVOKE_FROM])
        if invoke_from:
            is_preview = invoke_from.value == InvokeFrom.DEBUGGER.value
        else:
            is_preview = False
        chunks = variable.value
        variables = {"chunks": chunks}
        if not chunks:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, inputs=variables, error="Chunks is required."
            )

        # index knowledge
        try:
            if is_preview:
                outputs = self._get_preview_output(node_data.chunk_structure, chunks)
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=variables,
                    process_data=None,
                    outputs=outputs,
                )
            results = self._invoke_knowledge_index(
                dataset=dataset, node_data=node_data, chunks=chunks, variable_pool=variable_pool
            )
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, process_data=None, outputs=results
            )

        except KnowledgeIndexNodeError as e:
            logger.warning("Error when running knowledge index node")
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
            )
        # Temporary handle all exceptions from DatasetRetrieval class here.
        except Exception as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
            )

    def _invoke_knowledge_index(
        self,
        dataset: Dataset,
        node_data: KnowledgeIndexNodeData,
        chunks: Mapping[str, Any],
        variable_pool: VariablePool,
    ) -> Any:
        document_id = variable_pool.get(["sys", SystemVariableKey.DOCUMENT_ID])
        if not document_id:
            raise KnowledgeIndexNodeError("Document ID is required.")
        batch = variable_pool.get(["sys", SystemVariableKey.BATCH])
        if not batch:
            raise KnowledgeIndexNodeError("Batch is required.")
        document = db.session.query(Document).filter_by(id=document_id.value).first()
        if not document:
            raise KnowledgeIndexNodeError(f"Document {document_id.value} not found.")

        index_processor = IndexProcessorFactory(dataset.chunk_structure).init_index_processor()
        index_processor.index(dataset, document, chunks)

        # update document status
        document.indexing_status = "completed"
        document.completed_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        db.session.add(document)
        # update document segment status
        db.session.query(DocumentSegment).filter(
            DocumentSegment.document_id == document.id,
            DocumentSegment.dataset_id == dataset.id,
        ).update(
            {
                DocumentSegment.status: "completed",
                DocumentSegment.enabled: True,
                DocumentSegment.completed_at: datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
            }
        )

        db.session.commit()

        return {
            "dataset_id": dataset.id,
            "dataset_name": dataset.name,
            "batch": batch.value,
            "document_id": document.id,
            "document_name": document.name,
            "created_at": document.created_at.timestamp(),
            "display_status": document.indexing_status,
        }

    def _get_preview_output(self, chunk_structure: str, chunks: Mapping[str, Any]) -> Mapping[str, Any]:
        index_processor = IndexProcessorFactory(chunk_structure).init_index_processor()
        return index_processor.format_preview(chunks)
