"""Paragraph index processor."""

import json
import logging
import uuid
from collections.abc import Mapping
from typing import Any

from configs import dify_config
from core.db.session_factory import session_factory
from core.entities.knowledge_entities import PreviewDetail
from core.model_manager import ModelInstance
from core.rag.cleaner.clean_processor import CleanProcessor
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.docstore.dataset_docstore import DatasetDocumentStore
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.extractor.extract_processor import ExtractProcessor
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.models.document import AttachmentDocument, ChildDocument, Document, ParentChildStructureChunk
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from libs import helper
from models import Account
from models.dataset import ChildChunk, Dataset, DatasetProcessRule, DocumentSegment
from models.dataset import Document as DatasetDocument
from services.account_service import AccountService
from services.entities.knowledge_entities.knowledge_entities import ParentMode, Rule
from services.summary_index_service import SummaryIndexService

logger = logging.getLogger(__name__)


class ParentChildIndexProcessor(BaseIndexProcessor):
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
        if not process_rule.get("rules"):
            raise ValueError("No rules found in process rule.")
        rules = Rule.model_validate(process_rule.get("rules"))
        all_documents: list[Document] = []
        if rules.parent_mode == ParentMode.PARAGRAPH:
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
            for document in documents:
                if kwargs.get("preview") and len(all_documents) >= 10:
                    return all_documents
                # document clean
                document_text = CleanProcessor.clean(document.page_content, process_rule)
                document.page_content = document_text
                # parse document to nodes
                document_nodes = splitter.split_documents([document])
                split_documents = []
                for document_node in document_nodes:
                    if document_node.page_content.strip():
                        doc_id = str(uuid.uuid4())
                        hash = helper.generate_text_hash(document_node.page_content)
                        document_node.metadata["doc_id"] = doc_id
                        document_node.metadata["doc_hash"] = hash
                        # delete Splitter character
                        page_content = document_node.page_content
                        if page_content.startswith(".") or page_content.startswith("。"):
                            page_content = page_content[1:].strip()
                        else:
                            page_content = page_content
                        if len(page_content) > 0:
                            document_node.page_content = page_content
                            multimodel_documents = self._get_content_files(document_node, current_user)
                            if multimodel_documents:
                                document_node.attachments = multimodel_documents
                            # parse document to child nodes
                            child_nodes = self._split_child_nodes(
                                document_node, rules, process_rule.get("mode"), kwargs.get("embedding_model_instance")
                            )
                            document_node.children = child_nodes
                            split_documents.append(document_node)
                all_documents.extend(split_documents)
        elif rules.parent_mode == ParentMode.FULL_DOC:
            page_content = "\n".join([document.page_content for document in documents])
            document = Document(page_content=page_content, metadata=documents[0].metadata)
            multimodel_documents = self._get_content_files(document)
            if multimodel_documents:
                document.attachments = multimodel_documents
            # parse document to child nodes
            child_nodes = self._split_child_nodes(
                document, rules, process_rule.get("mode"), kwargs.get("embedding_model_instance")
            )
            if kwargs.get("preview"):
                if len(child_nodes) > dify_config.CHILD_CHUNKS_PREVIEW_NUMBER:
                    child_nodes = child_nodes[: dify_config.CHILD_CHUNKS_PREVIEW_NUMBER]

            document.children = child_nodes
            doc_id = str(uuid.uuid4())
            hash = helper.generate_text_hash(document.page_content)
            document.metadata["doc_id"] = doc_id
            document.metadata["doc_hash"] = hash
            all_documents.append(document)

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
            for document in documents:
                child_documents = document.children
                if child_documents:
                    formatted_child_documents = [
                        Document.model_validate(child_document.model_dump()) for child_document in child_documents
                    ]
                    vector.create(formatted_child_documents)
            if multimodal_documents and dataset.is_multimodal:
                vector.create_multimodal(multimodal_documents)

    def clean(self, dataset: Dataset, node_ids: list[str] | None, with_keywords: bool = True, **kwargs):
        # node_ids is segment's node_ids
        # Note: Summary indexes are now disabled (not deleted) when segments are disabled.
        # This method is called for actual deletion scenarios (e.g., when segment is deleted).
        # For disable operations, disable_summaries_for_segments is called directly in the task.
        # Only delete summaries if explicitly requested (e.g., when segment is actually deleted)
        delete_summaries = kwargs.get("delete_summaries", False)
        if delete_summaries:
            if node_ids:
                # Find segments by index_node_id
                with session_factory.create_session() as session:
                    segments = (
                        session.query(DocumentSegment)
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
            delete_child_chunks = kwargs.get("delete_child_chunks") or False
            precomputed_child_node_ids = kwargs.get("precomputed_child_node_ids")
            vector = Vector(dataset)

            if node_ids:
                # Use precomputed child_node_ids if available (to avoid race conditions)
                if precomputed_child_node_ids is not None:
                    child_node_ids = precomputed_child_node_ids
                else:
                    # Fallback to original query (may fail if segments are already deleted)
                    child_node_ids = (
                        db.session.query(ChildChunk.index_node_id)
                        .join(DocumentSegment, ChildChunk.segment_id == DocumentSegment.id)
                        .where(
                            DocumentSegment.dataset_id == dataset.id,
                            DocumentSegment.index_node_id.in_(node_ids),
                            ChildChunk.dataset_id == dataset.id,
                        )
                        .all()
                    )
                    child_node_ids = [child_node_id[0] for child_node_id in child_node_ids if child_node_id[0]]

                # Delete from vector index
                if child_node_ids:
                    vector.delete_by_ids(child_node_ids)

                # Delete from database
                if delete_child_chunks and child_node_ids:
                    db.session.query(ChildChunk).where(
                        ChildChunk.dataset_id == dataset.id, ChildChunk.index_node_id.in_(child_node_ids)
                    ).delete(synchronize_session=False)
                    db.session.commit()
            else:
                vector.delete()

                if delete_child_chunks:
                    # Use existing compound index: (tenant_id, dataset_id, ...)
                    db.session.query(ChildChunk).where(
                        ChildChunk.tenant_id == dataset.tenant_id, ChildChunk.dataset_id == dataset.id
                    ).delete(synchronize_session=False)
                    db.session.commit()

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

    def _split_child_nodes(
        self,
        document_node: Document,
        rules: Rule,
        process_rule_mode: str,
        embedding_model_instance: ModelInstance | None,
    ) -> list[ChildDocument]:
        if not rules.subchunk_segmentation:
            raise ValueError("No subchunk segmentation found in rules.")
        child_splitter = self._get_splitter(
            processing_rule_mode=process_rule_mode,
            max_tokens=rules.subchunk_segmentation.max_tokens,
            chunk_overlap=rules.subchunk_segmentation.chunk_overlap,
            separator=rules.subchunk_segmentation.separator,
            embedding_model_instance=embedding_model_instance,
        )
        # parse document to child nodes
        child_nodes = []
        child_documents = child_splitter.split_documents([document_node])
        for child_document_node in child_documents:
            if child_document_node.page_content.strip():
                doc_id = str(uuid.uuid4())
                hash = helper.generate_text_hash(child_document_node.page_content)
                child_document = ChildDocument(
                    page_content=child_document_node.page_content, metadata=document_node.metadata
                )
                child_document.metadata["doc_id"] = doc_id
                child_document.metadata["doc_hash"] = hash
                child_page_content = child_document.page_content
                if child_page_content.startswith(".") or child_page_content.startswith("。"):
                    child_page_content = child_page_content[1:].strip()
                if len(child_page_content) > 0:
                    child_document.page_content = child_page_content
                    child_nodes.append(child_document)
        return child_nodes

    def index(self, dataset: Dataset, document: DatasetDocument, chunks: Any):
        parent_childs = ParentChildStructureChunk.model_validate(chunks)
        documents = []
        for parent_child in parent_childs.parent_child_chunks:
            metadata = {
                "dataset_id": dataset.id,
                "document_id": document.id,
                "doc_id": str(uuid.uuid4()),
                "doc_hash": helper.generate_text_hash(parent_child.parent_content),
            }
            child_documents = []
            for child in parent_child.child_contents:
                child_metadata = {
                    "dataset_id": dataset.id,
                    "document_id": document.id,
                    "doc_id": str(uuid.uuid4()),
                    "doc_hash": helper.generate_text_hash(child),
                }
                child_documents.append(ChildDocument(page_content=child, metadata=child_metadata))
            doc = Document(page_content=parent_child.parent_content, metadata=metadata, children=child_documents)
            if parent_child.files and len(parent_child.files) > 0:
                attachments = []
                for file in parent_child.files:
                    file_metadata = {
                        "doc_id": file.id,
                        "doc_hash": "",
                        "document_id": document.id,
                        "dataset_id": dataset.id,
                        "doc_type": DocType.IMAGE,
                    }
                    file_document = AttachmentDocument(page_content=file.filename or "", metadata=file_metadata)
                    attachments.append(file_document)
                doc.attachments = attachments
            else:
                account = AccountService.load_user(document.created_by)
                if not account:
                    raise ValueError("Invalid account")
                doc.attachments = self._get_content_files(doc, current_user=account)
            documents.append(doc)
        if documents:
            # update document parent mode
            dataset_process_rule = DatasetProcessRule(
                dataset_id=dataset.id,
                mode="hierarchical",
                rules=json.dumps(
                    {
                        "parent_mode": parent_childs.parent_mode,
                    }
                ),
                created_by=document.created_by,
            )
            db.session.add(dataset_process_rule)
            db.session.flush()
            document.dataset_process_rule_id = dataset_process_rule.id
            db.session.commit()
            # save node to document segment
            doc_store = DatasetDocumentStore(dataset=dataset, user_id=document.created_by, document_id=document.id)
            # add document segments
            doc_store.add_documents(docs=documents, save_child=True)
            if dataset.indexing_technique == "high_quality":
                all_child_documents = []
                all_multimodal_documents = []
                for doc in documents:
                    if doc.children:
                        all_child_documents.extend(doc.children)
                    if doc.attachments:
                        all_multimodal_documents.extend(doc.attachments)
                vector = Vector(dataset)
                if all_child_documents:
                    vector.create(all_child_documents)
                if all_multimodal_documents and dataset.is_multimodal:
                    vector.create_multimodal(all_multimodal_documents)

    def format_preview(self, chunks: Any) -> Mapping[str, Any]:
        parent_childs = ParentChildStructureChunk.model_validate(chunks)
        preview = []
        for parent_child in parent_childs.parent_child_chunks:
            preview.append({"content": parent_child.parent_content, "child_chunks": parent_child.child_contents})
        return {
            "chunk_structure": IndexStructureType.PARENT_CHILD_INDEX,
            "parent_mode": parent_childs.parent_mode,
            "preview": preview,
            "total_segments": len(parent_childs.parent_child_chunks),
        }

    def generate_summary_preview(
        self,
        tenant_id: str,
        preview_texts: list[PreviewDetail],
        summary_index_setting: dict,
        doc_language: str | None = None,
    ) -> list[PreviewDetail]:
        """
        For each parent chunk in preview_texts, concurrently call generate_summary to generate a summary
        and write it to the summary attribute of PreviewDetail.
        In preview mode (indexing-estimate), if any summary generation fails, the method will raise an exception.

        Note: For parent-child structure, we only generate summaries for parent chunks.
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
            """Generate summary for a single preview item (parent chunk)."""
            from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor

            if flask_app:
                # Ensure Flask app context in worker thread
                with flask_app.app_context():
                    summary, _ = ParagraphIndexProcessor.generate_summary(
                        tenant_id=tenant_id,
                        text=preview.content,
                        summary_index_setting=summary_index_setting,
                        document_language=doc_language,
                    )
                    preview.summary = summary
            else:
                # Fallback: try without app context (may fail)
                summary, _ = ParagraphIndexProcessor.generate_summary(
                    tenant_id=tenant_id,
                    text=preview.content,
                    summary_index_setting=summary_index_setting,
                    document_language=doc_language,
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
