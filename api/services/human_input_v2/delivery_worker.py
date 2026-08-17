"""Durable worker orchestration for one Human Input v2 Email attempt."""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta

from pydantic import NaiveDatetime

from core.human_input_v2.approval import DeliveryAttemptRepository, RenderedEmailRequestProtector
from core.human_input_v2.delivery_runtime import (
    DeliveryOutcome,
    DeliveryOutcomeStatus,
    DeliveryPreparationError,
    HumanInputRenderedEmailDeliveryRuntime,
    fingerprint_rendered_email,
)
from core.human_input_v2.shared import DeliveryAttemptId
from libs.datetime_utils import naive_utc_now

from .notification_producer import deserialize_rendered_email_request


class HumanInputV2DeliveryWorker:
    def __init__(
        self,
        repository: DeliveryAttemptRepository,
        protector: RenderedEmailRequestProtector,
        runtime: HumanInputRenderedEmailDeliveryRuntime,
        *,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
        max_worker_retries: int = 5,
        default_retry_delay_seconds: float = 5,
        idempotency_horizon_seconds: float = 23 * 60 * 60,
    ) -> None:
        if max_worker_retries < 0:
            raise ValueError("maximum worker retries must not be negative")
        if default_retry_delay_seconds < 0:
            raise ValueError("default retry delay must not be negative")
        if idempotency_horizon_seconds <= 0:
            raise ValueError("idempotency horizon must be positive")
        self._repository = repository
        self._protector = protector
        self._runtime = runtime
        self._clock = clock
        self._max_worker_retries = max_worker_retries
        self._default_retry_delay_seconds = default_retry_delay_seconds
        self._idempotency_horizon_seconds = idempotency_horizon_seconds

    def deliver(self, attempt_id: DeliveryAttemptId) -> None:
        claim = self._repository.claim(attempt_id, now=self._clock())
        if claim is None:
            return
        now = self._clock()
        if claim.attempt.started_at is not None and claim.attempt.started_at < now - timedelta(
            seconds=self._idempotency_horizon_seconds
        ):
            self._repository.complete(
                claim,
                outcome=DeliveryOutcome.terminal("delivery_outcome_unknown"),
                now=now,
            )
            return
        tenant_id = claim.attempt.endpoint_ref.form_ref.tenant_id
        try:
            serialized = self._protector.reveal(tenant_id, claim.data.protected_request)
            request = deserialize_rendered_email_request(serialized)
            if request.tenant_id != tenant_id or request.delivery_id != claim.attempt.id:
                raise ValueError("protected delivery ownership does not match")
            if fingerprint_rendered_email(request) != claim.data.payload_fingerprint:
                raise ValueError("protected delivery payload fingerprint does not match")
            prepared = self._runtime.prepare(
                request,
                expected_snapshot=claim.data.configuration_snapshot,
            )
        except DeliveryPreparationError as error:
            self._repository.complete(
                claim,
                outcome=DeliveryOutcome.terminal(error.code),
                now=self._clock(),
            )
            return
        except Exception:
            self._repository.complete(
                claim,
                outcome=DeliveryOutcome.terminal("delivery_payload_unavailable"),
                now=self._clock(),
            )
            return

        bound_claim = self._repository.bind_prepared(
            claim,
            snapshot=prepared.snapshot.identity,
            payload_fingerprint=prepared.payload_fingerprint,
            now=self._clock(),
        )
        if bound_claim is None:
            self._repository.complete(
                claim,
                outcome=DeliveryOutcome.terminal("delivery_preparation_conflict"),
                now=self._clock(),
            )
            return

        try:
            outcome = self._runtime.send(prepared)
        except Exception:
            outcome = DeliveryOutcome.retryable("provider_failure")
        if outcome.status is not DeliveryOutcomeStatus.RETRYABLE_FAILURE:
            self._repository.complete(bound_claim, outcome=outcome, now=self._clock())
            return
        if bound_claim.data.worker_retry_count >= self._max_worker_retries:
            code = outcome.failure.code if outcome.failure is not None else "provider_retry_exhausted"
            self._repository.complete(
                bound_claim,
                outcome=DeliveryOutcome.terminal(f"{code}_retry_exhausted"),
                now=self._clock(),
            )
            return
        retry_after = (
            outcome.failure.retry.retry_after_seconds
            if outcome.failure is not None and outcome.failure.retry is not None
            else None
        )
        delay = retry_after if retry_after is not None else self._default_retry_delay_seconds
        now = self._clock()
        self._repository.requeue(
            bound_claim,
            outcome=outcome,
            scheduled_at=now + timedelta(seconds=delay),
            now=now,
        )


__all__ = ["HumanInputV2DeliveryWorker"]
