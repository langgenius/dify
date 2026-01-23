"""Summary index service for generating and managing document segment summaries."""

import logging
import time
import uuid

from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.models.document import Document
from extensions.ext_database import db
from libs import helper
from models.dataset import Dataset, DocumentSegment, DocumentSegmentSummary
from models.dataset import Document as DatasetDocument

logger = logging.getLogger(__name__)


class SummaryIndexService:
    """Service for generating and managing summary indexes."""

    @staticmethod
    def generate_summary_for_segment(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_index_setting: dict,
    ) -> str:
        """
        Generate summary for a single segment.

        Args:
            segment: DocumentSegment to generate summary for
            dataset: Dataset containing the segment
            summary_index_setting: Summary index configuration

        Returns:
            Generated summary text

        Raises:
            ValueError: If summary_index_setting is invalid or generation fails
        """
        # Reuse the existing generate_summary method from ParagraphIndexProcessor
        # Use lazy import to avoid circular import
        from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor

        summary_content = ParagraphIndexProcessor.generate_summary(
            tenant_id=dataset.tenant_id,
            text=segment.content,
            summary_index_setting=summary_index_setting,
            segment_id=segment.id,
        )

        if not summary_content:
            raise ValueError("Generated summary is empty")

        return summary_content

    @staticmethod
    def create_summary_record(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_content: str,
        status: str = "generating",
    ) -> DocumentSegmentSummary:
        """
        Create or update a DocumentSegmentSummary record.
        If a summary record already exists for this segment, it will be updated instead of creating a new one.

        Args:
            segment: DocumentSegment to create summary for
            dataset: Dataset containing the segment
            summary_content: Generated summary content
            status: Summary status (default: "generating")

        Returns:
            Created or updated DocumentSegmentSummary instance
        """
        # Check if summary record already exists
        existing_summary = (
            db.session.query(DocumentSegmentSummary).filter_by(chunk_id=segment.id, dataset_id=dataset.id).first()
        )

        if existing_summary:
            # Update existing record
            existing_summary.summary_content = summary_content
            existing_summary.status = status
            existing_summary.error = None  # Clear any previous errors
            # Re-enable if it was disabled
            if not existing_summary.enabled:
                existing_summary.enabled = True
                existing_summary.disabled_at = None
                existing_summary.disabled_by = None
            db.session.add(existing_summary)
            db.session.flush()
            return existing_summary
        else:
            # Create new record (enabled by default)
            summary_record = DocumentSegmentSummary(
                dataset_id=dataset.id,
                document_id=segment.document_id,
                chunk_id=segment.id,
                summary_content=summary_content,
                status=status,
                enabled=True,  # Explicitly set enabled to True
            )
            db.session.add(summary_record)
            db.session.flush()
            return summary_record

    @staticmethod
    def vectorize_summary(
        summary_record: DocumentSegmentSummary,
        segment: DocumentSegment,
        dataset: Dataset,
    ) -> None:
        """
        Vectorize summary and store in vector database.

        Args:
            summary_record: DocumentSegmentSummary record
            segment: Original DocumentSegment
            dataset: Dataset containing the segment
        """
        if dataset.indexing_technique != "high_quality":
            logger.warning(
                "Summary vectorization skipped for dataset %s: indexing_technique is not high_quality",
                dataset.id,
            )
            return

        # Reuse existing index_node_id if available (like segment does), otherwise generate new one
        old_summary_node_id = summary_record.summary_index_node_id
        if old_summary_node_id:
            # Reuse existing index_node_id (like segment behavior)
            summary_index_node_id = old_summary_node_id
        else:
            # Generate new index node ID only for new summaries
            summary_index_node_id = str(uuid.uuid4())

        # Always regenerate hash (in case summary content changed)
        summary_hash = helper.generate_text_hash(summary_record.summary_content)

        # Delete old vector only if we're reusing the same index_node_id (to overwrite)
        # If index_node_id changed, the old vector should have been deleted elsewhere
        if old_summary_node_id and old_summary_node_id == summary_index_node_id:
            try:
                vector = Vector(dataset)
                vector.delete_by_ids([old_summary_node_id])
            except Exception as e:
                logger.warning(
                    "Failed to delete old summary vector for segment %s: %s. Continuing with new vectorization.",
                    segment.id,
                    str(e),
                )

        # Create document with summary content and metadata
        summary_document = Document(
            page_content=summary_record.summary_content,
            metadata={
                "doc_id": summary_index_node_id,
                "doc_hash": summary_hash,
                "dataset_id": dataset.id,
                "document_id": segment.document_id,
                "original_chunk_id": segment.id,  # Key: link to original chunk
                "doc_type": DocType.TEXT,
                "is_summary": True,  # Identifier for summary documents
            },
        )

        # Vectorize and store with retry mechanism for connection errors
        max_retries = 3
        retry_delay = 2.0

        for attempt in range(max_retries):
            try:
                vector = Vector(dataset)
                vector.add_texts([summary_document], duplicate_check=True)

                # Success - update summary record with index node info
                summary_record.summary_index_node_id = summary_index_node_id
                summary_record.summary_index_node_hash = summary_hash
                summary_record.status = "completed"
                db.session.add(summary_record)
                db.session.flush()
                return  # Success, exit function

            except (ConnectionError, Exception) as e:
                error_str = str(e).lower()
                # Check if it's a connection-related error that might be transient
                is_connection_error = any(
                    keyword in error_str
                    for keyword in [
                        "connection",
                        "disconnected",
                        "timeout",
                        "network",
                        "could not connect",
                        "server disconnected",
                        "weaviate",
                    ]
                )

                if is_connection_error and attempt < max_retries - 1:
                    # Retry for connection errors
                    wait_time = retry_delay * (2**attempt)  # Exponential backoff
                    logger.warning(
                        "Vectorization attempt %s/%s failed for segment %s: %s. Retrying in %.1f seconds...",
                        attempt + 1,
                        max_retries,
                        segment.id,
                        str(e),
                        wait_time,
                    )
                    time.sleep(wait_time)
                    continue
                else:
                    # Final attempt failed or non-connection error - log and update status
                    logger.error(
                        "Failed to vectorize summary for segment %s after %s attempts: %s",
                        segment.id,
                        attempt + 1,
                        str(e),
                        exc_info=True,
                    )
                    summary_record.status = "error"
                    summary_record.error = f"Vectorization failed: {str(e)}"
                    db.session.add(summary_record)
                    db.session.flush()
                    raise

    @staticmethod
    def batch_create_summary_records(
        segments: list[DocumentSegment],
        dataset: Dataset,
        status: str = "not_started",
    ) -> None:
        """
        Batch create summary records for segments with specified status.
        If a record already exists, update its status.

        Args:
            segments: List of DocumentSegment instances
            dataset: Dataset containing the segments
            status: Initial status for the records (default: "not_started")
        """
        segment_ids = [segment.id for segment in segments]
        if not segment_ids:
            return

        # Query existing summary records
        existing_summaries = (
            db.session.query(DocumentSegmentSummary)
            .filter(
                DocumentSegmentSummary.chunk_id.in_(segment_ids),
                DocumentSegmentSummary.dataset_id == dataset.id,
            )
            .all()
        )
        existing_summary_map = {summary.chunk_id: summary for summary in existing_summaries}

        # Create or update records
        for segment in segments:
            existing_summary = existing_summary_map.get(segment.id)
            if existing_summary:
                # Update existing record
                existing_summary.status = status
                existing_summary.error = None  # Clear any previous errors
                if not existing_summary.enabled:
                    existing_summary.enabled = True
                    existing_summary.disabled_at = None
                    existing_summary.disabled_by = None
                db.session.add(existing_summary)
            else:
                # Create new record
                summary_record = DocumentSegmentSummary(
                    dataset_id=dataset.id,
                    document_id=segment.document_id,
                    chunk_id=segment.id,
                    summary_content=None,  # Will be filled later
                    status=status,
                    enabled=True,
                )
                db.session.add(summary_record)

    @staticmethod
    def update_summary_record_error(
        segment: DocumentSegment,
        dataset: Dataset,
        error: str,
    ) -> None:
        """
        Update summary record with error status.

        Args:
            segment: DocumentSegment
            dataset: Dataset containing the segment
            error: Error message
        """
        summary_record = (
            db.session.query(DocumentSegmentSummary)
            .filter_by(chunk_id=segment.id, dataset_id=dataset.id)
            .first()
        )

        if summary_record:
            summary_record.status = "error"
            summary_record.error = error
            db.session.add(summary_record)
            db.session.flush()
        else:
            logger.warning(
                "Summary record not found for segment %s when updating error", segment.id
            )

    @staticmethod
    def generate_and_vectorize_summary(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_index_setting: dict,
    ) -> DocumentSegmentSummary:
        """
        Generate summary for a segment and vectorize it.
        Assumes summary record already exists (created by batch_create_summary_records).

        Args:
            segment: DocumentSegment to generate summary for
            dataset: Dataset containing the segment
            summary_index_setting: Summary index configuration

        Returns:
            Created DocumentSegmentSummary instance

        Raises:
            ValueError: If summary generation fails
        """
        # Get existing summary record (should have been created by batch_create_summary_records)
        summary_record = (
            db.session.query(DocumentSegmentSummary)
            .filter_by(chunk_id=segment.id, dataset_id=dataset.id)
            .first()
        )

        if not summary_record:
            # If not found (shouldn't happen), create one
            logger.warning(
                "Summary record not found for segment %s, creating one", segment.id
            )
            summary_record = SummaryIndexService.create_summary_record(
                segment, dataset, summary_content="", status="generating"
            )

        try:
            # Update status to "generating"
            summary_record.status = "generating"
            summary_record.error = None
            db.session.add(summary_record)
            db.session.flush()

            # Generate summary
            summary_content = SummaryIndexService.generate_summary_for_segment(
                segment, dataset, summary_index_setting
            )

            # Update summary content
            summary_record.summary_content = summary_content

            # Vectorize summary (will delete old vector if exists before creating new one)
            SummaryIndexService.vectorize_summary(summary_record, segment, dataset)

            # Status will be updated to "completed" by vectorize_summary on success
            db.session.commit()
            logger.info("Successfully generated and vectorized summary for segment %s", segment.id)
            return summary_record

        except Exception as e:
            logger.exception("Failed to generate summary for segment %s", segment.id)
            # Update summary record with error status
            summary_record.status = "error"
            summary_record.error = str(e)
            db.session.add(summary_record)
            db.session.commit()
            raise

    @staticmethod
    def generate_summaries_for_document(
        dataset: Dataset,
        document: DatasetDocument,
        summary_index_setting: dict,
        segment_ids: list[str] | None = None,
        only_parent_chunks: bool = False,
    ) -> list[DocumentSegmentSummary]:
        """
        Generate summaries for all segments in a document including vectorization.

        Args:
            dataset: Dataset containing the document
            document: DatasetDocument to generate summaries for
            summary_index_setting: Summary index configuration
            segment_ids: Optional list of specific segment IDs to process
            only_parent_chunks: If True, only process parent chunks (for parent-child mode)

        Returns:
            List of created DocumentSegmentSummary instances
        """
        # Only generate summary index for high_quality indexing technique
        if dataset.indexing_technique != "high_quality":
            logger.info(
                "Skipping summary generation for dataset %s: indexing_technique is %s, not 'high_quality'",
                dataset.id,
                dataset.indexing_technique,
            )
            return []

        if not summary_index_setting or not summary_index_setting.get("enable"):
            logger.info("Summary index is disabled for dataset %s", dataset.id)
            return []

        # Skip qa_model documents
        if document.doc_form == "qa_model":
            logger.info("Skipping summary generation for qa_model document %s", document.id)
            return []

        logger.info(
            "Starting summary generation for document %s in dataset %s, segment_ids: %s, only_parent_chunks: %s",
            document.id,
            dataset.id,
            len(segment_ids) if segment_ids else "all",
            only_parent_chunks,
        )

        # Query segments (only enabled segments)
        query = db.session.query(DocumentSegment).filter_by(
            dataset_id=dataset.id,
            document_id=document.id,
            status="completed",
            enabled=True,  # Only generate summaries for enabled segments
        )

        if segment_ids:
            query = query.filter(DocumentSegment.id.in_(segment_ids))

        segments = query.all()

        if not segments:
            logger.info("No segments found for document %s", document.id)
            return []

        # Batch create summary records with "not_started" status before processing
        # This ensures all records exist upfront, allowing status tracking
        SummaryIndexService.batch_create_summary_records(
            segments=segments,
            dataset=dataset,
            status="not_started",
        )
        db.session.commit()  # Commit initial records

        summary_records = []

        for segment in segments:
            # For parent-child mode, only process parent chunks
            # In parent-child mode, all DocumentSegments are parent chunks,
            # so we process all of them. Child chunks are stored in ChildChunk table
            # and are not DocumentSegments, so they won't be in the segments list.
            # This check is mainly for clarity and future-proofing.
            if only_parent_chunks:
                # In parent-child mode, all segments in the query are parent chunks
                # Child chunks are not DocumentSegments, so they won't appear here
                # We can process all segments
                pass

            try:
                summary_record = SummaryIndexService.generate_and_vectorize_summary(
                    segment, dataset, summary_index_setting
                )
                summary_records.append(summary_record)
            except Exception as e:
                logger.exception("Failed to generate summary for segment %s", segment.id)
                # Update summary record with error status
                SummaryIndexService.update_summary_record_error(
                    segment=segment,
                    dataset=dataset,
                    error=str(e),
                )
                # Continue with other segments
                continue

        db.session.commit()  # Commit any remaining changes

        logger.info(
            "Completed summary generation for document %s: %s summaries generated and vectorized",
            document.id,
            len(summary_records),
        )
        return summary_records

    @staticmethod
    def disable_summaries_for_segments(
        dataset: Dataset,
        segment_ids: list[str] | None = None,
        disabled_by: str | None = None,
    ) -> None:
        """
        Disable summary records and remove vectors from vector database for segments.
        Unlike delete, this preserves the summary records but marks them as disabled.

        Args:
            dataset: Dataset containing the segments
            segment_ids: List of segment IDs to disable summaries for. If None, disable all.
            disabled_by: User ID who disabled the summaries
        """
        from libs.datetime_utils import naive_utc_now

        query = db.session.query(DocumentSegmentSummary).filter_by(
            dataset_id=dataset.id,
            enabled=True,  # Only disable enabled summaries
        )

        if segment_ids:
            query = query.filter(DocumentSegmentSummary.chunk_id.in_(segment_ids))

        summaries = query.all()

        if not summaries:
            return

        logger.info(
            "Disabling %s summary records for dataset %s, segment_ids: %s",
            len(summaries),
            dataset.id,
            len(segment_ids) if segment_ids else "all",
        )

        # Remove from vector database (but keep records)
        if dataset.indexing_technique == "high_quality":
            summary_node_ids = [s.summary_index_node_id for s in summaries if s.summary_index_node_id]
            if summary_node_ids:
                try:
                    vector = Vector(dataset)
                    vector.delete_by_ids(summary_node_ids)
                except Exception as e:
                    logger.warning("Failed to remove summary vectors: %s", str(e))

        # Disable summary records (don't delete)
        now = naive_utc_now()
        for summary in summaries:
            summary.enabled = False
            summary.disabled_at = now
            summary.disabled_by = disabled_by
            db.session.add(summary)

        db.session.commit()
        logger.info("Disabled %s summary records for dataset %s", len(summaries), dataset.id)

    @staticmethod
    def enable_summaries_for_segments(
        dataset: Dataset,
        segment_ids: list[str] | None = None,
    ) -> None:
        """
        Enable summary records and re-add vectors to vector database for segments.

        Note: This method enables summaries based on chunk status, not summary_index_setting.enable.
        The summary_index_setting.enable flag only controls automatic generation,
        not whether existing summaries can be used.
        Summary.enabled should always be kept in sync with chunk.enabled.

        Args:
            dataset: Dataset containing the segments
            segment_ids: List of segment IDs to enable summaries for. If None, enable all.
        """
        # Only enable summary index for high_quality indexing technique
        if dataset.indexing_technique != "high_quality":
            return

        query = db.session.query(DocumentSegmentSummary).filter_by(
            dataset_id=dataset.id,
            enabled=False,  # Only enable disabled summaries
        )

        if segment_ids:
            query = query.filter(DocumentSegmentSummary.chunk_id.in_(segment_ids))

        summaries = query.all()

        if not summaries:
            return

        logger.info(
            "Enabling %s summary records for dataset %s, segment_ids: %s",
            len(summaries),
            dataset.id,
            len(segment_ids) if segment_ids else "all",
        )

        # Re-vectorize and re-add to vector database
        enabled_count = 0
        for summary in summaries:
            # Get the original segment
            segment = (
                db.session.query(DocumentSegment)
                .filter_by(
                    id=summary.chunk_id,
                    dataset_id=dataset.id,
                )
                .first()
            )

            # Summary.enabled stays in sync with chunk.enabled, only enable summary if the associated chunk is enabled.
            if not segment or not segment.enabled or segment.status != "completed":
                continue

            if not summary.summary_content:
                continue

            try:
                # Re-vectorize summary
                SummaryIndexService.vectorize_summary(summary, segment, dataset)

                # Enable summary record
                summary.enabled = True
                summary.disabled_at = None
                summary.disabled_by = None
                db.session.add(summary)
                enabled_count += 1
            except Exception:
                logger.exception("Failed to re-vectorize summary %s", summary.id)
                # Keep it disabled if vectorization fails
                continue

        db.session.commit()
        logger.info("Enabled %s summary records for dataset %s", enabled_count, dataset.id)

    @staticmethod
    def delete_summaries_for_segments(
        dataset: Dataset,
        segment_ids: list[str] | None = None,
    ) -> None:
        """
        Delete summary records and vectors for segments (used only for actual deletion scenarios).
        For disable/enable operations, use disable_summaries_for_segments/enable_summaries_for_segments.

        Args:
            dataset: Dataset containing the segments
            segment_ids: List of segment IDs to delete summaries for. If None, delete all.
        """
        query = db.session.query(DocumentSegmentSummary).filter_by(dataset_id=dataset.id)

        if segment_ids:
            query = query.filter(DocumentSegmentSummary.chunk_id.in_(segment_ids))

        summaries = query.all()

        if not summaries:
            return

        # Delete from vector database
        if dataset.indexing_technique == "high_quality":
            summary_node_ids = [s.summary_index_node_id for s in summaries if s.summary_index_node_id]
            if summary_node_ids:
                vector = Vector(dataset)
                vector.delete_by_ids(summary_node_ids)

        # Delete summary records
        for summary in summaries:
            db.session.delete(summary)

        db.session.commit()
        logger.info("Deleted %s summary records for dataset %s", len(summaries), dataset.id)

    @staticmethod
    def update_summary_for_segment(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_content: str,
    ) -> DocumentSegmentSummary | None:
        """
        Update summary for a segment and re-vectorize it.

        Args:
            segment: DocumentSegment to update summary for
            dataset: Dataset containing the segment
            summary_content: New summary content

        Returns:
            Updated DocumentSegmentSummary instance, or None if indexing technique is not high_quality
        """
        # Only update summary index for high_quality indexing technique
        if dataset.indexing_technique != "high_quality":
            return None

        # When user manually provides summary, allow saving even if summary_index_setting doesn't exist
        # summary_index_setting is only needed for LLM generation, not for manual summary vectorization
        # Vectorization uses dataset.embedding_model, which doesn't require summary_index_setting

        # Skip qa_model documents
        if segment.document and segment.document.doc_form == "qa_model":
            return None

        try:
            # Check if summary_content is empty (whitespace-only strings are considered empty)
            if not summary_content or not summary_content.strip():
                # If summary is empty, only delete existing summary vector and record
                summary_record = (
                    db.session.query(DocumentSegmentSummary)
                    .filter_by(chunk_id=segment.id, dataset_id=dataset.id)
                    .first()
                )

                if summary_record:
                    # Delete old vector if exists
                    old_summary_node_id = summary_record.summary_index_node_id
                    if old_summary_node_id:
                        try:
                            vector = Vector(dataset)
                            vector.delete_by_ids([old_summary_node_id])
                        except Exception as e:
                            logger.warning(
                                "Failed to delete old summary vector for segment %s: %s",
                                segment.id,
                                str(e),
                            )

                    # Delete summary record since summary is empty
                    db.session.delete(summary_record)
                    db.session.commit()
                    logger.info("Deleted summary for segment %s (empty content provided)", segment.id)
                    return None
                else:
                    # No existing summary record, nothing to do
                    logger.info("No summary record found for segment %s, nothing to delete", segment.id)
                    return None

            # Find existing summary record
            summary_record = (
                db.session.query(DocumentSegmentSummary).filter_by(chunk_id=segment.id, dataset_id=dataset.id).first()
            )

            if summary_record:
                # Update existing summary
                old_summary_node_id = summary_record.summary_index_node_id

                # Update summary content
                summary_record.summary_content = summary_content
                summary_record.status = "generating"
                db.session.add(summary_record)
                db.session.flush()

                # Delete old vector if exists
                if old_summary_node_id:
                    vector = Vector(dataset)
                    vector.delete_by_ids([old_summary_node_id])

                # Re-vectorize summary
                SummaryIndexService.vectorize_summary(summary_record, segment, dataset)

                db.session.commit()
                logger.info("Successfully updated and re-vectorized summary for segment %s", segment.id)
                return summary_record
            else:
                # Create new summary record if doesn't exist
                summary_record = SummaryIndexService.create_summary_record(
                    segment, dataset, summary_content, status="generating"
                )
                SummaryIndexService.vectorize_summary(summary_record, segment, dataset)
                db.session.commit()
                logger.info("Successfully created and vectorized summary for segment %s", segment.id)
                return summary_record

        except Exception:
            logger.exception("Failed to update summary for segment %s", segment.id)
            # Update summary record with error status if it exists
            summary_record = (
                db.session.query(DocumentSegmentSummary).filter_by(chunk_id=segment.id, dataset_id=dataset.id).first()
            )
            if summary_record:
                summary_record.status = "error"
                summary_record.error = str(e)
                db.session.add(summary_record)
                db.session.commit()
            raise
