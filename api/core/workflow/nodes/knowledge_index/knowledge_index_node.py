import concurrent.futures
import datetime
import logging
import time
from collections.abc import Mapping
from typing import Any

from flask import current_app
from sqlalchemy import func, select

from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import NodeExecutionType, NodeType, SystemVariableKey
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.template import Template
from core.workflow.runtime import VariablePool
from extensions.ext_database import db
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from services.summary_index_service import SummaryIndexService
from tasks.generate_summary_index_task import generate_summary_index_task

from .entities import KnowledgeIndexNodeData
from .exc import (
    KnowledgeIndexNodeError,
)

logger = logging.getLogger(__name__)

default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 2,
    "score_threshold_enabled": False,
}


class KnowledgeIndexNode(Node[KnowledgeIndexNodeData]):
    node_type = NodeType.KNOWLEDGE_INDEX
    execution_type = NodeExecutionType.RESPONSE

    def _run(self) -> NodeRunResult:  # type: ignore
        node_data = self.node_data
        variable_pool = self.graph_runtime_state.variable_pool
        dataset_id = variable_pool.get(["sys", SystemVariableKey.DATASET_ID])
        if not dataset_id:
            raise KnowledgeIndexNodeError("Dataset ID is required.")
        dataset = db.session.query(Dataset).filter_by(id=dataset_id.value).first()
        if not dataset:
            raise KnowledgeIndexNodeError(f"Dataset {dataset_id.value} not found.")

        # extract variables
        variable = variable_pool.get(node_data.index_chunk_variable_selector)
        if not variable:
            raise KnowledgeIndexNodeError("Index chunk variable is required.")
        invoke_from = variable_pool.get(["sys", SystemVariableKey.INVOKE_FROM])
        if invoke_from:
            is_preview = invoke_from.value == InvokeFrom.DEBUGGER
        else:
            is_preview = False
        chunks = variable.value
        variables = {"chunks": chunks}
        if not chunks:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, inputs=variables, error="Chunks is required."
            )

        # index knowledge
        try:
            if is_preview:
                # Preview mode: generate summaries for chunks directly without saving to database
                # Format preview and generate summaries on-the-fly
                # Get indexing_technique and summary_index_setting from node_data (workflow graph config)
                # or fallback to dataset if not available in node_data
                indexing_technique = node_data.indexing_technique or dataset.indexing_technique
                summary_index_setting = node_data.summary_index_setting or dataset.summary_index_setting

                # Try to get document language if document_id is available
                doc_language = None
                document_id = variable_pool.get(["sys", SystemVariableKey.DOCUMENT_ID])
                if document_id:
                    document = db.session.query(Document).filter_by(id=document_id.value).first()
                    if document and document.doc_language:
                        doc_language = document.doc_language

                outputs = self._get_preview_output_with_summaries(
                    node_data.chunk_structure,
                    chunks,
                    dataset=dataset,
                    indexing_technique=indexing_technique,
                    summary_index_setting=summary_index_setting,
                    doc_language=doc_language,
                )
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=variables,
                    outputs=outputs,
                )
            results = self._invoke_knowledge_index(
                dataset=dataset, node_data=node_data, chunks=chunks, variable_pool=variable_pool
            )
            return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, outputs=results)

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

    def _invoke_knowledge_index(
        self,
        dataset: Dataset,
        node_data: KnowledgeIndexNodeData,
        chunks: Mapping[str, Any],
        variable_pool: VariablePool,
    ) -> Any:
        document_id = variable_pool.get(["sys", SystemVariableKey.DOCUMENT_ID])
        if not document_id:
            raise KnowledgeIndexNodeError("Document ID is required.")
        original_document_id = variable_pool.get(["sys", SystemVariableKey.ORIGINAL_DOCUMENT_ID])

        batch = variable_pool.get(["sys", SystemVariableKey.BATCH])
        if not batch:
            raise KnowledgeIndexNodeError("Batch is required.")
        document = db.session.query(Document).filter_by(id=document_id.value).first()
        if not document:
            raise KnowledgeIndexNodeError(f"Document {document_id.value} not found.")
        doc_id_value = document.id
        ds_id_value = dataset.id
        dataset_name_value = dataset.name
        document_name_value = document.name
        created_at_value = document.created_at
        # chunk nodes by chunk size
        indexing_start_at = time.perf_counter()
        index_processor = IndexProcessorFactory(dataset.chunk_structure).init_index_processor()
        if original_document_id:
            segments = db.session.scalars(
                select(DocumentSegment).where(DocumentSegment.document_id == original_document_id.value)
            ).all()
            if segments:
                index_node_ids = [segment.index_node_id for segment in segments]

                # delete from vector index
                index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

                for segment in segments:
                    db.session.delete(segment)
                db.session.commit()
        index_processor.index(dataset, document, chunks)
        indexing_end_at = time.perf_counter()
        document.indexing_latency = indexing_end_at - indexing_start_at
        # update document status
        document.indexing_status = "completed"
        document.completed_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        document.word_count = (
            db.session.query(func.sum(DocumentSegment.word_count))
            .where(
                DocumentSegment.document_id == doc_id_value,
                DocumentSegment.dataset_id == ds_id_value,
            )
            .scalar()
        )
        # Update need_summary based on dataset's summary_index_setting
        if dataset.summary_index_setting and dataset.summary_index_setting.get("enable") is True:
            document.need_summary = True
        else:
            document.need_summary = False
        db.session.add(document)
        # update document segment status
        db.session.query(DocumentSegment).where(
            DocumentSegment.document_id == doc_id_value,
            DocumentSegment.dataset_id == ds_id_value,
        ).update(
            {
                DocumentSegment.status: "completed",
                DocumentSegment.enabled: True,
                DocumentSegment.completed_at: datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
            }
        )

        db.session.commit()

        # Generate summary index if enabled
        self._handle_summary_index_generation(dataset, document, variable_pool)

        return {
            "dataset_id": ds_id_value,
            "dataset_name": dataset_name_value,
            "batch": batch.value,
            "document_id": doc_id_value,
            "document_name": document_name_value,
            "created_at": created_at_value.timestamp(),
            "display_status": "completed",
        }

    def _handle_summary_index_generation(
        self,
        dataset: Dataset,
        document: Document,
        variable_pool: VariablePool,
    ) -> None:
        """
        Handle summary index generation based on mode (debug/preview or production).

        Args:
            dataset: Dataset containing the document
            document: Document to generate summaries for
            variable_pool: Variable pool to check invoke_from
        """
        # Only generate summary index for high_quality indexing technique
        if dataset.indexing_technique != "high_quality":
            return

        # Check if summary index is enabled
        summary_index_setting = dataset.summary_index_setting
        if not summary_index_setting or not summary_index_setting.get("enable"):
            return

        # Skip qa_model documents
        if document.doc_form == "qa_model":
            return

        # Determine if in preview/debug mode
        invoke_from = variable_pool.get(["sys", SystemVariableKey.INVOKE_FROM])
        is_preview = invoke_from and invoke_from.value == InvokeFrom.DEBUGGER

        if is_preview:
            try:
                # Query segments that need summary generation
                query = db.session.query(DocumentSegment).filter_by(
                    dataset_id=dataset.id,
                    document_id=document.id,
                    status="completed",
                    enabled=True,
                )
                segments = query.all()

                if not segments:
                    logger.info("No segments found for document %s", document.id)
                    return

                # Filter segments based on mode
                segments_to_process = []
                for segment in segments:
                    # Skip if summary already exists
                    existing_summary = (
                        db.session.query(DocumentSegmentSummary)
                        .filter_by(chunk_id=segment.id, dataset_id=dataset.id, status="completed")
                        .first()
                    )
                    if existing_summary:
                        continue

                    # For parent-child mode, all segments are parent chunks, so process all
                    segments_to_process.append(segment)

                if not segments_to_process:
                    logger.info("No segments need summary generation for document %s", document.id)
                    return

                # Use ThreadPoolExecutor for concurrent generation
                flask_app = current_app._get_current_object()  # type: ignore
                max_workers = min(10, len(segments_to_process))  # Limit to 10 workers

                def process_segment(segment: DocumentSegment) -> None:
                    """Process a single segment in a thread with Flask app context."""
                    with flask_app.app_context():
                        try:
                            SummaryIndexService.generate_and_vectorize_summary(segment, dataset, summary_index_setting)
                        except Exception:
                            logger.exception(
                                "Failed to generate summary for segment %s",
                                segment.id,
                            )
                            # Continue processing other segments

                with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                    futures = [executor.submit(process_segment, segment) for segment in segments_to_process]
                    # Wait for all tasks to complete
                    concurrent.futures.wait(futures)

                logger.info(
                    "Successfully generated summary index for %s segments in document %s",
                    len(segments_to_process),
                    document.id,
                )
            except Exception:
                logger.exception("Failed to generate summary index for document %s", document.id)
                # Don't fail the entire indexing process if summary generation fails
        else:
            # Production mode: asynchronous generation
            logger.info(
                "Queuing summary index generation task for document %s (production mode)",
                document.id,
            )
            try:
                generate_summary_index_task.delay(dataset.id, document.id, None)
                logger.info("Summary index generation task queued for document %s", document.id)
            except Exception:
                logger.exception(
                    "Failed to queue summary index generation task for document %s",
                    document.id,
                )
                # Don't fail the entire indexing process if task queuing fails

    def _get_preview_output_with_summaries(
        self,
        chunk_structure: str,
        chunks: Any,
        dataset: Dataset,
        indexing_technique: str | None = None,
        summary_index_setting: dict | None = None,
        doc_language: str | None = None,
    ) -> Mapping[str, Any]:
        """
        Generate preview output with summaries for chunks in preview mode.
        This method generates summaries on-the-fly without saving to database.

        Args:
            chunk_structure: Chunk structure type
            chunks: Chunks to generate preview for
            dataset: Dataset object (for tenant_id)
            indexing_technique: Indexing technique from node config or dataset
            summary_index_setting: Summary index setting from node config or dataset
            doc_language: Optional document language to ensure summary is generated in the correct language
        """
        index_processor = IndexProcessorFactory(chunk_structure).init_index_processor()
        preview_output = index_processor.format_preview(chunks)

        # Check if summary index is enabled
        if indexing_technique != "high_quality":
            return preview_output

        if not summary_index_setting or not summary_index_setting.get("enable"):
            return preview_output

        # Generate summaries for chunks
        if "preview" in preview_output and isinstance(preview_output["preview"], list):
            chunk_count = len(preview_output["preview"])
            logger.info(
                "Generating summaries for %s chunks in preview mode (dataset: %s)",
                chunk_count,
                dataset.id,
            )
            # Use ParagraphIndexProcessor's generate_summary method
            from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor

            # Get Flask app for application context in worker threads
            flask_app = None
            try:
                flask_app = current_app._get_current_object()  # type: ignore
            except RuntimeError:
                logger.warning("No Flask application context available, summary generation may fail")

            def generate_summary_for_chunk(preview_item: dict) -> None:
                """Generate summary for a single chunk."""
                if "content" in preview_item:
                    # Set Flask application context in worker thread
                    if flask_app:
                        with flask_app.app_context():
                            summary, _ = ParagraphIndexProcessor.generate_summary(
                                tenant_id=dataset.tenant_id,
                                text=preview_item["content"],
                                summary_index_setting=summary_index_setting,
                                document_language=doc_language,
                            )
                            if summary:
                                preview_item["summary"] = summary
                    else:
                        # Fallback: try without app context (may fail)
                        summary, _ = ParagraphIndexProcessor.generate_summary(
                            tenant_id=dataset.tenant_id,
                            text=preview_item["content"],
                            summary_index_setting=summary_index_setting,
                            document_language=doc_language,
                        )
                        if summary:
                            preview_item["summary"] = summary

            # Generate summaries concurrently using ThreadPoolExecutor
            # Set a reasonable timeout to prevent hanging (60 seconds per chunk, max 5 minutes total)
            timeout_seconds = min(300, 60 * len(preview_output["preview"]))
            errors: list[Exception] = []

            with concurrent.futures.ThreadPoolExecutor(max_workers=min(10, len(preview_output["preview"]))) as executor:
                futures = [
                    executor.submit(generate_summary_for_chunk, preview_item)
                    for preview_item in preview_output["preview"]
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

            completed_count = sum(1 for item in preview_output["preview"] if item.get("summary") is not None)
            logger.info(
                "Completed summary generation for preview chunks: %s/%s succeeded",
                completed_count,
                len(preview_output["preview"]),
            )

        return preview_output

    def _get_preview_output(
        self,
        chunk_structure: str,
        chunks: Any,
        dataset: Dataset | None = None,
        variable_pool: VariablePool | None = None,
    ) -> Mapping[str, Any]:
        index_processor = IndexProcessorFactory(chunk_structure).init_index_processor()
        preview_output = index_processor.format_preview(chunks)

        # If dataset is provided, try to enrich preview with summaries
        if dataset and variable_pool:
            document_id = variable_pool.get(["sys", SystemVariableKey.DOCUMENT_ID])
            if document_id:
                document = db.session.query(Document).filter_by(id=document_id.value).first()
                if document:
                    # Query summaries for this document
                    summaries = (
                        db.session.query(DocumentSegmentSummary)
                        .filter_by(
                            dataset_id=dataset.id,
                            document_id=document.id,
                            status="completed",
                            enabled=True,
                        )
                        .all()
                    )

                    if summaries:
                        # Create a map of segment content to summary for matching
                        # Use content matching as chunks in preview might not be indexed yet
                        summary_by_content = {}
                        for summary in summaries:
                            segment = (
                                db.session.query(DocumentSegment)
                                .filter_by(id=summary.chunk_id, dataset_id=dataset.id)
                                .first()
                            )
                            if segment:
                                # Normalize content for matching (strip whitespace)
                                normalized_content = segment.content.strip()
                                summary_by_content[normalized_content] = summary.summary_content

                        # Enrich preview with summaries by content matching
                        if "preview" in preview_output and isinstance(preview_output["preview"], list):
                            matched_count = 0
                            for preview_item in preview_output["preview"]:
                                if "content" in preview_item:
                                    # Normalize content for matching
                                    normalized_chunk_content = preview_item["content"].strip()
                                    if normalized_chunk_content in summary_by_content:
                                        preview_item["summary"] = summary_by_content[normalized_chunk_content]
                                        matched_count += 1

                            if matched_count > 0:
                                logger.info(
                                    "Enriched preview with %s existing summaries (dataset: %s, document: %s)",
                                    matched_count,
                                    dataset.id,
                                    document.id,
                                )

        return preview_output

    @classmethod
    def version(cls) -> str:
        return "1"

    def get_streaming_template(self) -> Template:
        """
        Get the template for streaming.

        Returns:
            Template instance for this knowledge index node
        """
        return Template(segments=[])
