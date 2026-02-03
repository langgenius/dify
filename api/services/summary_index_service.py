"""Summary index service for generating and managing document segment summaries."""

import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.model_manager import ModelManager
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.models.document import Document
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
    ) -> tuple[str, LLMUsage]:
        """
        Generate summary for a single segment.

        Args:
            segment: DocumentSegment to generate summary for
            dataset: Dataset containing the segment
            summary_index_setting: Summary index configuration

        Returns:
            Tuple of (summary_content, llm_usage) where llm_usage is LLMUsage object

        Raises:
            ValueError: If summary_index_setting is invalid or generation fails
        """
        # Reuse the existing generate_summary method from ParagraphIndexProcessor
        # Use lazy import to avoid circular import
        from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor

        # Get document language to ensure summary is generated in the correct language
        # This is especially important for image-only chunks where text is empty or minimal
        document_language = None
        if segment.document and segment.document.doc_language:
            document_language = segment.document.doc_language

        summary_content, usage = ParagraphIndexProcessor.generate_summary(
            tenant_id=dataset.tenant_id,
            text=segment.content,
            summary_index_setting=summary_index_setting,
            segment_id=segment.id,
            document_language=document_language,
        )

        if not summary_content:
            raise ValueError("Generated summary is empty")

        return summary_content, usage

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
        with session_factory.create_session() as session:
            # Check if summary record already exists
            existing_summary = (
                session.query(DocumentSegmentSummary).filter_by(chunk_id=segment.id, dataset_id=dataset.id).first()
            )

            if existing_summary:
                # Update existing record
                existing_summary.summary_content = summary_content
                existing_summary.status = status
                existing_summary.error = None  # type: ignore[assignment]  # Clear any previous errors
                # Re-enable if it was disabled
                if not existing_summary.enabled:
                    existing_summary.enabled = True
                    existing_summary.disabled_at = None
                    existing_summary.disabled_by = None
                session.add(existing_summary)
                session.flush()
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
                session.add(summary_record)
                session.flush()
                return summary_record

    @staticmethod
    def vectorize_summary(
        summary_record: DocumentSegmentSummary,
        segment: DocumentSegment,
        dataset: Dataset,
        session: Session | None = None,
    ) -> None:
        """
        Vectorize summary and store in vector database.

        Args:
            summary_record: DocumentSegmentSummary record
            segment: Original DocumentSegment
            dataset: Dataset containing the segment
            session: Optional SQLAlchemy session. If provided, uses this session instead of creating a new one.
                    If not provided, creates a new session and commits automatically.
        """
        if dataset.indexing_technique != "high_quality":
            logger.warning(
                "Summary vectorization skipped for dataset %s: indexing_technique is not high_quality",
                dataset.id,
            )
            return

        # Get summary_record_id for later session queries
        summary_record_id = summary_record.id
        # Save the original session parameter for use in error handling
        original_session = session
        logger.debug(
            "Starting vectorization for segment %s, summary_record_id=%s, using_provided_session=%s",
            segment.id,
            summary_record_id,
            original_session is not None,
        )

        # Reuse existing index_node_id if available (like segment does), otherwise generate new one
        old_summary_node_id = summary_record.summary_index_node_id
        if old_summary_node_id:
            # Reuse existing index_node_id (like segment behavior)
            summary_index_node_id = old_summary_node_id
            logger.debug("Reusing existing index_node_id %s for segment %s", summary_index_node_id, segment.id)
        else:
            # Generate new index node ID only for new summaries
            summary_index_node_id = str(uuid.uuid4())
            logger.debug("Generated new index_node_id %s for segment %s", summary_index_node_id, segment.id)

        # Always regenerate hash (in case summary content changed)
        summary_content = summary_record.summary_content
        if not summary_content or not summary_content.strip():
            raise ValueError(f"Summary content is empty for segment {segment.id}, cannot vectorize")
        summary_hash = helper.generate_text_hash(summary_content)

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

        # Calculate embedding tokens for summary (for logging and statistics)
        embedding_tokens = 0
        try:
            model_manager = ModelManager()
            embedding_model = model_manager.get_model_instance(
                tenant_id=dataset.tenant_id,
                provider=dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset.embedding_model,
            )
            if embedding_model:
                tokens_list = embedding_model.get_text_embedding_num_tokens([summary_content])
                embedding_tokens = tokens_list[0] if tokens_list else 0
        except Exception as e:
            logger.warning("Failed to calculate embedding tokens for summary: %s", str(e))

        # Create document with summary content and metadata
        summary_document = Document(
            page_content=summary_content,
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
                logger.debug(
                    "Attempting to vectorize summary for segment %s (attempt %s/%s)",
                    segment.id,
                    attempt + 1,
                    max_retries,
                )
                vector = Vector(dataset)
                # Use duplicate_check=False to ensure re-vectorization even if old vector still exists
                # The old vector should have been deleted above, but if deletion failed,
                # we still want to re-vectorize (upsert will overwrite)
                vector.add_texts([summary_document], duplicate_check=False)
                logger.debug(
                    "Successfully added summary vector to database for segment %s (attempt %s/%s)",
                    segment.id,
                    attempt + 1,
                    max_retries,
                )

                # Log embedding token usage
                if embedding_tokens > 0:
                    logger.info(
                        "Summary embedding for segment %s used %s tokens",
                        segment.id,
                        embedding_tokens,
                    )

                # Success - update summary record with index node info
                # Use provided session if available, otherwise create a new one
                use_provided_session = session is not None
                if not use_provided_session:
                    logger.debug("Creating new session for vectorization of segment %s", segment.id)
                    session_context = session_factory.create_session()
                    session = session_context.__enter__()
                else:
                    logger.debug("Using provided session for vectorization of segment %s", segment.id)
                    session_context = None  # Don't use context manager for provided session

                # At this point, session is guaranteed to be not None
                # Type narrowing: session is definitely not None after the if/else above
                if session is None:
                    raise RuntimeError("Session should not be None at this point")

                try:
                    # Declare summary_record_in_session variable
                    summary_record_in_session: DocumentSegmentSummary | None

                    # If using provided session, merge the summary_record into it
                    if use_provided_session:
                        # Merge the summary_record into the provided session
                        logger.debug(
                            "Merging summary_record (id=%s) into provided session for segment %s",
                            summary_record_id,
                            segment.id,
                        )
                        summary_record_in_session = session.merge(summary_record)
                        logger.debug(
                            "Successfully merged summary_record for segment %s, merged_id=%s",
                            segment.id,
                            summary_record_in_session.id,
                        )
                    else:
                        # Query the summary record in the new session
                        logger.debug(
                            "Querying summary_record by id=%s for segment %s in new session",
                            summary_record_id,
                            segment.id,
                        )
                        summary_record_in_session = (
                            session.query(DocumentSegmentSummary).filter_by(id=summary_record_id).first()
                        )

                        if not summary_record_in_session:
                            # Record not found - try to find by chunk_id and dataset_id instead
                            logger.debug(
                                "Summary record not found by id=%s, trying chunk_id=%s and dataset_id=%s "
                                "for segment %s",
                                summary_record_id,
                                segment.id,
                                dataset.id,
                                segment.id,
                            )
                            summary_record_in_session = (
                                session.query(DocumentSegmentSummary)
                                .filter_by(chunk_id=segment.id, dataset_id=dataset.id)
                                .first()
                            )

                            if not summary_record_in_session:
                                # Still not found - create a new one using the parameter data
                                logger.warning(
                                    "Summary record not found in database for segment %s (id=%s), creating new one. "
                                    "This may indicate a session isolation issue.",
                                    segment.id,
                                    summary_record_id,
                                )
                                summary_record_in_session = DocumentSegmentSummary(
                                    id=summary_record_id,  # Use the same ID if available
                                    dataset_id=dataset.id,
                                    document_id=segment.document_id,
                                    chunk_id=segment.id,
                                    summary_content=summary_content,
                                    summary_index_node_id=summary_index_node_id,
                                    summary_index_node_hash=summary_hash,
                                    tokens=embedding_tokens,
                                    status="completed",
                                    enabled=True,
                                )
                                session.add(summary_record_in_session)
                                logger.info(
                                    "Created new summary record (id=%s) for segment %s after vectorization",
                                    summary_record_id,
                                    segment.id,
                                )
                            else:
                                # Found by chunk_id - update it
                                logger.info(
                                    "Found summary record for segment %s by chunk_id "
                                    "(id mismatch: expected %s, found %s). "
                                    "This may indicate the record was created in a different session.",
                                    segment.id,
                                    summary_record_id,
                                    summary_record_in_session.id,
                                )
                        else:
                            logger.debug(
                                "Found summary_record (id=%s) for segment %s in new session",
                                summary_record_id,
                                segment.id,
                            )

                        # At this point, summary_record_in_session is guaranteed to be not None
                        if summary_record_in_session is None:
                            raise RuntimeError("summary_record_in_session should not be None at this point")

                    # Update all fields including summary_content
                    # Always use the summary_content from the parameter (which is the latest from outer session)
                    # rather than relying on what's in the database, in case outer session hasn't committed yet
                    summary_record_in_session.summary_index_node_id = summary_index_node_id
                    summary_record_in_session.summary_index_node_hash = summary_hash
                    summary_record_in_session.tokens = embedding_tokens  # Save embedding tokens
                    summary_record_in_session.status = "completed"
                    # Ensure summary_content is preserved (use the latest from summary_record parameter)
                    # This is critical: use the parameter value, not the database value
                    summary_record_in_session.summary_content = summary_content
                    # Explicitly update updated_at to ensure it's refreshed even if other fields haven't changed
                    summary_record_in_session.updated_at = datetime.now(UTC).replace(tzinfo=None)
                    session.add(summary_record_in_session)

                    # Only commit if we created the session ourselves
                    if not use_provided_session:
                        logger.debug("Committing session for segment %s (self-created session)", segment.id)
                        session.commit()
                        logger.debug("Successfully committed session for segment %s", segment.id)
                    else:
                        # When using provided session, flush to ensure changes are written to database
                        # This prevents refresh() from overwriting our changes
                        logger.debug(
                            "Flushing session for segment %s (using provided session, caller will commit)",
                            segment.id,
                        )
                        session.flush()
                        logger.debug("Successfully flushed session for segment %s", segment.id)
                    # If using provided session, let the caller handle commit

                    logger.info(
                        "Successfully vectorized summary for segment %s, index_node_id=%s, index_node_hash=%s, "
                        "tokens=%s, summary_record_id=%s, use_provided_session=%s",
                        segment.id,
                        summary_index_node_id,
                        summary_hash,
                        embedding_tokens,
                        summary_record_in_session.id,
                        use_provided_session,
                    )
                    # Update the original object for consistency
                    summary_record.summary_index_node_id = summary_index_node_id
                    summary_record.summary_index_node_hash = summary_hash
                    summary_record.tokens = embedding_tokens
                    summary_record.status = "completed"
                    summary_record.summary_content = summary_content
                    if summary_record_in_session.updated_at:
                        summary_record.updated_at = summary_record_in_session.updated_at
                finally:
                    # Only close session if we created it ourselves
                    if not use_provided_session and session_context:
                        session_context.__exit__(None, None, None)
                # Success, exit function
                return

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
                        "Vectorization attempt %s/%s failed for segment %s (connection error): %s. "
                        "Retrying in %.1f seconds...",
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
                        "Failed to vectorize summary for segment %s after %s attempts: %s. "
                        "summary_record_id=%s, index_node_id=%s, use_provided_session=%s",
                        segment.id,
                        attempt + 1,
                        str(e),
                        summary_record_id,
                        summary_index_node_id,
                        session is not None,
                        exc_info=True,
                    )
                    # Update error status in session
                    # Use the original_session saved at function start (the function parameter)
                    logger.debug(
                        "Updating error status for segment %s, summary_record_id=%s, has_original_session=%s",
                        segment.id,
                        summary_record_id,
                        original_session is not None,
                    )
                    # Always create a new session for error handling to avoid issues with closed sessions
                    # Even if original_session was provided, we create a new one for safety
                    with session_factory.create_session() as error_session:
                        # Try to find the record by id first
                        # Note: Using assignment only (no type annotation) to avoid redeclaration error
                        summary_record_in_session = (
                            error_session.query(DocumentSegmentSummary).filter_by(id=summary_record_id).first()
                        )
                        if not summary_record_in_session:
                            # Try to find by chunk_id and dataset_id
                            logger.debug(
                                "Summary record not found by id=%s, trying chunk_id=%s and dataset_id=%s "
                                "for segment %s",
                                summary_record_id,
                                segment.id,
                                dataset.id,
                                segment.id,
                            )
                            summary_record_in_session = (
                                error_session.query(DocumentSegmentSummary)
                                .filter_by(chunk_id=segment.id, dataset_id=dataset.id)
                                .first()
                            )

                        if summary_record_in_session:
                            summary_record_in_session.status = "error"
                            summary_record_in_session.error = f"Vectorization failed: {str(e)}"
                            summary_record_in_session.updated_at = datetime.now(UTC).replace(tzinfo=None)
                            error_session.add(summary_record_in_session)
                            error_session.commit()
                            logger.info(
                                "Updated error status in new session for segment %s, record_id=%s",
                                segment.id,
                                summary_record_in_session.id,
                            )
                            # Update the original object for consistency
                            summary_record.status = "error"
                            summary_record.error = summary_record_in_session.error
                            summary_record.updated_at = summary_record_in_session.updated_at
                        else:
                            logger.warning(
                                "Could not update error status: summary record not found for segment %s (id=%s). "
                                "This may indicate a session isolation issue.",
                                segment.id,
                                summary_record_id,
                            )
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

        with session_factory.create_session() as session:
            # Query existing summary records
            existing_summaries = (
                session.query(DocumentSegmentSummary)
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
                    existing_summary.error = None  # type: ignore[assignment]  # Clear any previous errors
                    if not existing_summary.enabled:
                        existing_summary.enabled = True
                        existing_summary.disabled_at = None
                        existing_summary.disabled_by = None
                    session.add(existing_summary)
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
                    session.add(summary_record)

            # Commit the batch created records
            session.commit()

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
        with session_factory.create_session() as session:
            summary_record = (
                session.query(DocumentSegmentSummary).filter_by(chunk_id=segment.id, dataset_id=dataset.id).first()
            )

            if summary_record:
                summary_record.status = "error"
                summary_record.error = error
                session.add(summary_record)
                session.commit()
            else:
                logger.warning("Summary record not found for segment %s when updating error", segment.id)

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
        with session_factory.create_session() as session:
            try:
                # Get or refresh summary record in this session
                summary_record_in_session = (
                    session.query(DocumentSegmentSummary).filter_by(chunk_id=segment.id, dataset_id=dataset.id).first()
                )

                if not summary_record_in_session:
                    # If not found, create one
                    logger.warning("Summary record not found for segment %s, creating one", segment.id)
                    summary_record_in_session = DocumentSegmentSummary(
                        dataset_id=dataset.id,
                        document_id=segment.document_id,
                        chunk_id=segment.id,
                        summary_content="",
                        status="generating",
                        enabled=True,
                    )
                    session.add(summary_record_in_session)
                    session.flush()

                # Update status to "generating"
                summary_record_in_session.status = "generating"
                summary_record_in_session.error = None  # type: ignore[assignment]
                session.add(summary_record_in_session)
                # Don't flush here - wait until after vectorization succeeds

                # Generate summary (returns summary_content and llm_usage)
                summary_content, llm_usage = SummaryIndexService.generate_summary_for_segment(
                    segment, dataset, summary_index_setting
                )

                # Update summary content
                summary_record_in_session.summary_content = summary_content
                session.add(summary_record_in_session)
                # Flush to ensure summary_content is saved before vectorize_summary queries it
                session.flush()

                # Log LLM usage for summary generation
                if llm_usage and llm_usage.total_tokens > 0:
                    logger.info(
                        "Summary generation for segment %s used %s tokens (prompt: %s, completion: %s)",
                        segment.id,
                        llm_usage.total_tokens,
                        llm_usage.prompt_tokens,
                        llm_usage.completion_tokens,
                    )

                # Vectorize summary (will delete old vector if exists before creating new one)
                # Pass the session-managed record to vectorize_summary
                # vectorize_summary will update status to "completed" and tokens in its own session
                # vectorize_summary will also ensure summary_content is preserved
                try:
                    # Pass the session to vectorize_summary to avoid session isolation issues
                    SummaryIndexService.vectorize_summary(summary_record_in_session, segment, dataset, session=session)
                    # Refresh the object from database to get the updated status and tokens from vectorize_summary
                    session.refresh(summary_record_in_session)
                    # Commit the session
                    # (summary_record_in_session should have status="completed" and tokens from refresh)
                    session.commit()
                    logger.info("Successfully generated and vectorized summary for segment %s", segment.id)
                    return summary_record_in_session
                except Exception as vectorize_error:
                    # If vectorization fails, update status to error in current session
                    logger.exception("Failed to vectorize summary for segment %s", segment.id)
                    summary_record_in_session.status = "error"
                    summary_record_in_session.error = f"Vectorization failed: {str(vectorize_error)}"
                    session.add(summary_record_in_session)
                    session.commit()
                    raise

            except Exception as e:
                logger.exception("Failed to generate summary for segment %s", segment.id)
                # Update summary record with error status
                summary_record_in_session = (
                    session.query(DocumentSegmentSummary).filter_by(chunk_id=segment.id, dataset_id=dataset.id).first()
                )
                if summary_record_in_session:
                    summary_record_in_session.status = "error"
                    summary_record_in_session.error = str(e)
                    session.add(summary_record_in_session)
                    session.commit()
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

        with session_factory.create_session() as session:
            # Query segments (only enabled segments)
            query = session.query(DocumentSegment).filter_by(
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

        with session_factory.create_session() as session:
            query = session.query(DocumentSegmentSummary).filter_by(
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
                session.add(summary)

            session.commit()
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

        with session_factory.create_session() as session:
            query = session.query(DocumentSegmentSummary).filter_by(
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
                    session.query(DocumentSegment)
                    .filter_by(
                        id=summary.chunk_id,
                        dataset_id=dataset.id,
                    )
                    .first()
                )

                # Summary.enabled stays in sync with chunk.enabled,
                # only enable summary if the associated chunk is enabled.
                if not segment or not segment.enabled or segment.status != "completed":
                    continue

                if not summary.summary_content:
                    continue

                try:
                    # Re-vectorize summary (this will update status and tokens in its own session)
                    # Pass the session to vectorize_summary to avoid session isolation issues
                    SummaryIndexService.vectorize_summary(summary, segment, dataset, session=session)

                    # Refresh the object from database to get the updated status and tokens from vectorize_summary
                    session.refresh(summary)

                    # Enable summary record
                    summary.enabled = True
                    summary.disabled_at = None
                    summary.disabled_by = None
                    session.add(summary)
                    enabled_count += 1
                except Exception:
                    logger.exception("Failed to re-vectorize summary %s", summary.id)
                    # Keep it disabled if vectorization fails
                    continue

            session.commit()
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
        with session_factory.create_session() as session:
            query = session.query(DocumentSegmentSummary).filter_by(dataset_id=dataset.id)

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
                session.delete(summary)

            session.commit()
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

        with session_factory.create_session() as session:
            try:
                # Check if summary_content is empty (whitespace-only strings are considered empty)
                if not summary_content or not summary_content.strip():
                    # If summary is empty, only delete existing summary vector and record
                    summary_record = (
                        session.query(DocumentSegmentSummary)
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
                        session.delete(summary_record)
                        session.commit()
                        logger.info("Deleted summary for segment %s (empty content provided)", segment.id)
                        return None
                    else:
                        # No existing summary record, nothing to do
                        logger.info("No summary record found for segment %s, nothing to delete", segment.id)
                        return None

                # Find existing summary record
                summary_record = (
                    session.query(DocumentSegmentSummary).filter_by(chunk_id=segment.id, dataset_id=dataset.id).first()
                )

                if summary_record:
                    # Update existing summary
                    old_summary_node_id = summary_record.summary_index_node_id

                    # Update summary content
                    summary_record.summary_content = summary_content
                    summary_record.status = "generating"
                    summary_record.error = None  # type: ignore[assignment]  # Clear any previous errors
                    session.add(summary_record)
                    # Flush to ensure summary_content is saved before vectorize_summary queries it
                    session.flush()

                    # Delete old vector if exists (before vectorization)
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

                    # Re-vectorize summary (this will update status to "completed" and tokens in its own session)
                    # vectorize_summary will also ensure summary_content is preserved
                    # Note: vectorize_summary may take time due to embedding API calls, but we need to complete it
                    # to ensure the summary is properly indexed
                    try:
                        # Pass the session to vectorize_summary to avoid session isolation issues
                        SummaryIndexService.vectorize_summary(summary_record, segment, dataset, session=session)
                        # Refresh the object from database to get the updated status and tokens from vectorize_summary
                        session.refresh(summary_record)
                        # Now commit the session (summary_record should have status="completed" and tokens from refresh)
                        session.commit()
                        logger.info("Successfully updated and re-vectorized summary for segment %s", segment.id)
                        return summary_record
                    except Exception as e:
                        # If vectorization fails, update status to error in current session
                        # Don't raise the exception - just log it and return the record with error status
                        # This allows the segment update to complete even if vectorization fails
                        summary_record.status = "error"
                        summary_record.error = f"Vectorization failed: {str(e)}"
                        session.commit()
                        logger.exception("Failed to vectorize summary for segment %s", segment.id)
                        # Return the record with error status instead of raising
                        # The caller can check the status if needed
                        return summary_record
                else:
                    # Create new summary record if doesn't exist
                    summary_record = SummaryIndexService.create_summary_record(
                        segment, dataset, summary_content, status="generating"
                    )
                    # Re-vectorize summary (this will update status to "completed" and tokens in its own session)
                    # Note: summary_record was created in a different session,
                    # so we need to merge it into current session
                    try:
                        # Merge the record into current session first (since it was created in a different session)
                        summary_record = session.merge(summary_record)
                        # Pass the session to vectorize_summary - it will update the merged record
                        SummaryIndexService.vectorize_summary(summary_record, segment, dataset, session=session)
                        # Refresh to get updated status and tokens from database
                        session.refresh(summary_record)
                        # Commit the session to persist the changes
                        session.commit()
                        logger.info("Successfully created and vectorized summary for segment %s", segment.id)
                        return summary_record
                    except Exception as e:
                        # If vectorization fails, update status to error in current session
                        # Merge the record into current session first
                        error_record = session.merge(summary_record)
                        error_record.status = "error"
                        error_record.error = f"Vectorization failed: {str(e)}"
                        session.commit()
                        logger.exception("Failed to vectorize summary for segment %s", segment.id)
                        # Return the record with error status instead of raising
                        return error_record

            except Exception as e:
                logger.exception("Failed to update summary for segment %s", segment.id)
                # Update summary record with error status if it exists
                summary_record = (
                    session.query(DocumentSegmentSummary).filter_by(chunk_id=segment.id, dataset_id=dataset.id).first()
                )
                if summary_record:
                    summary_record.status = "error"
                    summary_record.error = str(e)
                    session.add(summary_record)
                    session.commit()
                raise

    @staticmethod
    def get_segment_summary(segment_id: str, dataset_id: str) -> DocumentSegmentSummary | None:
        """
        Get summary for a single segment.

        Args:
            segment_id: Segment ID (chunk_id)
            dataset_id: Dataset ID

        Returns:
            DocumentSegmentSummary instance if found, None otherwise
        """
        with session_factory.create_session() as session:
            return (
                session.query(DocumentSegmentSummary)
                .where(
                    DocumentSegmentSummary.chunk_id == segment_id,
                    DocumentSegmentSummary.dataset_id == dataset_id,
                    DocumentSegmentSummary.enabled == True,  # Only return enabled summaries
                )
                .first()
            )

    @staticmethod
    def get_segments_summaries(segment_ids: list[str], dataset_id: str) -> dict[str, DocumentSegmentSummary]:
        """
        Get summaries for multiple segments.

        Args:
            segment_ids: List of segment IDs (chunk_ids)
            dataset_id: Dataset ID

        Returns:
            Dictionary mapping segment_id to DocumentSegmentSummary (only enabled summaries)
        """
        if not segment_ids:
            return {}

        with session_factory.create_session() as session:
            summary_records = (
                session.query(DocumentSegmentSummary)
                .where(
                    DocumentSegmentSummary.chunk_id.in_(segment_ids),
                    DocumentSegmentSummary.dataset_id == dataset_id,
                    DocumentSegmentSummary.enabled == True,  # Only return enabled summaries
                )
                .all()
            )

            return {summary.chunk_id: summary for summary in summary_records}

    @staticmethod
    def get_document_summaries(
        document_id: str, dataset_id: str, segment_ids: list[str] | None = None
    ) -> list[DocumentSegmentSummary]:
        """
        Get all summary records for a document.

        Args:
            document_id: Document ID
            dataset_id: Dataset ID
            segment_ids: Optional list of segment IDs to filter by

        Returns:
            List of DocumentSegmentSummary instances (only enabled summaries)
        """
        with session_factory.create_session() as session:
            query = session.query(DocumentSegmentSummary).filter(
                DocumentSegmentSummary.document_id == document_id,
                DocumentSegmentSummary.dataset_id == dataset_id,
                DocumentSegmentSummary.enabled == True,  # Only return enabled summaries
            )

            if segment_ids:
                query = query.filter(DocumentSegmentSummary.chunk_id.in_(segment_ids))

            return query.all()

    @staticmethod
    def get_document_summary_index_status(document_id: str, dataset_id: str, tenant_id: str) -> str | None:
        """
        Get summary_index_status for a single document.

        Args:
            document_id: Document ID
            dataset_id: Dataset ID
            tenant_id: Tenant ID

        Returns:
            "SUMMARIZING" if there are pending summaries, None otherwise
        """
        # Get all segments for this document (excluding qa_model and re_segment)
        with session_factory.create_session() as session:
            segments = (
                session.query(DocumentSegment.id)
                .where(
                    DocumentSegment.document_id == document_id,
                    DocumentSegment.status != "re_segment",
                    DocumentSegment.tenant_id == tenant_id,
                )
                .all()
            )
        segment_ids = [seg.id for seg in segments]

        if not segment_ids:
            return None

        # Get all summary records for these segments
        summaries = SummaryIndexService.get_segments_summaries(segment_ids, dataset_id)
        summary_status_map = {chunk_id: summary.status for chunk_id, summary in summaries.items()}

        # Check if there are any "not_started" or "generating" status summaries
        has_pending_summaries = any(
            summary_status_map.get(segment_id) is not None  # Ensure summary exists (enabled=True)
            and summary_status_map[segment_id] in ("not_started", "generating")
            for segment_id in segment_ids
        )

        return "SUMMARIZING" if has_pending_summaries else None

    @staticmethod
    def get_documents_summary_index_status(
        document_ids: list[str], dataset_id: str, tenant_id: str
    ) -> dict[str, str | None]:
        """
        Get summary_index_status for multiple documents.

        Args:
            document_ids: List of document IDs
            dataset_id: Dataset ID
            tenant_id: Tenant ID

        Returns:
            Dictionary mapping document_id to summary_index_status ("SUMMARIZING" or None)
        """
        if not document_ids:
            return {}

        # Get all segments for these documents (excluding qa_model and re_segment)
        with session_factory.create_session() as session:
            segments = (
                session.query(DocumentSegment.id, DocumentSegment.document_id)
                .where(
                    DocumentSegment.document_id.in_(document_ids),
                    DocumentSegment.status != "re_segment",
                    DocumentSegment.tenant_id == tenant_id,
                )
                .all()
            )

        # Group segments by document_id
        document_segments_map: dict[str, list[str]] = {}
        for segment in segments:
            doc_id = str(segment.document_id)
            if doc_id not in document_segments_map:
                document_segments_map[doc_id] = []
            document_segments_map[doc_id].append(segment.id)

        # Get all summary records for these segments
        all_segment_ids = [seg.id for seg in segments]
        summaries = SummaryIndexService.get_segments_summaries(all_segment_ids, dataset_id)
        summary_status_map = {chunk_id: summary.status for chunk_id, summary in summaries.items()}

        # Calculate summary_index_status for each document
        result: dict[str, str | None] = {}
        for doc_id in document_ids:
            segment_ids = document_segments_map.get(doc_id, [])
            if not segment_ids:
                # No segments, status is None (not started)
                result[doc_id] = None
                continue

            # Check if there are any "not_started" or "generating" status summaries
            # Only check enabled=True summaries (already filtered in query)
            # If segment has no summary record (summary_status_map.get returns None),
            # it means the summary is disabled (enabled=False) or not created yet, ignore it
            has_pending_summaries = any(
                summary_status_map.get(segment_id) is not None  # Ensure summary exists (enabled=True)
                and summary_status_map[segment_id] in ("not_started", "generating")
                for segment_id in segment_ids
            )

            if has_pending_summaries:
                # Task is still running (not started or generating)
                result[doc_id] = "SUMMARIZING"
            else:
                # All enabled=True summaries are "completed" or "error", task finished
                # Or no enabled=True summaries exist (all disabled)
                result[doc_id] = None

        return result

    @staticmethod
    def get_document_summary_status_detail(
        document_id: str,
        dataset_id: str,
    ) -> dict[str, Any]:
        """
        Get detailed summary status for a document.

        Args:
            document_id: Document ID
            dataset_id: Dataset ID

        Returns:
            Dictionary containing:
            - total_segments: Total number of segments in the document
            - summary_status: Dictionary with status counts
              - completed: Number of summaries completed
              - generating: Number of summaries being generated
              - error: Number of summaries with errors
              - not_started: Number of segments without summary records
            - summaries: List of summary records with status and content preview
        """
        from services.dataset_service import SegmentService

        # Get all segments for this document
        segments = SegmentService.get_segments_by_document_and_dataset(
            document_id=document_id,
            dataset_id=dataset_id,
            status="completed",
            enabled=True,
        )

        total_segments = len(segments)

        # Get all summary records for these segments
        segment_ids = [segment.id for segment in segments]
        summaries = []
        if segment_ids:
            summaries = SummaryIndexService.get_document_summaries(
                document_id=document_id,
                dataset_id=dataset_id,
                segment_ids=segment_ids,
            )

        # Create a mapping of chunk_id to summary
        summary_map = {summary.chunk_id: summary for summary in summaries}

        # Count statuses
        status_counts = {
            "completed": 0,
            "generating": 0,
            "error": 0,
            "not_started": 0,
        }

        summary_list = []
        for segment in segments:
            summary = summary_map.get(segment.id)
            if summary:
                status = summary.status
                status_counts[status] = status_counts.get(status, 0) + 1
                summary_list.append(
                    {
                        "segment_id": segment.id,
                        "segment_position": segment.position,
                        "status": summary.status,
                        "summary_preview": (
                            summary.summary_content[:100] + "..."
                            if summary.summary_content and len(summary.summary_content) > 100
                            else summary.summary_content
                        ),
                        "error": summary.error,
                        "created_at": int(summary.created_at.timestamp()) if summary.created_at else None,
                        "updated_at": int(summary.updated_at.timestamp()) if summary.updated_at else None,
                    }
                )
            else:
                status_counts["not_started"] += 1
                summary_list.append(
                    {
                        "segment_id": segment.id,
                        "segment_position": segment.position,
                        "status": "not_started",
                        "summary_preview": None,
                        "error": None,
                        "created_at": None,
                        "updated_at": None,
                    }
                )

        return {
            "total_segments": total_segments,
            "summary_status": status_counts,
            "summaries": summary_list,
        }
