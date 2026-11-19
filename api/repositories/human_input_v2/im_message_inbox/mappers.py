"""Mappings between durable callback contracts and ORM records."""

from datetime import UTC, datetime

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.entities import AuthenticatedIMEvent
from core.human_input_v2.im_message_inbox import IMInboxRecord, IMInboxRecordId
from models.human_input_v2 import IMMessageEvent
from repositories.human_input_v2.im_channel_repository import IMChannelId


def _naive_utc(timestamp: datetime) -> datetime:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamp must be timezone-aware")
    return timestamp.astimezone(UTC).replace(tzinfo=None)


def event_record(
    *,
    record_id: IMInboxRecordId,
    channel_id: IMChannelId,
    event: AuthenticatedIMEvent,
    now: datetime,
    request_ip_address: str | None = None,
) -> IMMessageEvent:
    """Create one detached record containing immutable callback facts."""

    record = IMMessageEvent(
        channel_id=str(channel_id),
        provider=event.provider,
        tenant_id=event.provider_tenant_id,
        event_id=event.event_id,
        provider_event_time=event.occurred_at,
        received_at=event.received_at,
        provider_event_type=event.event_type,
        ingress_kind=event.ingress_kind,
        payload=event.payload,
        request_ip_address=request_ip_address,
    )
    record.id = str(record_id)
    record.created_at = _naive_utc(now)
    return record


def event_from_record(record: IMMessageEvent) -> AuthenticatedIMEvent:
    """Reconstruct the exact authenticated Provider callback facts."""

    return AuthenticatedIMEvent(
        provider=IMProvider(record.provider),
        provider_tenant_id=record.tenant_id,
        event_id=record.event_id,
        event_type=record.provider_event_type,
        occurred_at=record.provider_event_time,
        received_at=record.received_at,
        ingress_kind=record.ingress_kind,
        payload=record.payload,
    )


def inbox_record_from_model(record: IMMessageEvent) -> IMInboxRecord:
    """Convert one database record at the repository trust boundary."""

    return IMInboxRecord(
        record_id=IMInboxRecordId(record.id),
        channel_id=IMChannelId(record.channel_id),
        event=event_from_record(record),
        processed_at=record.processed_at,
        request_ip_address=record.request_ip_address,
    )
