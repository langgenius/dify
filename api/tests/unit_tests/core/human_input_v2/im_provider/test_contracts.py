from __future__ import annotations

from dataclasses import FrozenInstanceError, fields
from datetime import datetime
from typing import get_type_hints

import pytest
from pydantic import ValidationError

from core.human_input_v2 import ResolvedForm, im_provider
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CredentialTestSuccess,
    Directory,
    DirectoryEntry,
    IMDynamicCardMessaging,
    IMEventStream,
    IMStreamStartError,
    IMStreamStopError,
    ProviderUserId,
    SlackIMIntegrationCredentials,
)


def _credentials() -> SlackIMIntegrationCredentials:
    return SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id="client-id",
        client_secret="client-secret",
        signing_secret="signing-secret",
        bot_token="xoxb-test-bot-token",
        app_token="xapp-test-app-token",
    )


def test_resolved_slack_credentials_are_strict_immutable_and_secret_safe() -> None:
    credentials = _credentials()

    assert credentials.provider is IMProvider.SLACK
    assert "client-secret" not in repr(credentials)
    assert "signing-secret" not in repr(credentials)
    assert "xoxb-test-bot-token" not in repr(credentials)
    assert "xapp-test-app-token" not in repr(credentials)

    with pytest.raises(ValidationError):
        SlackIMIntegrationCredentials.model_validate({**credentials.model_dump(), "unexpected": "value"})
    with pytest.raises(ValidationError):
        SlackIMIntegrationCredentials.model_validate({**credentials.model_dump(), "provider": IMProvider.FEISHU})
    with pytest.raises(ValidationError):
        credentials.client_id = "changed"


def test_provider_neutral_values_are_immutable() -> None:
    directory = Directory((DirectoryEntry(ProviderUserId("user-1"), None, None),))
    success = CredentialTestSuccess(IMProvider.SLACK, "team-1")

    with pytest.raises(FrozenInstanceError):
        directory.entries = ()
    with pytest.raises(FrozenInstanceError):
        success.provider_tenant_id = "team-2"


def test_event_stream_contract_exposes_owner_managed_lifecycle() -> None:
    assert hasattr(IMEventStream, "start")
    assert hasattr(IMEventStream, "stop")
    assert not hasattr(IMEventStream, "run")
    assert issubclass(IMStreamStartError, Exception)
    assert issubclass(IMStreamStopError, Exception)


def test_authenticated_event_preserves_provider_payload_verbatim() -> None:
    payload = ' {"type":"card.action","nested":{"value":1}}\n'

    event = AuthenticatedIMEvent(
        provider=IMProvider.SLACK,
        provider_tenant_id="tenant-1",
        event_id="event-1",
        event_type="card.action",
        occurred_at=datetime(2026, 8, 2, 8),
        received_at=datetime(2026, 8, 2, 8, 0, 1),
        payload=payload,
    )

    assert tuple(field.name for field in fields(event)) == (
        "provider",
        "provider_tenant_id",
        "event_id",
        "event_type",
        "occurred_at",
        "received_at",
        "payload",
    )
    assert event.payload == payload


def test_provider_contract_does_not_export_superseded_inbox_types() -> None:
    assert not hasattr(im_provider, "ProviderNativePayload")
    assert not hasattr(im_provider, "IMEventSink")


def test_dynamic_card_contract_consumes_resolved_form_without_runtime_wrapper() -> None:
    assert get_type_hints(IMDynamicCardMessaging.assess)["intent"] is ResolvedForm
    assert get_type_hints(IMDynamicCardMessaging.send_card)["intent"] is ResolvedForm
    assert not hasattr(im_provider, "NormalizedCardIntent")
