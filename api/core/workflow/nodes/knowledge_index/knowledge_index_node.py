import logging
import time
from typing import Any, cast

from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.variables.segments import ObjectSegment
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.llm.node import LLMNode
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset, Document, RateLimitLog
from models.workflow import WorkflowNodeExecutionStatus
from services.dataset_service import DocumentService
from services.feature_service import FeatureService

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
        # extract variables
        variable = self.graph_runtime_state.variable_pool.get(node_data.index_chunk_variable_selector)
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
        # check rate limit
        if self.tenant_id:
            knowledge_rate_limit = FeatureService.get_knowledge_rate_limit(self.tenant_id)
            if knowledge_rate_limit.enabled:
                current_time = int(time.time() * 1000)
                key = f"rate_limit_{self.tenant_id}"
                redis_client.zadd(key, {current_time: current_time})
                redis_client.zremrangebyscore(key, 0, current_time - 60000)
                request_count = redis_client.zcard(key)
                if request_count > knowledge_rate_limit.limit:
                    # add ratelimit record
                    rate_limit_log = RateLimitLog(
                        tenant_id=self.tenant_id,
                        subscription_plan=knowledge_rate_limit.subscription_plan,
                        operation="knowledge",
                    )
                    db.session.add(rate_limit_log)
                    db.session.commit()
                    return NodeRunResult(
                        status=WorkflowNodeExecutionStatus.FAILED,
                        inputs=variables,
                        error="Sorry, you have reached the knowledge base request rate limit of your subscription.",
                        error_type="RateLimitExceeded",
                    )

        # retrieve knowledge
        try:
            results = self._invoke_knowledge_index(node_data=node_data, chunks=chunks)
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

    def _invoke_knowledge_index(self, node_data: KnowledgeIndexNodeData, chunks: list[Any]) -> Any:
        dataset = Dataset.query.filter_by(id=node_data.dataset_id).first()
        if not dataset:
            raise KnowledgeIndexNodeError(f"Dataset {node_data.dataset_id} not found.")

        document = Document.query.filter_by(id=node_data.document_id).first()
        if not document:
            raise KnowledgeIndexNodeError(f"Document {node_data.document_id} not found.")

        DocumentService.invoke_knowledge_index(
            dataset=dataset,
            document=document,
            chunks=chunks,
            chunk_structure=node_data.chunk_structure,
            index_method=node_data.index_method,
            retrieval_setting=node_data.retrieval_setting,
        )

        return {
            "dataset_id": dataset.id,
            "dataset_name": dataset.name,
            "document_id": document.id,
            "document_name": document.name,
            "created_at": document.created_at,
            "display_status": document.indexing_status,
        }
