from dataclasses import replace
from datetime import datetime

import pytest

from core.helper import encrypter
from core.human_input_v2.delivery_runtime import ConfigurationSnapshotIdentity, DeliveryPreparationError
from core.human_input_v2.email_channel import EmailChannelConfiguration
from core.human_input_v2.entities import EmailProviderType
from core.human_input_v2.shared import (
    EmailProviderId,
    NormalizedEmail,
    TenantId,
)
from services.human_input_v2.delivery_runtime import TenantEmailConfigurationSnapshotResolver

_NOW = datetime(2026, 7, 31, 8)
_PROVIDER = EmailProviderType.RESEND


class Repository:
    def __init__(self, configuration):
        self.configuration = configuration

    def load(self, tenant_id):
        assert tenant_id == TenantId("workspace-1")
        return self.configuration


def _configuration() -> EmailChannelConfiguration:
    return EmailChannelConfiguration(
        id=EmailProviderId("configuration-1"),
        tenant_id=TenantId("workspace-1"),
        sender_email=NormalizedEmail("sender@example.com"),
        sender_name="Dify",
        protected_api_key="ciphertext",
        configured_by_account_id=None,
        created_at=_NOW,
        updated_at=_NOW,
    )


@pytest.fixture(autouse=True)
def _reveal_email_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    def reveal(tenant_id: str, protected_api_key: str) -> str:
        assert tenant_id == "workspace-1"
        assert protected_api_key == "ciphertext"
        return "secret-api-key"

    monkeypatch.setattr(encrypter, "decrypt_token", reveal)


def test_resolver_returns_detached_send_time_snapshot() -> None:
    resolver = TenantEmailConfigurationSnapshotResolver(Repository(_configuration()))

    snapshot = resolver.resolve(TenantId("workspace-1"), _PROVIDER)

    assert snapshot.identity == ConfigurationSnapshotIdentity(EmailProviderId("configuration-1"), _NOW)
    assert snapshot.credential.value == "secret-api-key"
    assert "secret-api-key" not in repr(snapshot)


def test_resolver_rejects_missing_or_rotated_configuration() -> None:
    missing = TenantEmailConfigurationSnapshotResolver(Repository(None))
    with pytest.raises(DeliveryPreparationError) as missing_error:
        missing.resolve(TenantId("workspace-1"), _PROVIDER)
    assert missing_error.value.code == "provider_not_configured"

    resolver = TenantEmailConfigurationSnapshotResolver(Repository(_configuration()))
    with pytest.raises(DeliveryPreparationError) as changed_error:
        resolver.resolve(
            TenantId("workspace-1"),
            _PROVIDER,
            expected=ConfigurationSnapshotIdentity(
                EmailProviderId("configuration-2"),
                _NOW,
            ),
        )
    assert changed_error.value.code == "provider_configuration_changed"


def test_resolver_rejects_wrong_scope_and_credential_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    wrong_scope = TenantEmailConfigurationSnapshotResolver(
        Repository(replace(_configuration(), tenant_id=TenantId("workspace-2"))),
    )
    with pytest.raises(DeliveryPreparationError) as scope_error:
        wrong_scope.resolve(TenantId("workspace-1"), _PROVIDER)
    assert scope_error.value.code == "provider_configuration_scope_mismatch"

    def fail_reveal(_tenant_id: str, _protected_api_key: str) -> str:
        raise RuntimeError("decryption failed")

    monkeypatch.setattr(encrypter, "decrypt_token", fail_reveal)
    credential_failure = TenantEmailConfigurationSnapshotResolver(Repository(_configuration()))
    with pytest.raises(DeliveryPreparationError) as credential_error:
        credential_failure.resolve(TenantId("workspace-1"), _PROVIDER)
    assert credential_error.value.code == "provider_credential_unavailable"
