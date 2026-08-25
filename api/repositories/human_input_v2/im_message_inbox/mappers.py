"""Explicit mappings between inbox domain values and ORM records."""

from datetime import UTC, datetime

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.entities import AuthenticatedIMEvent
from core.human_input_v2.im_message_inbox import ClaimToken, IMInboxDelivery, IMInboxRecordId, InboxClaimOrigin
from core.human_input_v2.shared import IntegrationId
from models.human_input_v2 import IMMessageInbox


def _naive_utc(timestamp: datetime) -> datetime:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamp must be timezone-aware")
    return timestamp.astimezone(UTC).replace(tzinfo=None)


def event_record(
    *,
    record_id: IMInboxRecordId,
    integration_id: IntegrationId,
    event: AuthenticatedIMEvent,
    now: datetime,
) -> IMMessageInbox:
    """Create one detached pending record containing all immutable event facts."""

    record = IMMessageInbox(
        integration_id=str(integration_id),
        provider=event.provider,
        provider_tenant_id=event.provider_tenant_id,
        provider_event_id=event.event_id,
        provider_event_time=event.occurred_at,
        received_at=event.received_at,
        provider_event_type=event.event_type,
        ingress_kind=event.ingress_kind,
        payload=event.payload,
    )
    record.id = str(record_id)
    record.created_at = _naive_utc(now)
    record.updated_at = _naive_utc(now)
    return record


def event_from_record(record: IMMessageInbox) -> AuthenticatedIMEvent:
    """Reconstruct the exact provider-neutral authenticated event facts."""

    return AuthenticatedIMEvent(
        provider=IMProvider(record.provider),
        provider_tenant_id=record.provider_tenant_id,
        event_id=record.provider_event_id,
        event_type=record.provider_event_type,
        occurred_at=record.provider_event_time,
        received_at=record.received_at,
        ingress_kind=record.ingress_kind,
        payload=record.payload,
    )


def delivery_from_record(record: IMMessageInbox, *, claim_origin: InboxClaimOrigin) -> IMInboxDelivery:
    """Map one committed processing record into a consumer delivery."""

    if record.claim_token is None:
        raise ValueError("processing record is missing its claim token")
    return IMInboxDelivery(
        record_id=IMInboxRecordId(record.id),
        integration_id=IntegrationId(record.integration_id),
        event=event_from_record(record),
        claim_origin=claim_origin,
        attempt=record.attempt_count,
        claim_token=ClaimToken(record.claim_token),
    )
