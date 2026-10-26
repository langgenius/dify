"""Transactional persistence for pre-signing KnowledgeFS capability reservations."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import cast

import sqlalchemy as sa
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from models.knowledge_fs import (
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSCapabilityIssuanceReservationStatus,
    KnowledgeFSCapabilityReservationSummary,
)
from services.knowledge_fs_capability import (
    CAPABILITY_ISSUANCE_PROFILES,
    KNOWLEDGE_FS_CAPABILITY_OPERATIONS,
    CapabilityIssueRequest,
)

_TERMINAL_RETENTION = timedelta(days=1)


class KnowledgeFSCapabilityIssuanceReservationError(RuntimeError):
    """A retry attempted to change or lose a durable issuance binding."""


class SQLAlchemyKnowledgeFSCapabilityIssuanceReservationRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def reserve(self, request: CapabilityIssueRequest) -> KnowledgeFSCapabilityIssuanceReservation:
        summary = _request_summary(request)
        reservation = self._session.scalar(
            sa.select(KnowledgeFSCapabilityIssuanceReservation)
            .where(
                KnowledgeFSCapabilityIssuanceReservation.tenant_id == request.namespace_id,
                KnowledgeFSCapabilityIssuanceReservation.grant_id == request.grant_id,
            )
            .with_for_update()
        )
        if reservation is None:
            reservation = KnowledgeFSCapabilityIssuanceReservation(
                tenant_id=request.namespace_id,
                control_space_id=request.control_space_id,
                grant_id=request.grant_id,
                trace_id=request.trace_id,
                subject=summary["subject"],
                caller_kind=request.caller_kind,
                request_summary=summary,
            )
            self._session.add(reservation)
            self._session.flush()
            return reservation
        if (
            reservation.control_space_id != request.control_space_id
            or reservation.trace_id != request.trace_id
            or reservation.subject != summary["subject"]
            or reservation.caller_kind != request.caller_kind
            or reservation.request_summary != summary
        ):
            raise KnowledgeFSCapabilityIssuanceReservationError(
                "Capability grant retry does not match its durable reservation"
            )
        if reservation.status is KnowledgeFSCapabilityIssuanceReservationStatus.FAILED:
            reservation.status = KnowledgeFSCapabilityIssuanceReservationStatus.RESERVED
            reservation.failed_at = None
            reservation.failure_code = None
            reservation.cleanup_after = None
            reservation.row_version += 1
            self._session.flush()
        return reservation

    def mark_issued(
        self,
        *,
        tenant_id: str,
        grant_id: str,
        issued_at: datetime,
        token_expires_at: datetime,
    ) -> None:
        reservation = self._locked(tenant_id=tenant_id, grant_id=grant_id)
        reservation.status = KnowledgeFSCapabilityIssuanceReservationStatus.ISSUED
        reservation.issued_at = issued_at
        reservation.token_expires_at = token_expires_at
        reservation.failed_at = None
        reservation.failure_code = None
        reservation.cleanup_after = token_expires_at + _TERMINAL_RETENTION
        reservation.row_version += 1
        self._session.flush()

    def mark_failed(
        self,
        *,
        tenant_id: str,
        grant_id: str,
        failed_at: datetime,
        failure_code: str,
    ) -> None:
        reservation = self._locked(tenant_id=tenant_id, grant_id=grant_id)
        if reservation.status is KnowledgeFSCapabilityIssuanceReservationStatus.ISSUED:
            return
        reservation.status = KnowledgeFSCapabilityIssuanceReservationStatus.FAILED
        reservation.issued_at = None
        reservation.token_expires_at = None
        reservation.failed_at = failed_at
        reservation.failure_code = failure_code[:128]
        reservation.cleanup_after = failed_at + _TERMINAL_RETENTION
        reservation.row_version += 1
        self._session.flush()

    def cleanup_terminal(self, *, before: datetime, limit: int = 1_000) -> int:
        if limit <= 0:
            raise ValueError("Capability reservation cleanup limit must be positive")
        reservation_ids = tuple(
            self._session.scalars(
                sa.select(KnowledgeFSCapabilityIssuanceReservation.id)
                .where(
                    KnowledgeFSCapabilityIssuanceReservation.status
                    != KnowledgeFSCapabilityIssuanceReservationStatus.RESERVED,
                    KnowledgeFSCapabilityIssuanceReservation.cleanup_after <= before,
                )
                .order_by(
                    KnowledgeFSCapabilityIssuanceReservation.cleanup_after,
                    KnowledgeFSCapabilityIssuanceReservation.id,
                )
                .limit(limit)
                .with_for_update()
            )
        )
        if not reservation_ids:
            return 0
        result = self._session.execute(
            sa.delete(KnowledgeFSCapabilityIssuanceReservation).where(
                KnowledgeFSCapabilityIssuanceReservation.id.in_(reservation_ids)
            )
        )
        return cast(CursorResult[tuple[object, ...]], result).rowcount or 0

    def _locked(self, *, tenant_id: str, grant_id: str) -> KnowledgeFSCapabilityIssuanceReservation:
        reservation = self._session.scalar(
            sa.select(KnowledgeFSCapabilityIssuanceReservation)
            .where(
                KnowledgeFSCapabilityIssuanceReservation.tenant_id == tenant_id,
                KnowledgeFSCapabilityIssuanceReservation.grant_id == grant_id,
            )
            .with_for_update()
        )
        if reservation is None:
            raise KnowledgeFSCapabilityIssuanceReservationError("Capability issuance reservation is missing")
        return reservation


def _request_summary(request: CapabilityIssueRequest) -> KnowledgeFSCapabilityReservationSummary:
    operation = KNOWLEDGE_FS_CAPABILITY_OPERATIONS[request.operation_id]
    profile = CAPABILITY_ISSUANCE_PROFILES[request.caller_kind]
    subject = f"{profile.subject_prefix}:{request.principal_id}"
    return cast(
        KnowledgeFSCapabilityReservationSummary,
        {
            "action": operation.action,
            "actor": request.actor,
            "authz_revision": request.authz_revision.model_dump(mode="json"),
            "caller_kind": request.caller_kind,
            "content_policy_revision": request.content_policy_revision,
            "content_scope_ids": list(request.content_scope_ids),
            "control_space_id": request.control_space_id,
            "grant_id": request.grant_id,
            "namespace_id": request.namespace_id,
            "operation_id": request.operation_id,
            "resource_id": request.resource.id,
            "resource_parent_id": request.resource.parent_id,
            "resource_type": request.resource.type,
            "subject": subject,
            "trace_id": request.trace_id,
        },
    )


__all__ = [
    "KnowledgeFSCapabilityIssuanceReservationError",
    "SQLAlchemyKnowledgeFSCapabilityIssuanceReservationRepository",
]
