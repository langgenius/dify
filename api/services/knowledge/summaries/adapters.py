"""Adapters for existing ORM-based summary callers and indexing infrastructure."""

import logging
import time
import uuid
from collections.abc import Callable
from typing import TypedDict, cast

from sqlalchemy import select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from core.credit_usage import CreditUsageCreatedBy
from core.db.session_factory import session_factory
from core.model_context import with_credit_usage_created_by
from core.model_manager import ModelManager
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from core.rag.models.document import Document
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.model_entities import ModelType
from libs import helper
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, DocumentSegment, DocumentSegmentSummary
from models.dataset import Document as DatasetDocument
from models.enums import SummaryStatus
from repositories.knowledge.segment_query_repository import get_segment_document, get_segments_for_document
from repositories.knowledge.summary_repository import SQLAlchemySummaryRepository, get_documents_summary_index_status
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.summaries.application import SummaryIndexService, SummaryVectorInput, SummaryVectorResult

logger = logging.getLogger(__name__)


def _delete_summary_vectors(dataset: Dataset, node_ids: list[str], *, session: Session) -> None:
    # Legacy callers own this transaction; committing here breaks session.begin().
    # Document cleanup tasks materialize their inputs before deleting external indexes.
    vector_type = Vector.resolve_vector_type(dataset, session=session)
    Vector(dataset, session=None, vector_type=vector_type).delete_by_ids(node_ids)


class SummaryEntryDict(TypedDict):
    segment_id: str
    segment_position: int
    status: str
    summary_preview: str | None
    error: str | None
    created_at: int | None
    updated_at: int | None


class DocumentSummaryStatusDetailDict(TypedDict):
    total_segments: int
    summary_status: dict[str, int]
    summaries: list[SummaryEntryDict]


class SummaryIndexAdapter:
    """Adapt existing indexing callers to summary generation, storage and vectors."""

    @staticmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def generate_summary_for_segment(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_index_setting: SummaryIndexSettingDict,
        *,
        session: Session,
    ) -> tuple[str, LLMUsage]:
        """
        Generate summary for a single segment.

        Args:
            segment: DocumentSegment to generate summary for
            dataset: Dataset containing the segment
            summary_index_setting: Summary index configuration

        Keyword Args:
            session: Caller session, committed after loading generation inputs and
                before invoking the model. Image reads use a separate bounded session.

        Returns:
            Tuple of (summary_content, llm_usage) where llm_usage is LLMUsage object

        Raises:
            ValueError: If summary_index_setting is invalid or generation fails
        """
        # Lazy import avoids the index processor's circular dependency on this adapter.
        from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor

        # Get document language to ensure summary is generated in the correct language
        # This is especially important for image-only chunks where text is empty or minimal
        document_language = None
        document = get_segment_document(segment, session=session)
        if document and document.doc_language:
            document_language = document.doc_language

        tenant_id, text, segment_id = dataset.tenant_id, segment.content, segment.id
        if segment.tenant_id != tenant_id or segment.dataset_id != dataset.id:
            raise ValueError("Segment does not belong to the dataset")
        session.commit()

        def load_images():
            with session_factory.create_session() as image_session:
                images = ParagraphIndexProcessor._extract_images_from_segment_attachments(
                    tenant_id, segment_id, image_session
                )
                return images or ParagraphIndexProcessor._extract_images_from_text(tenant_id, text, image_session)

        summary_content, usage = ParagraphIndexProcessor.generate_summary_from_inputs(
            tenant_id=tenant_id,
            text=text,
            summary_index_setting=summary_index_setting,
            document_language=document_language,
            image_loader=load_images,
        )

        if not summary_content:
            raise ValueError("Generated summary is empty")

        return summary_content, usage

    @staticmethod
    def create_summary_record(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_content: str,
        status: SummaryStatus = SummaryStatus.GENERATING,
        *,
        session: Session,
    ) -> DocumentSegmentSummary:
        """
        Create or update a DocumentSegmentSummary record.
        If a summary record already exists for this segment, it will be updated instead of creating a new one.

        Args:
            segment: DocumentSegment to create summary for
            dataset: Dataset containing the segment
            summary_content: Generated summary content
            status: Summary status (default: SummaryStatus.GENERATING)

        Keyword Args:
            session: SQLAlchemy session used for the summary record.

        Returns:
            Created or updated DocumentSegmentSummary instance
        """
        # Check if summary record already exists
        existing_summary = session.scalar(
            select(DocumentSegmentSummary)
            .where(
                DocumentSegmentSummary.chunk_id == segment.id,
                DocumentSegmentSummary.dataset_id == dataset.id,
            )
            .limit(1)
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
    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def vectorize_summary(
        summary_record: DocumentSegmentSummary,
        segment: DocumentSegment,
        dataset: Dataset,
        session: Session | None = None,
        *,
        new_session: Callable[[], Session] | None = None,
        vector_factory: Callable[[], Vector] | None = None,
    ) -> bool:
        """Bridge already-authorized ORM callers to the detached summary use case.

        Pending summary writes are committed before external I/O. Each outcome
        attempt then owns a separate transaction, including retries and failures.

        Returns whether this attempt still owned and published the summary row.
        """
        if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
            return False
        ref = DatasetRef(dataset.tenant_id, dataset.id).document(segment.document_id).segment(segment.id)
        if segment.dataset_id != dataset.id or segment.tenant_id != dataset.tenant_id:
            raise ValueError("Segment does not belong to the dataset")
        if (
            summary_record.dataset_id != dataset.id
            or summary_record.document_id != segment.document_id
            or summary_record.chunk_id != segment.id
        ):
            raise ValueError("Summary does not belong to the segment")
        if session is not None:
            # Persist an attempt-local CAS token before releasing this session
            # for vector I/O. Content and node identity alone cannot distinguish
            # two requests that intentionally publish the same text.
            summary_record.updated_at = naive_utc_now()
            session.add(summary_record)
            session.flush()
        command = SummaryVectorInput(
            ref,
            summary_record.id,
            summary_record.summary_content or "",
            summary_record.summary_index_node_id,
            summary_record.updated_at,
            str(summary_record.status),
            summary_record.enabled,
        )
        if not command.content.strip():
            raise ValueError(f"Summary content is empty for segment {segment.id}, cannot vectorize")
        if session is not None:
            session.commit()
        create_session = new_session or session_factory.create_session
        store = SQLAlchemySummaryRepository(new_session=create_session)
        try:
            with create_session() as read_session:
                owned_dataset = read_session.scalar(
                    select(Dataset).where(
                        Dataset.id == ref.document.dataset.dataset_id,
                        Dataset.tenant_id == ref.document.dataset.tenant_id,
                    )
                )
                owned_segment = read_session.scalar(
                    select(DocumentSegment).where(
                        DocumentSegment.id == ref.segment_id,
                        DocumentSegment.tenant_id == ref.document.dataset.tenant_id,
                        DocumentSegment.dataset_id == ref.document.dataset.dataset_id,
                        DocumentSegment.document_id == ref.document.document_id,
                    )
                )
                owned_document = read_session.scalar(
                    select(DatasetDocument).where(
                        DatasetDocument.id == ref.document.document_id,
                        DatasetDocument.dataset_id == ref.document.dataset.dataset_id,
                        DatasetDocument.tenant_id == ref.document.dataset.tenant_id,
                    )
                )
                if owned_dataset is None or owned_segment is None or owned_document is None:
                    raise LookupError("Summary segment no longer exists in this dataset")
                vector_type = (
                    Vector.resolve_vector_type(owned_dataset, session=read_session) if vector_factory is None else None
                )
        except Exception as error:
            if store.failed(command, f"Vectorization failed: {error}"):
                set_committed_value(summary_record, "status", SummaryStatus.ERROR)
                set_committed_value(summary_record, "error", f"Vectorization failed: {error}")
            raise
        factory = vector_factory or (lambda: Vector(owned_dataset, session=None, vector_type=vector_type))
        service = SummaryIndexService(
            store=store,
            vectors=SummaryVectorGateway(owned_dataset, factory),
            new_id=lambda: str(uuid.uuid4()),
            text_hash=helper.generate_text_hash,
            sleep=time.sleep,
        )
        result = service.vectorize(command)
        if result is None:
            return False
        set_committed_value(summary_record, "summary_index_node_id", result.node_id)
        set_committed_value(summary_record, "summary_index_node_hash", result.content_hash)
        set_committed_value(summary_record, "tokens", result.tokens)
        set_committed_value(summary_record, "status", SummaryStatus.COMPLETED)
        set_committed_value(summary_record, "error", None)
        return True

    @staticmethod
    def batch_create_summary_records(
        segments: list[DocumentSegment],
        dataset: Dataset,
        status: SummaryStatus = SummaryStatus.NOT_STARTED,
    ) -> None:
        """
        Batch create summary records for segments with specified status.
        If a record already exists, update its status.

        Args:
            segments: List of DocumentSegment instances
            dataset: Dataset containing the segments
            status: Initial status for the records (default: SummaryStatus.NOT_STARTED)
        """
        segment_ids = [segment.id for segment in segments]
        if not segment_ids:
            return

        with session_factory.create_session() as session:
            # Query existing summary records
            existing_summaries = session.scalars(
                select(DocumentSegmentSummary).where(
                    DocumentSegmentSummary.chunk_id.in_(segment_ids),
                    DocumentSegmentSummary.dataset_id == dataset.id,
                )
            ).all()
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
    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def generate_and_vectorize_summary(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_index_setting: SummaryIndexSettingDict,
        *,
        session: Session,
    ) -> DocumentSegmentSummary | None:
        """
        Generate summary for a segment and vectorize it.
        Assumes summary record already exists (created by batch_create_summary_records).

        Args:
            segment: DocumentSegment to generate summary for
            dataset: Dataset containing the segment
            summary_index_setting: Summary index configuration

        Keyword Args:
            session: SQLAlchemy session used for summary record updates.

        Returns:
            The current summary record, or ``None`` if it was removed while
            this attempt was doing external work.

        Raises:
            ValueError: If summary generation fails
        """
        generation_command: SummaryVectorInput | None = None
        try:
            # Get or refresh summary record in this session
            summary_record_in_session = session.scalar(
                select(DocumentSegmentSummary)
                .where(
                    DocumentSegmentSummary.chunk_id == segment.id,
                    DocumentSegmentSummary.dataset_id == dataset.id,
                )
                .limit(1)
            )

            if not summary_record_in_session:
                # If not found, create one
                logger.warning("Summary record not found for segment %s, creating one", segment.id)
                summary_record_in_session = DocumentSegmentSummary(
                    dataset_id=dataset.id,
                    document_id=segment.document_id,
                    chunk_id=segment.id,
                    summary_content="",
                    status=SummaryStatus.GENERATING,
                    enabled=True,
                )
                session.add(summary_record_in_session)
                session.flush()

            # Update status to "generating"
            summary_record_in_session.status = SummaryStatus.GENERATING
            summary_record_in_session.error = None
            summary_record_in_session.updated_at = naive_utc_now()
            session.add(summary_record_in_session)
            session.flush()
            generation_command = SummaryVectorInput(
                DatasetRef(dataset.tenant_id, dataset.id).document(segment.document_id).segment(segment.id),
                summary_record_in_session.id,
                summary_record_in_session.summary_content or "",
                summary_record_in_session.summary_index_node_id,
                summary_record_in_session.updated_at,
                str(summary_record_in_session.status),
                summary_record_in_session.enabled,
            )
            # Persist GENERATING and release the write transaction before LLM I/O.
            session.commit()

            # Generate summary (returns summary_content and llm_usage)
            summary_content, llm_usage = SummaryIndexAdapter.generate_summary_for_segment(
                segment, dataset, summary_index_setting, session=session
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

            published = SummaryIndexAdapter.vectorize_summary(
                summary_record_in_session, segment, dataset, session=session
            )
            if not published:
                session.expire_all()
                return session.scalar(
                    select(DocumentSegmentSummary).where(
                        DocumentSegmentSummary.id == summary_record_in_session.id,
                        DocumentSegmentSummary.dataset_id == dataset.id,
                        DocumentSegmentSummary.document_id == segment.document_id,
                        DocumentSegmentSummary.chunk_id == segment.id,
                    )
                )
            # vectorize_summary mutates status and token fields; refresh before returning the ORM object.
            session.refresh(summary_record_in_session)
            session.commit()
            logger.info("Successfully generated and vectorized summary for segment %s", segment.id)
            return summary_record_in_session

        except Exception as e:
            logger.exception("Failed to generate summary for segment %s", segment.id)
            session.rollback()
            if generation_command is not None:
                SQLAlchemySummaryRepository(new_session=session_factory.create_session).failed(
                    generation_command,
                    f"Summary generation failed: {e}",
                )
            raise

    @staticmethod
    def generate_summaries_for_document(
        dataset: Dataset,
        document: DatasetDocument,
        summary_index_setting: SummaryIndexSettingDict,
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
        if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
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
            stmt = select(DocumentSegment).where(
                DocumentSegment.dataset_id == dataset.id,
                DocumentSegment.document_id == document.id,
                DocumentSegment.status == "completed",
                DocumentSegment.enabled.is_(True),  # Only generate summaries for enabled segments
            )

            if segment_ids:
                stmt = stmt.where(DocumentSegment.id.in_(segment_ids))

            segments = list(session.scalars(stmt).all())

            if not segments:
                logger.info("No segments found for document %s", document.id)
                return []

            session.commit()
            # Batch create summary records with "not_started" status before processing
            # This ensures all records exist upfront, allowing status tracking
            SummaryIndexAdapter.batch_create_summary_records(
                segments=segments,
                dataset=dataset,
                status=SummaryStatus.NOT_STARTED,
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
                    summary_record = SummaryIndexAdapter.generate_and_vectorize_summary(
                        segment, dataset, summary_index_setting, session=session
                    )
                    if summary_record is not None:
                        summary_records.append(summary_record)
                except Exception:
                    logger.exception("Failed to generate summary for segment %s", segment.id)
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
            stmt = select(DocumentSegmentSummary).where(
                DocumentSegmentSummary.dataset_id == dataset.id,
                DocumentSegmentSummary.enabled.is_(True),  # Only disable enabled summaries
            )

            if segment_ids:
                stmt = stmt.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))

            summaries = session.scalars(stmt).all()

            if not summaries:
                return

            logger.info(
                "Disabling %s summary records for dataset %s, segment_ids: %s",
                len(summaries),
                dataset.id,
                len(segment_ids) if segment_ids else "all",
            )

            # Remove from vector database (but keep records)
            if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
                summary_node_ids = [s.summary_index_node_id for s in summaries if s.summary_index_node_id]
                if summary_node_ids:
                    try:
                        _delete_summary_vectors(dataset, summary_node_ids, session=session)
                    except Exception:
                        logger.warning("Failed to remove summary vectors", exc_info=True)

            # Disable summary records (don't delete)
            now = naive_utc_now()
            session.execute(
                update(DocumentSegmentSummary)
                .where(DocumentSegmentSummary.id.in_(s.id for s in summaries))
                .values(enabled=False, disabled_at=now, disabled_by=disabled_by)
            )
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
        if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
            return

        with session_factory.create_session() as session:
            stmt = select(DocumentSegmentSummary).where(
                DocumentSegmentSummary.dataset_id == dataset.id,
                DocumentSegmentSummary.enabled.is_(False),  # Only enable disabled summaries
            )

            if segment_ids:
                stmt = stmt.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))

            summaries = session.scalars(stmt).all()

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
                segment = session.scalar(
                    select(DocumentSegment)
                    .where(
                        DocumentSegment.id == summary.chunk_id,
                        DocumentSegment.dataset_id == dataset.id,
                    )
                    .limit(1)
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
                    if not SummaryIndexAdapter.vectorize_summary(summary, segment, dataset, session=session):
                        continue

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
        *,
        document_id: str | None = None,
        session: Session,
    ) -> None:
        """
        Delete summary records and vectors for segments (used only for actual deletion scenarios).
        For disable/enable operations, use disable_summaries_for_segments/enable_summaries_for_segments.

        Args:
            dataset: Dataset containing the segments
            segment_ids: List of segment IDs to delete summaries for. If None, delete all.
            document_id: Optional document owner scope for asynchronous cleanup.
        """
        stmt = select(DocumentSegmentSummary).where(DocumentSegmentSummary.dataset_id == dataset.id)

        if document_id is not None:
            stmt = stmt.where(DocumentSegmentSummary.document_id == document_id)
        if segment_ids:
            stmt = stmt.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))

        summaries = session.scalars(stmt).all()

        if not summaries:
            return

        # Preserve the caller's transaction until it decides to commit or roll back.
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            summary_node_ids = [s.summary_index_node_id for s in summaries if s.summary_index_node_id]
            if summary_node_ids:
                _delete_summary_vectors(dataset, summary_node_ids, session=session)

        # Delete summary records in the caller's existing transaction.
        for summary in summaries:
            session.delete(summary)

        session.flush()
        logger.info("Deleted %s summary records for dataset %s", len(summaries), dataset.id)

    @staticmethod
    def update_summary_for_segment(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_content: str,
        *,
        session: Session,
    ) -> DocumentSegmentSummary | None:
        """
        Update summary for a segment and re-vectorize it.

        Args:
            segment: DocumentSegment to update summary for
            dataset: Dataset containing the segment
            summary_content: New summary content

        Keyword Args:
            session: SQLAlchemy session used for summary record updates.

        Returns:
            Updated DocumentSegmentSummary instance, or None if indexing technique is not high_quality
        """
        # Only update summary index for high_quality indexing technique
        if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
            return None

        # When user manually provides summary, allow saving even if summary_index_setting doesn't exist
        # summary_index_setting is only needed for LLM generation, not for manual summary vectorization
        # Vectorization uses dataset.embedding_model, which doesn't require summary_index_setting

        # Skip qa_model documents
        document = get_segment_document(segment, session=session)
        if document and document.doc_form == "qa_model":
            return None

        try:
            summary_record = session.scalar(
                select(DocumentSegmentSummary)
                .where(
                    DocumentSegmentSummary.chunk_id == segment.id,
                    DocumentSegmentSummary.dataset_id == dataset.id,
                )
                .limit(1)
            )

            # Check if summary_content is empty (whitespace-only strings are considered empty)
            if not summary_content or not summary_content.strip():
                # If summary is empty, only delete existing summary vector and record
                if summary_record:
                    # Delete old vector if exists
                    old_summary_node_id = summary_record.summary_index_node_id
                    if old_summary_node_id:
                        try:
                            _delete_summary_vectors(dataset, [old_summary_node_id], session=session)
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

            if summary_record:
                # Update summary content
                summary_record.summary_content = summary_content
                summary_record.status = SummaryStatus.GENERATING
                summary_record.error = None  # Clear any previous errors
                session.add(summary_record)
                # Flush to ensure summary_content is saved before vectorize_summary queries it
                session.flush()

            else:
                # Create new summary record if doesn't exist
                summary_record = SummaryIndexAdapter.create_summary_record(
                    segment,
                    dataset,
                    summary_content,
                    status=SummaryStatus.GENERATING,
                    session=session,
                )

            summary_id = summary_record.id
            try:
                # Vectorization must finish here so the manual summary is searchable immediately.
                if not SummaryIndexAdapter.vectorize_summary(summary_record, segment, dataset, session=session):
                    session.expire_all()
                    return session.scalar(
                        select(DocumentSegmentSummary).where(
                            DocumentSegmentSummary.id == summary_record.id,
                            DocumentSegmentSummary.dataset_id == dataset.id,
                            DocumentSegmentSummary.document_id == segment.document_id,
                            DocumentSegmentSummary.chunk_id == segment.id,
                        )
                    )
                session.refresh(summary_record)
                session.commit()
                logger.info("Successfully updated and re-vectorized summary for segment %s", segment.id)
                return summary_record
            except Exception:
                # The vectorization repository owns the conditional failure write.
                # Roll back this session's stale identity-map state before reading
                # the row that may have been edited by another request meanwhile.
                logger.exception("Failed to vectorize summary for segment %s", segment.id)
                session.rollback()
                session.expire_all()
                return session.scalar(
                    select(DocumentSegmentSummary).where(
                        DocumentSegmentSummary.id == summary_id,
                        DocumentSegmentSummary.dataset_id == dataset.id,
                        DocumentSegmentSummary.document_id == segment.document_id,
                        DocumentSegmentSummary.chunk_id == segment.id,
                    )
                )

        except Exception:
            logger.exception("Failed to update summary for segment %s", segment.id)
            session.rollback()
            raise

    @staticmethod
    def get_segment_summary(
        segment_id: str,
        dataset_id: str,
        *,
        session: Session,
    ) -> DocumentSegmentSummary | None:
        """
        Get summary for a single segment.

        Args:
            segment_id: Segment ID (chunk_id)
            dataset_id: Dataset ID

        Keyword Args:
            session: SQLAlchemy session used to read summary records.

        Returns:
            DocumentSegmentSummary instance if found, None otherwise
        """
        return session.scalar(
            select(DocumentSegmentSummary)
            .where(
                DocumentSegmentSummary.chunk_id == segment_id,
                DocumentSegmentSummary.dataset_id == dataset_id,
                DocumentSegmentSummary.enabled.is_(True),
            )
            .limit(1)
        )

    @staticmethod
    def get_segments_summaries(
        segment_ids: list[str],
        dataset_id: str,
        *,
        session: Session,
    ) -> dict[str, DocumentSegmentSummary]:
        """
        Get summaries for multiple segments.

        Args:
            segment_ids: List of segment IDs (chunk_ids)
            dataset_id: Dataset ID

        Keyword Args:
            session: SQLAlchemy session used to read summary records.

        Returns:
            Dictionary mapping segment_id to DocumentSegmentSummary (only enabled summaries)
        """
        if not segment_ids:
            return {}

        summaries = session.scalars(
            select(DocumentSegmentSummary).where(
                DocumentSegmentSummary.chunk_id.in_(segment_ids),
                DocumentSegmentSummary.dataset_id == dataset_id,
                DocumentSegmentSummary.enabled.is_(True),
            )
        ).all()
        return {summary.chunk_id: summary for summary in summaries}

    @staticmethod
    def get_document_summaries(
        document_id: str,
        dataset_id: str,
        segment_ids: list[str] | None = None,
        *,
        session: Session,
    ) -> list[DocumentSegmentSummary]:
        """
        Get all summary records for a document.

        Args:
            document_id: Document ID
            dataset_id: Dataset ID
            segment_ids: Optional list of segment IDs to filter by

        Keyword Args:
            session: SQLAlchemy session used to read summary records.

        Returns:
            List of DocumentSegmentSummary instances (only enabled summaries)
        """
        stmt = select(DocumentSegmentSummary).where(
            DocumentSegmentSummary.document_id == document_id,
            DocumentSegmentSummary.dataset_id == dataset_id,
            DocumentSegmentSummary.enabled.is_(True),
        )

        if segment_ids:
            stmt = stmt.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))

        return list(session.scalars(stmt).all())

    @staticmethod
    def get_document_summary_index_status(
        document_id: str,
        dataset_id: str,
        tenant_id: str,
        *,
        session: Session,
    ) -> str | None:
        """
        Get summary_index_status for a single document.

        Args:
            document_id: Document ID
            dataset_id: Dataset ID
            tenant_id: Tenant ID

        Keyword Args:
            session: SQLAlchemy session used to read summary status.

        Returns:
            "SUMMARIZING" if there are pending summaries, None otherwise
        """
        return get_documents_summary_index_status(
            session,
            document_ids=(document_id,),
            tenant_id=tenant_id,
            dataset_id=dataset_id,
        )[document_id]

    @staticmethod
    def get_documents_summary_index_status(
        document_ids: list[str],
        dataset_id: str,
        tenant_id: str,
        *,
        session: Session,
    ) -> dict[str, str | None]:
        """
        Get summary_index_status for multiple documents.

        Args:
            document_ids: List of document IDs
            dataset_id: Dataset ID
            tenant_id: Tenant ID

        Keyword Args:
            session: SQLAlchemy session used to read summary status.

        Returns:
            Dictionary mapping document_id to summary_index_status ("SUMMARIZING" or None)
        """
        return get_documents_summary_index_status(
            session,
            document_ids=document_ids,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
        )

    @staticmethod
    def get_document_summary_status_detail(
        document_id: str,
        dataset_id: str,
        session: Session,
        *,
        tenant_id: str,
    ) -> DocumentSummaryStatusDetailDict:
        """
        Get detailed summary status for a document.

        Args:
            document_id: Document ID
            dataset_id: Dataset ID
            tenant_id: Owning tenant ID
            session: SQLAlchemy session used for segment lookup

        Returns:
            Dictionary containing:
            - total_segments: Total number of segments in the document
            - summary_status: Dictionary with status counts
              - completed: Number of summaries completed
              - generating: Number of summaries being generated
              - error: Number of summaries with errors
              - not_started: Number of segments without summary records
              - timeout: Number of summaries that timed out
            - summaries: List of summary records with status and content preview
        """
        segments = get_segments_for_document(
            session,
            tenant_id=tenant_id,
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
            summaries = SummaryIndexAdapter.get_document_summaries(
                document_id=document_id,
                dataset_id=dataset_id,
                segment_ids=segment_ids,
                session=session,
            )

        # Create a mapping of chunk_id to summary
        summary_map = {summary.chunk_id: summary for summary in summaries}

        # Count statuses
        status_counts = {
            SummaryStatus.COMPLETED: 0,
            SummaryStatus.GENERATING: 0,
            SummaryStatus.ERROR: 0,
            SummaryStatus.NOT_STARTED: 0,
        }

        summary_list: list[SummaryEntryDict] = []
        for segment in segments:
            summary = summary_map.get(segment.id)
            if summary:
                status = SummaryStatus(summary.status)
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
                status_counts[SummaryStatus.NOT_STARTED] += 1
                summary_list.append(
                    {
                        "segment_id": segment.id,
                        "segment_position": segment.position,
                        "status": SummaryStatus.NOT_STARTED,
                        "summary_preview": None,
                        "error": None,
                        "created_at": None,
                        "updated_at": None,
                    }
                )

        return DocumentSummaryStatusDetailDict(
            total_segments=total_segments,
            summary_status=cast(dict[str, int], status_counts),
            summaries=summary_list,
        )


class SummaryVectorGateway:
    def __init__(self, dataset: Dataset, factory: Callable[[], Vector]) -> None:
        self._dataset, self._factory = dataset, factory

    def delete(self, node_id: str) -> None:
        self._factory().delete_by_ids([node_id])

    def count_tokens(self, content: str) -> int:
        dataset = self._dataset
        model = ModelManager.for_tenant(tenant_id=dataset.tenant_id).get_model_instance(
            tenant_id=dataset.tenant_id,
            provider=dataset.embedding_model_provider or "",
            model_type=ModelType.TEXT_EMBEDDING,
            model=dataset.embedding_model or "",
        )
        tokens = model.get_text_embedding_num_tokens([content])
        return tokens[0] if tokens and isinstance(tokens[0], int) else 0

    def write(self, command: SummaryVectorInput, result: SummaryVectorResult) -> None:
        document = Document(
            page_content=command.content,
            metadata={
                "doc_id": result.node_id,
                "doc_hash": result.content_hash,
                "dataset_id": command.ref.document.dataset.dataset_id,
                "document_id": command.ref.document.document_id,
                "original_chunk_id": command.ref.segment_id,
                "doc_type": DocType.TEXT,
                "is_summary": True,
            },
        )
        self._factory().add_texts([document], duplicate_check=False)
