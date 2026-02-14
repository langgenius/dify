import concurrent.futures
import datetime
import logging
import time
from collections.abc import Mapping
from typing import Any

from sqlalchemy import delete, func, select

from core.db.session_factory import session_factory
from core.workflow.nodes.knowledge_index.exc import KnowledgeIndexNodeError
from core.workflow.repositories.index_processor_protocol import Preview, PreviewItem, QaPreview
from models.dataset import Dataset, Document, DocumentSegment

from .index_processor_factory import IndexProcessorFactory
from .processor.paragraph_index_processor import ParagraphIndexProcessor

logger = logging.getLogger(__name__)


class IndexProcessor:
    def format_preview(self, chunk_structure: str, chunks: Any) -> Preview:
        index_processor = IndexProcessorFactory(chunk_structure).init_index_processor()
        preview = index_processor.format_preview(chunks)
        data = Preview(
            chunk_structure=preview["chunk_structure"],
            total_segments=preview["total_segments"],
            preview=[],
            parent_mode=None,
            qa_preview=[],
        )
        if "parent_mode" in preview:
            data.parent_mode = preview["parent_mode"]

        for item in preview["preview"]:
            if "content" in item and "child_chunks" in item:
                data.preview.append(
                    PreviewItem(content=item["content"], child_chunks=item["child_chunks"], summary=None)
                )
            elif "question" in item and "answer" in item:
                data.qa_preview.append(QaPreview(question=item["question"], answer=item["answer"]))
            elif "content" in item:
                data.preview.append(PreviewItem(content=item["content"], child_chunks=None, summary=None))
        return data

    def index_and_clean(
        self,
        dataset_id: str,
        document_id: str,
        original_document_id: str,
        chunks: Mapping[str, Any],
        batch: Any,
        summary_index_setting: dict | None = None,
    ):
        with session_factory.create_session() as session:
            document = session.query(Document).filter_by(id=document_id).first()
            if not document:
                raise KnowledgeIndexNodeError(f"Document {document_id} not found.")

            dataset = session.query(Dataset).filter_by(id=dataset_id).first()
            if not dataset:
                raise KnowledgeIndexNodeError(f"Dataset {dataset_id} not found.")

            dataset_name_value = dataset.name
            document_name_value = document.name
            created_at_value = document.created_at
            if summary_index_setting is None:
                summary_index_setting = dataset.summary_index_setting
            index_node_ids = []

            index_processor = IndexProcessorFactory(dataset.chunk_structure).init_index_processor()
            if original_document_id:
                segments = session.scalars(
                    select(DocumentSegment).where(DocumentSegment.document_id == original_document_id)
                ).all()
                if segments:
                    index_node_ids = [segment.index_node_id for segment in segments]

        indexing_start_at = time.perf_counter()
        # delete from vector index
        if index_node_ids:
            index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

        with session_factory.create_session() as session, session.begin():
            if index_node_ids:
                segment_delete_stmt = delete(DocumentSegment).where(DocumentSegment.document_id == original_document_id)
                session.execute(segment_delete_stmt)

        index_processor.index(dataset, document, chunks)
        indexing_end_at = time.perf_counter()

        with session_factory.create_session() as session, session.begin():
            document.indexing_latency = indexing_end_at - indexing_start_at
            document.indexing_status = "completed"
            document.completed_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            document.word_count = (
                session.query(func.sum(DocumentSegment.word_count))
                .where(
                    DocumentSegment.document_id == document_id,
                    DocumentSegment.dataset_id == dataset_id,
                )
                .scalar()
            ) or 0
            # Update need_summary based on dataset's summary_index_setting
            if summary_index_setting and summary_index_setting.get("enable") is True:
                document.need_summary = True
            else:
                document.need_summary = False
            session.add(document)
            # update document segment status
            session.query(DocumentSegment).where(
                DocumentSegment.document_id == document_id,
                DocumentSegment.dataset_id == dataset_id,
            ).update(
                {
                    DocumentSegment.status: "completed",
                    DocumentSegment.enabled: True,
                    DocumentSegment.completed_at: datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                }
            )

        return {
            "dataset_id": dataset_id,
            "dataset_name": dataset_name_value,
            "batch": batch,
            "document_id": document_id,
            "document_name": document_name_value,
            "created_at": created_at_value.timestamp(),
            "display_status": "completed",
        }

    def get_preview_output(
        self, chunks: Any, dataset_id: str, document_id: str, chunk_structure: str, summary_index_setting: dict | None
    ) -> Preview:
        doc_language = None
        with session_factory.create_session() as session:
            if document_id:
                document = session.query(Document).filter_by(id=document_id).first()
            else:
                document = None

            dataset = session.query(Dataset).filter_by(id=dataset_id).first()
            if not dataset:
                raise KnowledgeIndexNodeError(f"Dataset {dataset_id} not found.")

            if summary_index_setting is None:
                summary_index_setting = dataset.summary_index_setting

            if document:
                doc_language = document.doc_language
            indexing_technique = dataset.indexing_technique
            tenant_id = dataset.tenant_id

        preview_output = self.format_preview(chunk_structure, chunks)
        if indexing_technique != "high_quality":
            return preview_output

        if not summary_index_setting or not summary_index_setting.get("enable"):
            return preview_output

        if preview_output.preview is not None:
            chunk_count = len(preview_output.preview)
            logger.info(
                "Generating summaries for %s chunks in preview mode (dataset: %s)",
                chunk_count,
                dataset_id,
            )

            def generate_summary_for_chunk(preview_item: PreviewItem) -> None:
                """Generate summary for a single chunk."""
                if preview_item.content is not None:
                    # Set Flask application context in worker thread
                    summary, _ = ParagraphIndexProcessor.generate_summary(
                        tenant_id=tenant_id,
                        text=preview_item.content,
                        summary_index_setting=summary_index_setting,
                        document_language=doc_language,
                    )
                    if summary:
                        preview_item.summary = summary

                else:
                    summary, _ = ParagraphIndexProcessor.generate_summary(
                        tenant_id=tenant_id,
                        text=preview_item.content if preview_item.content is not None else "",
                        summary_index_setting=summary_index_setting,
                        document_language=doc_language,
                    )
                    if summary:
                        preview_item.summary = summary

            # Generate summaries concurrently using ThreadPoolExecutor
            # Set a reasonable timeout to prevent hanging (60 seconds per chunk, max 5 minutes total)
            timeout_seconds = min(300, 60 * len(preview_output.preview))
            errors: list[Exception] = []

            with concurrent.futures.ThreadPoolExecutor(max_workers=min(10, len(preview_output.preview))) as executor:
                futures = [
                    executor.submit(generate_summary_for_chunk, preview_item) for preview_item in preview_output.preview
                ]
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

            # In preview mode, if there are any errors, fail the request
            if errors:
                error_messages = [str(e) for e in errors]
                error_summary = (
                    f"Failed to generate summaries for {len(errors)} chunk(s). "
                    f"Errors: {'; '.join(error_messages[:3])}"  # Show first 3 errors
                )
                if len(errors) > 3:
                    error_summary += f" (and {len(errors) - 3} more)"
                logger.error("Summary generation failed in preview mode: %s", error_summary)
                raise KnowledgeIndexNodeError(error_summary)

            completed_count = sum(1 for item in preview_output.preview if item.summary is not None)
            logger.info(
                "Completed summary generation for preview chunks: %s/%s succeeded",
                completed_count,
                len(preview_output.preview),
            )
        return preview_output
