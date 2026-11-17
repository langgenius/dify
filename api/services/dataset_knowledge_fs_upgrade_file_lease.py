"""Physical-retention checks for legacy files captured by an upgrade snapshot."""

from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import datetime
from json import JSONDecodeError

import sqlalchemy as sa
from sqlalchemy.orm import Session, aliased, sessionmaker

from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models.dataset import Document
from models.knowledge_fs import KnowledgeFSUpgradeFileLease, KnowledgeFSUpgradeFileLeaseStatus
from models.model import UploadFile


def active_upgrade_file_ids(
    session: Session,
    upload_file_ids: Iterable[str],
    *,
    now: datetime | None = None,
) -> set[str]:
    """Return source files whose physical deletion must wait for migration."""

    normalized_ids = frozenset(str(upload_file_id) for upload_file_id in upload_file_ids if upload_file_id)
    if not normalized_ids:
        return set()
    return set(
        session.scalars(
            sa.select(KnowledgeFSUpgradeFileLease.old_upload_file_id).where(
                KnowledgeFSUpgradeFileLease.old_upload_file_id.in_(normalized_ids),
                KnowledgeFSUpgradeFileLease.status == KnowledgeFSUpgradeFileLeaseStatus.ACTIVE,
                KnowledgeFSUpgradeFileLease.expires_at > (now or naive_utc_now()),
            )
        )
    )


def reserve_upgrade_file_cleanup(
    session: Session,
    upload_file_ids: Iterable[str],
    *,
    now: datetime | None = None,
) -> set[str]:
    """Persist cleanup intent for files whose active migration lease blocks deletion."""

    requested_at = now or naive_utc_now()
    normalized_ids = frozenset(str(upload_file_id) for upload_file_id in upload_file_ids if upload_file_id)
    if not normalized_ids:
        return set()
    leases = list(
        session.scalars(
            sa.select(KnowledgeFSUpgradeFileLease)
            .where(
                KnowledgeFSUpgradeFileLease.old_upload_file_id.in_(normalized_ids),
                KnowledgeFSUpgradeFileLease.status == KnowledgeFSUpgradeFileLeaseStatus.ACTIVE,
                KnowledgeFSUpgradeFileLease.expires_at > requested_at,
            )
            .with_for_update()
        )
    )
    for lease in leases:
        if lease.cleanup_requested_at is None:
            lease.cleanup_requested_at = requested_at
    return {lease.old_upload_file_id for lease in leases}


def release_upgrade_file_lease(
    session: Session,
    *,
    job_id: str,
    upload_file_id: str,
    now: datetime | None = None,
) -> bool:
    """Release one lease and fulfill deferred cleanup after the last protection ends."""

    released_at = now or naive_utc_now()
    leases = list(
        session.scalars(
            sa.select(KnowledgeFSUpgradeFileLease)
            .where(KnowledgeFSUpgradeFileLease.old_upload_file_id == upload_file_id)
            .with_for_update()
        )
    )
    current = next((lease for lease in leases if lease.job_id == job_id), None)
    if current is None:
        return False
    current.status = KnowledgeFSUpgradeFileLeaseStatus.RELEASED
    current.released_at = released_at
    cleanup_requested = any(lease.cleanup_requested_at is not None for lease in leases)
    still_protected = any(
        lease.status == KnowledgeFSUpgradeFileLeaseStatus.ACTIVE and lease.expires_at > released_at for lease in leases
    )
    if not cleanup_requested or still_protected or _legacy_document_references_file(session, upload_file_id):
        return False
    upload_file = session.get(UploadFile, upload_file_id)
    if upload_file is None:
        return False
    storage.delete(upload_file.key)
    session.delete(upload_file)
    return True


def cleanup_deferred_upgrade_files(
    session_maker: sessionmaker[Session],
    *,
    limit: int = 100,
    now: datetime | None = None,
) -> int:
    """Retry bounded cleanup requests after abandoned migration leases expire."""

    cleanup_at = now or naive_utc_now()
    with session_maker() as session:
        candidate = aliased(KnowledgeFSUpgradeFileLease)
        blocking = aliased(KnowledgeFSUpgradeFileLease)
        upload_file_ids = list(
            session.scalars(
                sa.select(candidate.old_upload_file_id)
                .where(
                    candidate.cleanup_requested_at.is_not(None),
                    ~sa.exists(
                        sa.select(blocking.id).where(
                            blocking.old_upload_file_id == candidate.old_upload_file_id,
                            blocking.status == KnowledgeFSUpgradeFileLeaseStatus.ACTIVE,
                            blocking.expires_at > cleanup_at,
                        )
                    ),
                )
                .distinct()
                .limit(limit)
            )
        )
    cleaned = 0
    for upload_file_id in upload_file_ids:
        with session_maker.begin() as session:
            leases = list(
                session.scalars(
                    sa.select(KnowledgeFSUpgradeFileLease)
                    .where(KnowledgeFSUpgradeFileLease.old_upload_file_id == upload_file_id)
                    .with_for_update()
                )
            )
            for lease in leases:
                if lease.status == KnowledgeFSUpgradeFileLeaseStatus.ACTIVE and lease.expires_at <= cleanup_at:
                    lease.status = KnowledgeFSUpgradeFileLeaseStatus.EXPIRED
            if any(
                lease.status == KnowledgeFSUpgradeFileLeaseStatus.ACTIVE and lease.expires_at > cleanup_at
                for lease in leases
            ):
                continue
            if _legacy_document_references_file(session, upload_file_id):
                for lease in leases:
                    lease.cleanup_requested_at = None
                continue
            upload_file = session.get(UploadFile, upload_file_id)
            if upload_file is None:
                for lease in leases:
                    lease.cleanup_requested_at = None
                continue
            storage.delete(upload_file.key)
            session.delete(upload_file)
            cleaned += 1
    return cleaned


def _legacy_document_references_file(session: Session, upload_file_id: str) -> bool:
    candidates = session.scalars(
        sa.select(Document.data_source_info).where(
            Document.data_source_type == "upload_file",
            Document.data_source_info.contains(upload_file_id),
        )
    )
    for candidate in candidates:
        if not candidate:
            continue
        try:
            payload = json.loads(candidate)
        except (JSONDecodeError, TypeError):
            continue
        if isinstance(payload, dict) and str(payload.get("upload_file_id") or "") == upload_file_id:
            return True
    return False


__all__ = [
    "active_upgrade_file_ids",
    "cleanup_deferred_upgrade_files",
    "release_upgrade_file_lease",
    "reserve_upgrade_file_cleanup",
]
