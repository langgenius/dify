"""PostgreSQL persistence for TiDB-on-Qdrant orphan cleanup."""

from dataclasses import dataclass, field
from itertools import batched
from typing import Any, cast

from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, aliased, sessionmaker

from extensions.ext_database import db
from models.dataset import (
    ChildChunk,
    Dataset,
    Document,
    DocumentSegment,
    DocumentSegmentSummary,
    SegmentAttachmentBinding,
    TidbAuthBinding,
)
from models.enums import TidbAuthBindingStatus
from models.model import App, AppAnnotationSetting, MessageAnnotation


class TidbOrphanCleanupRepositoryError(RuntimeError):
    """Raised when persisted ownership no longer permits orphan cleanup."""


@dataclass(frozen=True)
class TidbBindingRecord:
    id: str
    tenant_id: str | None
    cluster_id: str
    status: TidbAuthBindingStatus
    account: str
    password: str = field(repr=False)
    qdrant_endpoint: str | None


@dataclass(frozen=True)
class TenantDatasetRecord:
    id: str
    index_struct: str | None


@dataclass(frozen=True)
class OrphanAuditRecord:
    dataset_id: str
    tenant_id: str
    documents: int


@dataclass(frozen=True)
class OrphanPgState:
    dataset_tenant_id: str | None = None
    app_tenant_id: str | None = None
    annotation_setting_exists: bool = False
    annotation_exists: bool = False
    documents: int = 0
    segments: int = 0
    indexed_segments: int = 0
    child_chunks: int = 0
    indexed_child_chunks: int = 0
    summaries: int = 0
    indexed_summaries: int = 0
    attachment_bindings: int = 0
    foreign_tenant_segments: bool = False
    live_document_segments: bool = False


class TidbOrphanCleanupRepository:
    _AUDIT_LOOKUP_BATCH_SIZE = 150

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def audit_orphan_segment_bucket(self, bucket: int) -> tuple[OrphanAuditRecord, ...]:
        """Find dataset IDs that exist only in document_segments within one UUID prefix bucket."""
        if not 0 <= bucket <= 255:
            raise ValueError("bucket must be between 0 and 255")

        bucket_start = f"{bucket:02x}000000-0000-0000-0000-000000000000"
        bucket_end = f"{bucket + 1:02x}000000-0000-0000-0000-000000000000" if bucket < 255 else None
        anchor_upper_bound = (
            "AND document_segments.dataset_id < CAST(:bucket_end AS uuid)" if bucket_end is not None else ""
        )
        recursive_upper_bound = "AND ds.dataset_id < CAST(:bucket_end AS uuid)" if bucket_end is not None else ""
        distinct_dataset_stmt = text(
            f"""
            WITH RECURSIVE distinct_dataset_ids(dataset_id) AS (
                (
                    SELECT document_segments.dataset_id
                    FROM document_segments
                    WHERE document_segments.dataset_id >= CAST(:bucket_start AS uuid)
                      {anchor_upper_bound}
                    ORDER BY document_segments.dataset_id
                    LIMIT 1
                )
                UNION ALL
                SELECT (
                    SELECT ds.dataset_id
                    FROM document_segments AS ds
                    WHERE ds.dataset_id > distinct_dataset_ids.dataset_id
                      {recursive_upper_bound}
                    ORDER BY ds.dataset_id
                    LIMIT 1
                )
                FROM distinct_dataset_ids
                WHERE distinct_dataset_ids.dataset_id IS NOT NULL
            )
            SELECT dataset_id
            FROM distinct_dataset_ids
            WHERE dataset_id IS NOT NULL
            ORDER BY dataset_id
            """
        )
        distinct_params = {"bucket_start": bucket_start}
        if bucket_end is not None:
            distinct_params["bucket_end"] = bucket_end

        audit_records_stmt = text(
            """
            SELECT candidate.dataset_id,
                   owner.tenant_id,
                   (
                       SELECT count(*)
                       FROM documents
                       WHERE documents.dataset_id = candidate.dataset_id
                   ) AS documents
            FROM unnest(CAST(:dataset_ids AS uuid[])) AS candidate(dataset_id)
            JOIN LATERAL (
                SELECT ds.tenant_id
                FROM document_segments AS ds
                WHERE ds.dataset_id = candidate.dataset_id
                ORDER BY ds.tenant_id
                LIMIT 1
            ) AS owner ON true
            ORDER BY candidate.dataset_id, owner.tenant_id
            """
        )

        records: list[OrphanAuditRecord] = []
        with self._session_maker() as session:
            dataset_ids = [str(row[0]) for row in session.execute(distinct_dataset_stmt, distinct_params)]
            for dataset_id_batch in batched(dataset_ids, self._AUDIT_LOOKUP_BATCH_SIZE):
                live_dataset_ids = {
                    str(dataset_id)
                    for dataset_id in session.scalars(select(Dataset.id).where(Dataset.id.in_(dataset_id_batch))).all()
                }
                orphan_dataset_ids = [
                    dataset_id for dataset_id in dataset_id_batch if dataset_id not in live_dataset_ids
                ]
                if not orphan_dataset_ids:
                    continue

                records.extend(
                    OrphanAuditRecord(
                        dataset_id=str(dataset_id),
                        tenant_id=str(owner_tenant_id),
                        documents=int(documents),
                    )
                    for dataset_id, owner_tenant_id, documents in session.execute(
                        audit_records_stmt, {"dataset_ids": orphan_dataset_ids}
                    )
                )

        return tuple(records)

    def get_active_binding(self, tenant_id: str) -> TidbBindingRecord:
        competing_binding = aliased(TidbAuthBinding)
        has_no_competing_active_binding = (
            ~select(competing_binding.id)
            .where(
                competing_binding.active.is_(True),
                competing_binding.id != TidbAuthBinding.id,
                or_(
                    competing_binding.tenant_id == TidbAuthBinding.tenant_id,
                    competing_binding.cluster_id == TidbAuthBinding.cluster_id,
                ),
            )
            .exists()
        )
        binding_stmt = select(TidbAuthBinding).where(
            TidbAuthBinding.tenant_id == tenant_id,
            TidbAuthBinding.active.is_(True),
            has_no_competing_active_binding,
        )

        with self._session_maker() as session:
            bindings = list(session.scalars(binding_stmt).all())
            if (
                len(bindings) != 1
                or bindings[0].tenant_id != tenant_id
                or bindings[0].status != TidbAuthBindingStatus.ACTIVE
            ):
                raise TidbOrphanCleanupRepositoryError(
                    f"Expected one unique ACTIVE TiDB binding with exclusive cluster ownership for tenant {tenant_id}."
                )

            binding = bindings[0]
            return TidbBindingRecord(
                id=str(binding.id),
                tenant_id=str(binding.tenant_id) if binding.tenant_id is not None else None,
                cluster_id=str(binding.cluster_id),
                status=binding.status,
                account=binding.account,
                password=binding.password,
                qdrant_endpoint=binding.qdrant_endpoint,
            )

    def load_pg_states(
        self,
        tenant_id: str,
        dataset_ids: set[str],
    ) -> tuple[dict[str, OrphanPgState], tuple[TenantDatasetRecord, ...]]:
        with self._session_maker() as session:
            tenant_datasets = tuple(
                TenantDatasetRecord(id=str(dataset_id), index_struct=index_struct)
                for dataset_id, index_struct in session.execute(
                    select(Dataset.id, Dataset.index_struct).where(Dataset.tenant_id == tenant_id)
                )
            )
            if not dataset_ids:
                return {}, tenant_datasets

            dataset_tenants = {
                str(dataset_id): str(owner_tenant_id)
                for dataset_id, owner_tenant_id in session.execute(
                    select(Dataset.id, Dataset.tenant_id).where(Dataset.id.in_(dataset_ids))
                )
            }
            app_tenants = {
                str(app_id): str(owner_tenant_id)
                for app_id, owner_tenant_id in session.execute(
                    select(App.id, App.tenant_id).where(App.id.in_(dataset_ids))
                )
            }
            annotation_setting_ids = {
                str(app_id)
                for app_id in session.scalars(
                    select(AppAnnotationSetting.app_id).where(AppAnnotationSetting.app_id.in_(dataset_ids))
                ).all()
            }
            annotation_ids = {
                str(app_id)
                for app_id in session.scalars(
                    select(MessageAnnotation.app_id).where(MessageAnnotation.app_id.in_(dataset_ids))
                ).all()
            }
            live_document_segment_dataset_ids = {
                str(dataset_id)
                for dataset_id in session.scalars(
                    select(DocumentSegment.dataset_id)
                    .join(Document, Document.id == DocumentSegment.document_id)
                    .where(DocumentSegment.dataset_id.in_(dataset_ids))
                    .group_by(DocumentSegment.dataset_id)
                ).all()
            }

            documents = self._count_rows_by_dataset(session, Document.dataset_id, Document.id, dataset_ids)
            segments = self._count_rows_by_dataset(
                session,
                DocumentSegment.dataset_id,
                DocumentSegment.id,
                dataset_ids,
                DocumentSegment.tenant_id == tenant_id,
            )
            all_segments = self._count_rows_by_dataset(
                session,
                DocumentSegment.dataset_id,
                DocumentSegment.id,
                dataset_ids,
            )
            indexed_segments = self._count_rows_by_dataset(
                session,
                DocumentSegment.dataset_id,
                DocumentSegment.id,
                dataset_ids,
                DocumentSegment.tenant_id == tenant_id,
                DocumentSegment.index_node_id.is_not(None),
            )
            child_chunks = self._count_rows_by_dataset(
                session,
                ChildChunk.dataset_id,
                ChildChunk.id,
                dataset_ids,
                ChildChunk.tenant_id == tenant_id,
            )
            indexed_child_chunks = self._count_rows_by_dataset(
                session,
                ChildChunk.dataset_id,
                ChildChunk.id,
                dataset_ids,
                ChildChunk.tenant_id == tenant_id,
                ChildChunk.index_node_id.is_not(None),
            )
            summaries = self._count_rows_by_dataset(
                session,
                DocumentSegmentSummary.dataset_id,
                DocumentSegmentSummary.id,
                dataset_ids,
            )
            indexed_summaries = self._count_rows_by_dataset(
                session,
                DocumentSegmentSummary.dataset_id,
                DocumentSegmentSummary.id,
                dataset_ids,
                DocumentSegmentSummary.summary_index_node_id.is_not(None),
            )
            attachment_bindings = self._count_rows_by_dataset(
                session,
                SegmentAttachmentBinding.dataset_id,
                SegmentAttachmentBinding.id,
                dataset_ids,
                SegmentAttachmentBinding.tenant_id == tenant_id,
            )

        states = {
            dataset_id: OrphanPgState(
                dataset_tenant_id=dataset_tenants.get(dataset_id),
                app_tenant_id=app_tenants.get(dataset_id),
                annotation_setting_exists=dataset_id in annotation_setting_ids,
                annotation_exists=dataset_id in annotation_ids,
                documents=documents.get(dataset_id, 0),
                segments=segments.get(dataset_id, 0),
                indexed_segments=indexed_segments.get(dataset_id, 0),
                child_chunks=child_chunks.get(dataset_id, 0),
                indexed_child_chunks=indexed_child_chunks.get(dataset_id, 0),
                summaries=summaries.get(dataset_id, 0),
                indexed_summaries=indexed_summaries.get(dataset_id, 0),
                attachment_bindings=attachment_bindings.get(dataset_id, 0),
                foreign_tenant_segments=all_segments.get(dataset_id, 0) != segments.get(dataset_id, 0),
                live_document_segments=dataset_id in live_document_segment_dataset_ids,
            )
            for dataset_id in dataset_ids
        }
        return states, tenant_datasets

    def delete_orphan_rows(self, tenant_id: str, dataset_id: str, batch_size: int) -> dict[str, int]:
        deleted = {
            "child_chunks": self._delete_rows_in_batches(
                ChildChunk,
                (ChildChunk.tenant_id == tenant_id, ChildChunk.dataset_id == dataset_id),
                tenant_id,
                dataset_id,
                batch_size,
            ),
            "summaries": self._delete_rows_in_batches(
                DocumentSegmentSummary,
                (DocumentSegmentSummary.dataset_id == dataset_id,),
                tenant_id,
                dataset_id,
                batch_size,
            ),
            "segments": self._delete_rows_in_batches(
                DocumentSegment,
                (DocumentSegment.tenant_id == tenant_id, DocumentSegment.dataset_id == dataset_id),
                tenant_id,
                dataset_id,
                batch_size,
            ),
        }
        self.verify_orphan_rows_deleted(tenant_id, dataset_id)
        return deleted

    def verify_orphan_rows_deleted(self, tenant_id: str, dataset_id: str) -> None:
        with self._session_maker() as session:
            remaining_checks = (
                select(ChildChunk.id)
                .where(
                    ChildChunk.tenant_id == tenant_id,
                    ChildChunk.dataset_id == dataset_id,
                )
                .exists(),
                select(DocumentSegmentSummary.id).where(DocumentSegmentSummary.dataset_id == dataset_id).exists(),
                select(DocumentSegment.id)
                .where(
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                )
                .exists(),
            )
            if any(session.execute(select(*remaining_checks)).one()):
                raise TidbOrphanCleanupRepositoryError(
                    f"PostgreSQL rows reappeared for dataset ID {dataset_id}; cleanup is incomplete."
                )

    @staticmethod
    def _count_rows_by_dataset(
        session: Session,
        dataset_column: Any,
        id_column: Any,
        dataset_ids: set[str],
        *conditions: Any,
    ) -> dict[str, int]:
        rows = session.execute(
            select(dataset_column, func.count(id_column))
            .where(dataset_column.in_(dataset_ids), *conditions)
            .group_by(dataset_column)
        ).all()
        return {str(dataset_id): int(count) for dataset_id, count in rows}

    def _assert_cleanup_is_safe(self, session: Session, tenant_id: str, dataset_id: str) -> None:
        ownership_checks = (
            select(Dataset.id).where(Dataset.id == dataset_id).exists(),
            select(Document.id).where(Document.dataset_id == dataset_id).exists(),
            select(App.id).where(App.id == dataset_id).exists(),
            select(AppAnnotationSetting.id).where(AppAnnotationSetting.app_id == dataset_id).exists(),
            select(MessageAnnotation.id).where(MessageAnnotation.app_id == dataset_id).exists(),
            select(DocumentSegment.id)
            .where(DocumentSegment.dataset_id == dataset_id, DocumentSegment.tenant_id != tenant_id)
            .exists(),
            select(DocumentSegment.id)
            .join(Document, Document.id == DocumentSegment.document_id)
            .where(DocumentSegment.dataset_id == dataset_id)
            .exists(),
        )
        if any(session.execute(select(*ownership_checks)).one()):
            raise TidbOrphanCleanupRepositoryError(
                f"PostgreSQL ownership changed for dataset ID {dataset_id}; row cleanup was stopped."
            )

    def _delete_rows_in_batches(
        self,
        model: Any,
        filters: tuple[Any, ...],
        tenant_id: str,
        dataset_id: str,
        batch_size: int,
    ) -> int:
        deleted_total = 0
        while True:
            with self._session_maker.begin() as session:
                self._assert_cleanup_is_safe(session, tenant_id, dataset_id)
                row_ids = list(session.scalars(select(model.id).where(*filters).limit(batch_size)))
                if not row_ids:
                    return deleted_total
                result = cast(CursorResult[Any], session.execute(delete(model).where(model.id.in_(row_ids), *filters)))
                deleted_total += max(int(result.rowcount or 0), 0)


def create_tidb_orphan_cleanup_repository() -> TidbOrphanCleanupRepository:
    return TidbOrphanCleanupRepository(sessionmaker(bind=db.engine, expire_on_commit=False))
