"""Exact workspace accounting with durable reservations and short DB transactions."""

from dataclasses import asdict

import sqlalchemy as sa
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from models.account import Tenant
from models.enums import CreatorUserRole, UploadFilePurpose
from models.model import App, EndUser, UploadFile
from models.upload_quota import UploadQuotaReservation
from services.end_user_upload_service import (
    PendingUpload,
    UploadLimits,
    UploadOwnerNotFoundError,
    WorkspaceUploadQuotaExceededError,
)


def _record(row: UploadQuotaReservation | UploadFile) -> PendingUpload:
    """Detach immutable intent fields before the repository session closes."""
    return PendingUpload(
        id=row.id,
        tenant_id=row.tenant_id,
        created_by=row.created_by,
        storage_type=row.storage_type,
        key=row.key,
        name=row.name,
        size=row.size,
        extension=row.extension,
        mime_type=row.mime_type,
        created_at=row.created_at,
        hash=row.hash or "",
        source_url=row.source_url,
    )


class UploadQuotaRepository:
    """Serialize capacity transitions by updating the owning workspace row.

    A no-op UPDATE acquires a write lock on PostgreSQL, MySQL and SQLite. It
    precedes any consistent reads, so MySQL REPEATABLE READ snapshots include
    the last lock holder's commit. Finalization takes the same lock. No object
    operation runs under it. Metadata deletion can only reduce counted usage.
    """

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        """Receive a factory; never share sessions across operations or callers."""
        self._sessions = session_factory

    @staticmethod
    def _lock(session: Session, tenant_id: str) -> None:
        """Lock one existing workspace without changing its ID or update timestamp."""
        result = session.execute(sa.update(Tenant).where(Tenant.id == tenant_id).values(updated_at=Tenant.updated_at))
        assert isinstance(result, CursorResult)
        if result.rowcount != 1:
            raise UploadOwnerNotFoundError("Upload workspace not found")

    @staticmethod
    def _owner(session: Session, upload: PendingUpload) -> None:
        """Require a matching end user and, if present, its workspace-owned app."""
        owner = session.execute(
            sa.select(EndUser.id, EndUser.app_id)
            .outerjoin(App, sa.and_(App.id == EndUser.app_id, App.tenant_id == EndUser.tenant_id))
            .where(
                EndUser.id == upload.created_by,
                EndUser.tenant_id == upload.tenant_id,
                sa.or_(EndUser.app_id.is_(None), App.id.is_not(None)),
            )
        ).first()
        if owner is None:
            raise UploadOwnerNotFoundError("Upload end user or application does not belong to this workspace")

    def reserve(self, upload: PendingUpload, limits: UploadLimits) -> None:
        """Atomically admit within both limits, including all historical end-user rows."""
        with self._sessions.begin() as session:
            self._lock(session, upload.tenant_id)
            self._owner(session, upload)
            count, size = session.execute(
                sa.select(sa.func.count(), sa.func.coalesce(sa.func.sum(UploadFile.size), 0)).where(
                    UploadFile.tenant_id == upload.tenant_id,
                    UploadFile.purpose == UploadFilePurpose.UPLOAD,
                    sa.type_coerce(UploadFile.created_by_role, sa.String).in_(("end_user", "end-user")),
                )
            ).one()
            pending_count, pending_size = session.execute(
                sa.select(sa.func.count(), sa.func.coalesce(sa.func.sum(UploadQuotaReservation.size), 0)).where(
                    UploadQuotaReservation.tenant_id == upload.tenant_id,
                )
            ).one()
            if (limits.max_files and count + pending_count + 1 > limits.max_files) or (
                limits.max_bytes and size + pending_size + upload.size > limits.max_bytes
            ):
                raise WorkspaceUploadQuotaExceededError()
            session.add(UploadQuotaReservation(**asdict(upload)))

    def finalize(self, upload: PendingUpload, *, reserved: bool) -> PendingUpload:
        """Settle under the admission lock; retries return only the same committed identity."""
        with self._sessions.begin() as session:
            if reserved:
                self._lock(session, upload.tenant_id)
            existing = session.scalar(
                sa.select(UploadFile).where(UploadFile.tenant_id == upload.tenant_id, UploadFile.id == upload.id)
            )
            if existing is not None:
                if existing.purpose != UploadFilePurpose.UPLOAD or _record(existing) != upload:
                    raise ValueError("Committed upload does not match the reservation")
                return upload
            if reserved:
                pending = session.scalar(
                    sa.select(UploadQuotaReservation).where(
                        UploadQuotaReservation.tenant_id == upload.tenant_id, UploadQuotaReservation.id == upload.id
                    )
                )
                if pending is None or _record(pending) != upload:
                    raise ValueError("Upload reservation not found or changed")
                session.delete(pending)
            row = UploadFile(
                tenant_id=upload.tenant_id,
                storage_type=StorageType(upload.storage_type),
                key=upload.key,
                name=upload.name,
                size=upload.size,
                extension=upload.extension,
                mime_type=upload.mime_type,
                created_by_role=CreatorUserRole.END_USER,
                created_by=upload.created_by,
                created_at=upload.created_at,
                used=False,
                hash=upload.hash,
                source_url=upload.source_url,
            )
            row.id = upload.id
            session.add(row)
        return upload

    def pending(self, *, tenant_id: str, limit: int, reservation_id: str | None = None) -> list[PendingUpload]:
        """Materialize a bounded, tenant-scoped snapshot for operator recovery."""
        with self._sessions() as session:
            return [
                _record(row)
                for row in session.scalars(
                    sa.select(UploadQuotaReservation)
                    .where(UploadQuotaReservation.tenant_id == tenant_id)
                    .where(UploadQuotaReservation.id == reservation_id if reservation_id is not None else sa.true())
                    .order_by(UploadQuotaReservation.created_at, UploadQuotaReservation.id)
                    .limit(limit)
                )
            ]

    def release_missing(self, upload: PendingUpload) -> None:
        """After quiesced-writer/absence checks, remove only matching uncommitted intent."""
        with self._sessions.begin() as session:
            self._lock(session, upload.tenant_id)
            committed = session.scalar(
                sa.select(UploadFile.id).where(UploadFile.tenant_id == upload.tenant_id, UploadFile.id == upload.id)
            )
            if committed is not None:
                raise ValueError("Cannot release a committed upload")
            pending = session.scalar(
                sa.select(UploadQuotaReservation).where(
                    UploadQuotaReservation.tenant_id == upload.tenant_id, UploadQuotaReservation.id == upload.id
                )
            )
            if pending is not None:
                if _record(pending) != upload:
                    raise ValueError("Upload reservation changed")
                session.delete(pending)
