"""Durable ownership and recovery for App related-data cleanup."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import and_, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.app_cleanup import AppCleanupOperation

APP_CLEANUP_PENDING = "pending"
APP_CLEANUP_RUNNING = "running"
APP_CLEANUP_COMPLETED = "completed"


@dataclass(frozen=True)
class AppCleanupLease:
    tenant_id: str
    app_id: str
    lease_id: str


@dataclass(frozen=True)
class AppCleanupRequest:
    tenant_id: str
    app_id: str


def ensure_app_cleanup_operation(session: Session, *, tenant_id: str, app_id: str) -> AppCleanupOperation:
    """Persist one App cleanup request in the caller's transaction.

    Deletion owners call this before removing the App row. App identity locks
    serialize the normal deletion paths; duplicate task deliveries can rely on
    the primary key and the already-persisted winner.
    """

    operation = session.get(AppCleanupOperation, app_id, with_for_update=True)
    if operation is None:
        operation = AppCleanupOperation(tenant_id=tenant_id, app_id=app_id)
        session.add(operation)
        session.flush()
    if operation.tenant_id != tenant_id:
        raise ValueError(f"App cleanup operation {app_id} belongs to another tenant")
    return operation


class AppCleanupRepository:
    """Persist cleanup state in short transactions around external work."""

    def __init__(self, *, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    def defer_unclaimed(
        self,
        *,
        tenant_id: str,
        app_id: str,
        available_at: datetime,
        error: str,
    ) -> bool:
        """Keep a legacy or duplicate delivery pending without stealing an active lease."""

        now = naive_utc_now()
        with self._session_factory() as session, session.begin():
            operation = ensure_app_cleanup_operation(session, tenant_id=tenant_id, app_id=app_id)
            if operation.status == APP_CLEANUP_COMPLETED:
                return False
            if (
                operation.status == APP_CLEANUP_RUNNING
                and operation.lease_expires_at is not None
                and operation.lease_expires_at > now
            ):
                return False
            operation.status = APP_CLEANUP_PENDING
            operation.available_at = available_at
            operation.lease_id = None
            operation.lease_expires_at = None
            operation.last_error = error
            return True

    def claim(self, *, tenant_id: str, app_id: str, now: datetime, lease_until: datetime) -> AppCleanupLease | None:
        """Claim one delivery, accepting pending reservations and expired executions."""

        with self._session_factory() as session, session.begin():
            operation = ensure_app_cleanup_operation(session, tenant_id=tenant_id, app_id=app_id)
            if operation.status == APP_CLEANUP_COMPLETED:
                return None
            if (
                operation.status == APP_CLEANUP_RUNNING
                and operation.lease_expires_at is not None
                and operation.lease_expires_at > now
            ):
                return None
            lease_id = str(uuid4())
            operation.status = APP_CLEANUP_RUNNING
            operation.lease_id = lease_id
            operation.lease_expires_at = lease_until
            operation.attempts += 1
            operation.last_error = None
            operation.finished_at = None
            return AppCleanupLease(tenant_id=tenant_id, app_id=app_id, lease_id=lease_id)

    def renew(self, lease: AppCleanupLease, *, lease_until: datetime) -> bool:
        with self._session_factory() as session, session.begin():
            result = session.execute(
                update(AppCleanupOperation)
                .where(
                    AppCleanupOperation.tenant_id == lease.tenant_id,
                    AppCleanupOperation.app_id == lease.app_id,
                    AppCleanupOperation.status == APP_CLEANUP_RUNNING,
                    AppCleanupOperation.lease_id == lease.lease_id,
                )
                .values(lease_expires_at=lease_until)
            )
            return bool(result.rowcount) if isinstance(result, CursorResult) else False

    def defer_claim(self, lease: AppCleanupLease, *, available_at: datetime, error: str) -> bool:
        with self._session_factory() as session, session.begin():
            result = session.execute(
                update(AppCleanupOperation)
                .where(
                    AppCleanupOperation.tenant_id == lease.tenant_id,
                    AppCleanupOperation.app_id == lease.app_id,
                    AppCleanupOperation.status == APP_CLEANUP_RUNNING,
                    AppCleanupOperation.lease_id == lease.lease_id,
                )
                .values(
                    status=APP_CLEANUP_PENDING,
                    available_at=available_at,
                    lease_id=None,
                    lease_expires_at=None,
                    last_error=error,
                )
            )
            return bool(result.rowcount) if isinstance(result, CursorResult) else False

    def complete(self, lease: AppCleanupLease, *, finished_at: datetime) -> bool:
        with self._session_factory() as session, session.begin():
            result = session.execute(
                update(AppCleanupOperation)
                .where(
                    AppCleanupOperation.tenant_id == lease.tenant_id,
                    AppCleanupOperation.app_id == lease.app_id,
                    AppCleanupOperation.status == APP_CLEANUP_RUNNING,
                    AppCleanupOperation.lease_id == lease.lease_id,
                )
                .values(
                    status=APP_CLEANUP_COMPLETED,
                    lease_id=None,
                    lease_expires_at=None,
                    last_error=None,
                    finished_at=finished_at,
                )
            )
            return bool(result.rowcount) if isinstance(result, CursorResult) else False

    def reserve_recovery_batch(
        self,
        *,
        now: datetime,
        limit: int,
        redispatch_after: timedelta,
    ) -> tuple[AppCleanupRequest, ...]:
        """Reserve due pending or abandoned operations before publishing them."""

        if limit < 1:
            return ()
        with self._session_factory() as session, session.begin():
            operations = session.scalars(
                select(AppCleanupOperation)
                .where(
                    or_(
                        and_(
                            AppCleanupOperation.status == APP_CLEANUP_PENDING,
                            AppCleanupOperation.available_at <= now,
                        ),
                        and_(
                            AppCleanupOperation.status == APP_CLEANUP_RUNNING,
                            AppCleanupOperation.lease_expires_at <= now,
                        ),
                    )
                )
                .order_by(AppCleanupOperation.available_at, AppCleanupOperation.app_id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            ).all()
            reserved: list[AppCleanupRequest] = []
            for operation in operations:
                operation.status = APP_CLEANUP_PENDING
                operation.available_at = now + redispatch_after
                operation.lease_id = None
                operation.lease_expires_at = None
                operation.last_error = operation.last_error or "Cleanup delivery recovered"
                reserved.append(AppCleanupRequest(tenant_id=operation.tenant_id, app_id=operation.app_id))
            return tuple(reserved)
