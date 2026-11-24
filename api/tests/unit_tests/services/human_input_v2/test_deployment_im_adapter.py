"""Deployment ciphertext must reach every IM runtime without tenant-key fallback."""

from contextlib import nullcontext
from dataclasses import replace
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from Crypto.PublicKey import RSA

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.credentials import SlackCredentials
from core.human_input_v2.im_integration.adapters.entities import WebhookRequest, WebhookResponse
from core.human_input_v2.shared import DeploymentScope, TenantId
from libs.credential_cipher import CredentialKeyUnavailableError
from libs.key_providers.deployment_local import LocalDeploymentKeyBackend
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId, IMChannelStatus, WebhookId
from services.human_input_v2 import composition, deployment_im_adapter, im_card_service, im_webhook_runtime
from services.human_input_v2.im_contact_sync import composition as sync_composition
from services.human_input_v2.im_credential_codec import IMCredentialCodec, IMCredentialError


class _KeyStorage:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def load_once(self, filename: str) -> bytes:
        if filename not in self.files:
            raise FileNotFoundError(filename)
        return self.files[filename]

    def save_if_absent(self, filename: str, data: bytes) -> bool:
        if filename in self.files:
            return False
        self.files[filename] = data
        return True


@pytest.fixture
def deployment_channel(monkeypatch: pytest.MonkeyPatch) -> tuple[IMChannel, SlackCredentials, Mock]:
    storage = _KeyStorage()
    storage.files["privkeys/deployments/test/private.pem"] = RSA.generate(2048).export_key()
    backend = LocalDeploymentKeyBackend(storage)
    reference = backend.provision("test", None)
    cipher = backend.bind("test", reference)
    credentials = SlackCredentials(
        provider=IMProvider.SLACK,
        client_id="client",
        client_secret="test-client-secret",
        signing_secret="test-signing-secret",
        bot_token="xoxb-test-bot",
        app_token=None,
    )
    now = datetime(2026, 11, 24)
    channel = IMChannel(
        id=IMChannelId("deployment-channel"),
        created_at=now,
        updated_at=now,
        provider=IMProvider.SLACK,
        provider_tenant_id="team",
        encrypted_credentials=IMCredentialCodec(cipher).seal(credentials),
        app_identifier="client",
        webhook_id=WebhookId("deployment-webhook"),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
    )
    builder = Mock(return_value=Mock())
    monkeypatch.setattr(deployment_im_adapter, "build_deployment_credential_cipher", lambda **_: cipher)
    monkeypatch.setattr(deployment_im_adapter, "build_im_provider_adapter", builder)
    return channel, credentials, builder


def test_runtime_adapter_decrypts_real_deployment_envelope(deployment_channel) -> None:
    channel, credentials, builder = deployment_channel
    adapter = deployment_im_adapter.build_deployment_im_adapter(channel)
    assert adapter is builder.return_value
    builder.assert_called_once_with(credentials)


def test_invalid_envelope_does_not_build_adapter(deployment_channel) -> None:
    channel, _, builder = deployment_channel
    invalid = replace(channel, encrypted_credentials=ChannelEncryptedCredentials(ciphertext="b2xkLXJlZmVyZW5jZQ=="))
    with pytest.raises(IMCredentialError, match="configuration is unavailable"):
        deployment_im_adapter.build_deployment_im_adapter(invalid)
    builder.assert_not_called()


def test_missing_key_fails_without_building_adapter(deployment_channel, monkeypatch: pytest.MonkeyPatch) -> None:
    channel, _, builder = deployment_channel

    def unavailable(**_):
        raise CredentialKeyUnavailableError("not provisioned")

    monkeypatch.setattr(deployment_im_adapter, "build_deployment_credential_cipher", unavailable)
    with pytest.raises(IMCredentialError, match="configuration is unavailable"):
        deployment_im_adapter.build_deployment_im_adapter(channel)
    builder.assert_not_called()


def test_delivery_and_card_composition_use_deployment_cipher(
    deployment_channel, monkeypatch: pytest.MonkeyPatch
) -> None:
    channel, credentials, builder = deployment_channel
    monkeypatch.setattr(composition.FeatureService, "is_im_centrally_managed", lambda: True)
    monkeypatch.setattr(composition, "build_email_client", lambda **_: Mock())
    service = composition.build_human_input_delivery_service(tenant_id=TenantId("workspace"), session_factory=Mock())
    assert service._im_adapter_factory is not None
    service._im_adapter_factory(channel)
    cards = im_card_service.HumanInputIMCardService(session_factory=Mock())
    cards._build_adapter(TenantId("workspace"), channel)
    assert builder.call_count == 2
    assert all(call.args == (credentials,) for call in builder.call_args_list)


def test_deployment_webhook_uses_deployment_cipher_and_closes_adapter(
    deployment_channel, monkeypatch: pytest.MonkeyPatch
) -> None:
    channel, credentials, builder = deployment_channel
    sessions = Mock(side_effect=lambda: nullcontext(Mock()))
    route = SimpleNamespace(channel=channel, scope=DeploymentScope())
    reader = Mock()
    reader.find_by_webhook_id.return_value = route
    monkeypatch.setattr(im_webhook_runtime, "SQLAlchemyIMWebhookChannelRepository", lambda _: reader)
    response = WebhookResponse(200, (), b"accepted")
    builder.return_value.create_webhook_handler.return_value.handle.return_value = response
    ingress = im_webhook_runtime.IMWebhookIngressService(sessions=sessions, key_provider=Mock())
    assert ingress.handle(channel.webhook_id, WebhookRequest("POST", (), b"", datetime(2026, 11, 24))) == response
    builder.assert_called_once_with(credentials)
    builder.return_value.close.assert_called_once()


def test_sync_adapter_uses_deployment_cipher(deployment_channel, monkeypatch: pytest.MonkeyPatch) -> None:
    channel, credentials, builder = deployment_channel
    cipher = deployment_im_adapter.build_deployment_credential_cipher()
    monkeypatch.setattr(sync_composition, "build_deployment_credential_cipher", lambda **_: cipher)
    adapter = sync_composition._deployment_adapter(Mock(), channel)
    assert adapter.provider is credentials.provider
    adapter.close()
