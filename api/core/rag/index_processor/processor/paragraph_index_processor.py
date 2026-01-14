"""Paragraph index processor."""

import logging
import uuid
from collections.abc import Mapping
from typing import Any

logger = logging.getLogger(__name__)

from core.entities.knowledge_entities import PreviewDetail
from core.rag.cleaner.clean_processor import CleanProcessor
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.docstore.dataset_docstore import DatasetDocumentStore
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.extractor.extract_processor import ExtractProcessor
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.models.document import AttachmentDocument, Document, MultimodalGeneralStructureChunk
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.tools.utils.text_processing_utils import remove_leading_symbols
from extensions.ext_database import db
from libs import helper
from models.account import Account
from models.dataset import Dataset, DatasetProcessRule, DocumentSegment
from models.dataset import Document as DatasetDocument
from services.account_service import AccountService
from services.entities.knowledge_entities.knowledge_entities import Rule
from services.summary_index_service import SummaryIndexService
from core.llm_generator.prompts import DEFAULT_GENERATOR_SUMMARY_PROMPT
from core.model_runtime.entities.message_entities import UserPromptMessage
from core.model_runtime.entities.model_entities import ModelType
from core.provider_manager import ProviderManager
from core.model_manager import ModelInstance


class ParagraphIndexProcessor(BaseIndexProcessor):
    def extract(self, extract_setting: ExtractSetting, **kwargs) -> list[Document]:
        text_docs = ExtractProcessor.extract(
            extract_setting=extract_setting,
            is_automatic=(
                kwargs.get("process_rule_mode") == "automatic" or kwargs.get("process_rule_mode") == "hierarchical"
            ),
        )

        return text_docs

    def transform(self, documents: list[Document], current_user: Account | None = None, **kwargs) -> list[Document]:
        process_rule = kwargs.get("process_rule")
        if not process_rule:
            raise ValueError("No process rule found.")
        if process_rule.get("mode") == "automatic":
            automatic_rule = DatasetProcessRule.AUTOMATIC_RULES
            rules = Rule.model_validate(automatic_rule)
        else:
            if not process_rule.get("rules"):
                raise ValueError("No rules found in process rule.")
            rules = Rule.model_validate(process_rule.get("rules"))
        # Split the text documents into nodes.
        if not rules.segmentation:
            raise ValueError("No segmentation found in rules.")
        splitter = self._get_splitter(
            processing_rule_mode=process_rule.get("mode"),
            max_tokens=rules.segmentation.max_tokens,
            chunk_overlap=rules.segmentation.chunk_overlap,
            separator=rules.segmentation.separator,
            embedding_model_instance=kwargs.get("embedding_model_instance"),
        )
        all_documents = []
        for document in documents:
            # document clean
            document_text = CleanProcessor.clean(document.page_content, kwargs.get("process_rule", {}))
            document.page_content = document_text
            # parse document to nodes
            document_nodes = splitter.split_documents([document])
            split_documents = []
            for document_node in document_nodes:
                if document_node.page_content.strip():
                    doc_id = str(uuid.uuid4())
                    hash = helper.generate_text_hash(document_node.page_content)
                    if document_node.metadata is not None:
                        document_node.metadata["doc_id"] = doc_id
                        document_node.metadata["doc_hash"] = hash
                    multimodal_documents = (
                        self._get_content_files(document_node, current_user) if document_node.metadata else None
                    )
                    if multimodal_documents:
                        document_node.attachments = multimodal_documents
                    # delete Splitter character
                    page_content = remove_leading_symbols(document_node.page_content).strip()
                    if len(page_content) > 0:
                        document_node.page_content = page_content
                        split_documents.append(document_node)
            all_documents.extend(split_documents)
        return all_documents

    def load(
        self,
        dataset: Dataset,
        documents: list[Document],
        multimodal_documents: list[AttachmentDocument] | None = None,
        with_keywords: bool = True,
        **kwargs,
    ):
        if dataset.indexing_technique == "high_quality":
            vector = Vector(dataset)
            vector.create(documents)
            if multimodal_documents and dataset.is_multimodal:
                vector.create_multimodal(multimodal_documents)
            with_keywords = False
        if with_keywords:
            keywords_list = kwargs.get("keywords_list")
            keyword = Keyword(dataset)
            if keywords_list and len(keywords_list) > 0:
                keyword.add_texts(documents, keywords_list=keywords_list)
            else:
                keyword.add_texts(documents)

    def clean(self, dataset: Dataset, node_ids: list[str] | None, with_keywords: bool = True, **kwargs):
        # Note: Summary indexes are now disabled (not deleted) when segments are disabled.
        # This method is called for actual deletion scenarios (e.g., when segment is deleted).
        # For disable operations, disable_summaries_for_segments is called directly in the task.
        # Only delete summaries if explicitly requested (e.g., when segment is actually deleted)
        delete_summaries = kwargs.get("delete_summaries", False)
        if delete_summaries:
            if node_ids:
                # Find segments by index_node_id
                segments = (
                    db.session.query(DocumentSegment)
                    .filter(
                        DocumentSegment.dataset_id == dataset.id,
                        DocumentSegment.index_node_id.in_(node_ids),
                    )
                    .all()
                )
                segment_ids = [segment.id for segment in segments]
                if segment_ids:
                    SummaryIndexService.delete_summaries_for_segments(dataset, segment_ids)
            else:
                # Delete all summaries for the dataset
                SummaryIndexService.delete_summaries_for_segments(dataset, None)

        if dataset.indexing_technique == "high_quality":
            vector = Vector(dataset)
            if node_ids:
                vector.delete_by_ids(node_ids)
            else:
                vector.delete()
            with_keywords = False
        if with_keywords:
            keyword = Keyword(dataset)
            if node_ids:
                keyword.delete_by_ids(node_ids)
            else:
                keyword.delete()

    def retrieve(
        self,
        retrieval_method: RetrievalMethod,
        query: str,
        dataset: Dataset,
        top_k: int,
        score_threshold: float,
        reranking_model: dict,
    ) -> list[Document]:
        # Set search parameters.
        results = RetrievalService.retrieve(
            retrieval_method=retrieval_method,
            dataset_id=dataset.id,
            query=query,
            top_k=top_k,
            score_threshold=score_threshold,
            reranking_model=reranking_model,
        )
        # Organize results.
        docs = []
        for result in results:
            metadata = result.metadata
            metadata["score"] = result.score
            if result.score >= score_threshold:
                doc = Document(page_content=result.page_content, metadata=metadata)
                docs.append(doc)
        return docs

    def index(self, dataset: Dataset, document: DatasetDocument, chunks: Any):
        documents: list[Any] = []
        all_multimodal_documents: list[Any] = []
        if isinstance(chunks, list):
            for content in chunks:
                metadata = {
                    "dataset_id": dataset.id,
                    "document_id": document.id,
                    "doc_id": str(uuid.uuid4()),
                    "doc_hash": helper.generate_text_hash(content),
                }
                doc = Document(page_content=content, metadata=metadata)
                attachments = self._get_content_files(doc)
                if attachments:
                    doc.attachments = attachments
                    all_multimodal_documents.extend(attachments)
                documents.append(doc)
        else:
            multimodal_general_structure = MultimodalGeneralStructureChunk.model_validate(chunks)
            for general_chunk in multimodal_general_structure.general_chunks:
                metadata = {
                    "dataset_id": dataset.id,
                    "document_id": document.id,
                    "doc_id": str(uuid.uuid4()),
                    "doc_hash": helper.generate_text_hash(general_chunk.content),
                }
                doc = Document(page_content=general_chunk.content, metadata=metadata)
                if general_chunk.files:
                    attachments = []
                    for file in general_chunk.files:
                        file_metadata = {
                            "doc_id": file.id,
                            "doc_hash": "",
                            "document_id": document.id,
                            "dataset_id": dataset.id,
                            "doc_type": DocType.IMAGE,
                        }
                        file_document = AttachmentDocument(
                            page_content=file.filename or "image_file", metadata=file_metadata
                        )
                        attachments.append(file_document)
                        all_multimodal_documents.append(file_document)
                    doc.attachments = attachments
                else:
                    account = AccountService.load_user(document.created_by)
                    if not account:
                        raise ValueError("Invalid account")
                    doc.attachments = self._get_content_files(doc, current_user=account)
                    if doc.attachments:
                        all_multimodal_documents.extend(doc.attachments)
                documents.append(doc)
        if documents:
            # save node to document segment
            doc_store = DatasetDocumentStore(dataset=dataset, user_id=document.created_by, document_id=document.id)
            # add document segments
            doc_store.add_documents(docs=documents, save_child=False)
            if dataset.indexing_technique == "high_quality":
                vector = Vector(dataset)
                vector.create(documents)
                if all_multimodal_documents and dataset.is_multimodal:
                    vector.create_multimodal(all_multimodal_documents)
            elif dataset.indexing_technique == "economy":
                keyword = Keyword(dataset)
                keyword.add_texts(documents)

    def format_preview(self, chunks: Any) -> Mapping[str, Any]:
        if isinstance(chunks, list):
            preview = []
            for content in chunks:
                preview.append({"content": content})
            return {
                "chunk_structure": IndexStructureType.PARAGRAPH_INDEX,
                "preview": preview,
                "total_segments": len(chunks),
            }
        else:
            raise ValueError("Chunks is not a list")

    def generate_summary_preview(self, tenant_id: str, preview_texts: list[PreviewDetail], summary_index_setting: dict) -> list[PreviewDetail]:
        """
        For each segment, concurrently call generate_summary to generate a summary
        and write it to the summary attribute of PreviewDetail.
        """
        import concurrent.futures
        from flask import current_app

        # Capture Flask app context for worker threads
        flask_app = None
        try:
            flask_app = current_app._get_current_object()  # type: ignore
        except RuntimeError:
            logger.warning("No Flask application context available, summary generation may fail")

        def process(preview: PreviewDetail) -> None:
            """Generate summary for a single preview item."""
            try:
                if flask_app:
                    # Ensure Flask app context in worker thread
                    with flask_app.app_context():
                        summary = self.generate_summary(tenant_id, preview.content, summary_index_setting)
                        preview.summary = summary
                else:
                    # Fallback: try without app context (may fail)
                    summary = self.generate_summary(tenant_id, preview.content, summary_index_setting)
                    preview.summary = summary
            except Exception as e:
                logger.error(f"Failed to generate summary for preview: {str(e)}")
                # Don't fail the entire preview if summary generation fails
                preview.summary = None

        with concurrent.futures.ThreadPoolExecutor() as executor:
            list(executor.map(process, preview_texts))
        return preview_texts

    @staticmethod
    def generate_summary(tenant_id: str, text: str, summary_index_setting: dict = None) -> str:
        """
        Generate summary for the given text using ModelInstance.invoke_llm and the default or custom summary prompt.
        """
        if not summary_index_setting or not summary_index_setting.get("enable"):
            raise ValueError("summary_index_setting is required and must be enabled to generate summary.")

        model_name = summary_index_setting.get("model_name")
        model_provider_name = summary_index_setting.get("model_provider_name")
        summary_prompt = summary_index_setting.get("summary_prompt")

        # Import default summary prompt
        if not summary_prompt:
            summary_prompt = DEFAULT_GENERATOR_SUMMARY_PROMPT

        prompt = f"{summary_prompt}\n{text}"

        provider_manager = ProviderManager()
        provider_model_bundle = provider_manager.get_provider_model_bundle(tenant_id, model_provider_name, ModelType.LLM)
        model_instance = ModelInstance(provider_model_bundle, model_name)
        prompt_messages = [UserPromptMessage(content=prompt)]

        result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters={},
            stream=False
        )

        return getattr(result.message, "content", "")
