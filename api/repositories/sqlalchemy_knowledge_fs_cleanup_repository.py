"""SQLAlchemy cleanup-authorization repository with status and version CAS."""

from __future__ import annotations

from typing import cast, override

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from models.knowledge_fs_cleanup import KnowledgeFSCleanupAuthorization
from repositories.knowledge_fs_cleanup_repository import (
    KnowledgeFSCleanupAuthorizationCASUpdate,
    KnowledgeFSCleanupAuthorizationRepository,
)


class SQLAlchemyKnowledgeFSCleanupAuthorizationRepository(KnowledgeFSCleanupAuthorizationRepository):
    _session: Session

    def __init__(self, session: Session):
        self._session = session

    @override
    def add(self, authorization: KnowledgeFSCleanupAuthorization) -> KnowledgeFSCleanupAuthorization:
        self._session.add(authorization)
        self._session.flush()
        return authorization

    @override
    def get(
        self,
        *,
        tenant_id: str,
        ledger_id: str,
        request_id: str,
    ) -> KnowledgeFSCleanupAuthorization | None:
        statement = (
            select(KnowledgeFSCleanupAuthorization)
            .where(
                KnowledgeFSCleanupAuthorization.tenant_id == tenant_id,
                KnowledgeFSCleanupAuthorization.ledger_id == ledger_id,
                KnowledgeFSCleanupAuthorization.request_id == request_id,
            )
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    @override
    def compare_and_set(self, update_values: KnowledgeFSCleanupAuthorizationCASUpdate) -> bool:
        values: dict[str, object] = {
            "status": update_values.new_status,
            "row_version": KnowledgeFSCleanupAuthorization.row_version + 1,
        }
        for field_name in (
            "approved_by_account_id",
            "approved_at",
            "approval_expires_at",
            "approved_ledger_cas_version",
            "started_by_account_id",
            "started_at",
            "started_ledger_cas_version",
            "completed_by_account_id",
            "completed_at",
            "completion_evidence",
            "completed_ledger_cas_version",
        ):
            value = getattr(update_values, field_name)
            if value is not None:
                values[field_name] = value
        statement = (
            update(KnowledgeFSCleanupAuthorization)
            .where(
                KnowledgeFSCleanupAuthorization.tenant_id == update_values.tenant_id,
                KnowledgeFSCleanupAuthorization.ledger_id == update_values.ledger_id,
                KnowledgeFSCleanupAuthorization.request_id == update_values.request_id,
                KnowledgeFSCleanupAuthorization.status == update_values.expected_status,
                KnowledgeFSCleanupAuthorization.row_version == update_values.expected_row_version,
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        result = self._session.execute(statement)
        return (cast(CursorResult[tuple[object, ...]], result).rowcount or 0) == 1


__all__ = ["SQLAlchemyKnowledgeFSCleanupAuthorizationRepository"]
