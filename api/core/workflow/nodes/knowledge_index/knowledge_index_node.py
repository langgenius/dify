import json
import logging
import re
import time
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any, Optional, cast

from sqlalchemy import Integer, and_, func, or_, text
from sqlalchemy import cast as sqlalchemy_cast

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.agent_entities import PlanningStrategy
from core.entities.model_entities import ModelStatus
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.message_entities import PromptMessageRole
from core.model_runtime.entities.model_entities import ModelFeature, ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.simple_prompt_transform import ModelMode
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.entities.metadata_entities import Condition, MetadataCondition
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.variables import StringSegment
from core.variables.segments import ObjectSegment
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.event.event import ModelInvokeCompletedEvent
from core.workflow.nodes.knowledge_retrieval.template_prompts import (
    METADATA_FILTER_ASSISTANT_PROMPT_1,
    METADATA_FILTER_ASSISTANT_PROMPT_2,
    METADATA_FILTER_COMPLETION_PROMPT,
    METADATA_FILTER_SYSTEM_PROMPT,
    METADATA_FILTER_USER_PROMPT_1,
    METADATA_FILTER_USER_PROMPT_3,
)
from core.workflow.nodes.llm.entities import LLMNodeChatModelMessage, LLMNodeCompletionModelPromptTemplate
from core.workflow.nodes.llm.node import LLMNode
from core.workflow.nodes.question_classifier.template_prompts import QUESTION_CLASSIFIER_USER_PROMPT_2
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.json_in_md_parser import parse_and_check_json_markdown
from models.dataset import Dataset, DatasetMetadata, Document, RateLimitLog
from models.workflow import WorkflowNodeExecutionStatus
from services.dataset_service import DatasetService
from services.feature_service import FeatureService

from .entities import KnowledgeIndexNodeData, KnowledgeRetrievalNodeData, ModelConfig
from .exc import (
    InvalidModelTypeError,
    KnowledgeIndexNodeError,
    KnowledgeRetrievalNodeError,
    ModelCredentialsNotInitializedError,
    ModelNotExistError,
    ModelNotSupportedError,
    ModelQuotaExceededError,
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


    def _invoke_knowledge_index(self, node_data: KnowledgeIndexNodeData, chunks: list[any]) -> Any:
        dataset = Dataset.query.filter_by(id=node_data.dataset_id).first()
        if not dataset:
            raise KnowledgeIndexNodeError(f"Dataset {node_data.dataset_id} not found.")
        
        DatasetService.invoke_knowledge_index(
            dataset=dataset,
            chunks=chunks,
            index_method=node_data.index_method,
            retrieval_setting=node_data.retrieval_setting,
        )
        
        pass
