import datetime
import logging
import time
from collections.abc import Mapping
from typing import Any

from sqlalchemy import func, select

from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeType, SystemVariableKey
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.template import Template
from core.workflow.runtime import VariablePool
from extensions.ext_database import db
from models.dataset import Dataset, Document, DocumentSegment

from .entities import KnowledgeIndexNodeData
from .exc import (
    KnowledgeIndexNodeError,
)

logger = logging.getLogger(__name__)

default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 2,
    "score_threshold_enabled": False,
}


class KnowledgeIndexNode(Node):
    _node_data: KnowledgeIndexNodeData
    node_type = NodeType.KNOWLEDGE_INDEX
    execution_type = NodeExecutionType.RESPONSE

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = KnowledgeIndexNodeData.model_validate(data)

    def _get_error_strategy(self) -> ErrorStrategy | None:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> str | None:
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    def _run(self) -> NodeRunResult:  # type: ignore
        node_data = self._node_data
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
            is_preview = invoke_from.value == InvokeFrom.DEBUGGER
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
                    outputs=outputs,
                )
            results = self._invoke_knowledge_index(
                dataset=dataset, node_data=node_data, chunks=chunks, variable_pool=variable_pool
            )
            return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, outputs=results)

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
        original_document_id = variable_pool.get(["sys", SystemVariableKey.ORIGINAL_DOCUMENT_ID])

        batch = variable_pool.get(["sys", SystemVariableKey.BATCH])
        if not batch:
            raise KnowledgeIndexNodeError("Batch is required.")
        document = db.session.query(Document).filter_by(id=document_id.value).first()
        if not document:
            raise KnowledgeIndexNodeError(f"Document {document_id.value} not found.")
        doc_id_value = document.id
        ds_id_value = dataset.id
        dataset_name_value = dataset.name
        document_name_value = document.name
        created_at_value = document.created_at
        # chunk nodes by chunk size
        indexing_start_at = time.perf_counter()
        index_processor = IndexProcessorFactory(dataset.chunk_structure).init_index_processor()
        if original_document_id:
            segments = db.session.scalars(
                select(DocumentSegment).where(DocumentSegment.document_id == original_document_id.value)
            ).all()
            if segments:
                index_node_ids = [segment.index_node_id for segment in segments]

                # delete from vector index
                index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

                for segment in segments:
                    db.session.delete(segment)
                db.session.commit()
        index_processor.index(dataset, document, chunks)
        indexing_end_at = time.perf_counter()
        document.indexing_latency = indexing_end_at - indexing_start_at
        # update document status
        document.indexing_status = "completed"
        document.completed_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        document.word_count = (
            db.session.query(func.sum(DocumentSegment.word_count))
            .where(
                DocumentSegment.document_id == doc_id_value,
                DocumentSegment.dataset_id == ds_id_value,
            )
            .scalar()
        )
        db.session.add(document)
        # update document segment status
        db.session.query(DocumentSegment).where(
            DocumentSegment.document_id == doc_id_value,
            DocumentSegment.dataset_id == ds_id_value,
        ).update(
            {
                DocumentSegment.status: "completed",
                DocumentSegment.enabled: True,
                DocumentSegment.completed_at: datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
            }
        )

        db.session.commit()

        return {
            "dataset_id": ds_id_value,
            "dataset_name": dataset_name_value,
            "batch": batch.value,
            "document_id": doc_id_value,
            "document_name": document_name_value,
            "created_at": created_at_value.timestamp(),
            "display_status": "completed",
        }

    def _get_preview_output(self, chunk_structure: str, chunks: Any) -> Mapping[str, Any]:
        index_processor = IndexProcessorFactory(chunk_structure).init_index_processor()
        return index_processor.format_preview(chunks)

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
