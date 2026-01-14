"""Summary index service for generating and managing document segment summaries."""

import logging
import time
import uuid
from typing import Any

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
            db.session.query(DocumentSegmentSummary)
            .filter_by(chunk_id=segment.id, dataset_id=dataset.id)
            .first()
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
                f"Summary vectorization skipped for dataset {dataset.id}: "
                "indexing_technique is not high_quality"
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
                    f"Failed to delete old summary vector for segment {segment.id}: {str(e)}. "
                    "Continuing with new vectorization."
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
                is_connection_error = any(keyword in error_str for keyword in [
                    "connection", "disconnected", "timeout", "network", 
                    "could not connect", "server disconnected", "weaviate"
                ])
                
                if is_connection_error and attempt < max_retries - 1:
                    # Retry for connection errors
                    wait_time = retry_delay * (2 ** attempt)  # Exponential backoff
                    logger.warning(
                        f"Vectorization attempt {attempt + 1}/{max_retries} failed for segment {segment.id}: {str(e)}. "
                        f"Retrying in {wait_time:.1f} seconds..."
                    )
                    time.sleep(wait_time)
                    continue
                else:
                    # Final attempt failed or non-connection error - log and update status
                    logger.error(
                        f"Failed to vectorize summary for segment {segment.id} after {attempt + 1} attempts: {str(e)}",
                        exc_info=True
                    )
                    summary_record.status = "error"
                    summary_record.error = f"Vectorization failed: {str(e)}"
                    db.session.add(summary_record)
                    db.session.flush()
                    raise

    @staticmethod
    def generate_and_vectorize_summary(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_index_setting: dict,
    ) -> DocumentSegmentSummary:
        """
        Generate summary for a segment and vectorize it.

        Args:
            segment: DocumentSegment to generate summary for
            dataset: Dataset containing the segment
            summary_index_setting: Summary index configuration

        Returns:
            Created DocumentSegmentSummary instance

        Raises:
            ValueError: If summary generation fails
        """
        try:
            # Generate summary
            summary_content = SummaryIndexService.generate_summary_for_segment(
                segment, dataset, summary_index_setting
            )

            # Create or update summary record (will handle overwrite internally)
            summary_record = SummaryIndexService.create_summary_record(
                segment, dataset, summary_content, status="generating"
            )

            # Vectorize summary (will delete old vector if exists before creating new one)
            SummaryIndexService.vectorize_summary(summary_record, segment, dataset)

            db.session.commit()
            logger.info(f"Successfully generated and vectorized summary for segment {segment.id}")
            return summary_record

        except Exception as e:
            logger.exception(f"Failed to generate summary for segment {segment.id}: {str(e)}")
            # Update summary record with error status if it exists
            summary_record = (
                db.session.query(DocumentSegmentSummary)
                .filter_by(chunk_id=segment.id, dataset_id=dataset.id)
                .first()
            )
            if summary_record:
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
                f"Skipping summary generation for dataset {dataset.id}: "
                f"indexing_technique is {dataset.indexing_technique}, not 'high_quality'"
            )
            return []

        if not summary_index_setting or not summary_index_setting.get("enable"):
            logger.info(f"Summary index is disabled for dataset {dataset.id}")
            return []

        # Skip qa_model documents
        if document.doc_form == "qa_model":
            logger.info(f"Skipping summary generation for qa_model document {document.id}")
            return []

        logger.info(
            f"Starting summary generation for document {document.id} in dataset {dataset.id}, "
            f"segment_ids: {len(segment_ids) if segment_ids else 'all'}, "
            f"only_parent_chunks: {only_parent_chunks}"
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
            logger.info(f"No segments found for document {document.id}")
            return []

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
                logger.error(f"Failed to generate summary for segment {segment.id}: {str(e)}")
                # Continue with other segments
                continue

        logger.info(
            f"Completed summary generation for document {document.id}: "
            f"{len(summary_records)} summaries generated and vectorized"
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
            f"Disabling {len(summaries)} summary records for dataset {dataset.id}, "
            f"segment_ids: {len(segment_ids) if segment_ids else 'all'}"
        )

        # Remove from vector database (but keep records)
        if dataset.indexing_technique == "high_quality":
            summary_node_ids = [
                s.summary_index_node_id for s in summaries if s.summary_index_node_id
            ]
            if summary_node_ids:
                try:
                    vector = Vector(dataset)
                    vector.delete_by_ids(summary_node_ids)
                except Exception as e:
                    logger.warning(f"Failed to remove summary vectors: {str(e)}")

        # Disable summary records (don't delete)
        now = naive_utc_now()
        for summary in summaries:
            summary.enabled = False
            summary.disabled_at = now
            summary.disabled_by = disabled_by
            db.session.add(summary)

        db.session.commit()
        logger.info(f"Disabled {len(summaries)} summary records for dataset {dataset.id}")

    @staticmethod
    def enable_summaries_for_segments(
        dataset: Dataset,
        segment_ids: list[str] | None = None,
    ) -> None:
        """
        Enable summary records and re-add vectors to vector database for segments.

        Args:
            dataset: Dataset containing the segments
            segment_ids: List of segment IDs to enable summaries for. If None, enable all.
        """
        # Only enable summary index for high_quality indexing technique
        if dataset.indexing_technique != "high_quality":
            return

        # Check if summary index is enabled
        summary_index_setting = dataset.summary_index_setting
        if not summary_index_setting or not summary_index_setting.get("enable"):
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
            f"Enabling {len(summaries)} summary records for dataset {dataset.id}, "
            f"segment_ids: {len(segment_ids) if segment_ids else 'all'}"
        )

        # Re-vectorize and re-add to vector database
        enabled_count = 0
        for summary in summaries:
            # Get the original segment
            segment = db.session.query(DocumentSegment).filter_by(
                id=summary.chunk_id,
                dataset_id=dataset.id,
            ).first()
            
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
            except Exception as e:
                logger.error(f"Failed to re-vectorize summary {summary.id}: {str(e)}")
                # Keep it disabled if vectorization fails
                continue

        db.session.commit()
        logger.info(f"Enabled {enabled_count} summary records for dataset {dataset.id}")

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
            summary_node_ids = [
                s.summary_index_node_id for s in summaries if s.summary_index_node_id
            ]
            if summary_node_ids:
                vector = Vector(dataset)
                vector.delete_by_ids(summary_node_ids)

        # Delete summary records
        for summary in summaries:
            db.session.delete(summary)

        db.session.commit()
        logger.info(f"Deleted {len(summaries)} summary records for dataset {dataset.id}")

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
            Updated DocumentSegmentSummary instance, or None if summary index is not enabled
        """
        # Only update summary index for high_quality indexing technique
        if dataset.indexing_technique != "high_quality":
            return None

        # Check if summary index is enabled
        summary_index_setting = dataset.summary_index_setting
        if not summary_index_setting or not summary_index_setting.get("enable"):
            return None

        # Skip qa_model documents
        if segment.document and segment.document.doc_form == "qa_model":
            return None

        try:
            # Find existing summary record
            summary_record = (
                db.session.query(DocumentSegmentSummary)
                .filter_by(chunk_id=segment.id, dataset_id=dataset.id)
                .first()
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
                logger.info(f"Successfully updated and re-vectorized summary for segment {segment.id}")
                return summary_record
            else:
                # Create new summary record if doesn't exist
                summary_record = SummaryIndexService.create_summary_record(
                    segment, dataset, summary_content, status="generating"
                )
                SummaryIndexService.vectorize_summary(summary_record, segment, dataset)
                db.session.commit()
                logger.info(f"Successfully created and vectorized summary for segment {segment.id}")
                return summary_record

        except Exception as e:
            logger.exception(f"Failed to update summary for segment {segment.id}: {str(e)}")
            # Update summary record with error status if it exists
            summary_record = (
                db.session.query(DocumentSegmentSummary)
                .filter_by(chunk_id=segment.id, dataset_id=dataset.id)
                .first()
            )
            if summary_record:
                summary_record.status = "error"
                summary_record.error = str(e)
                db.session.add(summary_record)
                db.session.commit()
            raise

