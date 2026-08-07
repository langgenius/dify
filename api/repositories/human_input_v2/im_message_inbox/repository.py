"""Transactional SQLAlchemy adapter for the durable IM message inbox.

Every method owns one short transaction. Claims use row locks with SKIP LOCKED
on databases that support them, while consumer work remains outside this class.
Every processing write is fenced by record ID, claim token, and unexpired lease.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.im_message_inbox import (
    AcceptanceKind,
    ClaimToken,
    IMInboxDelivery,
    IMInboxRecordId,
    InboxAcceptance,
    InboxBacklog,
    InboxClaimOrigin,
    InboxPersistenceError,
    InboxProcessingStatus,
    LostLease,
    TransitionApplied,
    TransitionResult,
    validate_inbox_event,
)
from core.human_input_v2.im_provider import AuthenticatedIMEvent
from core.human_input_v2.shared import IntegrationId, UtcTimestamp
from libs.uuid_utils import uuidv7
from models.human_input_v2 import IMMessageInbox

from .mappers import delivery_from_record, event_record


def _naive_utc(timestamp: UtcTimestamp) -> datetime:
    return timestamp.value.astimezone(UTC).replace(tzinfo=None)


class SQLAlchemyIMMessageInboxRepository:
    """Single-table persistence, claim, recovery, and fenced transition adapter."""

    _session_maker: sessionmaker[Session]

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def insert_or_resolve(
        self, integration_id: IntegrationId, event: AuthenticatedIMEvent, *, now: UtcTimestamp
    ) -> InboxAcceptance:
        """Commit all event facts atomically, resolving only real-ID conflicts."""

        validate_inbox_event(event)
        record_id = IMInboxRecordId(str(uuidv7()))
        try:
            with self._session_maker() as session, session.begin():
                record = event_record(record_id=record_id, integration_id=integration_id, event=event, now=now)
                session.add(record)
                session.flush()
        except IntegrityError as error:
            if event.event_id is None:
                raise InboxPersistenceError("failed to persist unidentified IM event") from error
            return self._resolve_duplicate(event)
        except (SQLAlchemyError, TypeError, ValueError) as error:
            raise InboxPersistenceError("failed to persist IM event") from error
        return InboxAcceptance(record_id, AcceptanceKind.NEW)

    def _resolve_duplicate(self, event: AuthenticatedIMEvent) -> InboxAcceptance:
        try:
            with self._session_maker() as session:
                existing_id = session.scalar(
                    select(IMMessageInbox.id).where(
                        IMMessageInbox.provider == event.provider,
                        IMMessageInbox.provider_tenant_id == event.provider_tenant_id,
                        IMMessageInbox.provider_event_id == event.event_id,
                    )
                )
        except SQLAlchemyError as error:
            raise InboxPersistenceError("failed to resolve duplicate IM event") from error
        if existing_id is None:
            raise InboxPersistenceError("duplicate IM event could not be resolved")
        return InboxAcceptance(IMInboxRecordId(existing_id), AcceptanceKind.DUPLICATE)

    def claim_by_id(
        self, record_id: IMInboxRecordId, *, now: UtcTimestamp, lease_duration: timedelta
    ) -> IMInboxDelivery | None:
        """Claim one available record and return only after the transaction commits."""

        with self._session_maker() as session, session.begin():
            record = session.scalar(
                select(IMMessageInbox)
                .where(IMMessageInbox.id == str(record_id), self._available(now))
                .with_for_update(skip_locked=True)
            )
            if record is None:
                return None
            claim_origin = self._claim_origin(record)
            self._assign_claim(record, now, lease_duration)
            session.flush()
            delivery = delivery_from_record(record, claim_origin=claim_origin)
        return delivery

    def claim_available(
        self, *, now: UtcTimestamp, lease_duration: timedelta, limit: int
    ) -> tuple[IMInboxDelivery, ...]:
        """Claim a bounded batch ordered by record age."""

        if limit < 1:
            raise ValueError("claim limit must be positive")
        with self._session_maker() as session, session.begin():
            records = list(
                session.scalars(
                    select(IMMessageInbox)
                    .where(self._available(now))
                    .order_by(IMMessageInbox.created_at, IMMessageInbox.id)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            claims = tuple((record, self._claim_origin(record)) for record in records)
            for record, _ in claims:
                self._assign_claim(record, now, lease_duration)
            session.flush()
            deliveries = tuple(delivery_from_record(record, claim_origin=origin) for record, origin in claims)
        return deliveries

    @staticmethod
    def _claim_origin(record: IMMessageInbox) -> InboxClaimOrigin:
        if record.status is InboxProcessingStatus.PENDING:
            return InboxClaimOrigin.PENDING
        if record.status is InboxProcessingStatus.PROCESSING:
            return InboxClaimOrigin.EXPIRED_PROCESSING
        raise ValueError(f"record has non-claimable status: {record.status.value}")

    @staticmethod
    def _available(now: UtcTimestamp) -> sa.ColumnElement[bool]:
        current = _naive_utc(now)
        return sa.or_(
            IMMessageInbox.status == InboxProcessingStatus.PENDING,
            sa.and_(
                IMMessageInbox.status == InboxProcessingStatus.PROCESSING,
                IMMessageInbox.lease_expires_at <= current,
            ),
        )

    @staticmethod
    def _assign_claim(record: IMMessageInbox, now: UtcTimestamp, lease_duration: timedelta) -> None:
        record.status = InboxProcessingStatus.PROCESSING
        record.attempt_count += 1
        record.claim_token = str(uuid4())
        record.lease_expires_at = _naive_utc(now) + lease_duration
        record.updated_at = _naive_utc(now)

    def renew(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        *,
        now: UtcTimestamp,
        lease_duration: timedelta,
    ) -> TransitionResult:
        values = {
            "lease_expires_at": _naive_utc(now) + lease_duration,
            "updated_at": _naive_utc(now),
        }
        return self._fenced_update(record_id, claim_token, now=now, values=values)

    def succeed(self, record_id: IMInboxRecordId, claim_token: ClaimToken, *, now: UtcTimestamp) -> TransitionResult:
        return self._finalize(record_id, claim_token, InboxProcessingStatus.SUCCEEDED, now=now)

    def ignore(self, record_id: IMInboxRecordId, claim_token: ClaimToken, *, now: UtcTimestamp) -> TransitionResult:
        return self._finalize(record_id, claim_token, InboxProcessingStatus.IGNORED, now=now)

    def fail(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        *,
        now: UtcTimestamp,
    ) -> TransitionResult:
        return self._finalize(record_id, claim_token, InboxProcessingStatus.FAILED, now=now)

    def _finalize(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        status: InboxProcessingStatus,
        *,
        now: UtcTimestamp,
    ) -> TransitionResult:
        current = _naive_utc(now)
        return self._fenced_update(
            record_id,
            claim_token,
            now=now,
            values={
                "status": status,
                "claim_token": None,
                "lease_expires_at": None,
                "completed_at": current,
                "updated_at": current,
            },
        )

    def retry(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        *,
        now: UtcTimestamp,
        maximum_attempts: int,
    ) -> TransitionResult:
        """Return current work to pending or fail it after bounded attempts."""

        current = _naive_utc(now)
        with self._session_maker() as session, session.begin():
            record = session.scalar(
                select(IMMessageInbox)
                .where(
                    IMMessageInbox.id == str(record_id),
                    IMMessageInbox.status == InboxProcessingStatus.PROCESSING,
                    IMMessageInbox.claim_token == str(claim_token),
                    IMMessageInbox.lease_expires_at > current,
                )
                .with_for_update()
            )
            if record is None:
                return LostLease(record_id, claim_token)
            if record.attempt_count >= maximum_attempts:
                record.status = InboxProcessingStatus.FAILED
                record.completed_at = current
            else:
                record.status = InboxProcessingStatus.PENDING
                record.completed_at = None
            record.claim_token = None
            record.lease_expires_at = None
            record.updated_at = current
        return TransitionApplied(record_id)

    def _fenced_update(
        self,
        record_id: IMInboxRecordId,
        claim_token: ClaimToken,
        *,
        now: UtcTimestamp,
        values: Mapping[str, object],
    ) -> TransitionResult:
        try:
            with self._session_maker() as session, session.begin():
                result = session.connection().execute(
                    sa.update(IMMessageInbox)
                    .where(
                        IMMessageInbox.id == str(record_id),
                        IMMessageInbox.status == InboxProcessingStatus.PROCESSING,
                        IMMessageInbox.claim_token == str(claim_token),
                        IMMessageInbox.lease_expires_at > _naive_utc(now),
                    )
                    .values(**values)
                )
                if result.rowcount != 1:
                    return LostLease(record_id, claim_token)
        except SQLAlchemyError as error:
            raise InboxPersistenceError("failed fenced IM inbox transition") from error
        return TransitionApplied(record_id)

    def recoverable_record_ids(self, *, now: UtcTimestamp, limit: int) -> tuple[IMInboxRecordId, ...]:
        """Return only record IDs; payload is not selected or sent to the broker."""

        with self._session_maker() as session:
            record_ids = session.scalars(
                select(IMMessageInbox.id)
                .where(self._available(now))
                .order_by(IMMessageInbox.created_at, IMMessageInbox.id)
                .limit(limit)
            )
            return tuple(IMInboxRecordId(record_id) for record_id in record_ids)

    def backlog(self, *, now: UtcTimestamp) -> InboxBacklog:
        """Measure backlog without reading or filtering Provider payloads."""

        with self._session_maker() as session:
            count_rows = session.execute(
                select(IMMessageInbox.status, func.count(IMMessageInbox.id)).group_by(IMMessageInbox.status)
            )
            oldest_pending = session.scalar(
                select(func.min(IMMessageInbox.created_at)).where(
                    IMMessageInbox.status == InboxProcessingStatus.PENDING
                )
            )
        counts = tuple((InboxProcessingStatus(status), count) for status, count in count_rows)
        age = None
        if oldest_pending is not None:
            oldest = oldest_pending.replace(tzinfo=UTC) if oldest_pending.tzinfo is None else oldest_pending
            age = max(now.value - oldest, timedelta())
        return InboxBacklog(counts, age)
