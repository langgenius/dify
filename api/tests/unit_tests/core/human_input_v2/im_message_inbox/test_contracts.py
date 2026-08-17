"""Contract tests for infrastructure-free IM event inbox values."""

from datetime import datetime

import pytest

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_message_inbox import (
    ClaimToken,
    ConsumerDecision,
    IMInboxDelivery,
    IMInboxRecordId,
    InboxClaimOrigin,
    InboxProcessingStatus,
    LostLease,
)
from core.human_input_v2.im_provider import AuthenticatedIMEvent, EventAcceptance, IMEventIngressKind
from core.human_input_v2.shared import IntegrationId


def _event() -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=IMProvider.FEISHU,
        provider_tenant_id="tenant-1",
        event_id="event-1",
        occurred_at=datetime(2026, 8, 2, 8),
        received_at=datetime(2026, 8, 2, 8, 0, 1),
        event_type="card.action",
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload=' {"token":"secret","nested":[1,true]}\n',
    )


def test_authenticated_event_and_delivery_preserve_payload_verbatim() -> None:
    payload = ' {"token":"secret","nested":[1,true]}\n'
    event = AuthenticatedIMEvent(
        provider=IMProvider.FEISHU,
        provider_tenant_id="tenant-1",
        event_id="event-1",
        occurred_at=None,
        received_at=datetime(2026, 8, 2, 8),
        event_type=None,
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload=payload,
    )
    delivery = IMInboxDelivery(
        record_id=IMInboxRecordId("record-1"),
        integration_id=IntegrationId("integration-1"),
        event=event,
        claim_origin=InboxClaimOrigin.PENDING,
        attempt=1,
        claim_token=ClaimToken("claim-1"),
    )

    assert event.payload == payload
    assert delivery.event is event


def test_inbox_identifiers_are_nominal_strings_without_runtime_validation() -> None:
    record_id = IMInboxRecordId("")
    claim_token = ClaimToken(" ")

    assert record_id == ""
    assert claim_token == " "
    assert not hasattr(record_id, "value")
    assert not hasattr(claim_token, "value")


def test_inbox_delivery_rejects_invalid_attempts() -> None:
    with pytest.raises(ValueError, match="attempt"):
        IMInboxDelivery(
            record_id=IMInboxRecordId("record-1"),
            integration_id=IntegrationId("integration-1"),
            event=_event(),
            claim_origin=InboxClaimOrigin.PENDING,
            attempt=0,
            claim_token=ClaimToken("claim-1"),
        )


def test_processing_and_consumer_outcomes_are_closed_typed_sets() -> None:
    assert {origin.value for origin in InboxClaimOrigin} == {"pending", "expired_processing"}
    assert {status.value for status in InboxProcessingStatus} == {
        "pending",
        "processing",
        "succeeded",
        "ignored",
        "failed",
    }
    assert {decision.value for decision in ConsumerDecision} == {
        "succeeded",
        "ignored",
        "retry",
        "failed",
    }
    assert {acceptance.value for acceptance in EventAcceptance} == {"accepted", "not_accepted"}


def test_lost_lease_result_preserves_fencing_identity() -> None:
    lost_lease = LostLease(IMInboxRecordId("record-1"), ClaimToken("stale-claim"))

    assert lost_lease.record_id == IMInboxRecordId("record-1")
    assert lost_lease.claim_token == ClaimToken("stale-claim")
