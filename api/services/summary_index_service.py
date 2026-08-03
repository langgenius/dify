"""Summary index service for generating and managing document segment summaries.

Summary vector publication is conditional on the source segment, summary row,
and dataset vector configuration remaining unchanged. This prevents slow work
from committing a pointer to a vector built with obsolete routing or embedding
settings.
"""

import logging
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import batched
from typing import Any, TypedDict, cast

from sqlalchemy import select, union_all
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.model_manager import ModelManager
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from core.rag.models.document import Document
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.model_entities import ModelType
from libs import helper
from models.dataset import (
    Dataset,
    DocumentSegment,
    DocumentSegmentSummary,
)
from models.dataset import Document as DatasetDocument
from models.enums import SummaryStatus

logger = logging.getLogger(__name__)

_GENERATION_CLAIM_PREFIX = "__summary_generation_claim__:"
_SUMMARY_GENERATION_CLAIM_TIMEOUT = timedelta(days=1)
_SUMMARY_VECTOR_CLEANUP_BATCH_SIZE = 500


class SummaryIndexConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class SummaryGenerationClaim:
    """Identifies one generation attempt and the segment content it summarizes."""

    dataset_id: str
    segment_id: str
    summary_record_id: str
    generation_token: str
    source_content_hash: str
    expected_summary_content: str | None = None
    expected_status: SummaryStatus = SummaryStatus.GENERATING
    expected_node_id: str | None = None
    expected_enabled: bool = True
    previous_error: str | None = None
    had_active_publication: bool = False


@dataclass(frozen=True)
class _SummaryVectorDatasetState:
    """Dataset fields that determine where and how a summary vector is built."""

    tenant_id: str
    indexing_technique: str | None
    embedding_model_provider: str | None
    embedding_model: str | None
    index_struct: str | None
    collection_binding_id: str | None


@dataclass(frozen=True)
class _SummaryVectorPublication:
    dataset_id: str
    segment_id: str
    segment_content: str
    summary_record_id: str
    summary_content: str
    old_node_id: str | None
    new_node_id: str
    summary_hash: str
    expected_enabled: bool
    expected_error: str | None
    expected_generation_token: str | None
    embedding_tokens: int
    expected_dataset_state: _SummaryVectorDatasetState
    expected_summary_content: str | None = None
    expected_status: SummaryStatus = SummaryStatus.GENERATING
    previous_error: str | None = None
    had_active_publication: bool = False


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


class SummaryIndexService:
    """Service for generating and managing summary indexes.

    Generation stores a tagged per-attempt claim in the otherwise-unused error field. A completed row keeps its
    published status and vector until the replacement succeeds, while status APIs interpret the claim as active work.
    The claim has a 24-hour lease and its token is also the pending vector ID, allowing status reads and competing
    mutations to reclaim abandoned work without a schema change. Every generated database write must still own its
    unexpired claim so slow work cannot overwrite a newer manual edit or generation attempt.
    """

    @staticmethod
    def _lock_segment_rows(session: Session, dataset_id: str, segment_ids: list[str] | None) -> None:
        if segment_ids == []:
            return

        stmt = select(DocumentSegment.id).where(DocumentSegment.dataset_id == dataset_id)
        if segment_ids is not None:
            stmt = stmt.where(DocumentSegment.id.in_(sorted(set(segment_ids))))
        session.execute(stmt.order_by(DocumentSegment.id).with_for_update()).all()

    @staticmethod
    def _publication_is_durable(publication: _SummaryVectorPublication) -> bool:
        """Reconcile a commit whose client acknowledgement may have been lost."""
        with session_factory.create_session() as session:
            summary = session.scalar(
                select(DocumentSegmentSummary).where(
                    DocumentSegmentSummary.id == publication.summary_record_id,
                    DocumentSegmentSummary.dataset_id == publication.dataset_id,
                    DocumentSegmentSummary.chunk_id == publication.segment_id,
                )
            )
            return bool(
                summary
                and summary.summary_index_node_id == publication.new_node_id
                and summary.summary_index_node_hash == publication.summary_hash
                and summary.summary_content == publication.summary_content
                and summary.status == SummaryStatus.COMPLETED
                and summary.error is None
            )

    @staticmethod
    def _get_summary_record(
        session: Session,
        segment_id: str,
        dataset_id: str,
        *,
        for_update: bool = False,
    ) -> DocumentSegmentSummary | None:
        stmt = (
            select(DocumentSegmentSummary)
            .where(
                DocumentSegmentSummary.chunk_id == segment_id,
                DocumentSegmentSummary.dataset_id == dataset_id,
            )
            .order_by(
                DocumentSegmentSummary.updated_at.desc(),
                DocumentSegmentSummary.id.desc(),
            )
            .limit(1)
        )
        if for_update:
            stmt = stmt.with_for_update()
        return session.scalar(stmt)

    @staticmethod
    def _get_segment_content(session: Session, dataset_id: str, segment_id: str) -> str | None:
        return session.scalar(
            select(DocumentSegment.content)
            .where(
                DocumentSegment.id == segment_id,
                DocumentSegment.dataset_id == dataset_id,
            )
            .limit(1)
        )

    @staticmethod
    def _summary_vector_dataset_state(dataset: Dataset) -> _SummaryVectorDatasetState:
        return _SummaryVectorDatasetState(
            tenant_id=dataset.tenant_id,
            indexing_technique=str(dataset.indexing_technique) if dataset.indexing_technique is not None else None,
            embedding_model_provider=dataset.embedding_model_provider,
            embedding_model=dataset.embedding_model,
            index_struct=dataset.index_struct,
            collection_binding_id=dataset.collection_binding_id,
        )

    @staticmethod
    def _get_publication_dataset(
        session: Session,
        publication: _SummaryVectorPublication,
    ) -> Dataset:
        """Lock and validate the vector-building dataset snapshot."""
        dataset = session.get(Dataset, publication.dataset_id, with_for_update=True)
        if dataset is None:
            raise SummaryIndexConflictError(
                f"Summary {publication.summary_record_id} dataset was deleted during vectorization"
            )
        if SummaryIndexService._summary_vector_dataset_state(dataset) != publication.expected_dataset_state:
            raise SummaryIndexConflictError(
                f"Summary {publication.summary_record_id} dataset configuration changed during vectorization"
            )
        return dataset

    @staticmethod
    def _publish_summary_vector(publication: _SummaryVectorPublication) -> datetime:
        """Commit a vector pointer only if its database inputs are unchanged."""
        with session_factory.create_session() as session:
            SummaryIndexService._lock_segment_rows(session, publication.dataset_id, [publication.segment_id])
            SummaryIndexService._get_publication_dataset(session, publication)
            summary = session.scalar(
                select(DocumentSegmentSummary)
                .where(
                    DocumentSegmentSummary.id == publication.summary_record_id,
                    DocumentSegmentSummary.dataset_id == publication.dataset_id,
                    DocumentSegmentSummary.chunk_id == publication.segment_id,
                )
                .with_for_update()
            )
            if summary is None:
                replacement = SummaryIndexService._get_summary_record(
                    session,
                    publication.segment_id,
                    publication.dataset_id,
                    for_update=True,
                )
                if replacement is None:
                    raise SummaryIndexConflictError(
                        f"Summary {publication.summary_record_id} was deleted while segment "
                        f"{publication.segment_id} was being vectorized"
                    )
                raise SummaryIndexConflictError(
                    f"Summary {publication.summary_record_id} was replaced by {replacement.id} while segment "
                    f"{publication.segment_id} was being vectorized"
                )

            source_changed = (
                publication.expected_generation_token is not None
                and SummaryIndexService._get_segment_content(
                    session,
                    publication.dataset_id,
                    publication.segment_id,
                )
                != publication.segment_content
            )
            if (
                summary.summary_index_node_id != publication.old_node_id
                or summary.summary_content != publication.expected_summary_content
                or summary.status != publication.expected_status
                or summary.enabled != publication.expected_enabled
                or summary.error != publication.expected_error
                or (
                    publication.expected_generation_token is not None
                    and SummaryIndexService._generation_claim_is_stale(summary)
                )
                or source_changed
                or not SummaryIndexService._segment_allows_summary(
                    session,
                    publication.dataset_id,
                    publication.segment_id,
                )
            ):
                raise SummaryIndexConflictError(f"Summary {publication.summary_record_id} vectorization was superseded")

            updated_at = datetime.now(UTC).replace(tzinfo=None)
            summary.summary_index_node_id = publication.new_node_id
            summary.summary_index_node_hash = publication.summary_hash
            summary.summary_content = publication.summary_content
            summary.tokens = publication.embedding_tokens
            summary.status = SummaryStatus.COMPLETED
            summary.error = None
            summary.updated_at = updated_at
            session.add(summary)
            session.commit()
            return updated_at

    @staticmethod
    def _record_vectorization_failure(
        publication: _SummaryVectorPublication,
        error: Exception,
        target: DocumentSegmentSummary,
    ) -> None:
        """Mark only the exact, unchanged summary row as failed."""
        with session_factory.create_session() as session:
            SummaryIndexService._lock_segment_rows(session, publication.dataset_id, [publication.segment_id])
            try:
                SummaryIndexService._get_publication_dataset(session, publication)
            except SummaryIndexConflictError:
                logger.info(
                    "Skipped stale vectorization error for summary %s after dataset configuration changed",
                    publication.summary_record_id,
                )
                return
            summary = session.scalar(
                select(DocumentSegmentSummary)
                .where(
                    DocumentSegmentSummary.id == publication.summary_record_id,
                    DocumentSegmentSummary.dataset_id == publication.dataset_id,
                    DocumentSegmentSummary.chunk_id == publication.segment_id,
                )
                .with_for_update()
            )
            if summary is None:
                logger.info(
                    "Skipped vectorization error for deleted summary %s",
                    publication.summary_record_id,
                )
                return

            source_changed = (
                publication.expected_generation_token is not None
                and SummaryIndexService._get_segment_content(
                    session,
                    publication.dataset_id,
                    publication.segment_id,
                )
                != publication.segment_content
            )
            if (
                summary.summary_index_node_id != publication.old_node_id
                or summary.summary_content != publication.expected_summary_content
                or summary.status != publication.expected_status
                or summary.enabled != publication.expected_enabled
                or summary.error != publication.expected_error
                or source_changed
            ):
                logger.info(
                    "Skipped stale vectorization error for summary %s",
                    publication.summary_record_id,
                )
                return

            if publication.had_active_publication:
                summary.status = publication.expected_status
                summary.error = publication.previous_error
            else:
                summary.status = SummaryStatus.ERROR
                summary.error = f"Vectorization failed: {error}"
            summary.updated_at = datetime.now(UTC).replace(tzinfo=None)
            session.add(summary)
            session.commit()
            target.summary_content = summary.summary_content
            target.summary_index_node_id = summary.summary_index_node_id
            target.summary_index_node_hash = summary.summary_index_node_hash
            target.tokens = summary.tokens
            target.status = summary.status
            target.error = summary.error
            target.enabled = summary.enabled
            target.updated_at = summary.updated_at

    @staticmethod
    def _apply_publication(
        target: DocumentSegmentSummary,
        publication: _SummaryVectorPublication,
        updated_at: datetime,
    ) -> None:
        target.summary_index_node_id = publication.new_node_id
        target.summary_index_node_hash = publication.summary_hash
        target.summary_content = publication.summary_content
        target.tokens = publication.embedding_tokens
        target.status = SummaryStatus.COMPLETED
        target.error = None
        target.updated_at = updated_at

    @staticmethod
    def _is_transient_vector_error(error: Exception) -> bool:
        if isinstance(error, ConnectionError):
            return True
        message = str(error).lower()
        return any(
            marker in message
            for marker in (
                "connection",
                "disconnected",
                "timeout",
                "network",
                "could not connect",
                "server disconnected",
                "weaviate",
            )
        )

    @staticmethod
    def _commit_caller_session_before_external_io(session: Session | None) -> None:
        """Commit caller-owned work without expiring ORM state used by follow-up external I/O.

        Flask-SQLAlchemy sessions expire loaded objects on commit. Summary generation/vectorization intentionally
        commits before calling LLM/vector providers, but expired ``Dataset``/``DocumentSegment`` instances would lazy
        refresh on first attribute access and hold a DB connection open across those provider calls.
        """
        if session is None:
            return

        session_with_expiration: Any = session
        if not hasattr(session_with_expiration, "expire_on_commit") and callable(session):
            session_with_expiration = session()

        expire_on_commit = session_with_expiration.expire_on_commit
        if not isinstance(expire_on_commit, bool):
            session.commit()
            return

        session_with_expiration.expire_on_commit = False
        try:
            session.commit()
        finally:
            session_with_expiration.expire_on_commit = expire_on_commit

    @staticmethod
    def _embedding_token_count(dataset: Dataset, summary_content: str) -> int:
        try:
            model_manager = ModelManager.for_tenant(tenant_id=dataset.tenant_id)
            embedding_model = model_manager.get_model_instance(
                tenant_id=dataset.tenant_id,
                provider=dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset.embedding_model,
            )
            if embedding_model is None:
                return 0
            token_counts = embedding_model.get_text_embedding_num_tokens([summary_content])
            token_count = token_counts[0] if token_counts else 0
            return token_count if isinstance(token_count, int) else 0
        except Exception as error:
            logger.warning("Failed to calculate embedding tokens for summary: %s", error)
            return 0

    @staticmethod
    def _generation_claim_marker(generation_token: str) -> str:
        return f"{_GENERATION_CLAIM_PREFIX}{generation_token}"

    @staticmethod
    def _generation_token_from_error(error: str | None) -> str | None:
        if not error or not error.startswith(_GENERATION_CLAIM_PREFIX):
            return None
        generation_token = error.removeprefix(_GENERATION_CLAIM_PREFIX)
        return generation_token or None

    @staticmethod
    def _clear_generation_claim(summary_record: DocumentSegmentSummary) -> str | None:
        generation_token = SummaryIndexService._generation_token_from_error(summary_record.error)
        if generation_token is not None:
            summary_record.error = None
        return generation_token

    @staticmethod
    def _generation_claim_is_stale(summary_record: DocumentSegmentSummary) -> bool:
        updated_at = summary_record.updated_at
        if not isinstance(updated_at, datetime):
            return False
        if updated_at.tzinfo is not None:
            updated_at = updated_at.astimezone(UTC).replace(tzinfo=None)
        return updated_at <= datetime.now(UTC).replace(tzinfo=None) - _SUMMARY_GENERATION_CLAIM_TIMEOUT

    @staticmethod
    def _effective_summary_status(summary_record: DocumentSegmentSummary) -> SummaryStatus:
        if SummaryIndexService._generation_token_from_error(summary_record.error) is not None:
            if SummaryIndexService._generation_claim_is_stale(summary_record):
                if SummaryIndexService._summary_has_active_publication(summary_record):
                    return SummaryStatus.COMPLETED
                return SummaryStatus.ERROR
            return SummaryStatus.GENERATING
        return SummaryStatus(summary_record.status)

    @staticmethod
    def _recover_stale_generation_claims(
        dataset_id: str,
        summaries: list[DocumentSegmentSummary],
    ) -> None:
        """Reclaim expired attempts already encountered by a status read.

        The claim token is also the pending vector ID, so recovery can retire an
        uncommitted vector without adding a database column or scanning the
        summary table. Rows are rechecked under lock before their claims change.
        """
        stale_claims = {
            summary.id: (
                summary.chunk_id,
                generation_token,
            )
            for summary in summaries
            if (generation_token := SummaryIndexService._generation_token_from_error(summary.error)) is not None
            and SummaryIndexService._generation_claim_is_stale(summary)
        }
        if not stale_claims:
            return

        retired_node_ids: list[str] = []
        with session_factory.create_session() as session:
            SummaryIndexService._lock_segment_rows(
                session,
                dataset_id,
                [chunk_id for chunk_id, _generation_token in stale_claims.values()],
            )
            claimed_summaries = session.scalars(
                select(DocumentSegmentSummary)
                .where(
                    DocumentSegmentSummary.id.in_(stale_claims),
                    DocumentSegmentSummary.dataset_id == dataset_id,
                )
                .with_for_update()
            ).all()
            for summary in claimed_summaries:
                expected_chunk_id, expected_generation_token = stale_claims[summary.id]
                if (
                    summary.chunk_id != expected_chunk_id
                    or SummaryIndexService._generation_token_from_error(summary.error) != expected_generation_token
                    or not SummaryIndexService._generation_claim_is_stale(summary)
                ):
                    continue

                if SummaryIndexService._summary_has_active_publication(summary):
                    summary.error = None
                else:
                    summary.status = SummaryStatus.ERROR
                    summary.error = "Summary generation timed out"
                retired_node_ids.append(expected_generation_token)
                session.add(summary)

            if retired_node_ids:
                session.commit()

        if retired_node_ids:
            delete_unreferenced_summary_vectors(dataset_id, retired_node_ids)

    @staticmethod
    def _generation_claim_is_current(
        session: Session,
        summary_record: DocumentSegmentSummary,
        claim: SummaryGenerationClaim,
    ) -> bool:
        if (
            summary_record.id != claim.summary_record_id
            or summary_record.dataset_id != claim.dataset_id
            or summary_record.chunk_id != claim.segment_id
            or SummaryIndexService._generation_token_from_error(summary_record.error) != claim.generation_token
            or SummaryIndexService._generation_claim_is_stale(summary_record)
        ):
            return False

        source_content = SummaryIndexService._get_segment_content(session, claim.dataset_id, claim.segment_id)
        return source_content is not None and helper.generate_text_hash(source_content) == claim.source_content_hash

    @staticmethod
    def _generation_claim_token_is_current(
        summary_record: DocumentSegmentSummary,
        claim: SummaryGenerationClaim,
    ) -> bool:
        return (
            summary_record.id == claim.summary_record_id
            and summary_record.dataset_id == claim.dataset_id
            and summary_record.chunk_id == claim.segment_id
            and SummaryIndexService._generation_token_from_error(summary_record.error) == claim.generation_token
        )

    @staticmethod
    def _summary_has_active_publication(summary_record: DocumentSegmentSummary) -> bool:
        return bool(
            summary_record.enabled
            and summary_record.status == SummaryStatus.COMPLETED
            and summary_record.summary_content
            and summary_record.summary_index_node_id
        )

    @staticmethod
    def _finish_claim_with_error(
        summary_record: DocumentSegmentSummary,
        claim: SummaryGenerationClaim,
        error: str,
    ) -> None:
        """Restore the publication snapshot and expose an error only when no publication existed."""
        summary_record.summary_content = claim.expected_summary_content
        summary_record.summary_index_node_id = claim.expected_node_id
        summary_record.enabled = claim.expected_enabled
        if claim.had_active_publication:
            summary_record.status = claim.expected_status
            summary_record.error = claim.previous_error
        else:
            summary_record.status = SummaryStatus.ERROR
            summary_record.error = error

    @staticmethod
    def _abandon_generation_claim(claim: SummaryGenerationClaim) -> None:
        """Best-effort release of a still-owned claim after stale publication."""
        try:
            with session_factory.create_session() as session:
                SummaryIndexService._lock_segment_rows(session, claim.dataset_id, [claim.segment_id])
                summary_record = session.get(DocumentSegmentSummary, claim.summary_record_id, with_for_update=True)
                if not summary_record or not SummaryIndexService._generation_claim_token_is_current(
                    summary_record, claim
                ):
                    return

                SummaryIndexService._finish_claim_with_error(
                    summary_record,
                    claim,
                    "Summary generation was superseded before publication",
                )
                session.add(summary_record)
                session.commit()
        except Exception:
            logger.warning(
                "Failed to release generation claim %s for summary %s",
                claim.generation_token,
                claim.summary_record_id,
                exc_info=True,
            )

    @staticmethod
    def _summary_allowed_segment_ids(session: Session, dataset_id: str, segment_ids: list[str]) -> set[str]:
        return set(
            session.scalars(
                select(DocumentSegment.id)
                .join(DatasetDocument, DatasetDocument.id == DocumentSegment.document_id)
                .where(
                    DocumentSegment.id.in_(segment_ids),
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.enabled.is_(True),
                    DocumentSegment.status == "completed",
                    DatasetDocument.dataset_id == dataset_id,
                    DatasetDocument.enabled.is_(True),
                    DatasetDocument.archived.is_(False),
                    DatasetDocument.indexing_status == "completed",
                )
            ).all()
        )

    @staticmethod
    def _segment_allows_summary(session: Session, dataset_id: str, segment_id: str) -> bool:
        stmt = (
            select(DocumentSegment.id)
            .join(DatasetDocument, DatasetDocument.id == DocumentSegment.document_id)
            .where(
                DocumentSegment.id == segment_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.enabled.is_(True),
                DocumentSegment.status == "completed",
                DatasetDocument.dataset_id == dataset_id,
                DatasetDocument.enabled.is_(True),
                DatasetDocument.archived.is_(False),
                DatasetDocument.indexing_status == "completed",
            )
        )
        return session.execute(stmt).scalar_one_or_none() is not None

    @staticmethod
    def _reenable_summary_record(summary_record: DocumentSegmentSummary) -> None:
        if summary_record.enabled:
            return

        summary_record.enabled = True
        summary_record.disabled_at = None
        summary_record.disabled_by = None

    @staticmethod
    def _mark_summary_generation_started(
        segment: DocumentSegment,
        dataset: Dataset,
    ) -> SummaryGenerationClaim:
        """Claim a summary row for one automatic generation attempt.

        The caller must present the returned claim when saving generated content. A competing generation replaces the
        marker, while a manual or administrative mutation clears it. The source-content comparison also rejects a
        detached segment that was already stale when this method acquired the row lock.
        """
        superseded_generation_token: str | None = None
        with session_factory.create_session() as session:
            SummaryIndexService._lock_segment_rows(session, dataset.id, [segment.id])
            if not SummaryIndexService._segment_allows_summary(session, dataset.id, segment.id):
                raise SummaryIndexConflictError(f"Segment {segment.id} no longer accepts summaries")
            source_content = SummaryIndexService._get_segment_content(session, dataset.id, segment.id)
            if source_content is None or source_content != segment.content:
                raise SummaryIndexConflictError(f"Segment {segment.id} changed before summary generation started")
            summary_record = SummaryIndexService._get_summary_record(
                session,
                segment.id,
                dataset.id,
                for_update=True,
            )

            if not summary_record:
                logger.warning("Summary record not found for segment %s, creating one", segment.id)
                summary_record = DocumentSegmentSummary(
                    dataset_id=dataset.id,
                    document_id=segment.document_id,
                    chunk_id=segment.id,
                    summary_content="",
                    status=SummaryStatus.GENERATING,
                    enabled=True,
                )
                had_active_publication = False
                previous_error = None
            else:
                had_active_publication = SummaryIndexService._summary_has_active_publication(summary_record)
                superseded_generation_token = SummaryIndexService._generation_token_from_error(summary_record.error)
                previous_error = None if superseded_generation_token is not None else summary_record.error
                SummaryIndexService._reenable_summary_record(summary_record)

            generation_token = str(uuid.uuid4())
            if not had_active_publication:
                summary_record.status = SummaryStatus.GENERATING
            summary_record.error = SummaryIndexService._generation_claim_marker(generation_token)
            session.add(summary_record)
            claim = SummaryGenerationClaim(
                dataset_id=dataset.id,
                segment_id=segment.id,
                summary_record_id=summary_record.id,
                generation_token=generation_token,
                source_content_hash=helper.generate_text_hash(source_content),
                expected_summary_content=summary_record.summary_content,
                expected_status=summary_record.status,
                expected_node_id=summary_record.summary_index_node_id,
                expected_enabled=summary_record.enabled,
                previous_error=previous_error,
                had_active_publication=had_active_publication,
            )
            session.commit()

        if superseded_generation_token is not None:
            delete_unreferenced_summary_vectors(dataset.id, [superseded_generation_token])
        return claim

    @staticmethod
    def _save_summary_content(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_content: str,
        *,
        generation_claim: SummaryGenerationClaim | None = None,
        status: SummaryStatus = SummaryStatus.GENERATING,
    ) -> DocumentSegmentSummary:
        """Stage claimed content or persist unclaimed content after locking its owner.

        Claimed content remains detached until vector publication atomically replaces the prior database content.
        It is rejected if another operation superseded or expired the claim. Calls without a claim persist immediately
        and clear any prior generation claim.
        """
        superseded_generation_token: str | None = None
        with session_factory.create_session() as session:
            SummaryIndexService._lock_segment_rows(session, dataset.id, [segment.id])
            if not SummaryIndexService._segment_allows_summary(session, dataset.id, segment.id):
                raise SummaryIndexConflictError(f"Segment {segment.id} no longer accepts summaries")
            if generation_claim:
                if generation_claim.dataset_id != dataset.id or generation_claim.segment_id != segment.id:
                    raise SummaryIndexConflictError("Summary generation claim does not match the target segment")
                summary_record = session.get(
                    DocumentSegmentSummary,
                    generation_claim.summary_record_id,
                    with_for_update=True,
                )
                if not summary_record:
                    raise SummaryIndexConflictError(
                        f"Summary {generation_claim.summary_record_id} was deleted while segment {segment.id} "
                        "was being generated"
                    )
                if not SummaryIndexService._generation_claim_is_current(session, summary_record, generation_claim):
                    raise SummaryIndexConflictError(
                        f"Summary {generation_claim.summary_record_id} generation was superseded"
                    )
                staged_summary = DocumentSegmentSummary(
                    dataset_id=summary_record.dataset_id,
                    document_id=summary_record.document_id,
                    chunk_id=summary_record.chunk_id,
                    summary_content=summary_content,
                    summary_index_node_id=summary_record.summary_index_node_id,
                    summary_index_node_hash=summary_record.summary_index_node_hash,
                    tokens=summary_record.tokens,
                    status=status,
                    error=summary_record.error,
                    enabled=summary_record.enabled,
                    disabled_at=summary_record.disabled_at,
                    disabled_by=summary_record.disabled_by,
                )
                staged_summary.id = summary_record.id
                staged_summary.created_at = summary_record.created_at
                staged_summary.updated_at = summary_record.updated_at
                return staged_summary
            else:
                summary_record = SummaryIndexService._get_summary_record(
                    session,
                    segment.id,
                    dataset.id,
                    for_update=True,
                )

            if not summary_record:
                summary_record = DocumentSegmentSummary(
                    dataset_id=dataset.id,
                    document_id=segment.document_id,
                    chunk_id=segment.id,
                    summary_content=summary_content,
                    status=status,
                    enabled=True,
                )
            else:
                summary_record.summary_content = summary_content
                summary_record.status = status
                superseded_generation_token = SummaryIndexService._clear_generation_claim(summary_record)
                if superseded_generation_token is None:
                    summary_record.error = None
                SummaryIndexService._reenable_summary_record(summary_record)

            session.add(summary_record)
            session.commit()

        if superseded_generation_token is not None:
            delete_unreferenced_summary_vectors(dataset.id, [superseded_generation_token])
        return summary_record

    @staticmethod
    def _enable_summary_record(
        summary_record_id: str,
        segment_id: str,
        dataset_id: str,
    ) -> bool:
        superseded_generation_token: str | None = None
        with session_factory.create_session() as session:
            SummaryIndexService._lock_segment_rows(session, dataset_id, [segment_id])
            summary_record = session.get(DocumentSegmentSummary, summary_record_id, with_for_update=True)
            if (
                not summary_record
                or summary_record.dataset_id != dataset_id
                or summary_record.chunk_id != segment_id
                or not SummaryIndexService._segment_allows_summary(session, dataset_id, segment_id)
            ):
                return False

            SummaryIndexService._reenable_summary_record(summary_record)
            superseded_generation_token = SummaryIndexService._clear_generation_claim(summary_record)
            session.add(summary_record)
            session.commit()

        if superseded_generation_token is not None:
            delete_unreferenced_summary_vectors(dataset_id, [superseded_generation_token])
        return True

    @staticmethod
    def generate_summary_for_segment(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_index_setting: SummaryIndexSettingDict,
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

        with session_factory.create_session() as session:
            document_language = session.scalar(
                select(DatasetDocument.doc_language).where(
                    DatasetDocument.id == segment.document_id,
                    DatasetDocument.dataset_id == dataset.id,
                )
            )

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
        status: SummaryStatus = SummaryStatus.GENERATING,
    ) -> DocumentSegmentSummary:
        """
        Create or update a DocumentSegmentSummary record.
        If a summary record already exists for this segment, it will be updated instead of creating a new one.
        The write is committed before returning so follow-up vectorization can run without a dirty DB session.

        Args:
            segment: DocumentSegment to create summary for
            dataset: Dataset containing the segment
            summary_content: Generated summary content
            status: Summary status (default: SummaryStatus.GENERATING)

        Returns:
            Created or updated DocumentSegmentSummary instance
        """
        return SummaryIndexService._save_summary_content(
            segment=segment,
            dataset=dataset,
            summary_content=summary_content,
            status=status,
        )

    @staticmethod
    def vectorize_summary(
        summary_record: DocumentSegmentSummary,
        segment: DocumentSegment,
        dataset: Dataset,
        session: Session | None = None,
        *,
        generation_claim: SummaryGenerationClaim | None = None,
    ) -> None:
        """Publish a replacement summary vector, then retire the previous vector.

        A supplied session is committed before external I/O; publication uses a
        fresh transaction and rejects any intervening summary or segment change.
        """
        if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
            logger.warning(
                "Summary vectorization skipped for dataset %s: indexing_technique is not high_quality",
                dataset.id,
            )
            return
        SummaryIndexService._commit_caller_session_before_external_io(session)

        summary_content = summary_record.summary_content
        if not summary_content or not summary_content.strip():
            raise ValueError(f"Summary content is empty for segment {segment.id}, cannot vectorize")

        if generation_claim is not None and (
            generation_claim.dataset_id != dataset.id
            or generation_claim.segment_id != segment.id
            or generation_claim.summary_record_id != summary_record.id
        ):
            raise SummaryIndexConflictError("Summary generation claim does not match the vectorization target")

        publication = _SummaryVectorPublication(
            dataset_id=dataset.id,
            segment_id=segment.id,
            segment_content=segment.content,
            summary_record_id=summary_record.id,
            summary_content=summary_content,
            old_node_id=(
                generation_claim.expected_node_id
                if generation_claim is not None
                else summary_record.summary_index_node_id
            ),
            new_node_id=generation_claim.generation_token if generation_claim is not None else str(uuid.uuid4()),
            summary_hash=helper.generate_text_hash(summary_content),
            expected_enabled=(
                generation_claim.expected_enabled if generation_claim is not None else summary_record.enabled
            ),
            expected_error=(
                SummaryIndexService._generation_claim_marker(generation_claim.generation_token)
                if generation_claim is not None
                else summary_record.error
            ),
            expected_generation_token=(
                generation_claim.generation_token
                if generation_claim is not None
                else SummaryIndexService._generation_token_from_error(summary_record.error)
            ),
            embedding_tokens=SummaryIndexService._embedding_token_count(dataset, summary_content),
            expected_dataset_state=SummaryIndexService._summary_vector_dataset_state(dataset),
            expected_summary_content=(
                generation_claim.expected_summary_content
                if generation_claim is not None
                else summary_record.summary_content
            ),
            expected_status=(
                generation_claim.expected_status if generation_claim is not None else summary_record.status
            ),
            previous_error=generation_claim.previous_error if generation_claim is not None else summary_record.error,
            had_active_publication=(
                generation_claim.had_active_publication
                if generation_claim is not None
                else SummaryIndexService._summary_has_active_publication(summary_record)
            ),
        )
        summary_document = Document(
            page_content=summary_content,
            metadata={
                "doc_id": publication.new_node_id,
                "doc_hash": publication.summary_hash,
                "dataset_id": dataset.id,
                "document_id": segment.document_id,
                "original_chunk_id": segment.id,
                "doc_type": DocType.TEXT,
                "is_summary": True,
            },
        )

        max_attempts = 3
        vector: Vector | None = None
        vector_was_added = False
        for attempt in range(max_attempts):
            try:
                vector = Vector(dataset)
                vector.add_texts([summary_document], duplicate_check=False)
                vector_was_added = True
                updated_at = SummaryIndexService._publish_summary_vector(publication)
            except Exception as error:
                transient = SummaryIndexService._is_transient_vector_error(error)
                reconciliation_failed = False
                durable = False
                if vector_was_added:
                    try:
                        durable = SummaryIndexService._publication_is_durable(publication)
                    except Exception:
                        reconciliation_failed = True
                        logger.warning(
                            "Could not reconcile summary publication %s for segment %s",
                            publication.new_node_id,
                            segment.id,
                            exc_info=True,
                        )

                if durable:
                    SummaryIndexService._apply_publication(
                        summary_record,
                        publication,
                        datetime.now(UTC).replace(tzinfo=None),
                    )
                    if publication.old_node_id:
                        delete_unreferenced_summary_vectors(dataset.id, [publication.old_node_id])
                    logger.info(
                        "Reconciled summary vector %s for segment %s after %s",
                        publication.new_node_id,
                        segment.id,
                        type(error).__name__,
                    )
                    return

                if isinstance(error, SummaryIndexConflictError):
                    if reconciliation_failed:
                        raise
                    if vector_was_added and vector is not None:
                        try:
                            vector.delete_by_ids([publication.new_node_id])
                        except Exception:
                            logger.warning(
                                "Failed to compensate summary vector %s",
                                publication.new_node_id,
                                exc_info=True,
                            )
                    raise

                if transient and attempt < max_attempts - 1:
                    wait_time = 2.0 * (2**attempt)
                    logger.warning(
                        "Summary vectorization attempt %s/%s failed for segment %s: %s; retrying in %.1fs",
                        attempt + 1,
                        max_attempts,
                        segment.id,
                        error,
                        wait_time,
                    )
                    time.sleep(wait_time)
                    continue

                logger.error(
                    "Summary vectorization failed for segment %s after %s attempts",
                    segment.id,
                    attempt + 1,
                    exc_info=True,
                )
                if vector_was_added and not reconciliation_failed and vector is not None:
                    try:
                        vector.delete_by_ids([publication.new_node_id])
                    except Exception:
                        logger.warning(
                            "Failed to compensate unpublished summary vector %s",
                            publication.new_node_id,
                            exc_info=True,
                        )
                if not (vector_was_added and reconciliation_failed):
                    SummaryIndexService._record_vectorization_failure(publication, error, summary_record)
                raise
            else:
                SummaryIndexService._apply_publication(summary_record, publication, updated_at)
                if publication.old_node_id:
                    delete_unreferenced_summary_vectors(dataset.id, [publication.old_node_id])
                logger.info(
                    "Vectorized summary %s for segment %s with %s embedding tokens",
                    publication.summary_record_id,
                    segment.id,
                    publication.embedding_tokens,
                )
                return

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

        superseded_generation_tokens: list[str] = []
        with session_factory.create_session() as session:
            SummaryIndexService._lock_segment_rows(session, dataset.id, segment_ids)
            allowed_segment_ids = SummaryIndexService._summary_allowed_segment_ids(session, dataset.id, segment_ids)
            # Query existing summary records
            existing_summaries = session.scalars(
                select(DocumentSegmentSummary)
                .where(
                    DocumentSegmentSummary.chunk_id.in_(segment_ids),
                    DocumentSegmentSummary.dataset_id == dataset.id,
                )
                .order_by(
                    DocumentSegmentSummary.chunk_id,
                    DocumentSegmentSummary.updated_at.desc(),
                    DocumentSegmentSummary.id.desc(),
                )
            ).all()
            existing_summary_map: dict[str, DocumentSegmentSummary] = {}
            for summary in existing_summaries:
                existing_summary_map.setdefault(summary.chunk_id, summary)

            # Create or update records
            for segment in segments:
                if segment.id not in allowed_segment_ids:
                    continue
                existing_summary = existing_summary_map.get(segment.id)
                if existing_summary:
                    if SummaryIndexService._summary_has_active_publication(existing_summary):
                        continue
                    # Update existing record
                    existing_summary.status = status
                    superseded_generation_token = SummaryIndexService._clear_generation_claim(existing_summary)
                    if superseded_generation_token is not None:
                        superseded_generation_tokens.append(superseded_generation_token)
                    else:
                        existing_summary.error = None
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

        if superseded_generation_tokens:
            delete_unreferenced_summary_vectors(dataset.id, superseded_generation_tokens)

    @staticmethod
    def update_summary_record_error(
        segment: DocumentSegment,
        dataset: Dataset,
        error: str,
        *,
        generation_claim: SummaryGenerationClaim | None = None,
    ) -> None:
        """Update a summary record with an error if the originating generation still owns it.

        Args:
            segment: DocumentSegment
            dataset: Dataset containing the segment
            error: Error message
        """
        with session_factory.create_session() as session:
            SummaryIndexService._lock_segment_rows(session, dataset.id, [segment.id])
            summary_record = SummaryIndexService._get_summary_record(
                session,
                segment.id,
                dataset.id,
                for_update=True,
            )

            if summary_record:
                if generation_claim:
                    if not SummaryIndexService._generation_claim_token_is_current(summary_record, generation_claim):
                        logger.info("Skipped stale summary generation error for segment %s", segment.id)
                        return
                    source_content = SummaryIndexService._get_segment_content(session, dataset.id, segment.id)
                    source_is_current = (
                        source_content is not None
                        and helper.generate_text_hash(source_content) == generation_claim.source_content_hash
                    )
                    claim_error = error if source_is_current else "Summary generation was superseded by a source change"
                    SummaryIndexService._finish_claim_with_error(summary_record, generation_claim, claim_error)
                else:
                    summary_record.status = SummaryStatus.ERROR
                    summary_record.error = error
                session.add(summary_record)
                session.commit()
            else:
                logger.warning("Summary record not found for segment %s when updating error", segment.id)

    @staticmethod
    def generate_and_vectorize_summary(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_index_setting: SummaryIndexSettingDict,
        *,
        session: Session | None = None,
    ) -> DocumentSegmentSummary:
        """
        Generate summary for a segment and vectorize it.
        Caller state is committed before service-owned LLM/vector work.

        Args:
            segment: DocumentSegment to generate summary for
            dataset: Dataset containing the segment
            summary_index_setting: Summary index configuration

        Returns:
            Created DocumentSegmentSummary instance

        Raises:
            ValueError: If summary generation fails
        """
        SummaryIndexService._commit_caller_session_before_external_io(session)
        generation_claim = SummaryIndexService._mark_summary_generation_started(segment, dataset)
        summary_record: DocumentSegmentSummary | None = None

        try:
            summary_content, llm_usage = SummaryIndexService.generate_summary_for_segment(
                segment, dataset, summary_index_setting
            )

            summary_record = SummaryIndexService._save_summary_content(
                segment=segment,
                dataset=dataset,
                summary_content=summary_content,
                generation_claim=generation_claim,
                status=SummaryStatus.GENERATING,
            )

            # Log LLM usage for summary generation
            if llm_usage and llm_usage.total_tokens > 0:
                logger.info(
                    "Summary generation for segment %s used %s tokens (prompt: %s, completion: %s)",
                    segment.id,
                    llm_usage.total_tokens,
                    llm_usage.prompt_tokens,
                    llm_usage.completion_tokens,
                )

            SummaryIndexService.vectorize_summary(
                summary_record,
                segment,
                dataset,
                generation_claim=generation_claim,
            )
            logger.info("Successfully generated and vectorized summary for segment %s", segment.id)
            return summary_record
        except SummaryIndexConflictError:
            logger.info("Summary generation for segment %s was superseded", segment.id)
            SummaryIndexService._abandon_generation_claim(generation_claim)
            raise
        except Exception as e:
            logger.exception("Failed to generate summary for segment %s", segment.id)
            SummaryIndexService.update_summary_record_error(
                segment=segment,
                dataset=dataset,
                error=str(e),
                generation_claim=generation_claim,
            )
            raise

    @staticmethod
    def generate_summaries_for_document(
        dataset: Dataset,
        document: DatasetDocument,
        summary_index_setting: SummaryIndexSettingDict,
        session: Session | None = None,
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

        def _load_segments(query_session: Session) -> list[DocumentSegment]:
            # Query segments (only enabled segments)
            stmt = select(DocumentSegment).where(
                DocumentSegment.dataset_id == dataset.id,
                DocumentSegment.document_id == document.id,
                DocumentSegment.status == "completed",
                DocumentSegment.enabled.is_(True),  # Only generate summaries for enabled segments
            )

            if segment_ids:
                stmt = stmt.where(DocumentSegment.id.in_(segment_ids))

            return list(query_session.scalars(stmt).all())

        if session is None:
            with session_factory.create_session() as query_session:
                segments = _load_segments(query_session)
        else:
            segments = _load_segments(session)
            SummaryIndexService._commit_caller_session_before_external_io(session)

        if not segments:
            logger.info("No segments found for document %s", document.id)
            return []

        SummaryIndexService.batch_create_summary_records(
            segments=segments,
            dataset=dataset,
            status=SummaryStatus.NOT_STARTED,
        )

        summary_records = []

        for segment in segments:
            try:
                summary_record = SummaryIndexService.generate_and_vectorize_summary(
                    segment, dataset, summary_index_setting
                )
                summary_records.append(summary_record)
            except SummaryIndexConflictError:
                logger.info("Summary generation for segment %s was superseded", segment.id)
                continue
            except Exception:
                logger.exception("Failed to generate summary for segment %s", segment.id)
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
        session: Session | None = None,
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

        if segment_ids == []:
            return

        def _disable_with_session(write_session: Session) -> list[str]:
            SummaryIndexService._lock_segment_rows(write_session, dataset.id, segment_ids)
            stmt = select(DocumentSegmentSummary).where(
                DocumentSegmentSummary.dataset_id == dataset.id,
                DocumentSegmentSummary.enabled.is_(True),  # Only disable enabled summaries
            )

            if segment_ids is not None:
                stmt = stmt.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))

            summaries = write_session.scalars(
                stmt.order_by(DocumentSegmentSummary.chunk_id, DocumentSegmentSummary.id).with_for_update()
            ).all()

            if not summaries:
                return []

            logger.info(
                "Disabling %s summary records for dataset %s, segment_ids: %s",
                len(summaries),
                dataset.id,
                len(segment_ids) if segment_ids else "all",
            )

            # Disable summary records (don't delete)
            summary_node_ids = [node_id for summary in summaries if (node_id := summary.summary_index_node_id)]
            now = naive_utc_now()
            for summary in summaries:
                summary.enabled = False
                summary.disabled_at = now
                summary.disabled_by = disabled_by
                generation_token = SummaryIndexService._clear_generation_claim(summary)
                if generation_token is not None:
                    summary_node_ids.append(generation_token)
                write_session.add(summary)
            logger.info("Disabled %s summary records for dataset %s", len(summaries), dataset.id)
            return summary_node_ids

        if session is None:
            with session_factory.create_session() as write_session:
                summary_node_ids = _disable_with_session(write_session)
                write_session.commit()
        else:
            try:
                with session.begin_nested():
                    summary_node_ids = _disable_with_session(session)
            except Exception:
                if not session.is_active:
                    session.rollback()
                raise
            SummaryIndexService._commit_caller_session_before_external_io(session)

        if summary_node_ids:
            delete_unreferenced_summary_vectors(dataset.id, summary_node_ids)

    @staticmethod
    def enable_summaries_for_segments(
        dataset: Dataset,
        session: Session | None = None,
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
        if segment_ids == []:
            return
        if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
            return

        summary_segment_pairs: list[tuple[DocumentSegmentSummary, DocumentSegment]] = []

        def _collect_candidates(query_session: Session) -> None:
            stmt = select(DocumentSegmentSummary).where(DocumentSegmentSummary.dataset_id == dataset.id)

            if segment_ids is not None:
                stmt = stmt.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))

            summaries = query_session.scalars(
                stmt.order_by(
                    DocumentSegmentSummary.chunk_id,
                    DocumentSegmentSummary.updated_at.desc(),
                    DocumentSegmentSummary.id.desc(),
                )
            ).all()

            if not summaries:
                return

            logger.info(
                "Enabling %s summary records for dataset %s, segment_ids: %s",
                len(summaries),
                dataset.id,
                len(segment_ids) if segment_ids else "all",
            )

            # Re-vectorize and re-add to vector database
            seen_chunk_ids: set[str] = set()
            candidate_summaries: list[DocumentSegmentSummary] = []
            for summary in summaries:
                if summary.chunk_id in seen_chunk_ids:
                    continue
                seen_chunk_ids.add(summary.chunk_id)
                if summary.enabled:
                    continue
                if summary.summary_content:
                    candidate_summaries.append(summary)

            if not candidate_summaries:
                return

            candidate_segment_ids = [summary.chunk_id for summary in candidate_summaries]
            segments_by_id = {
                segment.id: segment
                for segment in query_session.scalars(
                    select(DocumentSegment).where(
                        DocumentSegment.id.in_(candidate_segment_ids),
                        DocumentSegment.dataset_id == dataset.id,
                    )
                ).all()
            }

            for summary in candidate_summaries:
                segment = segments_by_id.get(summary.chunk_id)
                # Summary.enabled stays in sync with chunk.enabled,
                # only enable summary if the associated chunk is enabled.
                if not segment or not segment.enabled or segment.status != "completed":
                    continue

                summary_segment_pairs.append((summary, segment))

        if session is None:
            with session_factory.create_session() as query_session:
                _collect_candidates(query_session)
        else:
            _collect_candidates(session)
            SummaryIndexService._commit_caller_session_before_external_io(session)

        enabled_count = 0
        for summary, segment in summary_segment_pairs:
            try:
                SummaryIndexService.vectorize_summary(summary, segment, dataset)
                if SummaryIndexService._enable_summary_record(summary.id, segment.id, dataset.id):
                    enabled_count += 1
                elif summary.summary_index_node_id:
                    delete_unreferenced_summary_vectors(dataset.id, [summary.summary_index_node_id])
            except Exception:
                logger.exception("Failed to re-vectorize summary %s", summary.id)
                continue

        logger.info("Enabled %s summary records for dataset %s", enabled_count, dataset.id)

    @staticmethod
    def delete_summaries_for_segments(
        dataset: Dataset,
        segment_ids: list[str] | None = None,
        *,
        session: Session | None = None,
    ) -> None:
        """
        Delete summary records and vectors for segments (used only for actual deletion scenarios).
        For disable/enable operations, use disable_summaries_for_segments/enable_summaries_for_segments.

        Args:
            dataset: Dataset containing the segments
            segment_ids: List of segment IDs to delete summaries for. If None, delete all.

        """
        if segment_ids == []:
            return

        def _delete_with_session(write_session: Session) -> list[str]:
            SummaryIndexService._lock_segment_rows(write_session, dataset.id, segment_ids)
            stmt = select(DocumentSegmentSummary).where(DocumentSegmentSummary.dataset_id == dataset.id)

            if segment_ids is not None:
                stmt = stmt.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))

            summaries = write_session.scalars(
                stmt.order_by(DocumentSegmentSummary.chunk_id, DocumentSegmentSummary.id).with_for_update()
            ).all()

            if not summaries:
                return []

            summary_node_ids = [node_id for summary in summaries if (node_id := summary.summary_index_node_id)]
            summary_count = len(summaries)
            for summary in summaries:
                generation_token = SummaryIndexService._generation_token_from_error(summary.error)
                if generation_token is not None:
                    summary_node_ids.append(generation_token)
                write_session.delete(summary)

            logger.info("Deleted %s summary records for dataset %s", summary_count, dataset.id)
            return summary_node_ids

        if session is None:
            with session_factory.create_session() as write_session:
                summary_node_ids = _delete_with_session(write_session)
                write_session.commit()
        else:
            try:
                with session.begin_nested():
                    summary_node_ids = _delete_with_session(session)
            except Exception:
                if not session.is_active:
                    session.rollback()
                raise
            SummaryIndexService._commit_caller_session_before_external_io(session)

        if summary_node_ids:
            delete_unreferenced_summary_vectors(dataset.id, summary_node_ids)

    @staticmethod
    def update_summary_for_segment(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_content: str,
        *,
        session: Session | None = None,
    ) -> DocumentSegmentSummary | None:
        """
        Update summary for a segment and re-vectorize it.

        Args:
            segment: DocumentSegment to update summary for
            dataset: Dataset containing the segment
            summary_content: New summary content

        Returns:
            The published summary state, or an error record when no prior publication exists.
            Returns None if indexing technique is not high_quality.
        """
        # Only update summary index for high_quality indexing technique
        if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
            return None

        # When user manually provides summary, allow saving even if summary_index_setting doesn't exist
        # summary_index_setting is only needed for LLM generation, not for manual summary vectorization
        # Vectorization uses dataset.embedding_model, which doesn't require summary_index_setting

        def _load_doc_form(query_session: Session) -> str | None:
            return query_session.scalar(
                select(DatasetDocument.doc_form).where(
                    DatasetDocument.id == segment.document_id,
                    DatasetDocument.dataset_id == dataset.id,
                )
            )

        if session is None:
            with session_factory.create_session() as query_session:
                doc_form = _load_doc_form(query_session)
        else:
            doc_form = _load_doc_form(session)
        if doc_form == "qa_model":
            return None

        if not summary_content or not summary_content.strip():

            def _delete_with_session(write_session: Session) -> tuple[bool, list[str]]:
                SummaryIndexService._lock_segment_rows(write_session, dataset.id, [segment.id])
                summary_record = SummaryIndexService._get_summary_record(
                    write_session,
                    segment.id,
                    dataset.id,
                    for_update=True,
                )

                if summary_record:
                    node_ids = [
                        node_id
                        for node_id in (
                            summary_record.summary_index_node_id,
                            SummaryIndexService._generation_token_from_error(summary_record.error),
                        )
                        if node_id is not None
                    ]
                    write_session.delete(summary_record)
                    return True, node_ids
                return False, []

            if session is None:
                with session_factory.create_session() as write_session:
                    summary_deleted, retired_node_ids = _delete_with_session(write_session)
                    write_session.commit()
            else:
                try:
                    with session.begin_nested():
                        summary_deleted, retired_node_ids = _delete_with_session(session)
                except Exception:
                    if not session.is_active:
                        session.rollback()
                    raise
                SummaryIndexService._commit_caller_session_before_external_io(session)

            if retired_node_ids:
                delete_unreferenced_summary_vectors(dataset.id, retired_node_ids)

            if summary_deleted:
                logger.info("Deleted summary for segment %s (empty content provided)", segment.id)
            else:
                logger.info("No summary record found for segment %s, nothing to delete", segment.id)
            return None

        SummaryIndexService._commit_caller_session_before_external_io(session)

        generation_claim = SummaryIndexService._mark_summary_generation_started(segment, dataset)
        summary_record: DocumentSegmentSummary | None = None
        try:
            summary_record = SummaryIndexService._save_summary_content(
                segment=segment,
                dataset=dataset,
                summary_content=summary_content,
                generation_claim=generation_claim,
                status=SummaryStatus.GENERATING,
            )
            SummaryIndexService.vectorize_summary(
                summary_record,
                segment,
                dataset,
                generation_claim=generation_claim,
            )
            logger.info("Successfully updated and re-vectorized summary for segment %s", segment.id)
            return summary_record
        except SummaryIndexConflictError:
            logger.info("Summary update for segment %s was superseded", segment.id)
            SummaryIndexService._abandon_generation_claim(generation_claim)
            raise
        except Exception as e:
            logger.exception("Failed to vectorize summary for segment %s", segment.id)
            error = f"Vectorization failed: {str(e)}"
            SummaryIndexService.update_summary_record_error(
                segment=segment,
                dataset=dataset,
                error=error,
                generation_claim=generation_claim,
            )
            if summary_record is None:
                raise
            SummaryIndexService._finish_claim_with_error(summary_record, generation_claim, error)
            return summary_record

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
        summary = session.scalar(
            select(DocumentSegmentSummary)
            .where(
                DocumentSegmentSummary.chunk_id == segment_id,
                DocumentSegmentSummary.dataset_id == dataset_id,
            )
            .order_by(
                DocumentSegmentSummary.updated_at.desc(),
                DocumentSegmentSummary.id.desc(),
            )
            .limit(1)
        )
        return summary if summary and summary.enabled else None

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
            select(DocumentSegmentSummary)
            .where(
                DocumentSegmentSummary.chunk_id.in_(segment_ids),
                DocumentSegmentSummary.dataset_id == dataset_id,
            )
            .order_by(
                DocumentSegmentSummary.chunk_id,
                DocumentSegmentSummary.updated_at.desc(),
                DocumentSegmentSummary.id.desc(),
            )
        ).all()
        canonical_summaries: dict[str, DocumentSegmentSummary] = {}
        for summary in summaries:
            canonical_summaries.setdefault(summary.chunk_id, summary)
        return {chunk_id: summary for chunk_id, summary in canonical_summaries.items() if summary.enabled}

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
        if segment_ids == []:
            return []

        stmt = select(DocumentSegmentSummary).where(
            DocumentSegmentSummary.document_id == document_id,
            DocumentSegmentSummary.dataset_id == dataset_id,
        )
        if segment_ids is not None:
            stmt = stmt.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))

        summaries = session.scalars(
            stmt.order_by(
                DocumentSegmentSummary.chunk_id,
                DocumentSegmentSummary.updated_at.desc(),
                DocumentSegmentSummary.id.desc(),
            )
        ).all()
        canonical_summaries: dict[str, DocumentSegmentSummary] = {}
        for summary in summaries:
            canonical_summaries.setdefault(summary.chunk_id, summary)
        return [summary for summary in canonical_summaries.values() if summary.enabled]

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
        # Get all segments for this document (excluding qa_model and re_segment)
        segment_ids = list(
            session.scalars(
                select(DocumentSegment.id).where(
                    DocumentSegment.document_id == document_id,
                    DocumentSegment.status != "re_segment",
                    DocumentSegment.tenant_id == tenant_id,
                )
            ).all()
        )

        if not segment_ids:
            return None

        # Get all summary records for these segments
        summaries = SummaryIndexService.get_segments_summaries(segment_ids, dataset_id, session=session)
        SummaryIndexService._recover_stale_generation_claims(dataset_id, list(summaries.values()))
        summary_status_map = {
            chunk_id: SummaryIndexService._effective_summary_status(summary) for chunk_id, summary in summaries.items()
        }

        # Check if there are any "not_started" or "generating" status summaries
        has_pending_summaries = any(
            summary_status_map.get(segment_id) is not None  # Ensure summary exists (enabled=True)
            and summary_status_map[segment_id] in (SummaryStatus.NOT_STARTED, SummaryStatus.GENERATING)
            for segment_id in segment_ids
        )

        return "SUMMARIZING" if has_pending_summaries else None

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
        if not document_ids:
            return {}

        # Get all segments for these documents (excluding qa_model and re_segment)
        segments = session.execute(
            select(DocumentSegment.id, DocumentSegment.document_id).where(
                DocumentSegment.document_id.in_(document_ids),
                DocumentSegment.status != "re_segment",
                DocumentSegment.tenant_id == tenant_id,
            )
        ).all()

        # Group segments by document_id
        document_segments_map: dict[str, list[str]] = {}
        for segment in segments:
            doc_id = str(segment.document_id)
            if doc_id not in document_segments_map:
                document_segments_map[doc_id] = []
            document_segments_map[doc_id].append(segment.id)

        # Get all summary records for these segments
        all_segment_ids = [seg.id for seg in segments]
        summaries = SummaryIndexService.get_segments_summaries(all_segment_ids, dataset_id, session=session)
        SummaryIndexService._recover_stale_generation_claims(dataset_id, list(summaries.values()))
        summary_status_map = {
            chunk_id: SummaryIndexService._effective_summary_status(summary) for chunk_id, summary in summaries.items()
        }

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
                and summary_status_map[segment_id] in (SummaryStatus.NOT_STARTED, SummaryStatus.GENERATING)
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
        session: Session,
    ) -> DocumentSummaryStatusDetailDict:
        """
        Get detailed summary status for a document.

        Args:
            document_id: Document ID
            dataset_id: Dataset ID
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
        from services.dataset_service import SegmentService

        # Get all segments for this document
        segments = SegmentService.get_segments_by_document_and_dataset(
            document_id=document_id,
            dataset_id=dataset_id,
            session=session,
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
                session=session,
            )
            SummaryIndexService._recover_stale_generation_claims(dataset_id, summaries)

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
                status = SummaryIndexService._effective_summary_status(summary)
                status_counts[status] = status_counts.get(status, 0) + 1
                summary_list.append(
                    {
                        "segment_id": segment.id,
                        "segment_position": segment.position,
                        "status": status,
                        "summary_preview": (
                            summary.summary_content[:100] + "..."
                            if summary.summary_content and len(summary.summary_content) > 100
                            else summary.summary_content
                        ),
                        "error": (
                            None
                            if SummaryIndexService._generation_token_from_error(summary.error) is not None
                            else summary.error
                        ),
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


def delete_unreferenced_summary_vectors(dataset_id: str, node_ids: list[str]) -> None:
    """Best-effort deletion of summary vectors that have no active database owner.

    Database references are checked before vector-store I/O. A failed deletion can leave an unreachable vector, but
    the cleanup never intentionally deletes a vector still owned by an enabled summary or document segment.
    """
    unique_node_ids = list(dict.fromkeys(node_id for node_id in node_ids if node_id))
    if not unique_node_ids:
        return

    try:
        with session_factory.create_session() as session:
            dataset = session.get(Dataset, dataset_id)
            if dataset is None:
                logger.warning("Skipping summary vector cleanup because dataset %s no longer exists", dataset_id)
                return

            referenced_node_ids: set[str] = set()
            for node_id_batch in batched(unique_node_ids, _SUMMARY_VECTOR_CLEANUP_BATCH_SIZE):
                referenced_node_ids.update(
                    node_id
                    for node_id in session.scalars(
                        union_all(
                            select(DocumentSegmentSummary.summary_index_node_id).where(
                                DocumentSegmentSummary.dataset_id == dataset_id,
                                DocumentSegmentSummary.summary_index_node_id.in_(node_id_batch),
                                DocumentSegmentSummary.enabled.is_(True),
                            ),
                            select(DocumentSegment.index_node_id).where(
                                DocumentSegment.dataset_id == dataset_id,
                                DocumentSegment.index_node_id.in_(node_id_batch),
                            ),
                        )
                    ).all()
                    if node_id is not None
                )

        deletable_node_ids = [node_id for node_id in unique_node_ids if node_id not in referenced_node_ids]
        if not deletable_node_ids:
            return

        vector = Vector(dataset)
        for node_id_batch in batched(deletable_node_ids, _SUMMARY_VECTOR_CLEANUP_BATCH_SIZE):
            vector.delete_by_ids(list(node_id_batch))
    except Exception:
        logger.warning(
            "Summary vector cleanup failed for dataset %s; unreachable vectors may remain",
            dataset_id,
            exc_info=True,
        )
