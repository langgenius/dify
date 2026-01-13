import json
import math
import re
import threading
from collections import Counter, defaultdict
from collections.abc import Generator, Mapping
from typing import Any, Union, cast

from flask import Flask, current_app
from sqlalchemy import and_, literal, or_, select
from sqlalchemy.orm import Session

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
from core.file import File, FileTransferMethod, FileType
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
from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.rag.entities.context_entities import DocumentContext
from core.rag.entities.metadata_entities import Condition, MetadataCondition
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.constant.query_type import QueryType
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
from core.tools.signature import sign_upload_file
from core.tools.utils.dataset_retriever.dataset_retriever_base_tool import DatasetRetrieverBaseTool
from extensions.ext_database import db
from libs.json_in_md_parser import parse_and_check_json_markdown
from models import UploadFile
from models.dataset import ChildChunk, Dataset, DatasetMetadata, DatasetQuery, DocumentSegment, SegmentAttachmentBinding
from models.dataset import Document as DatasetDocument
from services.external_knowledge_service import ExternalDatasetService

default_retrieval_model: dict[str, Any] = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
    "score_threshold_enabled": False,
}


class DatasetRetrieval:
    def __init__(self, application_generate_entity=None):
        self.application_generate_entity = application_generate_entity
        self._llm_usage = LLMUsage.empty_usage()

    @property
    def llm_usage(self) -> LLMUsage:
        return self._llm_usage.model_copy()

    def _record_usage(self, usage: LLMUsage | None) -> None:
        if usage is None or usage.total_tokens <= 0:
            return
        if self._llm_usage.total_tokens == 0:
            self._llm_usage = usage
        else:
            self._llm_usage = self._llm_usage.plus(usage)

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
        memory: TokenBufferMemory | None = None,
        inputs: Mapping[str, Any] | None = None,
        vision_enabled: bool = False,
    ) -> tuple[str | None, list[File] | None]:
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
        :param inputs: inputs
        :return:
        """
        dataset_ids = config.dataset_ids
        if len(dataset_ids) == 0:
            return None, []
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
            return None, []

        planning_strategy = PlanningStrategy.REACT_ROUTER
        features = model_schema.features
        if features:
            if ModelFeature.TOOL_CALL in features or ModelFeature.MULTI_TOOL_CALL in features:
                planning_strategy = PlanningStrategy.ROUTER
        available_datasets = []

        dataset_stmt = select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id.in_(dataset_ids))
        datasets: list[Dataset] = db.session.execute(dataset_stmt).scalars().all()  # type: ignore
        for dataset in datasets:
            if dataset.available_document_count == 0 and dataset.provider != "external":
                continue
            available_datasets.append(dataset)

        if inputs:
            inputs = {key: str(value) for key, value in inputs.items()}
        else:
            inputs = {}
        available_datasets_ids = [dataset.id for dataset in available_datasets]
        metadata_filter_document_ids, metadata_condition = self.get_metadata_filter_condition(
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
                query,
                available_datasets,
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
                True if retrieve_config.reranking_enabled is None else retrieve_config.reranking_enabled,
                message_id,
                metadata_filter_document_ids,
                metadata_condition,
            )

        dify_documents = [item for item in all_documents if item.provider == "dify"]
        external_documents = [item for item in all_documents if item.provider == "external"]
        document_context_list: list[DocumentContext] = []
        context_files: list[File] = []
        retrieval_resource_list: list[RetrievalSourceMetadata] = []
        # deal with external documents
        for item in external_documents:
            document_context_list.append(DocumentContext(content=item.page_content, score=item.metadata.get("score")))
            source = RetrievalSourceMetadata(
                dataset_id=item.metadata.get("dataset_id"),
                dataset_name=item.metadata.get("dataset_name"),
                document_id=item.metadata.get("document_id") or item.metadata.get("title"),
                document_name=item.metadata.get("title"),
                data_source_type="external",
                retriever_from=invoke_from.to_source(),
                score=item.metadata.get("score"),
                content=item.page_content,
            )
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
                    if vision_enabled:
                        attachments_with_bindings = db.session.execute(
                            select(SegmentAttachmentBinding, UploadFile)
                            .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
                            .where(
                                SegmentAttachmentBinding.segment_id == segment.id,
                            )
                        ).all()
                        if attachments_with_bindings:
                            for _, upload_file in attachments_with_bindings:
                                attachment_info = File(
                                    id=upload_file.id,
                                    filename=upload_file.name,
                                    extension="." + upload_file.extension,
                                    mime_type=upload_file.mime_type,
                                    tenant_id=segment.tenant_id,
                                    type=FileType.IMAGE,
                                    transfer_method=FileTransferMethod.LOCAL_FILE,
                                    remote_url=upload_file.source_url,
                                    related_id=upload_file.id,
                                    size=upload_file.size,
                                    storage_key=upload_file.key,
                                    url=sign_upload_file(upload_file.id, upload_file.extension),
                                )
                                context_files.append(attachment_info)
                if show_retrieve_source:
                    dataset_ids = [record.segment.dataset_id for record in records]
                    document_ids = [record.segment.document_id for record in records]
                    dataset_document_stmt = select(DatasetDocument).where(
                        DatasetDocument.id.in_(document_ids),
                        DatasetDocument.enabled == True,
                        DatasetDocument.archived == False,
                    )
                    documents = db.session.execute(dataset_document_stmt).scalars().all()  # type: ignore
                    dataset_stmt = select(Dataset).where(
                        Dataset.id.in_(dataset_ids),
                    )
                    datasets = db.session.execute(dataset_stmt).scalars().all()  # type: ignore
                    dataset_map = {i.id: i for i in datasets}
                    document_map = {i.id: i for i in documents}
                    for record in records:
                        segment = record.segment
                        dataset_item = dataset_map.get(segment.dataset_id)
                        document_item = document_map.get(segment.document_id)
                        if dataset_item and document_item:
                            source = RetrievalSourceMetadata(
                                dataset_id=dataset_item.id,
                                dataset_name=dataset_item.name,
                                document_id=document_item.id,
                                document_name=document_item.name,
                                data_source_type=document_item.data_source_type,
                                segment_id=segment.id,
                                retriever_from=invoke_from.to_source(),
                                score=record.score or 0.0,
                                doc_metadata=document_item.doc_metadata,
                            )

                            if invoke_from.to_source() == "dev":
                                source.hit_count = segment.hit_count
                                source.word_count = segment.word_count
                                source.segment_position = segment.position
                                source.index_node_hash = segment.index_node_hash
                            if segment.answer:
                                source.content = f"question:{segment.content} \nanswer:{segment.answer}"
                            else:
                                source.content = segment.content
                            retrieval_resource_list.append(source)
        if hit_callback and retrieval_resource_list:
            retrieval_resource_list = sorted(retrieval_resource_list, key=lambda x: x.score or 0.0, reverse=True)
            for position, item in enumerate(retrieval_resource_list, start=1):
                item.position = position
            hit_callback.return_retriever_resource_info(retrieval_resource_list)
        if document_context_list:
            document_context_list = sorted(document_context_list, key=lambda x: x.score or 0.0, reverse=True)
            return str(
                "\n".join([document_context.content for document_context in document_context_list])
            ), context_files
        return "", context_files

    def single_retrieve(
        self,
        app_id: str,
        tenant_id: str,
        user_id: str,
        user_from: str,
        query: str,
        available_datasets: list,
        model_instance: ModelInstance,
        model_config: ModelConfigWithCredentialsEntity,
        planning_strategy: PlanningStrategy,
        message_id: str | None = None,
        metadata_filter_document_ids: dict[str, list[str]] | None = None,
        metadata_condition: MetadataCondition | None = None,
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
        router_usage = LLMUsage.empty_usage()
        if planning_strategy == PlanningStrategy.REACT_ROUTER:
            react_multi_dataset_router = ReactMultiDatasetRouter()
            dataset_id, router_usage = react_multi_dataset_router.invoke(
                query, tools, model_config, model_instance, user_id, tenant_id
            )

        elif planning_strategy == PlanningStrategy.ROUTER:
            function_call_router = FunctionCallMultiDatasetRouter()
            dataset_id, router_usage = function_call_router.invoke(query, tools, model_config, model_instance)

        self._record_usage(router_usage)
        timer = None
        if dataset_id:
            # get retrieval model config
            dataset_stmt = select(Dataset).where(Dataset.id == dataset_id)
            dataset = db.session.scalar(dataset_stmt)
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
                        retrieval_method = RetrievalMethod.KEYWORD_SEARCH
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
                self._on_query(query, None, [dataset_id], app_id, user_from, user_id)

                if results:
                    thread = threading.Thread(
                        target=self._on_retrieval_end,
                        kwargs={
                            "flask_app": current_app._get_current_object(),  # type: ignore
                            "documents": results,
                            "message_id": message_id,
                            "timer": timer,
                        },
                    )
                    thread.start()

                return results
        return []

    def multiple_retrieve(
        self,
        app_id: str,
        tenant_id: str,
        user_id: str,
        user_from: str,
        available_datasets: list,
        query: str | None,
        top_k: int,
        score_threshold: float,
        reranking_mode: str,
        reranking_model: dict | None = None,
        weights: dict[str, Any] | None = None,
        reranking_enable: bool = True,
        message_id: str | None = None,
        metadata_filter_document_ids: dict[str, list[str]] | None = None,
        metadata_condition: MetadataCondition | None = None,
        attachment_ids: list[str] | None = None,
    ):
        if not available_datasets:
            return []
        all_threads = []
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
        dataset_count = len(available_datasets)
        with measure_time() as timer:
            cancel_event = threading.Event()
            thread_exceptions: list[Exception] = []

            if query:
                query_thread = threading.Thread(
                    target=self._multiple_retrieve_thread,
                    kwargs={
                        "flask_app": current_app._get_current_object(),  # type: ignore
                        "available_datasets": available_datasets,
                        "metadata_condition": metadata_condition,
                        "metadata_filter_document_ids": metadata_filter_document_ids,
                        "all_documents": all_documents,
                        "tenant_id": tenant_id,
                        "reranking_enable": reranking_enable,
                        "reranking_mode": reranking_mode,
                        "reranking_model": reranking_model,
                        "weights": weights,
                        "top_k": top_k,
                        "score_threshold": score_threshold,
                        "query": query,
                        "attachment_id": None,
                        "dataset_count": dataset_count,
                        "cancel_event": cancel_event,
                        "thread_exceptions": thread_exceptions,
                    },
                )
                all_threads.append(query_thread)
                query_thread.start()
            if attachment_ids:
                for attachment_id in attachment_ids:
                    attachment_thread = threading.Thread(
                        target=self._multiple_retrieve_thread,
                        kwargs={
                            "flask_app": current_app._get_current_object(),  # type: ignore
                            "available_datasets": available_datasets,
                            "metadata_condition": metadata_condition,
                            "metadata_filter_document_ids": metadata_filter_document_ids,
                            "all_documents": all_documents,
                            "tenant_id": tenant_id,
                            "reranking_enable": reranking_enable,
                            "reranking_mode": reranking_mode,
                            "reranking_model": reranking_model,
                            "weights": weights,
                            "top_k": top_k,
                            "score_threshold": score_threshold,
                            "query": None,
                            "attachment_id": attachment_id,
                            "dataset_count": dataset_count,
                            "cancel_event": cancel_event,
                            "thread_exceptions": thread_exceptions,
                        },
                    )
                    all_threads.append(attachment_thread)
                    attachment_thread.start()

            # Poll threads with short timeout to detect errors quickly (fail-fast)
            while any(t.is_alive() for t in all_threads):
                for thread in all_threads:
                    thread.join(timeout=0.1)
                    if thread_exceptions:
                        cancel_event.set()
                        break
                if thread_exceptions:
                    break

            if thread_exceptions:
                raise thread_exceptions[0]
        self._on_query(query, attachment_ids, dataset_ids, app_id, user_from, user_id)

        if all_documents:
            # add thread to call _on_retrieval_end
            retrieval_end_thread = threading.Thread(
                target=self._on_retrieval_end,
                kwargs={
                    "flask_app": current_app._get_current_object(),  # type: ignore
                    "documents": all_documents,
                    "message_id": message_id,
                    "timer": timer,
                },
            )
            retrieval_end_thread.start()
        retrieval_resource_list = []
        doc_ids_filter = []
        for document in all_documents:
            if document.provider == "dify":
                doc_id = document.metadata.get("doc_id")
                if doc_id and doc_id not in doc_ids_filter:
                    doc_ids_filter.append(doc_id)
                    retrieval_resource_list.append(document)
            elif document.provider == "external":
                retrieval_resource_list.append(document)
        return retrieval_resource_list

    def _on_retrieval_end(
        self, flask_app: Flask, documents: list[Document], message_id: str | None = None, timer: dict | None = None
    ):
        """Handle retrieval end."""
        with flask_app.app_context():
            dify_documents = [document for document in documents if document.provider == "dify"]
            if not dify_documents:
                self._send_trace_task(message_id, documents, timer)
                return

            with Session(db.engine) as session:
                # Collect all document_ids and batch fetch DatasetDocuments
                document_ids = {
                    doc.metadata["document_id"]
                    for doc in dify_documents
                    if doc.metadata and "document_id" in doc.metadata
                }
                if not document_ids:
                    self._send_trace_task(message_id, documents, timer)
                    return

                dataset_docs_stmt = select(DatasetDocument).where(DatasetDocument.id.in_(document_ids))
                dataset_docs = session.scalars(dataset_docs_stmt).all()
                dataset_doc_map = {str(doc.id): doc for doc in dataset_docs}

                # Categorize documents by type and collect necessary IDs
                parent_child_text_docs: list[tuple[Document, DatasetDocument]] = []
                parent_child_image_docs: list[tuple[Document, DatasetDocument]] = []
                normal_text_docs: list[tuple[Document, DatasetDocument]] = []
                normal_image_docs: list[tuple[Document, DatasetDocument]] = []

                for doc in dify_documents:
                    if not doc.metadata or "document_id" not in doc.metadata:
                        continue
                    dataset_doc = dataset_doc_map.get(doc.metadata["document_id"])
                    if not dataset_doc:
                        continue

                    is_image = doc.metadata.get("doc_type") == DocType.IMAGE
                    is_parent_child = dataset_doc.doc_form == IndexStructureType.PARENT_CHILD_INDEX

                    if is_parent_child:
                        if is_image:
                            parent_child_image_docs.append((doc, dataset_doc))
                        else:
                            parent_child_text_docs.append((doc, dataset_doc))
                    else:
                        if is_image:
                            normal_image_docs.append((doc, dataset_doc))
                        else:
                            normal_text_docs.append((doc, dataset_doc))

                segment_ids_to_update: set[str] = set()

                # Process PARENT_CHILD_INDEX text documents - batch fetch ChildChunks
                if parent_child_text_docs:
                    index_node_ids = [doc.metadata["doc_id"] for doc, _ in parent_child_text_docs if doc.metadata]
                    if index_node_ids:
                        child_chunks_stmt = select(ChildChunk).where(ChildChunk.index_node_id.in_(index_node_ids))
                        child_chunks = session.scalars(child_chunks_stmt).all()
                        child_chunk_map = {chunk.index_node_id: chunk.segment_id for chunk in child_chunks}
                        for doc, _ in parent_child_text_docs:
                            if doc.metadata:
                                segment_id = child_chunk_map.get(doc.metadata["doc_id"])
                                if segment_id:
                                    segment_ids_to_update.add(str(segment_id))

                # Process non-PARENT_CHILD_INDEX text documents - batch fetch DocumentSegments
                if normal_text_docs:
                    index_node_ids = [doc.metadata["doc_id"] for doc, _ in normal_text_docs if doc.metadata]
                    if index_node_ids:
                        segments_stmt = select(DocumentSegment).where(DocumentSegment.index_node_id.in_(index_node_ids))
                        segments = session.scalars(segments_stmt).all()
                        segment_map = {seg.index_node_id: seg.id for seg in segments}
                        for doc, _ in normal_text_docs:
                            if doc.metadata:
                                segment_id = segment_map.get(doc.metadata["doc_id"])
                                if segment_id:
                                    segment_ids_to_update.add(str(segment_id))

                # Process IMAGE documents - batch fetch SegmentAttachmentBindings
                all_image_docs = parent_child_image_docs + normal_image_docs
                if all_image_docs:
                    attachment_ids = [
                        doc.metadata["doc_id"]
                        for doc, _ in all_image_docs
                        if doc.metadata and doc.metadata.get("doc_id")
                    ]
                    if attachment_ids:
                        bindings_stmt = select(SegmentAttachmentBinding).where(
                            SegmentAttachmentBinding.attachment_id.in_(attachment_ids)
                        )
                        bindings = session.scalars(bindings_stmt).all()
                        segment_ids_to_update.update(str(binding.segment_id) for binding in bindings)

                # Batch update hit_count for all segments
                if segment_ids_to_update:
                    session.query(DocumentSegment).where(DocumentSegment.id.in_(segment_ids_to_update)).update(
                        {DocumentSegment.hit_count: DocumentSegment.hit_count + 1},
                        synchronize_session=False,
                    )
                    session.commit()

            self._send_trace_task(message_id, documents, timer)

    def _send_trace_task(self, message_id: str | None, documents: list[Document], timer: dict | None):
        """Send trace task if trace manager is available."""
        trace_manager: TraceQueueManager | None = (
            self.application_generate_entity.trace_manager if self.application_generate_entity else None
        )
        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.DATASET_RETRIEVAL_TRACE, message_id=message_id, documents=documents, timer=timer
                )
            )

    def _on_query(
        self,
        query: str | None,
        attachment_ids: list[str] | None,
        dataset_ids: list[str],
        app_id: str,
        user_from: str,
        user_id: str,
    ):
        """
        Handle query.
        """
        if not query and not attachment_ids:
            return
        dataset_queries = []
        for dataset_id in dataset_ids:
            contents = []
            if query:
                contents.append({"content_type": QueryType.TEXT_QUERY, "content": query})
            if attachment_ids:
                for attachment_id in attachment_ids:
                    contents.append({"content_type": QueryType.IMAGE_QUERY, "content": attachment_id})
            if contents:
                dataset_query = DatasetQuery(
                    dataset_id=dataset_id,
                    content=json.dumps(contents),
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
        document_ids_filter: list[str] | None = None,
        metadata_condition: MetadataCondition | None = None,
        attachment_ids: list[str] | None = None,
    ):
        with flask_app.app_context():
            dataset_stmt = select(Dataset).where(Dataset.id == dataset_id)
            dataset = db.session.scalar(dataset_stmt)

            if not dataset:
                return []

            if dataset.provider == "external" and query:
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
                        retrieval_method=RetrievalMethod.KEYWORD_SEARCH,
                        dataset_id=dataset.id,
                        query=query,
                        top_k=top_k,
                        document_ids_filter=document_ids_filter,
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
                            top_k=retrieval_model.get("top_k") or 4,
                            score_threshold=retrieval_model.get("score_threshold", 0.0)
                            if retrieval_model["score_threshold_enabled"]
                            else 0.0,
                            reranking_model=retrieval_model.get("reranking_model", None)
                            if retrieval_model["reranking_enable"]
                            else None,
                            reranking_mode=retrieval_model.get("reranking_mode") or "reranking_model",
                            weights=retrieval_model.get("weights", None),
                            document_ids_filter=document_ids_filter,
                            attachment_ids=attachment_ids,
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
        user_id: str,
        inputs: dict,
    ) -> list[DatasetRetrieverBaseTool] | None:
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
            dataset_stmt = select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id)
            dataset = db.session.scalar(dataset_stmt)

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
                "search_method": RetrievalMethod.SEMANTIC_SEARCH,
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
                    retrieve_config=retrieve_config,
                    user_id=user_id,
                    inputs=inputs,
                )

                tools.append(tool)
        elif retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE:
            from core.tools.utils.dataset_retriever.dataset_multi_retriever_tool import DatasetMultiRetrieverTool

            if retrieve_config.reranking_model is None:
                raise ValueError("Reranking model is required for multiple retrieval")

            tool = DatasetMultiRetrieverTool.from_dataset(
                dataset_ids=[dataset.id for dataset in available_datasets],
                tenant_id=tenant_id,
                top_k=retrieve_config.top_k or 4,
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
        :param top_k: top k

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

    def get_metadata_filter_condition(
        self,
        dataset_ids: list,
        query: str,
        tenant_id: str,
        user_id: str,
        metadata_filtering_mode: str,
        metadata_model_config: ModelConfig,
        metadata_filtering_conditions: MetadataFilteringCondition | None,
        inputs: dict,
    ) -> tuple[dict[str, list[str]] | None, MetadataCondition | None]:
        document_query = db.session.query(DatasetDocument).where(
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
                for sequence, filter in enumerate(automatic_metadata_filters):
                    self.process_metadata_filter_func(
                        sequence,
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
                    logical_operator=metadata_filtering_conditions.logical_operator
                    if metadata_filtering_conditions
                    else "or",  # type: ignore
                    conditions=conditions,
                )
        elif metadata_filtering_mode == "manual":
            if metadata_filtering_conditions:
                conditions = []
                for sequence, condition in enumerate(metadata_filtering_conditions.conditions):  # type: ignore
                    metadata_name = condition.name
                    expected_value = condition.value
                    if expected_value is not None and condition.comparison_operator not in ("empty", "not empty"):
                        if isinstance(expected_value, str):
                            expected_value = self._replace_metadata_filter_value(expected_value, inputs)
                    conditions.append(
                        Condition(
                            name=metadata_name,
                            comparison_operator=condition.comparison_operator,
                            value=expected_value,
                        )
                    )
                    filters = self.process_metadata_filter_func(
                        sequence,
                        condition.comparison_operator,
                        metadata_name,
                        expected_value,
                        filters,
                    )
                metadata_condition = MetadataCondition(
                    logical_operator=metadata_filtering_conditions.logical_operator,
                    conditions=conditions,
                )
        else:
            raise ValueError("Invalid metadata filtering mode")
        if filters:
            if metadata_filtering_conditions and metadata_filtering_conditions.logical_operator == "and":  # type: ignore
                document_query = document_query.where(and_(*filters))
            else:
                document_query = document_query.where(or_(*filters))
        documents = document_query.all()
        # group by dataset_id
        metadata_filter_document_ids = defaultdict(list) if documents else None  # type: ignore
        for document in documents:
            metadata_filter_document_ids[document.dataset_id].append(document.id)  # type: ignore
        return metadata_filter_document_ids, metadata_condition

    def _replace_metadata_filter_value(self, text: str, inputs: dict) -> str:
        if not inputs:
            return text

        def replacer(match):
            key = match.group(1)
            return str(inputs.get(key, f"{{{{{key}}}}}"))

        pattern = re.compile(r"\{\{(\w+)\}\}")
        output = pattern.sub(replacer, text)
        if isinstance(output, str):
            output = re.sub(r"[\r\n\t]+", " ", output).strip()
        return output

    def _automatic_metadata_filter_func(
        self, dataset_ids: list, query: str, tenant_id: str, user_id: str, metadata_model_config: ModelConfig
    ) -> list[dict[str, Any]] | None:
        # get all metadata field
        metadata_stmt = select(DatasetMetadata).where(DatasetMetadata.dataset_id.in_(dataset_ids))
        metadata_fields = db.session.scalars(metadata_stmt).all()
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
            self._record_usage(usage)

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
        except Exception:
            return None
        return automatic_metadata_filters

    @classmethod
    def process_metadata_filter_func(
        cls, sequence: int, condition: str, metadata_name: str, value: Any | None, filters: list
    ):
        if value is None and condition not in ("empty", "not empty"):
            return filters

        json_field = DatasetDocument.doc_metadata[metadata_name].as_string()

        from libs.helper import escape_like_pattern

        match condition:
            case "contains":
                escaped_value = escape_like_pattern(str(value))
                filters.append(json_field.like(f"%{escaped_value}%", escape="\\"))

            case "not contains":
                escaped_value = escape_like_pattern(str(value))
                filters.append(json_field.notlike(f"%{escaped_value}%", escape="\\"))

            case "start with":
                escaped_value = escape_like_pattern(str(value))
                filters.append(json_field.like(f"{escaped_value}%", escape="\\"))

            case "end with":
                escaped_value = escape_like_pattern(str(value))
                filters.append(json_field.like(f"%{escaped_value}", escape="\\"))

            case "is" | "=":
                if isinstance(value, str):
                    filters.append(json_field == value)
                elif isinstance(value, (int, float)):
                    filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() == value)

            case "is not" | "≠":
                if isinstance(value, str):
                    filters.append(json_field != value)
                elif isinstance(value, (int, float)):
                    filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() != value)

            case "empty":
                filters.append(DatasetDocument.doc_metadata[metadata_name].is_(None))

            case "not empty":
                filters.append(DatasetDocument.doc_metadata[metadata_name].isnot(None))

            case "before" | "<":
                filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() < value)

            case "after" | ">":
                filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() > value)

            case "≤" | "<=":
                filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() <= value)

            case "≥" | ">=":
                filters.append(DatasetDocument.doc_metadata[metadata_name].as_float() >= value)
            case "in" | "not in":
                if isinstance(value, str):
                    value_list = [v.strip() for v in value.split(",") if v.strip()]
                elif isinstance(value, (list, tuple)):
                    value_list = [str(v) for v in value if v is not None]
                else:
                    value_list = [str(value)] if value is not None else []

                if not value_list:
                    # `field in []` is False, `field not in []` is True
                    filters.append(literal(condition == "not in"))
                else:
                    op = json_field.in_ if condition == "in" else json_field.notin_
                    filters.append(op(value_list))
            case _:
                pass

        return filters

    def _fetch_model_config(
        self, tenant_id: str, model: ModelConfig
    ) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
        """
        Fetch model config
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
        model_mode = ModelMode(mode)
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

    def _multiple_retrieve_thread(
        self,
        flask_app: Flask,
        available_datasets: list,
        metadata_condition: MetadataCondition | None,
        metadata_filter_document_ids: dict[str, list[str]] | None,
        all_documents: list[Document],
        tenant_id: str,
        reranking_enable: bool,
        reranking_mode: str,
        reranking_model: dict | None,
        weights: dict[str, Any] | None,
        top_k: int,
        score_threshold: float,
        query: str | None,
        attachment_id: str | None,
        dataset_count: int,
        cancel_event: threading.Event | None = None,
        thread_exceptions: list[Exception] | None = None,
    ):
        try:
            with flask_app.app_context():
                threads = []
                all_documents_item: list[Document] = []
                index_type = None
                for dataset in available_datasets:
                    # Check for cancellation signal
                    if cancel_event and cancel_event.is_set():
                        break
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
                            "flask_app": flask_app,
                            "dataset_id": dataset.id,
                            "query": query,
                            "top_k": top_k,
                            "all_documents": all_documents_item,
                            "document_ids_filter": document_ids_filter,
                            "metadata_condition": metadata_condition,
                            "attachment_ids": [attachment_id] if attachment_id else None,
                        },
                    )
                    threads.append(retrieval_thread)
                    retrieval_thread.start()

                # Poll threads with short timeout to respond quickly to cancellation
                while any(t.is_alive() for t in threads):
                    for thread in threads:
                        thread.join(timeout=0.1)
                        if cancel_event and cancel_event.is_set():
                            break
                    if cancel_event and cancel_event.is_set():
                        break

                # Skip second reranking when there is only one dataset
                if reranking_enable and dataset_count > 1:
                    # do rerank for searched documents
                    data_post_processor = DataPostProcessor(tenant_id, reranking_mode, reranking_model, weights, False)
                    if query:
                        all_documents_item = data_post_processor.invoke(
                            query=query,
                            documents=all_documents_item,
                            score_threshold=score_threshold,
                            top_n=top_k,
                            query_type=QueryType.TEXT_QUERY,
                        )
                    if attachment_id:
                        all_documents_item = data_post_processor.invoke(
                            documents=all_documents_item,
                            score_threshold=score_threshold,
                            top_n=top_k,
                            query_type=QueryType.IMAGE_QUERY,
                            query=attachment_id,
                        )
                else:
                    if index_type == IndexTechniqueType.ECONOMY:
                        if not query:
                            all_documents_item = []
                        else:
                            all_documents_item = self.calculate_keyword_score(query, all_documents_item, top_k)
                    elif index_type == IndexTechniqueType.HIGH_QUALITY:
                        all_documents_item = self.calculate_vector_score(all_documents_item, top_k, score_threshold)
                    else:
                        all_documents_item = all_documents_item[:top_k] if top_k else all_documents_item
                if all_documents_item:
                    all_documents.extend(all_documents_item)
        except Exception as e:
            if cancel_event:
                cancel_event.set()
            if thread_exceptions is not None:
                thread_exceptions.append(e)
