from __future__ import annotations

from datetime import datetime

import pytest

from core.human_input_v2.channel_management import (
    HumanInputChannelManagementContext,
    NewSecret,
    PreserveSlackSecret,
    SlackIMCandidate,
)
from core.human_input_v2.entities import IMIntegrationStatus, IMProvider
from core.human_input_v2.im_integration import (
    EncryptedCredentials,
    IMIntegration,
    ProviderTenantIdentity,
)
from core.human_input_v2.im_provider import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    SlackIMIntegrationCredentials,
)
from core.human_input_v2.shared import AccountId, IntegrationId, NormalizedEmail, TenantId
from services.human_input_im_channel_manager import IMProviderConfigurationError
from services.human_input_slack_channel import (
    SlackIMCredentialProtector,
    SlackIMProviderConfigurationPort,
)

_CONTEXT = HumanInputChannelManagementContext(
    tenant_id=TenantId("workspace-1"),
    actor_account_id=AccountId("account-1"),
    actor_email=NormalizedEmail("operator@example.com"),
)
_NOW = datetime(2026, 8, 6, 8)


def _candidate() -> SlackIMCandidate:
    return SlackIMCandidate(
        client_id="client-id",
        client_secret=NewSecret("client-secret"),
        signing_secret=NewSecret("signing-secret"),
        bot_token=NewSecret("xoxb-test-bot-token"),
        app_token=NewSecret("xapp-test-app-token"),
    )


def _current_integration() -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=TenantId("workspace-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "team-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {
                "client_id": "current-client-id",
                "encrypted_client_secret": "cipher-client",
                "encrypted_signing_secret": "cipher-signing",
                "encrypted_bot_token": "cipher-bot",
                "encrypted_app_token": "cipher-app",
            }
        ),
        configured_by_account_id=AccountId("account-1"),
        callback_url=None,
        now=_NOW,
    )


class FakeAdapter:
    def __init__(self, credentials, result) -> None:
        self.credentials = credentials
        self.result = result
        self.closed = False

    def test_credentials(self):
        return self.result

    def close(self):
        self.closed = True


def test_credential_protector_encrypts_and_decrypts_every_secret(mocker) -> None:
    encrypt = mocker.patch(
        "services.human_input_slack_channel.encrypter.encrypt_token",
        side_effect=lambda owner, secret: f"cipher:{owner}:{secret}",
    )
    decrypt = mocker.patch(
        "services.human_input_slack_channel.encrypter.decrypt_token",
        side_effect=lambda owner, ciphertext: ciphertext.removeprefix(f"cipher:{owner}:"),
    )
    protector = SlackIMCredentialProtector()
    credentials = SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id="client-id",
        client_secret="client-secret",
        signing_secret="signing-secret",
        bot_token="xoxb-test-bot-token",
        app_token="xapp-test-app-token",
    )

    encrypted = protector.protect("workspace-1", credentials)
    revealed = protector.reveal("workspace-1", encrypted)

    assert encrypted.to_mapping() == {
        "client_id": "client-id",
        "encrypted_client_secret": "cipher:workspace-1:client-secret",
        "encrypted_signing_secret": "cipher:workspace-1:signing-secret",
        "encrypted_bot_token": "cipher:workspace-1:xoxb-test-bot-token",
        "encrypted_app_token": "cipher:workspace-1:xapp-test-app-token",
    }
    assert revealed == credentials
    assert encrypt.call_count == 4
    assert decrypt.call_count == 4


def test_provider_port_resolves_tests_protects_and_closes_adapter() -> None:
    adapters = []

    def adapter_factory(credentials):
        adapter = FakeAdapter(credentials, CredentialTestSuccess(IMProvider.SLACK, "team-1"))
        adapters.append(adapter)
        return adapter

    class Protector:
        def protect(self, owner_key, credentials):
            assert owner_key == "workspace-1"
            return SlackIMCredentialProtectorValues.encrypted(credentials)

    port = SlackIMProviderConfigurationPort(
        Protector(),
        adapter_factory=adapter_factory,
        clock=lambda: _NOW,
    )

    confirmed = port.prepare(_CONTEXT, _candidate(), None)
    tested = port.test(_CONTEXT, _candidate(), None)

    assert confirmed.provider is IMProvider.SLACK
    assert confirmed.provider_tenant_id == "team-1"
    assert "encrypted_app_token" in confirmed.encrypted_credentials.to_mapping()
    assert tested.provider_tenant_id == "team-1"
    assert tested.status is IMIntegrationStatus.CONNECTED
    assert tested.checked_at == _NOW
    assert all(adapter.closed for adapter in adapters)
    assert adapters[0].credentials.app_token == "xapp-test-app-token"


class SlackIMCredentialProtectorValues:
    @staticmethod
    def encrypted(credentials):
        from core.human_input_v2.im_integration import EncryptedCredentials

        return EncryptedCredentials.from_mapping(
            {
                "client_id": credentials.client_id,
                "encrypted_client_secret": "cipher-client",
                "encrypted_signing_secret": "cipher-signing",
                "encrypted_bot_token": "cipher-bot",
                "encrypted_app_token": "cipher-app",
            }
        )


def test_provider_port_maps_credential_failure_without_reason_leak() -> None:
    failure = CredentialTestFailure(
        CredentialTestFailureKind.AUTHENTICATION_REJECTED,
        "raw provider response with secret",
    )
    adapter = FakeAdapter(None, failure)
    port = SlackIMProviderConfigurationPort(
        SlackIMCredentialProtector(),
        adapter_factory=lambda _: adapter,
        clock=lambda: _NOW,
    )

    with pytest.raises(IMProviderConfigurationError) as raised:
        port.test(_CONTEXT, _candidate(), None)

    assert raised.value.code == "slack_authentication_rejected"
    assert "secret" not in str(raised.value)
    assert adapter.closed is True


def test_provider_port_resolves_preserved_slack_secret_before_adapter_and_protection() -> None:
    current = _current_integration()
    current_credentials = SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id="current-client-id",
        client_secret="current-client-secret",
        signing_secret="current-signing-secret",
        bot_token="xoxb-current-bot-token",
        app_token="xapp-current-app-token",
    )
    candidate = SlackIMCandidate(
        client_id="new-client-id",
        client_secret=NewSecret("new-client-secret"),
        signing_secret=NewSecret("new-signing-secret"),
        bot_token=NewSecret("xoxb-new-bot-token"),
        app_token=PreserveSlackSecret(),
    )
    resolved_credentials = []

    class Protector:
        def reveal(self, owner_key, encrypted_credentials):
            assert owner_key == "workspace-1"
            assert encrypted_credentials == current.encrypted_credentials
            return current_credentials

        def protect(self, owner_key, credentials):
            assert owner_key == "workspace-1"
            resolved_credentials.append(credentials)
            return current.encrypted_credentials

    def adapter_factory(credentials):
        resolved_credentials.append(credentials)
        return FakeAdapter(credentials, CredentialTestSuccess(IMProvider.SLACK, "team-1"))

    port = SlackIMProviderConfigurationPort(Protector(), adapter_factory=adapter_factory)

    port.prepare(_CONTEXT, candidate, current)

    assert len(resolved_credentials) == 2
    assert all(credentials.client_id == "new-client-id" for credentials in resolved_credentials)
    assert all(credentials.client_secret == "new-client-secret" for credentials in resolved_credentials)
    assert all(credentials.signing_secret == "new-signing-secret" for credentials in resolved_credentials)
    assert all(credentials.bot_token == "xoxb-new-bot-token" for credentials in resolved_credentials)
    assert all(credentials.app_token == "xapp-current-app-token" for credentials in resolved_credentials)


def test_provider_port_rejects_preserved_slack_secret_without_current_configuration() -> None:
    candidate = SlackIMCandidate(
        client_id="new-client-id",
        client_secret=PreserveSlackSecret(),
        signing_secret=NewSecret("new-signing-secret"),
        bot_token=NewSecret("xoxb-new-bot-token"),
        app_token=NewSecret("xapp-new-app-token"),
    )
    port = SlackIMProviderConfigurationPort(SlackIMCredentialProtector())

    with pytest.raises(IMProviderConfigurationError) as raised:
        port.prepare(_CONTEXT, candidate, None)

    assert raised.value.code == "slack_preserved_secret_unavailable"
