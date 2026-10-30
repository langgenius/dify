"""Question-and-answer index processor."""

import logging
import re
import threading
import uuid
from collections.abc import Callable, Mapping
from typing import Any, TypedDict, override

from flask import Flask, current_app
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.entities.knowledge_entities import PreviewDetail
from core.llm_generator.llm_generator import LLMGenerator
from core.model_manager import ModelInstance
from core.rag.cleaner.clean_processor import CleanProcessor
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.docstore.dataset_docstore import DatasetDocumentStore
from core.rag.embedding.token_counter import calculate_segment_token_counts
from core.rag.entities import Rule
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.index_processor_base import BaseIndexProcessor, SummaryIndexSettingDict
from core.rag.models.document import AttachmentDocument, Document, QAStructureChunk
from core.tools.utils.text_processing_utils import remove_leading_symbols
from libs import helper
from models.account import Account
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument
from services.knowledge.summaries.adapters import SummaryIndexAdapter

logger = logging.getLogger(__name__)


class QAFormatPreviewDict(TypedDict):
    chunk_structure: str
    qa_preview: list[dict[str, Any]]
    total_segments: int


class QAIndexProcessor(BaseIndexProcessor):
    @override
    def transform(
        self,
        documents: list[Document],
        current_user: Account | None = None,
        *,
        process_rule: Mapping[str, object],
        tenant_id: str,
        on_upload_file_created: Callable[[str], None],
        session: Session,
        embedding_model_instance: ModelInstance | None = None,
        doc_language: str = "English",
        preview: bool = False,
    ) -> list[Document]:
        if not process_rule:
            raise ValueError("No process rule found.")
        mode = process_rule.get("mode")
        if not isinstance(mode, str):
            raise ValueError("Invalid process rule mode.")
        if not process_rule.get("rules"):
            raise ValueError("No rules found in process rule.")
        rules = Rule.model_validate(process_rule.get("rules"))
        splitter = self._get_splitter(
            processing_rule_mode=mode,
            max_tokens=rules.segmentation.max_tokens if rules.segmentation else 0,
            chunk_overlap=rules.segmentation.chunk_overlap if rules.segmentation else 0,
            separator=rules.segmentation.separator if rules.segmentation else "",
            embedding_model_instance=embedding_model_instance,
        )

        # Split the text documents into nodes.
        all_documents: list[Document] = []
        all_qa_documents: list[Document] = []
        for document in documents:
            # document clean
            document_text = CleanProcessor.clean(document.page_content, dict(process_rule))
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
                    # delete Splitter character
                    page_content = document_node.page_content
                    document_node.page_content = remove_leading_symbols(page_content)
                    split_documents.append(document_node)
            all_documents.extend(split_documents)
        if preview:
            self._format_qa_document(
                current_app._get_current_object(),  # type: ignore
                tenant_id,
                all_documents[0],
                all_qa_documents,
                doc_language,
            )
        else:
            for i in range(0, len(all_documents), 10):
                threads = []
                sub_documents = all_documents[i : i + 10]
                for doc in sub_documents:
                    document_format_thread = threading.Thread(
                        target=self._format_qa_document,
                        kwargs={
                            "flask_app": current_app._get_current_object(),  # type: ignore
                            "tenant_id": tenant_id,
                            "document_node": doc,
                            "all_qa_documents": all_qa_documents,
                            "document_language": doc_language,
                        },
                    )
                    threads.append(document_format_thread)
                    document_format_thread.start()
                for thread in threads:
                    thread.join()
        return all_qa_documents

    @override
    def load(
        self,
        dataset: Dataset,
        documents: list[Document],
        multimodal_documents: list[AttachmentDocument] | None = None,
        with_keywords: bool = True,
        *,
        session: Session,
    ) -> None:
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            vector = Vector(dataset, session=session)
            vector.create(documents)
            if multimodal_documents and dataset.is_multimodal:
                vector.create_multimodal(multimodal_documents)

    @override
    def clean(
        self,
        dataset: Dataset,
        node_ids: list[str] | None,
        with_keywords: bool = True,
        *,
        session: Session,
        delete_summaries: bool = False,
        delete_child_chunks: bool = False,
        precomputed_child_node_ids: list[str] | None = None,
    ) -> None:
        # Note: Summary indexes are now disabled (not deleted) when segments are disabled.
        # This method is called for actual deletion scenarios (e.g., when segment is deleted).
        # For disable operations, disable_summaries_for_segments is called directly in the task.
        # Note: qa_model doesn't generate summaries, but we clean them for completeness
        # Only delete summaries if explicitly requested (e.g., when segment is actually deleted)
        if delete_summaries:
            if node_ids:
                # Find segments by index_node_id
                segments = session.scalars(
                    select(DocumentSegment).where(
                        DocumentSegment.dataset_id == dataset.id,
                        DocumentSegment.index_node_id.in_(node_ids),
                    )
                ).all()
                segment_ids = [segment.id for segment in segments]
                if segment_ids:
                    SummaryIndexAdapter.delete_summaries_for_segments(dataset, segment_ids, session=session)
            else:
                # Delete all summaries for the dataset
                SummaryIndexAdapter.delete_summaries_for_segments(dataset, None, session=session)

        vector = Vector(dataset, session=session)
        if node_ids:
            vector.delete_by_ids(node_ids)
        else:
            vector.delete()

    @override
    def index(self, dataset: Dataset, document: DatasetDocument, chunks: Any, session: Session) -> None:
        qa_chunks = QAStructureChunk.model_validate(chunks)
        documents = []
        for qa_chunk in qa_chunks.qa_chunks:
            metadata = {
                "dataset_id": dataset.id,
                "document_id": document.id,
                "doc_id": str(uuid.uuid4()),
                "doc_hash": helper.generate_text_hash(qa_chunk.question),
                "answer": qa_chunk.answer,
            }
            doc = Document(page_content=qa_chunk.question, metadata=metadata)
            documents.append(doc)
        if documents:
            token_counts = calculate_segment_token_counts(dataset=dataset, documents=documents)
            # save node to document segment
            doc_store = DatasetDocumentStore(dataset=dataset, user_id=document.created_by, document_id=document.id)
            doc_store.add_documents(
                session=session,
                docs=documents,
                token_counts=token_counts,
                save_child=False,
            )
            session.commit()
            if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
                vector = Vector(dataset, session=session)
                vector.create(documents)
            else:
                raise ValueError("Indexing technique must be high quality.")

    @override
    def format_preview(self, chunks: Any) -> QAFormatPreviewDict:
        qa_chunks = QAStructureChunk.model_validate(chunks)
        preview = []
        for qa_chunk in qa_chunks.qa_chunks:
            preview.append({"question": qa_chunk.question, "answer": qa_chunk.answer})
        result: QAFormatPreviewDict = {
            "chunk_structure": IndexStructureType.QA_INDEX,
            "qa_preview": preview,
            "total_segments": len(qa_chunks.qa_chunks),
        }
        return result

    @override
    def generate_summary_preview(
        self,
        tenant_id: str,
        preview_texts: list[PreviewDetail],
        summary_index_setting: SummaryIndexSettingDict,
        doc_language: str | None = None,
        *,
        session: Session,
    ) -> list[PreviewDetail]:
        """
        QA model doesn't generate summaries, so this method returns preview_texts unchanged.

        Note: QA model uses question-answer pairs, which don't require summary generation.
        """
        # QA model doesn't generate summaries, return as-is
        return preview_texts

    def _format_qa_document(self, flask_app: Flask, tenant_id: str, document_node, all_qa_documents, document_language):
        format_documents = []
        if document_node.page_content is None or not document_node.page_content.strip():
            return
        with flask_app.app_context():
            try:
                # qa model document
                response = LLMGenerator.generate_qa_document(tenant_id, document_node.page_content, document_language)
                document_qa_list = self._format_split_text(response)
                qa_documents = []
                for result in document_qa_list:
                    qa_document = Document(page_content=result["question"], metadata=document_node.metadata.copy())
                    if qa_document.metadata is not None:
                        doc_id = str(uuid.uuid4())
                        hash = helper.generate_text_hash(result["question"])
                        qa_document.metadata["answer"] = result["answer"]
                        qa_document.metadata["doc_id"] = doc_id
                        qa_document.metadata["doc_hash"] = hash
                    qa_documents.append(qa_document)
                format_documents.extend(qa_documents)
            except Exception:
                logger.exception("Failed to format qa document")

            all_qa_documents.extend(format_documents)

    def _format_split_text(self, text):
        regex = r"Q\d+:\s*(.*?)\s*A\d+:\s*([\s\S]*?)(?=Q\d+:|$)"
        matches = re.findall(regex, text, re.UNICODE)

        return [{"question": q, "answer": re.sub(r"\n\s*", "\n", a.strip())} for q, a in matches if q and a]
