"""CAS persistence for Human Input v2 delivery attempt workers."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.approval import (
    ClaimedDeliveryAttempt,
    DeliveryAttemptData,
    LegacyDeliveryAttemptData,
    SafeDeliveryOutcome,
)
from core.human_input_v2.approval.delivery import delivery_attempt_data_from_mapping
from core.human_input_v2.delivery_runtime import (
    ConfigurationSnapshotIdentity,
    DeliveryOutcome,
    DeliveryOutcomeStatus,
)
from core.human_input_v2.entities import HumanInputDeliveryAttemptStatus
from core.human_input_v2.shared import DeliveryAttemptId, UtcTimestamp
from models.human_input_v2 import (
    FormDeliveryProviderResponse,
    HumanInputV2Form,
    HumanInputV2FormDeliveryAttempt,
    HumanInputV2FormDeliveryEndpoint,
)

from .mappers import delivery_attempt_from_record


class SQLAlchemyDeliveryAttemptRepository:
    """Claim and complete attempts without allowing ORM records to escape."""

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def list_due_ids(self, *, now: UtcTimestamp, limit: int) -> tuple[DeliveryAttemptId, ...]:
        if limit < 1:
            raise ValueError("delivery due-read limit must be positive")
        with self._session_maker() as session:
            ids = session.scalars(
                select(HumanInputV2FormDeliveryAttempt.id)
                .where(
                    HumanInputV2FormDeliveryAttempt.status == HumanInputDeliveryAttemptStatus.QUEUED,
                    HumanInputV2FormDeliveryAttempt.scheduled_at <= now.value,
                )
                .order_by(
                    HumanInputV2FormDeliveryAttempt.scheduled_at,
                    HumanInputV2FormDeliveryAttempt.id,
                )
                .limit(limit)
            ).all()
        return tuple(DeliveryAttemptId(value) for value in ids)

    def claim(self, attempt_id: DeliveryAttemptId, *, now: UtcTimestamp) -> ClaimedDeliveryAttempt | None:
        with self._session_maker() as session, session.begin():
            row = session.execute(self._owned_attempt(attempt_id).with_for_update()).one_or_none()
            if row is None:
                return None
            record, endpoint = row
            if record.status is not HumanInputDeliveryAttemptStatus.QUEUED or _aware(record.scheduled_at) > now.value:
                return None
            record.status = HumanInputDeliveryAttemptStatus.SENDING
            if record.started_at is None:
                record.started_at = now.value
            record.updated_at = _next_timestamp(record.updated_at, now)
            session.flush()
            try:
                return _claimed(record, endpoint)
            except ValueError:
                record.status = HumanInputDeliveryAttemptStatus.FAILED
                record.finished_at = now.value
                record.failure_code = "delivery_payload_unavailable"
                record.updated_at = _next_timestamp(record.updated_at, now)
                return None

    def bind_prepared(
        self,
        claim: ClaimedDeliveryAttempt,
        *,
        snapshot: ConfigurationSnapshotIdentity,
        payload_fingerprint: str,
        now: UtcTimestamp,
    ) -> ClaimedDeliveryAttempt | None:
        if payload_fingerprint != claim.data.payload_fingerprint:
            return None
        existing = claim.data.configuration_snapshot
        if existing is not None and existing != snapshot:
            return None
        data = replace(claim.data, configuration_snapshot=snapshot)
        with self._session_maker() as session, session.begin():
            row = session.execute(self._owned_attempt(claim.attempt.id).with_for_update()).one_or_none()
            if row is None:
                return None
            record, endpoint = row
            if not _claim_matches(record, claim):
                return None
            record.provider_response = FormDeliveryProviderResponse.model_validate(data.to_mapping())
            record.updated_at = _next_timestamp(record.updated_at, now)
            session.flush()
            return _claimed(record, endpoint)

    def requeue(
        self,
        claim: ClaimedDeliveryAttempt,
        *,
        outcome: DeliveryOutcome,
        scheduled_at: UtcTimestamp,
        now: UtcTimestamp,
    ) -> bool:
        if outcome.status is not DeliveryOutcomeStatus.RETRYABLE_FAILURE or outcome.failure is None:
            raise ValueError("only retryable outcomes can requeue a delivery")
        data = replace(
            claim.data,
            worker_retry_count=claim.data.worker_retry_count + 1,
            outcome=_safe_outcome(outcome),
        )
        with self._session_maker() as session, session.begin():
            record = session.scalar(
                select(HumanInputV2FormDeliveryAttempt)
                .where(
                    HumanInputV2FormDeliveryAttempt.id == str(claim.attempt.id),
                    HumanInputV2FormDeliveryAttempt.status == HumanInputDeliveryAttemptStatus.SENDING,
                    HumanInputV2FormDeliveryAttempt.updated_at == claim.attempt.updated_at.value,
                )
                .with_for_update()
            )
            if record is None:
                return False
            record.status = HumanInputDeliveryAttemptStatus.QUEUED
            record.scheduled_at = scheduled_at.value
            record.provider_response = FormDeliveryProviderResponse.model_validate(data.to_mapping())
            record.updated_at = _next_timestamp(record.updated_at, now)
            return True

    def complete(
        self,
        claim: ClaimedDeliveryAttempt,
        *,
        outcome: DeliveryOutcome,
        now: UtcTimestamp,
    ) -> bool:
        if outcome.status is DeliveryOutcomeStatus.RETRYABLE_FAILURE:
            raise ValueError("retryable outcome cannot complete a delivery")
        data = replace(claim.data, outcome=_safe_outcome(outcome))
        with self._session_maker() as session, session.begin():
            record = session.scalar(
                select(HumanInputV2FormDeliveryAttempt)
                .where(
                    HumanInputV2FormDeliveryAttempt.id == str(claim.attempt.id),
                    HumanInputV2FormDeliveryAttempt.status == HumanInputDeliveryAttemptStatus.SENDING,
                    HumanInputV2FormDeliveryAttempt.updated_at == claim.attempt.updated_at.value,
                )
                .with_for_update()
            )
            if record is None:
                return False
            record.status = (
                HumanInputDeliveryAttemptStatus.SENT
                if outcome.status is DeliveryOutcomeStatus.ACCEPTED
                else HumanInputDeliveryAttemptStatus.FAILED
            )
            record.finished_at = now.value
            record.provider_message_id = outcome.receipt.provider_message_id if outcome.receipt is not None else None
            record.failure_code = outcome.failure.code if outcome.failure is not None else None
            record.failure_reason = None
            record.provider_response = FormDeliveryProviderResponse.model_validate(data.to_mapping())
            record.updated_at = _next_timestamp(record.updated_at, now)
            return True

    def recover_stale(
        self,
        *,
        stale_before: UtcTimestamp,
        idempotency_cutoff: UtcTimestamp,
        now: UtcTimestamp,
        limit: int,
    ) -> int:
        if limit < 1:
            raise ValueError("delivery recovery limit must be positive")
        recovered = 0
        with self._session_maker() as session, session.begin():
            records = session.scalars(
                select(HumanInputV2FormDeliveryAttempt)
                .where(
                    HumanInputV2FormDeliveryAttempt.status == HumanInputDeliveryAttemptStatus.SENDING,
                    HumanInputV2FormDeliveryAttempt.updated_at <= stale_before.value,
                )
                .order_by(HumanInputV2FormDeliveryAttempt.updated_at, HumanInputV2FormDeliveryAttempt.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            ).all()
            for record in records:
                if record.started_at is None or _aware(record.started_at) < idempotency_cutoff.value:
                    record.status = HumanInputDeliveryAttemptStatus.FAILED
                    record.finished_at = now.value
                    record.failure_code = "delivery_outcome_unknown"
                    if record.provider_response is not None:
                        current_data = delivery_attempt_data_from_mapping(record.provider_response.root)
                        if isinstance(current_data, DeliveryAttemptData):
                            current_data = replace(
                                current_data,
                                outcome=SafeDeliveryOutcome(
                                    status=DeliveryOutcomeStatus.TERMINAL_FAILURE.value,
                                    failure_code="delivery_outcome_unknown",
                                ),
                            )
                            record.provider_response = FormDeliveryProviderResponse.model_validate(
                                current_data.to_mapping()
                            )
                else:
                    record.status = HumanInputDeliveryAttemptStatus.QUEUED
                    record.scheduled_at = now.value
                record.updated_at = _next_timestamp(record.updated_at, now)
                recovered += 1
        return recovered

    @staticmethod
    def _owned_attempt(
        attempt_id: DeliveryAttemptId,
    ) -> sa.Select[tuple[HumanInputV2FormDeliveryAttempt, HumanInputV2FormDeliveryEndpoint]]:
        return (
            select(HumanInputV2FormDeliveryAttempt, HumanInputV2FormDeliveryEndpoint)
            .join(
                HumanInputV2FormDeliveryEndpoint,
                sa.and_(
                    HumanInputV2FormDeliveryEndpoint.id == HumanInputV2FormDeliveryAttempt.endpoint_id,
                    HumanInputV2FormDeliveryEndpoint.form_id == HumanInputV2FormDeliveryAttempt.form_id,
                    HumanInputV2FormDeliveryEndpoint.tenant_id == HumanInputV2FormDeliveryAttempt.tenant_id,
                ),
            )
            .join(
                HumanInputV2Form,
                sa.and_(
                    HumanInputV2Form.id == HumanInputV2FormDeliveryAttempt.form_id,
                    HumanInputV2Form.tenant_id == HumanInputV2FormDeliveryAttempt.tenant_id,
                ),
            )
            .where(HumanInputV2FormDeliveryAttempt.id == str(attempt_id))
        )


def _claimed(
    record: HumanInputV2FormDeliveryAttempt,
    endpoint: HumanInputV2FormDeliveryEndpoint,
) -> ClaimedDeliveryAttempt:
    attempt = delivery_attempt_from_record(record, endpoint)
    data = attempt.data
    if data is None or isinstance(data, LegacyDeliveryAttemptData):
        raise ValueError("delivery_payload_unavailable")
    return ClaimedDeliveryAttempt(attempt, data)


def _claim_matches(record: HumanInputV2FormDeliveryAttempt, claim: ClaimedDeliveryAttempt) -> bool:
    return (
        record.status is HumanInputDeliveryAttemptStatus.SENDING
        and _aware(record.updated_at) == claim.attempt.updated_at.value
    )


def _next_timestamp(current: datetime, now: UtcTimestamp) -> datetime:
    return max(now.value, _aware(current) + timedelta(microseconds=1))


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _safe_outcome(outcome: DeliveryOutcome) -> SafeDeliveryOutcome:
    return SafeDeliveryOutcome(
        status=outcome.status.value,
        failure_code=outcome.failure.code if outcome.failure is not None else None,
        provider_message_id=(outcome.receipt.provider_message_id if outcome.receipt is not None else None),
    )


__all__ = ["SQLAlchemyDeliveryAttemptRepository"]
