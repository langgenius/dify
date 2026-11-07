"""Persist authenticated callbacks and enqueue their Celery processing task.

The database commit completes before task publication. Transport acceptance
requires both operations; an identified Provider redelivery resolves the same
record and attempts publication again. Failure logs omit exception details
because they may contain callback payloads or connection credentials.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.entities import AuthenticatedIMEvent, EventAcceptance
from core.human_input_v2.im_message_inbox import (
    AcceptanceKind,
    IMMessageInboxRepository,
    InboxPersistenceError,
    canonicalize_inbox_event,
    validate_inbox_event,
    validate_inbox_provider_tenant_id,
)
from repositories.human_input_v2.im_channel_repository import IMChannelId
from tasks.im_message_inbox_tasks import process_im_message_inbox_record

from .telemetry import IMInboxMetricKind, IMInboxMetrics

logger = logging.getLogger(__name__)


class IMMessageInboxSink:
    """Concrete durable sink bound to one logical local Channel."""

    _channel_id: IMChannelId
    _expected_provider: IMProvider
    _expected_provider_tenant_id: str
    _repository: IMMessageInboxRepository
    _clock: Callable[[], datetime]
    _metrics: IMInboxMetrics

    def __init__(
        self,
        *,
        channel_id: IMChannelId,
        expected_provider: IMProvider,
        expected_provider_tenant_id: str,
        repository: IMMessageInboxRepository,
        clock: Callable[[], datetime],
        metrics: IMInboxMetrics,
    ) -> None:
        if not expected_provider_tenant_id.strip():
            raise ValueError("expected provider tenant id must not be blank")
        validate_inbox_provider_tenant_id(expected_provider_tenant_id)
        self._channel_id = channel_id
        self._expected_provider = expected_provider
        self._expected_provider_tenant_id = expected_provider_tenant_id
        self._repository = repository
        self._clock = clock
        self._metrics = metrics

    def accept(self, event: AuthenticatedIMEvent, *, request_ip_address: str | None = None) -> EventAcceptance:
        """Commit or resolve the event before returning transport acceptance."""

        event = canonicalize_inbox_event(event)
        validate_inbox_event(event)
        if (
            event.provider is not self._expected_provider
            or event.provider_tenant_id != self._expected_provider_tenant_id
        ):
            self._metrics.record(
                IMInboxMetricKind.ACCEPTANCE_FAILURE,
                provider=event.provider,
                outcome="identity_conflict",
            )
            logger.warning(
                "Rejected IM event with conflicting bound identity channel_id=%s expected_provider=%s",
                self._channel_id,
                self._expected_provider.value,
            )
            return EventAcceptance.NOT_ACCEPTED
        try:
            accepted = self._repository.insert_or_resolve(
                self._channel_id,
                event,
                now=self._clock(),
                request_ip_address=request_ip_address,
            )
        except InboxPersistenceError:
            self._metrics.record(
                IMInboxMetricKind.ACCEPTANCE_FAILURE,
                provider=event.provider,
                outcome="persistence_failure",
            )
            logger.warning(
                "Failed durable IM event acceptance channel_id=%s provider=%s error_code=persistence_failure",
                self._channel_id,
                event.provider.value,
            )
            return EventAcceptance.NOT_ACCEPTED

        self._metrics.record(
            IMInboxMetricKind.ACCEPTANCE,
            provider=event.provider,
            outcome=accepted.kind.value,
        )
        if accepted.kind is AcceptanceKind.DUPLICATE:
            self._metrics.record(IMInboxMetricKind.DUPLICATE, provider=event.provider)

        try:
            process_im_message_inbox_record.apply_async(args=(str(accepted.record_id),), retry=False)
        except Exception:
            self._metrics.record(
                IMInboxMetricKind.DISPATCH_FAILURE,
                provider=event.provider,
                outcome="broker_unavailable",
            )
            logger.warning(
                "Failed post-commit IM callback task publication record_id=%s channel_id=%s provider=%s "
                "error_code=broker_unavailable",
                accepted.record_id,
                self._channel_id,
                event.provider.value,
            )
            return EventAcceptance.NOT_ACCEPTED
        return EventAcceptance.ACCEPTED
