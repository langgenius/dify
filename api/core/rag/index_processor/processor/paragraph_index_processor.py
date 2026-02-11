"""Paragraph index processor."""

import logging
import re
import uuid
from collections.abc import Mapping
from typing import Any, cast

logger = logging.getLogger(__name__)

from core.entities.knowledge_entities import PreviewDetail
from core.file import File, FileTransferMethod, FileType, file_manager
from core.llm_generator.prompts import DEFAULT_GENERATOR_SUMMARY_PROMPT
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentUnionTypes,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import ModelFeature, ModelType
from core.provider_manager import ProviderManager
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
from core.workflow.nodes.llm import llm_utils
from extensions.ext_database import db
from factories.file_factory import build_from_mapping
from libs import helper
from models import UploadFile
from models.account import Account
from models.dataset import Dataset, DatasetProcessRule, DocumentSegment, SegmentAttachmentBinding
from models.dataset import Document as DatasetDocument
from services.account_service import AccountService
from services.entities.knowledge_entities.knowledge_entities import Rule
from services.summary_index_service import SummaryIndexService


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

    def generate_summary_preview(
        self,
        tenant_id: str,
        preview_texts: list[PreviewDetail],
        summary_index_setting: dict,
        doc_language: str | None = None,
    ) -> list[PreviewDetail]:
        """
        For each segment, concurrently call generate_summary to generate a summary
        and write it to the summary attribute of PreviewDetail.
        In preview mode (indexing-estimate), if any summary generation fails, the method will raise an exception.
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
            if flask_app:
                # Ensure Flask app context in worker thread
                with flask_app.app_context():
                    summary, _ = self.generate_summary(
                        tenant_id, preview.content, summary_index_setting, document_language=doc_language
                    )
                    preview.summary = summary
            else:
                # Fallback: try without app context (may fail)
                summary, _ = self.generate_summary(
                    tenant_id, preview.content, summary_index_setting, document_language=doc_language
                )
                preview.summary = summary

        # Generate summaries concurrently using ThreadPoolExecutor
        # Set a reasonable timeout to prevent hanging (60 seconds per chunk, max 5 minutes total)
        timeout_seconds = min(300, 60 * len(preview_texts))
        errors: list[Exception] = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(10, len(preview_texts))) as executor:
            futures = [executor.submit(process, preview) for preview in preview_texts]
            # Wait for all tasks to complete with timeout
            done, not_done = concurrent.futures.wait(futures, timeout=timeout_seconds)

            # Cancel tasks that didn't complete in time
            if not_done:
                timeout_error_msg = (
                    f"Summary generation timeout: {len(not_done)} chunks did not complete within {timeout_seconds}s"
                )
                logger.warning("%s. Cancelling remaining tasks...", timeout_error_msg)
                # In preview mode, timeout is also an error
                errors.append(TimeoutError(timeout_error_msg))
                for future in not_done:
                    future.cancel()
                # Wait a bit for cancellation to take effect
                concurrent.futures.wait(not_done, timeout=5)

            # Collect exceptions from completed futures
            for future in done:
                try:
                    future.result()  # This will raise any exception that occurred
                except Exception as e:
                    logger.exception("Error in summary generation future")
                    errors.append(e)

        # In preview mode (indexing-estimate), if there are any errors, fail the request
        if errors:
            error_messages = [str(e) for e in errors]
            error_summary = (
                f"Failed to generate summaries for {len(errors)} chunk(s). "
                f"Errors: {'; '.join(error_messages[:3])}"  # Show first 3 errors
            )
            if len(errors) > 3:
                error_summary += f" (and {len(errors) - 3} more)"
            logger.error("Summary generation failed in preview mode: %s", error_summary)
            raise ValueError(error_summary)

        return preview_texts

    @staticmethod
    def generate_summary(
        tenant_id: str,
        text: str,
        summary_index_setting: dict | None = None,
        segment_id: str | None = None,
        document_language: str | None = None,
    ) -> tuple[str, LLMUsage]:
        """
        Generate summary for the given text using ModelInstance.invoke_llm and the default or custom summary prompt,
        and supports vision models by including images from the segment attachments or text content.

        Args:
            tenant_id: Tenant ID
            text: Text content to summarize
            summary_index_setting: Summary index configuration
            segment_id: Optional segment ID to fetch attachments from SegmentAttachmentBinding table
            document_language: Optional document language (e.g., "Chinese", "English")
                to ensure summary is generated in the correct language

        Returns:
            Tuple of (summary_content, llm_usage) where llm_usage is LLMUsage object
        """
        if not summary_index_setting or not summary_index_setting.get("enable"):
            raise ValueError("summary_index_setting is required and must be enabled to generate summary.")

        model_name = summary_index_setting.get("model_name")
        model_provider_name = summary_index_setting.get("model_provider_name")
        summary_prompt = summary_index_setting.get("summary_prompt")

        if not model_name or not model_provider_name:
            raise ValueError("model_name and model_provider_name are required in summary_index_setting")

        # Import default summary prompt
        is_default_prompt = False
        if not summary_prompt:
            summary_prompt = DEFAULT_GENERATOR_SUMMARY_PROMPT
            is_default_prompt = True

        # Format prompt with document language only for default prompt
        # Custom prompts are used as-is to avoid interfering with user-defined templates
        # If document_language is provided, use it; otherwise, use "the same language as the input content"
        # This is especially important for image-only chunks where text is empty or minimal
        if is_default_prompt:
            language_for_prompt = document_language or "the same language as the input content"
            try:
                summary_prompt = summary_prompt.format(language=language_for_prompt)
            except KeyError:
                # If default prompt doesn't have {language} placeholder, use it as-is
                pass

        provider_manager = ProviderManager()
        provider_model_bundle = provider_manager.get_provider_model_bundle(
            tenant_id, model_provider_name, ModelType.LLM
        )
        model_instance = ModelInstance(provider_model_bundle, model_name)

        # Get model schema to check if vision is supported
        model_schema = model_instance.model_type_instance.get_model_schema(model_name, model_instance.credentials)
        supports_vision = model_schema and model_schema.features and ModelFeature.VISION in model_schema.features

        # Extract images if model supports vision
        image_files = []
        if supports_vision:
            # First, try to get images from SegmentAttachmentBinding (preferred method)
            if segment_id:
                image_files = ParagraphIndexProcessor._extract_images_from_segment_attachments(tenant_id, segment_id)

            # If no images from attachments, fall back to extracting from text
            if not image_files:
                image_files = ParagraphIndexProcessor._extract_images_from_text(tenant_id, text)

        # Build prompt messages
        prompt_messages = []

        if image_files:
            # If we have images, create a UserPromptMessage with both text and images
            prompt_message_contents: list[PromptMessageContentUnionTypes] = []

            # Add images first
            for file in image_files:
                try:
                    file_content = file_manager.to_prompt_message_content(
                        file, image_detail_config=ImagePromptMessageContent.DETAIL.LOW
                    )
                    prompt_message_contents.append(file_content)
                except Exception as e:
                    logger.warning("Failed to convert image file to prompt message content: %s", str(e))
                    continue

            # Add text content
            if prompt_message_contents:  # Only add text if we successfully added images
                prompt_message_contents.append(TextPromptMessageContent(data=f"{summary_prompt}\n{text}"))
                prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
            else:
                # If image conversion failed, fall back to text-only
                prompt = f"{summary_prompt}\n{text}"
                prompt_messages.append(UserPromptMessage(content=prompt))
        else:
            # No images, use simple text prompt
            prompt = f"{summary_prompt}\n{text}"
            prompt_messages.append(UserPromptMessage(content=prompt))

        result = model_instance.invoke_llm(
            prompt_messages=cast(list[PromptMessage], prompt_messages), model_parameters={}, stream=False
        )

        # Type assertion: when stream=False, invoke_llm returns LLMResult, not Generator
        if not isinstance(result, LLMResult):
            raise ValueError("Expected LLMResult when stream=False")

        summary_content = getattr(result.message, "content", "")
        usage = result.usage

        # Deduct quota for summary generation (same as workflow nodes)
        try:
            llm_utils.deduct_llm_quota(tenant_id=tenant_id, model_instance=model_instance, usage=usage)
        except Exception as e:
            # Log but don't fail summary generation if quota deduction fails
            logger.warning("Failed to deduct quota for summary generation: %s", str(e))

        return summary_content, usage

    @staticmethod
    def _extract_images_from_text(tenant_id: str, text: str) -> list[File]:
        """
        Extract images from markdown text and convert them to File objects.

        Args:
            tenant_id: Tenant ID
            text: Text content that may contain markdown image links

        Returns:
            List of File objects representing images found in the text
        """
        # Extract markdown images using regex pattern
        pattern = r"!\[.*?\]\((.*?)\)"
        images = re.findall(pattern, text)

        if not images:
            return []

        upload_file_id_list = []

        for image in images:
            # For data before v0.10.0
            pattern = r"/files/([a-f0-9\-]+)/image-preview(?:\?.*?)?"
            match = re.search(pattern, image)
            if match:
                upload_file_id = match.group(1)
                upload_file_id_list.append(upload_file_id)
                continue

            # For data after v0.10.0
            pattern = r"/files/([a-f0-9\-]+)/file-preview(?:\?.*?)?"
            match = re.search(pattern, image)
            if match:
                upload_file_id = match.group(1)
                upload_file_id_list.append(upload_file_id)
                continue

            # For tools directory - direct file formats (e.g., .png, .jpg, etc.)
            pattern = r"/files/tools/([a-f0-9\-]+)\.([a-zA-Z0-9]+)(?:\?[^\s\)\"\']*)?"
            match = re.search(pattern, image)
            if match:
                # Tool files are handled differently, skip for now
                continue

        if not upload_file_id_list:
            return []

        # Get unique IDs for database query
        unique_upload_file_ids = list(set(upload_file_id_list))
        upload_files = (
            db.session.query(UploadFile)
            .where(UploadFile.id.in_(unique_upload_file_ids), UploadFile.tenant_id == tenant_id)
            .all()
        )

        # Create File objects from UploadFile records
        file_objects = []
        for upload_file in upload_files:
            # Only process image files
            if not upload_file.mime_type or "image" not in upload_file.mime_type:
                continue

            mapping = {
                "upload_file_id": upload_file.id,
                "transfer_method": FileTransferMethod.LOCAL_FILE.value,
                "type": FileType.IMAGE.value,
            }

            try:
                file_obj = build_from_mapping(
                    mapping=mapping,
                    tenant_id=tenant_id,
                )
                file_objects.append(file_obj)
            except Exception as e:
                logger.warning("Failed to create File object from UploadFile %s: %s", upload_file.id, str(e))
                continue

        return file_objects

    @staticmethod
    def _extract_images_from_segment_attachments(tenant_id: str, segment_id: str) -> list[File]:
        """
        Extract images from SegmentAttachmentBinding table (preferred method).
        This matches how DatasetRetrieval gets segment attachments.

        Args:
            tenant_id: Tenant ID
            segment_id: Segment ID to fetch attachments for

        Returns:
            List of File objects representing images found in segment attachments
        """
        from sqlalchemy import select

        # Query attachments from SegmentAttachmentBinding table
        attachments_with_bindings = db.session.execute(
            select(SegmentAttachmentBinding, UploadFile)
            .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
            .where(
                SegmentAttachmentBinding.segment_id == segment_id,
                SegmentAttachmentBinding.tenant_id == tenant_id,
            )
        ).all()

        if not attachments_with_bindings:
            return []

        file_objects = []
        for _, upload_file in attachments_with_bindings:
            # Only process image files
            if not upload_file.mime_type or "image" not in upload_file.mime_type:
                continue

            try:
                # Create File object directly (similar to DatasetRetrieval)
                file_obj = File(
                    id=upload_file.id,
                    filename=upload_file.name,
                    extension="." + upload_file.extension,
                    mime_type=upload_file.mime_type,
                    tenant_id=tenant_id,
                    type=FileType.IMAGE,
                    transfer_method=FileTransferMethod.LOCAL_FILE,
                    remote_url=upload_file.source_url,
                    related_id=upload_file.id,
                    size=upload_file.size,
                    storage_key=upload_file.key,
                )
                file_objects.append(file_obj)
            except Exception as e:
                logger.warning("Failed to create File object from UploadFile %s: %s", upload_file.id, str(e))
                continue

        return file_objects
