from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime

import pytest

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ParagraphInput, ResolvedForm, ResolvedFormAction, SelectInput
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.ms_teams import MSTeamsIMProviderAdapter, _MSTeamsCardCodec
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CorrelationToken,
    DynamicCardMessagingError,
    IMCardEvent,
    IMCardEventDecodingError,
    IMEventIngressKind,
    ProviderUserId,
    UnrecognizedIMEvent,
)

_RECEIVED_AT = datetime(2026, 8, 12, 2, 26, 40)


def _form(*, comment_input_name: str = "review_comment") -> ResolvedForm:
    return ResolvedForm(
        title="Microsoft Teams card integration",
        blocks=(
            MarkdownText("Review the encoded form."),
            ParagraphInput(comment_input_name, "Initial review"),
            SelectInput("risk_level", ("low", "high"), "low"),
        ),
        user_actions=(
            ResolvedFormAction("approve-✅", "Approve", ButtonStyle.PRIMARY),
            ResolvedFormAction("reject", "Reject", ButtonStyle.ACCENT),
        ),
        legacy_form_content="unused",
    )


def _event(callback: Mapping[str, object], *, event_type: str = "message") -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=IMProvider.MS_TEAMS,
        provider_tenant_id="integration-tenant",
        event_id="integration-card-event",
        event_type=event_type,
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload=json.dumps(callback, ensure_ascii=False, separators=(",", ":")),
    )


def test_ms_teams_sender_metadata_and_callback_decoder_round_trip() -> None:
    codec = MSTeamsIMProviderAdapter.card_event_decoder()
    assert isinstance(codec, _MSTeamsCardCodec)
    correlation_token = CorrelationToken("integration-correlation-🔐")

    card = codec.encode(_form(), correlation_token)
    actions = card["actions"]
    assert isinstance(actions, list)
    invoked_action = actions[0]
    assert isinstance(invoked_action, dict)
    action_data = invoked_action["data"]
    assert isinstance(action_data, dict)
    callback_value = {
        **action_data,
        "review_comment": "Reviewed exactly ✅",
        "risk_level": "high",
    }
    callback = {
        "type": "message",
        "from": {"id": "integration-teams-user"},
        "value": callback_value,
    }

    decoded = MSTeamsIMProviderAdapter.card_event_decoder().decode(_event(callback))

    assert decoded == IMCardEvent(
        provider_user_id=ProviderUserId("integration-teams-user"),
        action_id="approve-✅",
        inputs={"review_comment": "Reviewed exactly ✅", "risk_level": "high"},
        correlation_token=correlation_token,
    )


def test_ms_teams_codec_rejects_collision_and_malformed_recognized_callback() -> None:
    codec = MSTeamsIMProviderAdapter.card_event_decoder()
    assert isinstance(codec, _MSTeamsCardCodec)
    colliding_form = _form(comment_input_name="__dify.human_input")

    assert codec.assess(_form()).representable is True
    assert codec.assess(colliding_form).representable is False
    with pytest.raises(DynamicCardMessagingError):
        codec.encode(colliding_form, CorrelationToken("integration-correlation"))

    malformed_callback = {
        "type": "invoke",
        "from": {"id": "integration-teams-user"},
        "value": {
            "__dify.human_input": {
                "version": 1,
                "action_id": True,
                "correlation_token": "integration-correlation",
            }
        },
    }
    with pytest.raises(IMCardEventDecodingError):
        codec.decode(_event(malformed_callback, event_type="invoke"))


def test_ms_teams_codec_routes_foreign_and_invalid_transport_events() -> None:
    decoder = MSTeamsIMProviderAdapter.card_event_decoder()
    foreign_callback = {
        "type": "message",
        "from": {"id": "foreign-user"},
        "value": {"foreign": "interaction"},
    }

    assert isinstance(decoder.decode(_event(foreign_callback)), UnrecognizedIMEvent)
    non_card_event = AuthenticatedIMEvent(
        provider=IMProvider.MS_TEAMS,
        provider_tenant_id="integration-tenant",
        event_id="integration-card-event",
        event_type="conversationUpdate",
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload="not-json",
    )
    assert isinstance(decoder.decode(non_card_event), UnrecognizedIMEvent)

    foreign_value_callback = {"type": "message", "value": []}
    assert isinstance(decoder.decode(_event(foreign_value_callback)), UnrecognizedIMEvent)

    mismatched_type_callback = {
        "type": "invoke",
        "from": {"id": "integration-teams-user"},
        "value": {
            "__dify.human_input": {
                "version": 1,
                "action_id": "approve",
                "correlation_token": "integration-correlation",
            }
        },
    }
    with pytest.raises(IMCardEventDecodingError):
        decoder.decode(_event(mismatched_type_callback))

    invalid_transport = AuthenticatedIMEvent(
        provider=IMProvider.MS_TEAMS,
        provider_tenant_id="integration-tenant",
        event_id="integration-card-event",
        event_type="message",
        occurred_at=None,
        received_at=_RECEIVED_AT,
        ingress_kind=IMEventIngressKind.WEBHOOK,
        payload="not-json",
    )
    with pytest.raises(IMCardEventDecodingError):
        decoder.decode(invalid_transport)
    with pytest.raises(IMCardEventDecodingError):
        decoder.decode(
            AuthenticatedIMEvent(
                provider=IMProvider.MS_TEAMS,
                provider_tenant_id="integration-tenant",
                event_id="integration-card-event",
                event_type="message",
                occurred_at=None,
                received_at=_RECEIVED_AT,
                ingress_kind=IMEventIngressKind.WEBHOOK,
                payload="[]",
            )
        )
