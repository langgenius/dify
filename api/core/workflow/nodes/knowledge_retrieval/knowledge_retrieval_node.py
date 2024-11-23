import logging
from collections.abc import Mapping, Sequence
from typing import Any, cast

from sqlalchemy import func

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.agent_entities import PlanningStrategy
from core.entities.model_entities import ModelStatus
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.model_entities import ModelFeature, ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.variables import StringSegment
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from extensions.ext_database import db
from models.dataset import Dataset, Document, DocumentSegment
from models.workflow import WorkflowNodeExecutionStatus

from .entities import KnowledgeRetrievalNodeData
from .exc import (
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


class KnowledgeRetrievalNode(BaseNode[KnowledgeRetrievalNodeData]):
    _node_data_cls = KnowledgeRetrievalNodeData
    _node_type = NodeType.KNOWLEDGE_RETRIEVAL

    def _run(self) -> NodeRunResult:
        # extract variables
        variable = self.graph_runtime_state.variable_pool.get(self.node_data.query_variable_selector)
        if not isinstance(variable, StringSegment):
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs={},
                error="Query variable is not string type.",
            )
        query = variable.value
        variables = {"query": query}
        if not query:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, inputs=variables, error="Query is required."
            )
        # retrieve knowledge
        try:
            results = self._fetch_dataset_retriever(node_data=self.node_data, query=query)
            outputs = {"result": results}
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, process_data=None, outputs=outputs
            )

        except KnowledgeRetrievalNodeError as e:
            logger.warning("Error when running knowledge retrieval node")
            return NodeRunResult(status=WorkflowNodeExecutionStatus.FAILED, inputs=variables, error=str(e))

    def _fetch_dataset_retriever(self, node_data: KnowledgeRetrievalNodeData, query: str) -> list[dict[str, Any]]:
        available_datasets = []
        dataset_ids = node_data.dataset_ids

        # Subquery: Count the number of available documents for each dataset
        subquery = (
            db.session.query(Document.dataset_id, func.count(Document.id).label("available_document_count"))
            .filter(
                Document.indexing_status == "completed",
                Document.enabled == True,
                Document.archived == False,
                Document.dataset_id.in_(dataset_ids),
            )
            .group_by(Document.dataset_id)
            .having(func.count(Document.id) > 0)
            .subquery()
        )

        results = (
            db.session.query(Dataset)
            .outerjoin(subquery, Dataset.id == subquery.c.dataset_id)
            .filter(Dataset.tenant_id == self.tenant_id, Dataset.id.in_(dataset_ids))
            .filter((subquery.c.available_document_count > 0) | (Dataset.provider == "external"))
            .all()
        )

        for dataset in results:
            # pass if dataset is not available
            if not dataset:
                continue
            available_datasets.append(dataset)
        all_documents = []
        dataset_retrieval = DatasetRetrieval()
        if node_data.retrieval_mode == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE.value:
            # fetch model config
            model_instance, model_config = self._fetch_model_config(node_data)
            # check model is support tool calling
            model_type_instance = model_config.provider_model_bundle.model_type_instance
            model_type_instance = cast(LargeLanguageModel, model_type_instance)
            # get model schema
            model_schema = model_type_instance.get_model_schema(
                model=model_config.model, credentials=model_config.credentials
            )

            if model_schema:
                planning_strategy = PlanningStrategy.REACT_ROUTER
                features = model_schema.features
                if features:
                    if ModelFeature.TOOL_CALL in features or ModelFeature.MULTI_TOOL_CALL in features:
                        planning_strategy = PlanningStrategy.ROUTER
                all_documents = dataset_retrieval.single_retrieve(
                    available_datasets=available_datasets,
                    tenant_id=self.tenant_id,
                    user_id=self.user_id,
                    app_id=self.app_id,
                    user_from=self.user_from.value,
                    query=query,
                    model_config=model_config,
                    model_instance=model_instance,
                    planning_strategy=planning_strategy,
                )
        elif node_data.retrieval_mode == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE.value:
            if node_data.multiple_retrieval_config.reranking_mode == "reranking_model":
                if node_data.multiple_retrieval_config.reranking_model:
                    reranking_model = {
                        "reranking_provider_name": node_data.multiple_retrieval_config.reranking_model.provider,
                        "reranking_model_name": node_data.multiple_retrieval_config.reranking_model.model,
                    }
                else:
                    reranking_model = None
                weights = None
            elif node_data.multiple_retrieval_config.reranking_mode == "weighted_score":
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
            else:
                reranking_model = None
                weights = None
            all_documents = dataset_retrieval.multiple_retrieve(
                self.app_id,
                self.tenant_id,
                self.user_id,
                self.user_from.value,
                available_datasets,
                query,
                node_data.multiple_retrieval_config.top_k,
                node_data.multiple_retrieval_config.score_threshold,
                node_data.multiple_retrieval_config.reranking_mode,
                reranking_model,
                weights,
                node_data.multiple_retrieval_config.reranking_enable,
            )
        dify_documents = [item for item in all_documents if item.provider == "dify"]
        external_documents = [item for item in all_documents if item.provider == "external"]
        retrieval_resource_list = []
        # deal with external documents
        for item in external_documents:
            source = {
                "metadata": {
                    "_source": "knowledge",
                    "dataset_id": item.metadata.get("dataset_id"),
                    "dataset_name": item.metadata.get("dataset_name"),
                    "document_name": item.metadata.get("title"),
                    "data_source_type": "external",
                    "retriever_from": "workflow",
                    "score": item.metadata.get("score"),
                },
                "title": item.metadata.get("title"),
                "content": item.page_content,
            }
            retrieval_resource_list.append(source)
        document_score_list = {}
        # deal with dify documents
        if dify_documents:
            document_score_list = {}
            for item in dify_documents:
                if item.metadata.get("score"):
                    document_score_list[item.metadata["doc_id"]] = item.metadata["score"]

            index_node_ids = [document.metadata["doc_id"] for document in dify_documents]
            segments = DocumentSegment.query.filter(
                DocumentSegment.dataset_id.in_(dataset_ids),
                DocumentSegment.completed_at.isnot(None),
                DocumentSegment.status == "completed",
                DocumentSegment.enabled == True,
                DocumentSegment.index_node_id.in_(index_node_ids),
            ).all()
            if segments:
                index_node_id_to_position = {id: position for position, id in enumerate(index_node_ids)}
                sorted_segments = sorted(
                    segments, key=lambda segment: index_node_id_to_position.get(segment.index_node_id, float("inf"))
                )

                for segment in sorted_segments:
                    dataset = Dataset.query.filter_by(id=segment.dataset_id).first()
                    document = Document.query.filter(
                        Document.id == segment.document_id,
                        Document.enabled == True,
                        Document.archived == False,
                    ).first()
                    if dataset and document:
                        source = {
                            "metadata": {
                                "_source": "knowledge",
                                "dataset_id": dataset.id,
                                "dataset_name": dataset.name,
                                "document_id": document.id,
                                "document_name": document.name,
                                "document_data_source_type": document.data_source_type,
                                "segment_id": segment.id,
                                "retriever_from": "workflow",
                                "score": document_score_list.get(segment.index_node_id, None),
                                "segment_hit_count": segment.hit_count,
                                "segment_word_count": segment.word_count,
                                "segment_position": segment.position,
                                "segment_index_node_hash": segment.index_node_hash,
                            },
                            "title": document.name,
                        }
                        if segment.answer:
                            source["content"] = f"question:{segment.get_sign_content()} \nanswer:{segment.answer}"
                        else:
                            source["content"] = segment.get_sign_content()
                        retrieval_resource_list.append(source)
        if retrieval_resource_list:
            retrieval_resource_list = sorted(
                retrieval_resource_list, key=lambda x: x.get("metadata").get("score") or 0.0, reverse=True
            )
            position = 1
            for item in retrieval_resource_list:
                item["metadata"]["position"] = position
                position += 1
        return retrieval_resource_list

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: KnowledgeRetrievalNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        variable_mapping = {}
        variable_mapping[node_id + ".query"] = node_data.query_variable_selector
        return variable_mapping

    def _fetch_model_config(
        self, node_data: KnowledgeRetrievalNodeData
    ) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
        """
        Fetch model config
        :param node_data: node data
        :return:
        """
        model_name = node_data.single_retrieval_config.model.name
        provider_name = node_data.single_retrieval_config.model.provider

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=self.tenant_id, model_type=ModelType.LLM, provider=provider_name, model=model_name
        )

        provider_model_bundle = model_instance.provider_model_bundle
        model_type_instance = model_instance.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        model_credentials = model_instance.credentials

        # check model
        provider_model = provider_model_bundle.configuration.get_provider_model(
            model=model_name, model_type=ModelType.LLM
        )

        if provider_model is None:
            raise ModelNotExistError(f"Model {model_name} not exist.")

        if provider_model.status == ModelStatus.NO_CONFIGURE:
            raise ModelCredentialsNotInitializedError(f"Model {model_name} credentials is not initialized.")
        elif provider_model.status == ModelStatus.NO_PERMISSION:
            raise ModelNotSupportedError(f"Dify Hosted OpenAI {model_name} currently not support.")
        elif provider_model.status == ModelStatus.QUOTA_EXCEEDED:
            raise ModelQuotaExceededError(f"Model provider {provider_name} quota exceeded.")

        # model config
        completion_params = node_data.single_retrieval_config.model.completion_params
        stop = []
        if "stop" in completion_params:
            stop = completion_params["stop"]
            del completion_params["stop"]

        # get model mode
        model_mode = node_data.single_retrieval_config.model.mode
        if not model_mode:
            raise ModelNotExistError("LLM mode is required.")

        model_schema = model_type_instance.get_model_schema(model_name, model_credentials)

        if not model_schema:
            raise ModelNotExistError(f"Model {model_name} not exist.")

        return model_instance, ModelConfigWithCredentialsEntity(
            provider=provider_name,
            model=model_name,
            model_schema=model_schema,
            mode=model_mode,
            provider_model_bundle=provider_model_bundle,
            credentials=model_credentials,
            parameters=completion_params,
            stop=stop,
        )
