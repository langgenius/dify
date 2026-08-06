from __future__ import annotations

import threading
from dataclasses import FrozenInstanceError

import pytest
from pydantic import ValidationError

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_provider import (
    CredentialTestSuccess,
    Directory,
    DirectoryEntry,
    ProviderUserId,
    SlackIMIntegrationCredentials,
    StopSignal,
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


def test_stop_signal_observes_caller_owned_event() -> None:
    source = threading.Event()
    signal = StopSignal(source)

    assert signal.stop_requested is False
    assert signal.wait(0) is False

    source.set()
    source.set()

    assert signal.stop_requested is True
    assert signal.wait(0) is True
