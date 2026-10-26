"""SQLAlchemy CAS implementation for the KnowledgeFS lifecycle outbox."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import cast, override

import sqlalchemy as sa
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from models.knowledge_fs import (
    KnowledgeFSLifecycleOperation,
    KnowledgeFSLifecycleOutbox,
    KnowledgeFSLifecycleOutboxStatus,
)
from repositories.knowledge_fs_lifecycle_outbox_repository import KnowledgeFSLifecycleOutboxRepository
from services.knowledge_fs.observability import (
    KnowledgeFSLifecycleTaskMetric,
    KnowledgeFSOperationalMetricsPort,
    get_knowledge_fs_operational_metrics,
)

logger = logging.getLogger(__name__)


class SQLAlchemyKnowledgeFSLifecycleOutboxRepository(KnowledgeFSLifecycleOutboxRepository):
    """Claim and settle commands inside a caller-owned database transaction."""

    def __init__(self, session: Session, metrics: KnowledgeFSOperationalMetricsPort | None = None):
        self._session = session
        self._metrics = metrics or get_knowledge_fs_operational_metrics()

    @override
    def add(self, command: KnowledgeFSLifecycleOutbox) -> KnowledgeFSLifecycleOutbox:
        self._session.add(command)
        self._session.flush()
        try:
            self._metrics.record_lifecycle_task(KnowledgeFSLifecycleTaskMetric(None, command.operation.value, "queued"))
        except Exception:
            logger.warning(
                "KnowledgeFS lifecycle metric export failed operation=%s status=queued",
                command.operation.value,
                exc_info=True,
            )
        return command

    @override
    def get(self, *, outbox_id: str) -> KnowledgeFSLifecycleOutbox | None:
        statement = (
            select(KnowledgeFSLifecycleOutbox)
            .where(KnowledgeFSLifecycleOutbox.id == outbox_id)
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    @override
    def get_by_operation_id(self, *, tenant_id: str, operation_id: str) -> KnowledgeFSLifecycleOutbox | None:
        statement = (
            select(KnowledgeFSLifecycleOutbox)
            .where(
                KnowledgeFSLifecycleOutbox.tenant_id == tenant_id,
                KnowledgeFSLifecycleOutbox.operation_id == operation_id,
            )
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    @override
    def find_open_for_control_space(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
        operation: KnowledgeFSLifecycleOperation,
    ) -> KnowledgeFSLifecycleOutbox | None:
        statement = (
            select(KnowledgeFSLifecycleOutbox)
            .where(
                KnowledgeFSLifecycleOutbox.tenant_id == tenant_id,
                KnowledgeFSLifecycleOutbox.control_space_id == control_space_id,
                KnowledgeFSLifecycleOutbox.operation == operation,
                KnowledgeFSLifecycleOutbox.status.in_(
                    (
                        KnowledgeFSLifecycleOutboxStatus.PENDING,
                        KnowledgeFSLifecycleOutboxStatus.PROCESSING,
                        KnowledgeFSLifecycleOutboxStatus.RETRY,
                    )
                ),
            )
            .order_by(KnowledgeFSLifecycleOutbox.created_at.desc(), KnowledgeFSLifecycleOutbox.id.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    @override
    def find_latest_for_control_space(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
        operation: KnowledgeFSLifecycleOperation,
    ) -> KnowledgeFSLifecycleOutbox | None:
        statement = (
            select(KnowledgeFSLifecycleOutbox)
            .where(
                KnowledgeFSLifecycleOutbox.tenant_id == tenant_id,
                KnowledgeFSLifecycleOutbox.control_space_id == control_space_id,
                KnowledgeFSLifecycleOutbox.operation == operation,
            )
            .order_by(KnowledgeFSLifecycleOutbox.created_at.desc(), KnowledgeFSLifecycleOutbox.id.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    @override
    def reactivate_dead_letter(self, *, outbox_id: str) -> bool:
        statement = (
            update(KnowledgeFSLifecycleOutbox)
            .where(
                KnowledgeFSLifecycleOutbox.id == outbox_id,
                KnowledgeFSLifecycleOutbox.status == KnowledgeFSLifecycleOutboxStatus.DEAD_LETTER,
                KnowledgeFSLifecycleOutbox.lease_owner.is_(None),
                KnowledgeFSLifecycleOutbox.lease_expires_at.is_(None),
            )
            .values(
                status=KnowledgeFSLifecycleOutboxStatus.RETRY,
                next_attempt_at=None,
                completed_at=None,
            )
            .execution_options(synchronize_session=False)
        )
        return self._updated_once(statement)

    @override
    def supersede_unattempted(
        self,
        *,
        outbox_id: str,
        completed_at: datetime,
        error_code: str,
        error_message: str,
    ) -> bool:
        statement = (
            update(KnowledgeFSLifecycleOutbox)
            .where(
                KnowledgeFSLifecycleOutbox.id == outbox_id,
                KnowledgeFSLifecycleOutbox.status == KnowledgeFSLifecycleOutboxStatus.PENDING,
                KnowledgeFSLifecycleOutbox.attempt_count == 0,
                KnowledgeFSLifecycleOutbox.lease_owner.is_(None),
                KnowledgeFSLifecycleOutbox.lease_expires_at.is_(None),
            )
            .values(
                status=KnowledgeFSLifecycleOutboxStatus.DEAD_LETTER,
                completed_at=completed_at,
                last_error_code=error_code,
                last_error_message=error_message,
            )
            .execution_options(synchronize_session=False)
        )
        return self._updated_once(statement)

    @override
    def supersede_after_remote_absence(
        self,
        *,
        outbox_id: str,
        observed_at: datetime,
        error_code: str,
        error_message: str,
    ) -> bool:
        safely_unleased = sa.and_(
            KnowledgeFSLifecycleOutbox.status.in_(
                (
                    KnowledgeFSLifecycleOutboxStatus.PENDING,
                    KnowledgeFSLifecycleOutboxStatus.RETRY,
                    KnowledgeFSLifecycleOutboxStatus.DEAD_LETTER,
                )
            ),
            KnowledgeFSLifecycleOutbox.lease_owner.is_(None),
            KnowledgeFSLifecycleOutbox.lease_expires_at.is_(None),
        )
        expired_lease = sa.and_(
            KnowledgeFSLifecycleOutbox.status == KnowledgeFSLifecycleOutboxStatus.PROCESSING,
            KnowledgeFSLifecycleOutbox.lease_expires_at <= observed_at,
        )
        statement = (
            update(KnowledgeFSLifecycleOutbox)
            .where(
                KnowledgeFSLifecycleOutbox.id == outbox_id,
                sa.or_(safely_unleased, expired_lease),
            )
            .values(
                status=KnowledgeFSLifecycleOutboxStatus.DEAD_LETTER,
                lease_owner=None,
                lease_expires_at=None,
                completed_at=sa.func.coalesce(KnowledgeFSLifecycleOutbox.completed_at, observed_at),
                last_error_code=error_code,
                last_error_message=error_message,
            )
            .execution_options(synchronize_session=False)
        )
        return self._updated_once(statement)

    @override
    def claim_next(
        self,
        *,
        lease_owner: str,
        now: datetime,
        lease_duration: timedelta,
        allowed_operations: tuple[KnowledgeFSLifecycleOperation, ...],
    ) -> KnowledgeFSLifecycleOutbox | None:
        if not lease_owner.strip():
            raise ValueError("lease_owner must not be blank")
        if lease_duration <= timedelta(0):
            raise ValueError("lease_duration must be positive")
        if not allowed_operations:
            return None

        ready_to_attempt = sa.and_(
            KnowledgeFSLifecycleOutbox.status.in_(
                (KnowledgeFSLifecycleOutboxStatus.PENDING, KnowledgeFSLifecycleOutboxStatus.RETRY)
            ),
            sa.or_(
                KnowledgeFSLifecycleOutbox.next_attempt_at.is_(None),
                KnowledgeFSLifecycleOutbox.next_attempt_at <= now,
            ),
        )
        expired_lease = sa.and_(
            KnowledgeFSLifecycleOutbox.status == KnowledgeFSLifecycleOutboxStatus.PROCESSING,
            KnowledgeFSLifecycleOutbox.lease_expires_at <= now,
        )
        candidate_statement = (
            select(KnowledgeFSLifecycleOutbox)
            .where(
                KnowledgeFSLifecycleOutbox.operation.in_(allowed_operations),
                sa.or_(ready_to_attempt, expired_lease),
            )
            .order_by(
                sa.func.coalesce(KnowledgeFSLifecycleOutbox.next_attempt_at, KnowledgeFSLifecycleOutbox.created_at),
                KnowledgeFSLifecycleOutbox.id,
            )
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        candidate = self._session.scalar(candidate_statement)
        if candidate is None:
            return None

        lease_expires_at = now + lease_duration
        claim_statement = update(KnowledgeFSLifecycleOutbox).where(
            KnowledgeFSLifecycleOutbox.id == candidate.id,
            KnowledgeFSLifecycleOutbox.status == candidate.status,
            KnowledgeFSLifecycleOutbox.attempt_count == candidate.attempt_count,
        )
        if candidate.status is KnowledgeFSLifecycleOutboxStatus.PROCESSING:
            claim_statement = claim_statement.where(
                KnowledgeFSLifecycleOutbox.lease_owner == candidate.lease_owner,
                KnowledgeFSLifecycleOutbox.lease_expires_at == candidate.lease_expires_at,
                KnowledgeFSLifecycleOutbox.lease_expires_at <= now,
            )
        else:
            claim_statement = claim_statement.where(
                KnowledgeFSLifecycleOutbox.lease_owner.is_(None),
                KnowledgeFSLifecycleOutbox.lease_expires_at.is_(None),
            )
        result = self._session.execute(
            claim_statement.values(
                status=KnowledgeFSLifecycleOutboxStatus.PROCESSING,
                lease_owner=lease_owner,
                lease_expires_at=lease_expires_at,
                last_attempt_at=now,
                attempt_count=candidate.attempt_count + 1,
                completed_at=None,
            ).execution_options(synchronize_session=False)
        )
        if (cast(CursorResult[tuple[object, ...]], result).rowcount or 0) != 1:
            return None
        return self.get(outbox_id=candidate.id)

    @override
    def acknowledge(
        self,
        *,
        outbox_id: str,
        lease_owner: str,
        expected_lease_expires_at: datetime,
        completed_at: datetime,
    ) -> bool:
        statement = (
            update(KnowledgeFSLifecycleOutbox)
            .where(
                KnowledgeFSLifecycleOutbox.id == outbox_id,
                KnowledgeFSLifecycleOutbox.status == KnowledgeFSLifecycleOutboxStatus.PROCESSING,
                KnowledgeFSLifecycleOutbox.lease_owner == lease_owner,
                KnowledgeFSLifecycleOutbox.lease_expires_at == expected_lease_expires_at,
                KnowledgeFSLifecycleOutbox.lease_expires_at > completed_at,
            )
            .values(
                status=KnowledgeFSLifecycleOutboxStatus.SUCCEEDED,
                lease_owner=None,
                lease_expires_at=None,
                completed_at=completed_at,
                last_error_code=None,
                last_error_message=None,
            )
            .execution_options(synchronize_session=False)
        )
        return self._updated_once(statement)

    @override
    def schedule_retry(
        self,
        *,
        outbox_id: str,
        lease_owner: str,
        expected_lease_expires_at: datetime,
        next_attempt_at: datetime,
        error_code: str,
        error_message: str,
    ) -> bool:
        statement = (
            self._leased_update(
                outbox_id=outbox_id,
                lease_owner=lease_owner,
                expected_lease_expires_at=expected_lease_expires_at,
            )
            .values(
                status=KnowledgeFSLifecycleOutboxStatus.RETRY,
                lease_owner=None,
                lease_expires_at=None,
                next_attempt_at=next_attempt_at,
                completed_at=None,
                last_error_code=error_code,
                last_error_message=error_message,
            )
            .execution_options(synchronize_session=False)
        )
        return self._updated_once(statement)

    @override
    def mark_dead_letter(
        self,
        *,
        outbox_id: str,
        lease_owner: str,
        expected_lease_expires_at: datetime,
        completed_at: datetime,
        error_code: str,
        error_message: str,
    ) -> bool:
        statement = (
            self._leased_update(
                outbox_id=outbox_id,
                lease_owner=lease_owner,
                expected_lease_expires_at=expected_lease_expires_at,
            )
            .values(
                status=KnowledgeFSLifecycleOutboxStatus.DEAD_LETTER,
                lease_owner=None,
                lease_expires_at=None,
                completed_at=completed_at,
                last_error_code=error_code,
                last_error_message=error_message,
            )
            .execution_options(synchronize_session=False)
        )
        return self._updated_once(statement)

    def _leased_update(
        self,
        *,
        outbox_id: str,
        lease_owner: str,
        expected_lease_expires_at: datetime,
    ) -> sa.Update:
        return update(KnowledgeFSLifecycleOutbox).where(
            KnowledgeFSLifecycleOutbox.id == outbox_id,
            KnowledgeFSLifecycleOutbox.status == KnowledgeFSLifecycleOutboxStatus.PROCESSING,
            KnowledgeFSLifecycleOutbox.lease_owner == lease_owner,
            KnowledgeFSLifecycleOutbox.lease_expires_at == expected_lease_expires_at,
        )

    def _updated_once(self, statement: sa.Update) -> bool:
        result = self._session.execute(statement)
        return (cast(CursorResult[tuple[object, ...]], result).rowcount or 0) == 1


__all__ = ["SQLAlchemyKnowledgeFSLifecycleOutboxRepository"]
