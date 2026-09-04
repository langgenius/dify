"""Contract tests for durable IM callback facts."""

from datetime import datetime

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import AuthenticatedIMEvent, IMEventIngressKind
from core.human_input_v2.im_message_inbox import IMInboxRecord, IMInboxRecordId, canonicalize_inbox_event
from core.human_input_v2.shared import IntegrationId


def _event(*, event_id: str | None = "event-1") -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=IMProvider.FEISHU,
        provider_tenant_id="tenant-1",
        event_id=event_id,
        occurred_at=datetime(2026, 8, 2, 8),
        received_at=datetime(2026, 8, 2, 8, 0, 1),
        event_type="card.action",
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload=' {"token":"secret","nested":[1,true]}\n',
    )


def test_inbox_record_preserves_callback_facts_verbatim() -> None:
    event = _event()
    record = IMInboxRecord(
        record_id=IMInboxRecordId("record-1"),
        integration_id=IntegrationId("integration-1"),
        event=event,
        processed_at=None,
    )

    assert record.event is event
    assert record.event.payload == ' {"token":"secret","nested":[1,true]}\n'
    assert record.processed_at is None


def test_blank_provider_event_id_is_canonicalized_as_unidentified() -> None:
    event = _event(event_id=" \t\n")

    canonical = canonicalize_inbox_event(event)

    assert canonical.event_id is None
    assert canonical.payload == event.payload


def test_nonblank_provider_event_id_is_preserved_verbatim() -> None:
    event = _event(event_id=" event-1 ")

    assert canonicalize_inbox_event(event) is event
