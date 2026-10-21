"""Adapters for existing ORM-based summary callers and indexing infrastructure."""

import logging
import time
import uuid
from collections.abc import Callable
from typing import TypedDict, cast

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
from models.dataset import Dataset, DocumentSegment, DocumentSegmentSummary
from models.dataset import Document as DatasetDocument
from models.enums import SummaryStatus
from repositories.knowledge.segment_query_repository import get_segment_document
from repositories.knowledge.summary_repository import (
    SQLAlchemySummaryRepository,
    delete_summaries,
    disable_summaries,
    ensure_summary_records,
    list_disabled_summary_candidates,
    list_document_summary_rows,
    list_enabled_summaries,
    list_segments_for_summary_generation,
    list_summaries,
    load_vectorization_owners,
    mark_summary_error,
    prepare_summary_generation,
    refresh_summary,
)
from repositories.knowledge.summary_repository import (
    get_documents_summary_index_status as get_summary_status_by_document,
)
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.summaries.application import (
    SummaryCompletionAckError,
    SummaryIndexService,
    SummaryVectorInput,
    SummaryVectorResult,
    SummaryWriteFence,
    SummaryWriteFenceLostError,
)
from services.knowledge.task_outbox.contracts import KnowledgeTaskExecutionLeaseLostError

logger = logging.getLogger(__name__)


def _summary_write_fence(
    dataset: Dataset,
    document: DatasetDocument,
    segment: DocumentSegment,
    *,
    expected_segment_status: str = "completed",
) -> SummaryWriteFence:
    return SummaryWriteFence(
        expected_document_generation=document.indexing_generation,
        enforce_document_generation=True,
        expected_segment_generation=segment.indexing_generation,
        enforce_segment_generation=True,
        expected_segment_status=expected_segment_status,
        expected_indexing_technique=str(dataset.indexing_technique),
        expected_embedding_model_provider=dataset.embedding_model_provider,
        expected_embedding_model=dataset.embedding_model,
        expected_summary_index_setting=(
            dict(dataset.summary_index_setting) if dataset.summary_index_setting is not None else None
        ),
        enforce_summary_index_setting=True,
    )


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

        if not summary_content.strip():
            raise ValueError("Generated summary is empty")

        return summary_content, usage

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
        fence: SummaryWriteFence | None = None,
    ) -> None:
        """Bridge already-authorized ORM callers to the detached summary use case.

        Pending summary writes are committed before external I/O. Each outcome
        attempt then owns a separate transaction, including retries and failures.
        """
        if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
            return
        ref = DatasetRef(dataset.tenant_id, dataset.id).document(segment.document_id).segment(segment.id)
        if segment.dataset_id != dataset.id or segment.tenant_id != dataset.tenant_id:
            raise ValueError("Segment does not belong to the dataset")
        if (
            summary_record.dataset_id != dataset.id
            or summary_record.document_id != segment.document_id
            or summary_record.chunk_id != segment.id
        ):
            raise ValueError("Summary does not belong to the segment")
        summary_content = summary_record.summary_content or ""
        if not summary_content.strip():
            raise ValueError(f"Summary content is empty for segment {segment.id}, cannot vectorize")
        if session is not None:
            session.commit()
        create_session = new_session or session_factory.create_session
        with create_session() as read_session:
            owned_dataset, owned_segment, owned_document = load_vectorization_owners(
                read_session,
                tenant_id=ref.document.dataset.tenant_id,
                dataset_id=ref.document.dataset.dataset_id,
                document_id=ref.document.document_id,
                segment_id=ref.segment_id,
            )
            if owned_dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
                raise SummaryWriteFenceLostError("Summary dataset is no longer high quality")
            vector_type = (
                Vector.resolve_vector_type(owned_dataset, session=read_session) if vector_factory is None else None
            )
            if fence is None:
                fence = _summary_write_fence(owned_dataset, owned_document, owned_segment)
        command = SummaryVectorInput(
            ref,
            summary_record.id,
            summary_content,
            summary_record.summary_index_node_id,
            fence,
        )
        factory = vector_factory or (lambda: Vector(owned_dataset, session=None, vector_type=vector_type))
        store = SQLAlchemySummaryRepository(new_session=create_session)
        store.assert_current(command)
        service = SummaryIndexService(
            store=store,
            vectors=SummaryVectorGateway(owned_dataset, factory),
            new_id=lambda: str(uuid.uuid4()),
            text_hash=helper.generate_text_hash,
            sleep=time.sleep,
        )
        try:
            result = service.vectorize(command)
        except Exception as error:
            set_committed_value(summary_record, "status", SummaryStatus.ERROR)
            set_committed_value(summary_record, "error", f"Vectorization failed: {error}")
            raise
        set_committed_value(summary_record, "summary_index_node_id", result.node_id)
        set_committed_value(summary_record, "summary_index_node_hash", result.content_hash)
        set_committed_value(summary_record, "tokens", result.tokens)
        set_committed_value(summary_record, "status", SummaryStatus.COMPLETED)
        set_committed_value(summary_record, "error", None)

    @staticmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
    def generate_and_vectorize_summary(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_index_setting: SummaryIndexSettingDict,
        *,
        session: Session,
        fence: SummaryWriteFence | None = None,
        reuse_generated_content: bool = False,
        new_session: Callable[[], Session] | None = None,
        vector_factory: Callable[[], Vector] | None = None,
    ) -> DocumentSegmentSummary:
        """
        Generate summary for a segment and vectorize it.
        Reuses the repository-owned pending record when document generation created one.

        Args:
            segment: DocumentSegment to generate summary for
            dataset: Dataset containing the segment
            summary_index_setting: Summary index configuration

        Keyword Args:
            session: SQLAlchemy session used for summary record updates.

        Returns:
            Created DocumentSegmentSummary instance

        Raises:
            ValueError: If summary generation fails
        """
        summary_record_in_session: DocumentSegmentSummary | None = None
        command: SummaryVectorInput | None = None
        create_session = new_session or session_factory.create_session
        store = SQLAlchemySummaryRepository(new_session=create_session)
        try:
            ref = DatasetRef(dataset.tenant_id, dataset.id).document(segment.document_id).segment(segment.id)
            if fence is None:
                owned_dataset, owned_segment, owned_document = load_vectorization_owners(
                    session,
                    tenant_id=ref.document.dataset.tenant_id,
                    dataset_id=ref.document.dataset.dataset_id,
                    document_id=ref.document.document_id,
                    segment_id=ref.segment_id,
                )
                fence = _summary_write_fence(owned_dataset, owned_document, owned_segment)
                dataset = owned_dataset
                segment = owned_segment
                if owned_dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
                    raise SummaryWriteFenceLostError("Summary dataset is no longer high quality")
                current_setting = owned_dataset.summary_index_setting
                if not current_setting or current_setting.get("enable") is not True:
                    raise SummaryWriteFenceLostError("Summary generation configuration is no longer enabled")
                summary_index_setting = current_setting
            command = SummaryVectorInput(ref, str(uuid.uuid4()), "", None, fence)
            summary_record_in_session = prepare_summary_generation(
                session,
                dataset_id=dataset.id,
                segment=segment,
                command=command,
            )
            command = SummaryVectorInput(
                ref,
                summary_record_in_session.id,
                summary_record_in_session.summary_content or "",
                summary_record_in_session.summary_index_node_id,
                fence,
            )
            # Persist GENERATING and release the write transaction before LLM I/O.
            session.commit()

            if reuse_generated_content and command.content.strip():
                summary_content = command.content
                llm_usage = None
            else:
                summary_content, llm_usage = SummaryIndexAdapter.generate_summary_for_segment(
                    segment, dataset, summary_index_setting, session=session
                )
                command = SummaryVectorInput(
                    ref,
                    summary_record_in_session.id,
                    summary_content,
                    summary_record_in_session.summary_index_node_id,
                    fence,
                )
                store.generated(command)
                set_committed_value(summary_record_in_session, "summary_content", summary_content)

            # Log LLM usage for summary generation
            if llm_usage and llm_usage.total_tokens > 0:
                logger.info(
                    "Summary generation for segment %s used %s tokens (prompt: %s, completion: %s)",
                    segment.id,
                    llm_usage.total_tokens,
                    llm_usage.prompt_tokens,
                    llm_usage.completion_tokens,
                )

            SummaryIndexAdapter.vectorize_summary(
                summary_record_in_session,
                segment,
                dataset,
                session=session,
                new_session=create_session,
                vector_factory=vector_factory,
                fence=fence,
            )
            # vectorize_summary mutates status and token fields; refresh before returning the ORM object.
            refresh_summary(session, summary_record_in_session)
            session.commit()
            logger.info("Successfully generated and vectorized summary for segment %s", segment.id)
            return summary_record_in_session

        except Exception as e:
            logger.exception("Failed to generate summary for segment %s", segment.id)
            session.rollback()
            if isinstance(e, (SummaryCompletionAckError, SummaryWriteFenceLostError)):
                raise
            if command is not None:
                store.failed(command, str(e))
            elif mark_summary_error(session, dataset_id=dataset.id, segment_id=segment.id, error=str(e)):
                session.commit()
            raise

    @staticmethod
    def generate_summaries_for_document(
        dataset: Dataset,
        document: DatasetDocument,
        summary_index_setting: SummaryIndexSettingDict,
        segment_ids: list[str] | None = None,
        only_parent_chunks: bool = False,
        expected_document_generation: str | None = None,
        enforce_document_generation: bool = False,
        task_intent_id: str | None = None,
        task_execution_id: str | None = None,
        expected_indexing_technique: str | None = None,
        expected_embedding_model_provider: str | None = None,
        expected_embedding_model: str | None = None,
        expected_summary_index_setting: dict[str, object] | None = None,
        assert_owned: Callable[[], None] | None = None,
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
            segments = list_segments_for_summary_generation(
                session,
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                segment_ids=segment_ids,
            )

            if not segments:
                logger.info("No segments found for document %s", document.id)
                return []

            session.commit()

            use_fence = enforce_document_generation or task_intent_id is not None or task_execution_id is not None
            if not use_fence:
                with session_factory.create_session() as write_session:
                    ensure_summary_records(
                        write_session,
                        dataset_id=dataset.id,
                        segments=segments,
                        status=SummaryStatus.NOT_STARTED,
                    )
                    write_session.commit()

            summary_records = []
            checkpoints = SQLAlchemySummaryRepository(new_session=session_factory.create_session)

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

                fence = (
                    SummaryWriteFence(
                        expected_document_generation=expected_document_generation,
                        enforce_document_generation=enforce_document_generation,
                        expected_segment_generation=segment.indexing_generation,
                        enforce_segment_generation=True,
                        task_intent_id=task_intent_id,
                        task_execution_id=task_execution_id,
                        expected_indexing_technique=expected_indexing_technique,
                        expected_embedding_model_provider=expected_embedding_model_provider,
                        expected_embedding_model=expected_embedding_model,
                        expected_summary_index_setting=expected_summary_index_setting,
                        enforce_summary_index_setting=True,
                    )
                    if use_fence
                    else None
                )
                checkpoint_command = SummaryVectorInput(
                    DatasetRef(dataset.tenant_id, dataset.id).document(document.id).segment(segment.id),
                    "checkpoint",
                    "checkpoint",
                    None,
                    fence,
                )
                checkpoint = checkpoints.checkpoint(checkpoint_command)
                if fence is not None and checkpoint.was_completed(checkpoint_command):
                    continue
                try:
                    if assert_owned is not None:
                        assert_owned()
                    summary_record = SummaryIndexAdapter.generate_and_vectorize_summary(
                        segment,
                        dataset,
                        summary_index_setting,
                        session=session,
                        fence=fence,
                        reuse_generated_content=(fence is not None and checkpoint.was_generated(checkpoint_command)),
                    )
                    if assert_owned is not None:
                        assert_owned()
                    summary_records.append(summary_record)
                except Exception as e:
                    logger.exception("Failed to generate summary for segment %s", segment.id)
                    if isinstance(e, (SummaryWriteFenceLostError, KnowledgeTaskExecutionLeaseLostError)):
                        raise
                    if fence is None:
                        with session_factory.create_session() as write_session:
                            if mark_summary_error(
                                write_session,
                                dataset_id=dataset.id,
                                segment_id=segment.id,
                                error=str(e),
                            ):
                                write_session.commit()
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
        with session_factory.create_session() as session:
            summaries = list_enabled_summaries(session, dataset_id=dataset.id, segment_ids=segment_ids)

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

            disable_summaries(session, summaries, disabled_by=disabled_by)
            session.commit()
            logger.info("Disabled %s summary records for dataset %s", len(summaries), dataset.id)

    @staticmethod
    def enable_summaries_for_segments(
        dataset: Dataset,
        segment_ids: list[str] | None = None,
        *,
        expected_segment_generation: str | None = None,
        raise_on_failure: bool = False,
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
            candidates = list_disabled_summary_candidates(
                session,
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                segment_ids=segment_ids,
                expected_segment_generation=expected_segment_generation,
            )

            if not candidates:
                return

            logger.info(
                "Enabling %s summary records for dataset %s, segment_ids: %s",
                len(candidates),
                dataset.id,
                len(segment_ids) if segment_ids else "all",
            )

            # Re-vectorize and re-add to vector database
            enabled_count = 0
            failed_summary_ids: list[str] = []
            store = SQLAlchemySummaryRepository(new_session=session_factory.create_session)
            for summary, segment in candidates:
                if not summary.summary_content:
                    continue

                try:
                    owned_dataset, owned_segment, owned_document = load_vectorization_owners(
                        session,
                        tenant_id=dataset.tenant_id,
                        dataset_id=dataset.id,
                        document_id=segment.document_id,
                        segment_id=segment.id,
                    )
                    fence = _summary_write_fence(
                        owned_dataset,
                        owned_document,
                        owned_segment,
                        expected_segment_status=str(owned_segment.status),
                    )
                    # Re-vectorize summary (this will update status and tokens in its own session)
                    # Pass the session to vectorize_summary to avoid session isolation issues
                    SummaryIndexAdapter.vectorize_summary(
                        summary,
                        owned_segment,
                        owned_dataset,
                        session=session,
                        fence=fence,
                    )

                    # Refresh the object from database to get the updated status and tokens from vectorize_summary
                    refresh_summary(session, summary)
                    store.enable(
                        SummaryVectorInput(
                            DatasetRef(owned_dataset.tenant_id, owned_dataset.id)
                            .document(owned_segment.document_id)
                            .segment(owned_segment.id),
                            summary.id,
                            summary.summary_content or "",
                            summary.summary_index_node_id,
                            fence,
                        )
                    )
                    enabled_count += 1
                except Exception:
                    logger.exception("Failed to re-vectorize summary %s", summary.id)
                    # Keep it disabled if vectorization fails
                    failed_summary_ids.append(summary.id)
                    continue

            session.commit()
            logger.info("Enabled %s summary records for dataset %s", enabled_count, dataset.id)
            if failed_summary_ids and raise_on_failure:
                raise RuntimeError("Failed to restore summary indexes: " + ", ".join(failed_summary_ids))

    @staticmethod
    def delete_summaries_for_segments(
        dataset: Dataset,
        segment_ids: list[str] | None = None,
        *,
        session: Session,
    ) -> None:
        """
        Delete summary records and vectors for segments (used only for actual deletion scenarios).
        For disable/enable operations, use disable_summaries_for_segments/enable_summaries_for_segments.

        Args:
            dataset: Dataset containing the segments
            segment_ids: List of segment IDs to delete summaries for. If None, delete all.
        """
        summaries = list_summaries(session, dataset_id=dataset.id, segment_ids=segment_ids)

        if not summaries:
            return

        # Preserve the caller's transaction until it decides to commit or roll back.
        if dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY:
            summary_node_ids = [s.summary_index_node_id for s in summaries if s.summary_index_node_id]
            if summary_node_ids:
                _delete_summary_vectors(dataset, summary_node_ids, session=session)

        delete_summaries(session, summaries)
        logger.info("Deleted %s summary records for dataset %s", len(summaries), dataset.id)

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
        return get_summary_status_by_document(
            session,
            document_ids=[document_id],
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
        return get_summary_status_by_document(
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
        rows = list_document_summary_rows(
            session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
        )
        total_segments = len(rows)

        # Count statuses
        status_counts = {
            SummaryStatus.COMPLETED: 0,
            SummaryStatus.GENERATING: 0,
            SummaryStatus.ERROR: 0,
            SummaryStatus.NOT_STARTED: 0,
        }

        summary_list: list[SummaryEntryDict] = []
        for segment, summary in rows:
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
