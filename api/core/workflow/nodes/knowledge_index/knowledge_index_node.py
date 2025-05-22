import datetime
import logging
from collections.abc import Mapping
from typing import Any, cast

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.variables.segments import ObjectSegment
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.llm.node import LLMNode
from extensions.ext_database import db
from models.dataset import Dataset, Document
from models.workflow import WorkflowNodeExecutionStatus

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


class KnowledgeIndexNode(LLMNode):
    _node_data_cls = KnowledgeIndexNodeData  # type: ignore
    _node_type = NodeType.KNOWLEDGE_INDEX

    def _run(self) -> NodeRunResult:  # type: ignore
        node_data = cast(KnowledgeIndexNodeData, self.node_data)
        variable_pool = self.graph_runtime_state.variable_pool
        # extract variables
        variable = variable_pool.get(node_data.index_chunk_variable_selector)
        if not isinstance(variable, ObjectSegment):
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs={},
                error="Query variable is not object type.",
            )
        chunks = variable.value
        variables = {"chunks": chunks}
        if not chunks:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, inputs=variables, error="Chunks is required."
            )
        # retrieve knowledge
        try:
            results = self._invoke_knowledge_index(node_data=node_data, chunks=chunks, variable_pool=variable_pool)
            outputs = {"result": results}
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, process_data=None, outputs=outputs
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
        self, node_data: KnowledgeIndexNodeData, chunks: Mapping[str, Any], variable_pool: VariablePool
    ) -> Any:
        dataset_id = variable_pool.get(["sys", SystemVariableKey.DATASET_ID])
        if not dataset_id:
            raise KnowledgeIndexNodeError("Dataset ID is required.")
        document_id = variable_pool.get(["sys", SystemVariableKey.DOCUMENT_ID])
        if not document_id:
            raise KnowledgeIndexNodeError("Document ID is required.")
        batch = variable_pool.get(["sys", SystemVariableKey.BATCH])
        if not batch:
            raise KnowledgeIndexNodeError("Batch is required.")
        dataset = Dataset.query.filter_by(id=dataset_id).first()
        if not dataset:
            raise KnowledgeIndexNodeError(f"Dataset {dataset_id} not found.")

        document = Document.query.filter_by(id=document_id).first()
        if not document:
            raise KnowledgeIndexNodeError(f"Document {document_id} not found.")

        index_processor = IndexProcessorFactory(node_data.chunk_structure).init_index_processor()
        index_processor.index(dataset, document, chunks)

        # update document status
        document.indexing_status = "completed"
        document.completed_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        db.session.commit()

        return {
            "dataset_id": dataset.id,
            "dataset_name": dataset.name,
            "batch": batch,
            "document_id": document.id,
            "document_name": document.name,
            "created_at": document.created_at,
            "display_status": document.indexing_status,
        }
