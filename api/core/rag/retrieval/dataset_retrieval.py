import json
import math
import re
import threading
from collections import Counter, defaultdict
from collections.abc import Generator, Mapping
from typing import Any, Optional, Union, cast

from flask import Flask, current_app
from sqlalchemy import Integer, and_, or_, text
from sqlalchemy import cast as sqlalchemy_cast

from core.app.app_config.entities import (
    DatasetEntity,
    DatasetRetrieveConfigEntity,
    MetadataFilteringCondition,
    ModelConfig,
)
from core.app.entities.app_invoke_entities import InvokeFrom, ModelConfigWithCredentialsEntity
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.entities.agent_entities import PlanningStrategy
from core.entities.model_entities import ModelStatus
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageRole, PromptMessageTool
from core.model_runtime.entities.model_entities import ModelFeature, ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.ops.utils import measure_time
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate
from core.prompt.simple_prompt_transform import ModelMode
from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.entities.context_entities import DocumentContext
from core.rag.entities.metadata_entities import Condition, MetadataCondition
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.rag.retrieval.router.multi_dataset_function_call_router import FunctionCallMultiDatasetRouter
from core.rag.retrieval.router.multi_dataset_react_route import ReactMultiDatasetRouter
from core.rag.retrieval.template_prompts import (
    METADATA_FILTER_ASSISTANT_PROMPT_1,
    METADATA_FILTER_ASSISTANT_PROMPT_2,
    METADATA_FILTER_COMPLETION_PROMPT,
    METADATA_FILTER_SYSTEM_PROMPT,
    METADATA_FILTER_USER_PROMPT_1,
    METADATA_FILTER_USER_PROMPT_2,
    METADATA_FILTER_USER_PROMPT_3,
)
from core.tools.utils.dataset_retriever.dataset_retriever_base_tool import DatasetRetrieverBaseTool
from extensions.ext_database import db
from libs.json_in_md_parser import parse_and_check_json_markdown
from models.dataset import ChildChunk, Dataset, DatasetMetadata, DatasetQuery, DocumentSegment
from models.dataset import Document as DatasetDocument
from services.external_knowledge_service import ExternalDatasetService

default_retrieval_model: dict[str, Any] = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH.value,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 2,
    "score_threshold_enabled": False,
}


class DatasetRetrieval:
    def __init__(self, application_generate_entity=None):
        self.application_generate_entity = application_generate_entity

    def retrieve(
        self,
        app_id: str,
        user_id: str,
        tenant_id: str,
        model_config: ModelConfigWithCredentialsEntity,
        config: DatasetEntity,
        query: str,
        invoke_from: InvokeFrom,
        show_retrieve_source: bool,
        hit_callback: DatasetIndexToolCallbackHandler,
        message_id: str,
        memory: Optional[TokenBufferMemory] = None,
        inputs: Optional[Mapping[str, Any]] = None,
    ) -> Optional[str]:
        """
        Retrieve dataset.
        :param app_id: app_id
        :param user_id: user_id
        :param tenant_id: tenant id
        :param model_config: model config
        :param config: dataset config
        :param query: query
        :param invoke_from: invoke from
        :param show_retrieve_source: show retrieve source
        :param hit_callback: hit callback
        :param message_id: message id
        :param memory: memory
        :return:
        """
        dataset_ids = config.dataset_ids
        if len(dataset_ids) == 0:
            return None
        retrieve_config = config.retrieve_config

        # check model is support tool calling
        model_type_instance = model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id, model_type=ModelType.LLM, provider=model_config.provider, model=model_config.model
        )

        # get model schema
        model_schema = model_type_instance.get_model_schema(
            model=model_config.model, credentials=model_config.credentials
        )

        if not model_schema:
            return None

        planning_strategy = PlanningStrategy.REACT_ROUTER
        features = model_schema.features
        if features:
            if ModelFeature.TOOL_CALL in features or ModelFeature.MULTI_TOOL_CALL in features:
                planning_strategy = PlanningStrategy.ROUTER
        available_datasets = []
        for dataset_id in dataset_ids:
            # get dataset from dataset id
            dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()

            # pass if dataset is not available
            if not dataset:
                continue

            # pass if dataset is not available
            if dataset and dataset.available_document_count == 0 and dataset.provider != "external":
                continue

            available_datasets.append(dataset)
        if inputs:
            inputs = {key: str(value) for key, value in inputs.items()}
        else:
            inputs = {}
        available_datasets_ids = [dataset.id for dataset in available_datasets]
        metadata_filter_document_ids, metadata_condition = self._get_metadata_filter_condition(
            available_datasets_ids,
            query,
            tenant_id,
            user_id,
            retrieve_config.metadata_filtering_mode,  # type: ignore
            retrieve_config.metadata_model_config,  # type: ignore
            retrieve_config.metadata_filtering_conditions,
            inputs,
        )

        all_documents = []
        user_from = "account" if invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER} else "end_user"
        if retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE:
            all_documents = self.single_retrieve(
                app_id,
                tenant_id,
                user_id,
                user_from,
                available_datasets,
                query,
                model_instance,
                model_config,
                planning_strategy,
                message_id,
                metadata_filter_document_ids,
                metadata_condition,
            )
        elif retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE:
            all_documents = self.multiple_retrieve(
                app_id,
                tenant_id,
                user_id,
                user_from,
                available_datasets,
                query,
                retrieve_config.top_k or 0,
                retrieve_config.score_threshold or 0,
                retrieve_config.rerank_mode or "reranking_model",
                retrieve_config.reranking_model,
                retrieve_config.weights,
                retrieve_config.reranking_enabled or True,
                message_id,
                metadata_filter_document_ids,
                metadata_condition,
            )

        dify_documents = [item for item in all_documents if item.provider == "dify"]
        external_documents = [item for item in all_documents if item.provider == "external"]
        document_context_list = []
        retrieval_resource_list = []
        # deal with external documents
        for item in external_documents:
            document_context_list.append(DocumentContext(content=item.page_content, score=item.metadata.get("score")))
            source = {
                "dataset_id": item.metadata.get("dataset_id"),
                "dataset_name": item.metadata.get("dataset_name"),
                "document_name": item.metadata.get("title"),
                "data_source_type": "external",
                "retriever_from": invoke_from.to_source(),
                "score": item.metadata.get("score"),
                "content": item.page_content,
            }
            retrieval_resource_list.append(source)
        # deal with dify documents
        if dify_documents:
            records = RetrievalService.format_retrieval_documents(dify_documents)
            if records:
                for record in records:
                    segment = record.segment
                    if segment.answer:
                        document_context_list.append(
                            DocumentContext(
                                content=f"question:{segment.get_sign_content()} answer:{segment.answer}",
                                score=record.score,
                            )
                        )
                    else:
                        document_context_list.append(
                            DocumentContext(
                                content=segment.get_sign_content(),
                                score=record.score,
                            )
                        )
                if show_retrieve_source:
                    for record in records:
                        segment = record.segment
                        dataset = Dataset.query.filter_by(id=segment.dataset_id).first()
                        document = DatasetDocument.query.filter(
                            DatasetDocument.id == segment.document_id,
                            DatasetDocument.enabled == True,
                            DatasetDocument.archived == False,
                        ).first()
                        if dataset and document:
                            source = {
                                "dataset_id": dataset.id,
                                "dataset_name": dataset.name,
                                "document_id": document.id,
                                "document_name": document.name,
                                "data_source_type": document.data_source_type,
                                "segment_id": segment.id,
                                "retriever_from": invoke_from.to_source(),
                                "score": record.score or 0.0,
                                "doc_metadata": document.doc_metadata,
                            }

                            if invoke_from.to_source() == "dev":
                                source["hit_count"] = segment.hit_count
                                source["word_count"] = segment.word_count
                                source["segment_position"] = segment.position
                                source["index_node_hash"] = segment.index_node_hash
                            if segment.answer:
                                source["content"] = f"question:{segment.content} \nanswer:{segment.answer}"
                            else:
                                source["content"] = segment.content
                            retrieval_resource_list.append(source)
        if hit_callback and retrieval_resource_list:
            retrieval_resource_list = sorted(retrieval_resource_list, key=lambda x: x.get("score") or 0.0, reverse=True)
            for position, item in enumerate(retrieval_resource_list, start=1):
                item["position"] = position
            hit_callback.return_retriever_resource_info(retrieval_resource_list)
        if document_context_list:
            document_context_list = sorted(document_context_list, key=lambda x: x.score or 0.0, reverse=True)
            return str("\n".join([document_context.content for document_context in document_context_list]))
        return ""

    def single_retrieve(
        self,
        app_id: str,
        tenant_id: str,
        user_id: str,
        user_from: str,
        available_datasets: list,
        query: str,
        model_instance: ModelInstance,
        model_config: ModelConfigWithCredentialsEntity,
        planning_strategy: PlanningStrategy,
        message_id: Optional[str] = None,
        metadata_filter_document_ids: Optional[dict[str, list[str]]] = None,
        metadata_condition: Optional[MetadataCondition] = None,
    ):
        tools = []
        for dataset in available_datasets:
            description = dataset.description
            if not description:
                description = "useful for when you want to answer queries about the " + dataset.name

            description = description.replace("\n", "").replace("\r", "")
            message_tool = PromptMessageTool(
                name=dataset.id,
                description=description,
                parameters={
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            )
            tools.append(message_tool)
        dataset_id = None
        if planning_strategy == PlanningStrategy.REACT_ROUTER:
            react_multi_dataset_router = ReactMultiDatasetRouter()
            dataset_id = react_multi_dataset_router.invoke(
                query, tools, model_config, model_instance, user_id, tenant_id
            )

        elif planning_strategy == PlanningStrategy.ROUTER:
            function_call_router = FunctionCallMultiDatasetRouter()
            dataset_id = function_call_router.invoke(query, tools, model_config, model_instance)

        if dataset_id:
            # get retrieval model config
            dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
            if dataset:
                results = []
                if dataset.provider == "external":
                    external_documents = ExternalDatasetService.fetch_external_knowledge_retrieval(
                        tenant_id=dataset.tenant_id,
                        dataset_id=dataset_id,
                        query=query,
                        external_retrieval_parameters=dataset.retrieval_model,
                        metadata_condition=metadata_condition,
                    )
                    for external_document in external_documents:
                        document = Document(
                            page_content=external_document.get("content"),
                            metadata=external_document.get("metadata"),
                            provider="external",
                        )
                        if document.metadata is not None:
                            document.metadata["score"] = external_document.get("score")
                            document.metadata["title"] = external_document.get("title")
                            document.metadata["dataset_id"] = dataset_id
                            document.metadata["dataset_name"] = dataset.name
                        results.append(document)
                else:
                    if metadata_condition and not metadata_filter_document_ids:
                        return []
                    document_ids_filter = None
                    if metadata_filter_document_ids:
                        document_ids = metadata_filter_document_ids.get(dataset.id, [])
                        if document_ids:
                            document_ids_filter = document_ids
                        else:
                            return []
                    retrieval_model_config = dataset.retrieval_model or default_retrieval_model

                    # get top k
                    top_k = retrieval_model_config["top_k"]
                    # get retrieval method
                    if dataset.indexing_technique == "economy":
                        retrieval_method = "keyword_search"
                    else:
                        retrieval_method = retrieval_model_config["search_method"]
                    # get reranking model
                    reranking_model = (
                        retrieval_model_config["reranking_model"]
                        if retrieval_model_config["reranking_enable"]
                        else None
                    )
                    # get score threshold
                    score_threshold = 0.0
                    score_threshold_enabled = retrieval_model_config.get("score_threshold_enabled")
                    if score_threshold_enabled:
                        score_threshold = retrieval_model_config.get("score_threshold", 0.0)

                    with measure_time() as timer:
                        results = RetrievalService.retrieve(
                            retrieval_method=retrieval_method,
                            dataset_id=dataset.id,
                            query=query,
                            top_k=top_k,
                            score_threshold=score_threshold,
                            reranking_model=reranking_model,
                            reranking_mode=retrieval_model_config.get("reranking_mode", "reranking_model"),
                            weights=retrieval_model_config.get("weights", None),
                            document_ids_filter=document_ids_filter,
                        )
                self._on_query(query, [dataset_id], app_id, user_from, user_id)

                if results:
                    self._on_retrieval_end(results, message_id, timer)

                return results
        return []

    def multiple_retrieve(
        self,
        app_id: str,
        tenant_id: str,
        user_id: str,
        user_from: str,
        available_datasets: list,
        query: str,
        top_k: int,
        score_threshold: float,
        reranking_mode: str,
        reranking_model: Optional[dict] = None,
        weights: Optional[dict[str, Any]] = None,
        reranking_enable: bool = True,
        message_id: Optional[str] = None,
        metadata_filter_document_ids: Optional[dict[str, list[str]]] = None,
        metadata_condition: Optional[MetadataCondition] = None,
    ):
        if not available_datasets:
            return []
        threads = []
        all_documents: list[Document] = []
        dataset_ids = [dataset.id for dataset in available_datasets]
        index_type_check = all(
            item.indexing_technique == available_datasets[0].indexing_technique for item in available_datasets
        )
        if not index_type_check and (not reranking_enable or reranking_mode != RerankMode.RERANKING_MODEL):
            raise ValueError(
                "The configured knowledge base list have different indexing technique, please set reranking model."
            )
        index_type = available_datasets[0].indexing_technique
        if index_type == "high_quality":
            embedding_model_check = all(
                item.embedding_model == available_datasets[0].embedding_model for item in available_datasets
            )
            embedding_model_provider_check = all(
                item.embedding_model_provider == available_datasets[0].embedding_model_provider
                for item in available_datasets
            )
            if (
                reranking_enable
                and reranking_mode == "weighted_score"
                and (not embedding_model_check or not embedding_model_provider_check)
            ):
                raise ValueError(
                    "The configured knowledge base list have different embedding model, please set reranking model."
                )
            if reranking_enable and reranking_mode == RerankMode.WEIGHTED_SCORE:
                if weights is not None:
                    weights["vector_setting"]["embedding_provider_name"] = available_datasets[
                        0
                    ].embedding_model_provider
                    weights["vector_setting"]["embedding_model_name"] = available_datasets[0].embedding_model

        for dataset in available_datasets:
            index_type = dataset.indexing_technique
            document_ids_filter = None
            if dataset.provider != "external":
                if metadata_condition and not metadata_filter_document_ids:
                    continue
                if metadata_filter_document_ids:
                    document_ids = metadata_filter_document_ids.get(dataset.id, [])
                    if document_ids:
                        document_ids_filter = document_ids
                    else:
                        continue
            retrieval_thread = threading.Thread(
                target=self._retriever,
                kwargs={
                    "flask_app": current_app._get_current_object(),  # type: ignore
                    "dataset_id": dataset.id,
                    "query": query,
                    "top_k": top_k,
                    "all_documents": all_documents,
                    "document_ids_filter": document_ids_filter,
                    "metadata_condition": metadata_condition,
                },
            )
            threads.append(retrieval_thread)
            retrieval_thread.start()
        for thread in threads:
            thread.join()

        with measure_time() as timer:
            if reranking_enable:
                # do rerank for searched documents
                data_post_processor = DataPostProcessor(tenant_id, reranking_mode, reranking_model, weights, False)

                all_documents = data_post_processor.invoke(
                    query=query, documents=all_documents, score_threshold=score_threshold, top_n=top_k
                )
            else:
                if index_type == "economy":
                    all_documents = self.calculate_keyword_score(query, all_documents, top_k)
                elif index_type == "high_quality":
                    all_documents = self.calculate_vector_score(all_documents, top_k, score_threshold)

        self._on_query(query, dataset_ids, app_id, user_from, user_id)

        if all_documents:
            self._on_retrieval_end(all_documents, message_id, timer)

        return all_documents

    def _on_retrieval_end(
        self, documents: list[Document], message_id: Optional[str] = None, timer: Optional[dict] = None
    ) -> None:
        """Handle retrieval end."""
        dify_documents = [document for document in documents if document.provider == "dify"]
        for document in dify_documents:
            if document.metadata is not None:
                dataset_document = DatasetDocument.query.filter(
                    DatasetDocument.id == document.metadata["document_id"]
                ).first()
                if dataset_document:
                    if dataset_document.doc_form == IndexType.PARENT_CHILD_INDEX:
                        child_chunk = ChildChunk.query.filter(
                            ChildChunk.index_node_id == document.metadata["doc_id"],
                            ChildChunk.dataset_id == dataset_document.dataset_id,
                            ChildChunk.document_id == dataset_document.id,
                        ).first()
                        if child_chunk:
                            segment = DocumentSegment.query.filter(DocumentSegment.id == child_chunk.segment_id).update(
                                {DocumentSegment.hit_count: DocumentSegment.hit_count + 1}, synchronize_session=False
                            )
                            db.session.commit()
                    else:
                        query = db.session.query(DocumentSegment).filter(
                            DocumentSegment.index_node_id == document.metadata["doc_id"]
                        )

                        # if 'dataset_id' in document.metadata:
                        if "dataset_id" in document.metadata:
                            query = query.filter(DocumentSegment.dataset_id == document.metadata["dataset_id"])

                        # add hit count to document segment
                        query.update(
                            {DocumentSegment.hit_count: DocumentSegment.hit_count + 1}, synchronize_session=False
                        )

                    db.session.commit()

        # get tracing instance
        trace_manager: TraceQueueManager | None = (
            self.application_generate_entity.trace_manager if self.application_generate_entity else None
        )
        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.DATASET_RETRIEVAL_TRACE, message_id=message_id, documents=documents, timer=timer
                )
            )

    def _on_query(self, query: str, dataset_ids: list[str], app_id: str, user_from: str, user_id: str) -> None:
        """
        Handle query.
        """
        if not query:
            return
        dataset_queries = []
        for dataset_id in dataset_ids:
            dataset_query = DatasetQuery(
                dataset_id=dataset_id,
                content=query,
                source="app",
                source_app_id=app_id,
                created_by_role=user_from,
                created_by=user_id,
            )
            dataset_queries.append(dataset_query)
        if dataset_queries:
            db.session.add_all(dataset_queries)
        db.session.commit()

    def _retriever(
        self,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        all_documents: list,
        document_ids_filter: Optional[list[str]] = None,
        metadata_condition: Optional[MetadataCondition] = None,
    ):
        with flask_app.app_context():
            dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()

            if not dataset:
                return []

            if dataset.provider == "external":
                external_documents = ExternalDatasetService.fetch_external_knowledge_retrieval(
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset_id,
                    query=query,
                    external_retrieval_parameters=dataset.retrieval_model,
                    metadata_condition=metadata_condition,
                )
                for external_document in external_documents:
                    document = Document(
                        page_content=external_document.get("content"),
                        metadata=external_document.get("metadata"),
                        provider="external",
                    )
                    if document.metadata is not None:
                        document.metadata["score"] = external_document.get("score")
                        document.metadata["title"] = external_document.get("title")
                        document.metadata["dataset_id"] = dataset_id
                        document.metadata["dataset_name"] = dataset.name
                    all_documents.append(document)
            else:
                # get retrieval model , if the model is not setting , using default
                retrieval_model = dataset.retrieval_model or default_retrieval_model

                if dataset.indexing_technique == "economy":
                    # use keyword table query
                    documents = RetrievalService.retrieve(
                        retrieval_method="keyword_search", dataset_id=dataset.id, query=query, top_k=top_k
                    )
                    if documents:
                        all_documents.extend(documents)
                else:
                    if top_k > 0:
                        # retrieval source
                        documents = RetrievalService.retrieve(
                            retrieval_method=retrieval_model["search_method"],
                            dataset_id=dataset.id,
                            query=query,
                            top_k=retrieval_model.get("top_k") or 2,
                            score_threshold=retrieval_model.get("score_threshold", 0.0)
                            if retrieval_model["score_threshold_enabled"]
                            else 0.0,
                            reranking_model=retrieval_model.get("reranking_model", None)
                            if retrieval_model["reranking_enable"]
                            else None,
                            reranking_mode=retrieval_model.get("reranking_mode") or "reranking_model",
                            weights=retrieval_model.get("weights", None),
                            document_ids_filter=document_ids_filter,
                        )

                        all_documents.extend(documents)

    def to_dataset_retriever_tool(
        self,
        tenant_id: str,
        dataset_ids: list[str],
        retrieve_config: DatasetRetrieveConfigEntity,
        return_resource: bool,
        invoke_from: InvokeFrom,
        hit_callback: DatasetIndexToolCallbackHandler,
    ) -> Optional[list[DatasetRetrieverBaseTool]]:
        """
        A dataset tool is a tool that can be used to retrieve information from a dataset
        :param tenant_id: tenant id
        :param dataset_ids: dataset ids
        :param retrieve_config: retrieve config
        :param return_resource: return resource
        :param invoke_from: invoke from
        :param hit_callback: hit callback
        """
        tools = []
        available_datasets = []
        for dataset_id in dataset_ids:
            # get dataset from dataset id
            dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()

            # pass if dataset is not available
            if not dataset:
                continue

            # pass if dataset is not available
            if dataset and dataset.provider != "external" and dataset.available_document_count == 0:
                continue

            available_datasets.append(dataset)

        if retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE:
            # get retrieval model config
            default_retrieval_model = {
                "search_method": RetrievalMethod.SEMANTIC_SEARCH.value,
                "reranking_enable": False,
                "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
                "top_k": 2,
                "score_threshold_enabled": False,
            }

            for dataset in available_datasets:
                retrieval_model_config = dataset.retrieval_model or default_retrieval_model

                # get top k
                top_k = retrieval_model_config["top_k"]

                # get score threshold
                score_threshold = None
                score_threshold_enabled = retrieval_model_config.get("score_threshold_enabled")
                if score_threshold_enabled:
                    score_threshold = retrieval_model_config.get("score_threshold")

                from core.tools.utils.dataset_retriever.dataset_retriever_tool import DatasetRetrieverTool

                tool = DatasetRetrieverTool.from_dataset(
                    dataset=dataset,
                    top_k=top_k,
                    score_threshold=score_threshold,
                    hit_callbacks=[hit_callback],
                    return_resource=return_resource,
                    retriever_from=invoke_from.to_source(),
                )

                tools.append(tool)
        elif retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE:
            from core.tools.utils.dataset_retriever.dataset_multi_retriever_tool import DatasetMultiRetrieverTool

            if retrieve_config.reranking_model is None:
                raise ValueError("Reranking model is required for multiple retrieval")

            tool = DatasetMultiRetrieverTool.from_dataset(
                dataset_ids=[dataset.id for dataset in available_datasets],
                tenant_id=tenant_id,
                top_k=retrieve_config.top_k or 2,
                score_threshold=retrieve_config.score_threshold,
                hit_callbacks=[hit_callback],
                return_resource=return_resource,
                retriever_from=invoke_from.to_source(),
                reranking_provider_name=retrieve_config.reranking_model.get("reranking_provider_name"),
                reranking_model_name=retrieve_config.reranking_model.get("reranking_model_name"),
            )

            tools.append(tool)

        return tools

    def calculate_keyword_score(self, query: str, documents: list[Document], top_k: int) -> list[Document]:
        """
        Calculate keywords scores
        :param query: search query
        :param documents: documents for reranking

        :return:
        """
        keyword_table_handler = JiebaKeywordTableHandler()
        query_keywords = keyword_table_handler.extract_keywords(query, None)
        documents_keywords = []
        for document in documents:
            if document.metadata is not None:
                # get the document keywords
                document_keywords = keyword_table_handler.extract_keywords(document.page_content, None)
                document.metadata["keywords"] = document_keywords
                documents_keywords.append(document_keywords)

        # Counter query keywords(TF)
        query_keyword_counts = Counter(query_keywords)

        # total documents
        total_documents = len(documents)

        # calculate all documents' keywords IDF
        all_keywords = set()
        for document_keywords in documents_keywords:
            all_keywords.update(document_keywords)

        keyword_idf = {}
        for keyword in all_keywords:
            # calculate include query keywords' documents
            doc_count_containing_keyword = sum(1 for doc_keywords in documents_keywords if keyword in doc_keywords)
            # IDF
            keyword_idf[keyword] = math.log((1 + total_documents) / (1 + doc_count_containing_keyword)) + 1

        query_tfidf = {}

        for keyword, count in query_keyword_counts.items():
            tf = count
            idf = keyword_idf.get(keyword, 0)
            query_tfidf[keyword] = tf * idf

        # calculate all documents' TF-IDF
        documents_tfidf = []
        for document_keywords in documents_keywords:
            document_keyword_counts = Counter(document_keywords)
            document_tfidf = {}
            for keyword, count in document_keyword_counts.items():
                tf = count
                idf = keyword_idf.get(keyword, 0)
                document_tfidf[keyword] = tf * idf
            documents_tfidf.append(document_tfidf)

        def cosine_similarity(vec1, vec2):
            intersection = set(vec1.keys()) & set(vec2.keys())
            numerator = sum(vec1[x] * vec2[x] for x in intersection)

            sum1 = sum(vec1[x] ** 2 for x in vec1)
            sum2 = sum(vec2[x] ** 2 for x in vec2)
            denominator = math.sqrt(sum1) * math.sqrt(sum2)

            if not denominator:
                return 0.0
            else:
                return float(numerator) / denominator

        similarities = []
        for document_tfidf in documents_tfidf:
            similarity = cosine_similarity(query_tfidf, document_tfidf)
            similarities.append(similarity)

        for document, score in zip(documents, similarities):
            # format document
            if document.metadata is not None:
                document.metadata["score"] = score
        documents = sorted(documents, key=lambda x: x.metadata.get("score", 0) if x.metadata else 0, reverse=True)
        return documents[:top_k] if top_k else documents

    def calculate_vector_score(
        self, all_documents: list[Document], top_k: int, score_threshold: float
    ) -> list[Document]:
        filter_documents = []
        for document in all_documents:
            if score_threshold is None or (document.metadata and document.metadata.get("score", 0) >= score_threshold):
                filter_documents.append(document)

        if not filter_documents:
            return []
        filter_documents = sorted(
            filter_documents, key=lambda x: x.metadata.get("score", 0) if x.metadata else 0, reverse=True
        )
        return filter_documents[:top_k] if top_k else filter_documents

    def _get_metadata_filter_condition(
        self,
        dataset_ids: list,
        query: str,
        tenant_id: str,
        user_id: str,
        metadata_filtering_mode: str,
        metadata_model_config: ModelConfig,
        metadata_filtering_conditions: Optional[MetadataFilteringCondition],
        inputs: dict,
    ) -> tuple[Optional[dict[str, list[str]]], Optional[MetadataCondition]]:
        document_query = db.session.query(DatasetDocument).filter(
            DatasetDocument.dataset_id.in_(dataset_ids),
            DatasetDocument.indexing_status == "completed",
            DatasetDocument.enabled == True,
            DatasetDocument.archived == False,
        )
        filters = []  # type: ignore
        metadata_condition = None
        if metadata_filtering_mode == "disabled":
            return None, None
        elif metadata_filtering_mode == "automatic":
            automatic_metadata_filters = self._automatic_metadata_filter_func(
                dataset_ids, query, tenant_id, user_id, metadata_model_config
            )
            if automatic_metadata_filters:
                conditions = []
                for filter in automatic_metadata_filters:
                    self._process_metadata_filter_func(
                        filter.get("condition"),  # type: ignore
                        filter.get("metadata_name"),  # type: ignore
                        filter.get("value"),
                        filters,  # type: ignore
                    )
                    conditions.append(
                        Condition(
                            name=filter.get("metadata_name"),  # type: ignore
                            comparison_operator=filter.get("condition"),  # type: ignore
                            value=filter.get("value"),
                        )
                    )
                metadata_condition = MetadataCondition(
                    logical_operator=metadata_filtering_conditions.logical_operator,  # type: ignore
                    conditions=conditions,
                )
        elif metadata_filtering_mode == "manual":
            if metadata_filtering_conditions:
                metadata_condition = MetadataCondition(**metadata_filtering_conditions.model_dump())
                for condition in metadata_filtering_conditions.conditions:  # type: ignore
                    metadata_name = condition.name
                    expected_value = condition.value
                    if expected_value is not None or condition.comparison_operator in ("empty", "not empty"):
                        if isinstance(expected_value, str):
                            expected_value = self._replace_metadata_filter_value(expected_value, inputs)
                        filters = self._process_metadata_filter_func(
                            condition.comparison_operator, metadata_name, expected_value, filters
                        )
        else:
            raise ValueError("Invalid metadata filtering mode")
        if filters:
            if metadata_filtering_conditions.logical_operator == "or":  # type: ignore
                document_query = document_query.filter(or_(*filters))
            else:
                document_query = document_query.filter(and_(*filters))
        documents = document_query.all()
        # group by dataset_id
        metadata_filter_document_ids = defaultdict(list) if documents else None  # type: ignore
        for document in documents:
            metadata_filter_document_ids[document.dataset_id].append(document.id)  # type: ignore
        return metadata_filter_document_ids, metadata_condition

    def _replace_metadata_filter_value(self, text: str, inputs: dict) -> str:
        def replacer(match):
            key = match.group(1)
            return str(inputs.get(key, f"{{{{{key}}}}}"))

        pattern = re.compile(r"\{\{(\w+)\}\}")
        return pattern.sub(replacer, text)

    def _automatic_metadata_filter_func(
        self, dataset_ids: list, query: str, tenant_id: str, user_id: str, metadata_model_config: ModelConfig
    ) -> Optional[list[dict[str, Any]]]:
        # get all metadata field
        metadata_fields = db.session.query(DatasetMetadata).filter(DatasetMetadata.dataset_id.in_(dataset_ids)).all()
        all_metadata_fields = [metadata_field.name for metadata_field in metadata_fields]
        # get metadata model config
        if metadata_model_config is None:
            raise ValueError("metadata_model_config is required")
        # get metadata model instance
        # fetch model config
        model_instance, model_config = self._fetch_model_config(tenant_id, metadata_model_config)

        # fetch prompt messages
        prompt_messages, stop = self._get_prompt_template(
            model_config=model_config,
            mode=metadata_model_config.mode,
            metadata_fields=all_metadata_fields,
            query=query or "",
        )

        result_text = ""
        try:
            # handle invoke result
            invoke_result = cast(
                Generator[LLMResult, None, None],
                model_instance.invoke_llm(
                    prompt_messages=prompt_messages,
                    model_parameters=model_config.parameters,
                    stop=stop,
                    stream=True,
                    user=user_id,
                ),
            )

            # handle invoke result
            result_text, usage = self._handle_invoke_result(invoke_result=invoke_result)

            result_text_json = parse_and_check_json_markdown(result_text, [])
            automatic_metadata_filters = []
            if "metadata_map" in result_text_json:
                metadata_map = result_text_json["metadata_map"]
                for item in metadata_map:
                    if item.get("metadata_field_name") in all_metadata_fields:
                        automatic_metadata_filters.append(
                            {
                                "metadata_name": item.get("metadata_field_name"),
                                "value": item.get("metadata_field_value"),
                                "condition": item.get("comparison_operator"),
                            }
                        )
        except Exception as e:
            return None
        return automatic_metadata_filters

    def _process_metadata_filter_func(self, condition: str, metadata_name: str, value: Optional[Any], filters: list):
        match condition:
            case "contains":
                filters.append(
                    (text("documents.doc_metadata ->> :key LIKE :value")).params(key=metadata_name, value=f"%{value}%")
                )
            case "not contains":
                filters.append(
                    (text("documents.doc_metadata ->> :key NOT LIKE :value")).params(
                        key=metadata_name, value=f"%{value}%"
                    )
                )
            case "start with":
                filters.append(
                    (text("documents.doc_metadata ->> :key LIKE :value")).params(key=metadata_name, value=f"{value}%")
                )

            case "end with":
                filters.append(
                    (text("documents.doc_metadata ->> :key LIKE :value")).params(key=metadata_name, value=f"%{value}")
                )
            case "is" | "=":
                if isinstance(value, str):
                    filters.append(DatasetDocument.doc_metadata[metadata_name] == f'"{value}"')
                else:
                    filters.append(
                        sqlalchemy_cast(DatasetDocument.doc_metadata[metadata_name].astext, Integer) == value
                    )
            case "is not" | "≠":
                if isinstance(value, str):
                    filters.append(DatasetDocument.doc_metadata[metadata_name] != f'"{value}"')
                else:
                    filters.append(
                        sqlalchemy_cast(DatasetDocument.doc_metadata[metadata_name].astext, Integer) != value
                    )
            case "empty":
                filters.append(DatasetDocument.doc_metadata[metadata_name].is_(None))
            case "not empty":
                filters.append(DatasetDocument.doc_metadata[metadata_name].isnot(None))
            case "before" | "<":
                filters.append(sqlalchemy_cast(DatasetDocument.doc_metadata[metadata_name].astext, Integer) < value)
            case "after" | ">":
                filters.append(sqlalchemy_cast(DatasetDocument.doc_metadata[metadata_name].astext, Integer) > value)
            case "≤" | ">=":
                filters.append(sqlalchemy_cast(DatasetDocument.doc_metadata[metadata_name].astext, Integer) <= value)
            case "≥" | ">=":
                filters.append(sqlalchemy_cast(DatasetDocument.doc_metadata[metadata_name].astext, Integer) >= value)
            case _:
                pass
        return filters

    def _fetch_model_config(
        self, tenant_id: str, model: ModelConfig
    ) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
        """
        Fetch model config
        :param node_data: node data
        :return:
        """
        if model is None:
            raise ValueError("single_retrieval_config is required")
        model_name = model.name
        provider_name = model.provider

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id, model_type=ModelType.LLM, provider=provider_name, model=model_name
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
            raise ValueError(f"Model {model_name} not exist.")

        if provider_model.status == ModelStatus.NO_CONFIGURE:
            raise ValueError(f"Model {model_name} credentials is not initialized.")
        elif provider_model.status == ModelStatus.NO_PERMISSION:
            raise ValueError(f"Dify Hosted OpenAI {model_name} currently not support.")
        elif provider_model.status == ModelStatus.QUOTA_EXCEEDED:
            raise ValueError(f"Model provider {provider_name} quota exceeded.")

        # model config
        completion_params = model.completion_params
        stop = []
        if "stop" in completion_params:
            stop = completion_params["stop"]
            del completion_params["stop"]

        # get model mode
        model_mode = model.mode
        if not model_mode:
            raise ValueError("LLM mode is required.")

        model_schema = model_type_instance.get_model_schema(model_name, model_credentials)

        if not model_schema:
            raise ValueError(f"Model {model_name} not exist.")

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

    def _get_prompt_template(
        self, model_config: ModelConfigWithCredentialsEntity, mode: str, metadata_fields: list, query: str
    ):
        model_mode = ModelMode.value_of(mode)
        input_text = query

        prompt_template: Union[CompletionModelPromptTemplate, list[ChatModelMessage]]
        if model_mode == ModelMode.CHAT:
            prompt_template = []
            system_prompt_messages = ChatModelMessage(role=PromptMessageRole.SYSTEM, text=METADATA_FILTER_SYSTEM_PROMPT)
            prompt_template.append(system_prompt_messages)
            user_prompt_message_1 = ChatModelMessage(role=PromptMessageRole.USER, text=METADATA_FILTER_USER_PROMPT_1)
            prompt_template.append(user_prompt_message_1)
            assistant_prompt_message_1 = ChatModelMessage(
                role=PromptMessageRole.ASSISTANT, text=METADATA_FILTER_ASSISTANT_PROMPT_1
            )
            prompt_template.append(assistant_prompt_message_1)
            user_prompt_message_2 = ChatModelMessage(role=PromptMessageRole.USER, text=METADATA_FILTER_USER_PROMPT_2)
            prompt_template.append(user_prompt_message_2)
            assistant_prompt_message_2 = ChatModelMessage(
                role=PromptMessageRole.ASSISTANT, text=METADATA_FILTER_ASSISTANT_PROMPT_2
            )
            prompt_template.append(assistant_prompt_message_2)
            user_prompt_message_3 = ChatModelMessage(
                role=PromptMessageRole.USER,
                text=METADATA_FILTER_USER_PROMPT_3.format(
                    input_text=input_text,
                    metadata_fields=json.dumps(metadata_fields, ensure_ascii=False),
                ),
            )
            prompt_template.append(user_prompt_message_3)
        elif model_mode == ModelMode.COMPLETION:
            prompt_template = CompletionModelPromptTemplate(
                text=METADATA_FILTER_COMPLETION_PROMPT.format(
                    input_text=input_text,
                    metadata_fields=json.dumps(metadata_fields, ensure_ascii=False),
                )
            )

        else:
            raise ValueError(f"Model mode {model_mode} not support.")

        prompt_transform = AdvancedPromptTransform()
        prompt_messages = prompt_transform.get_prompt(
            prompt_template=prompt_template,
            inputs={},
            query=query or "",
            files=[],
            context=None,
            memory_config=None,
            memory=None,
            model_config=model_config,
        )
        stop = model_config.stop

        return prompt_messages, stop

    def _handle_invoke_result(self, invoke_result: Generator) -> tuple[str, LLMUsage]:
        """
        Handle invoke result
        :param invoke_result: invoke result
        :return:
        """
        model = None
        prompt_messages: list[PromptMessage] = []
        full_text = ""
        usage = None
        for result in invoke_result:
            text = result.delta.message.content
            full_text += text

            if not model:
                model = result.model

            if not prompt_messages:
                prompt_messages = result.prompt_messages

            if not usage and result.delta.usage:
                usage = result.delta.usage

        if not usage:
            usage = LLMUsage.empty_usage()

        return full_text, usage
