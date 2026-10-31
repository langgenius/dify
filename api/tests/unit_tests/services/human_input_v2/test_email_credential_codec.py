"""Complete credential decoding rejects malformed data without exposing secrets."""

import json
from dataclasses import replace
from datetime import datetime
from traceback import format_exception

import pytest
from cryptography.fernet import Fernet, InvalidToken
from pydantic import ValidationError

from core.helper import encrypter
from core.human_input_v2.shared import EmailProviderId, NormalizedEmail, TenantId
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.email_channel.entities import (
    EmailChannelConfiguration,
    ResendCredentials,
)
from services.human_input_v2.email_credential_codec import load_email_credentials, seal_email_credentials

_TENANT = TenantId("workspace-1")


@pytest.fixture
def configuration(monkeypatch: pytest.MonkeyPatch) -> EmailChannelConfiguration:
    ciphers = {"workspace-1": Fernet(Fernet.generate_key()), "workspace-2": Fernet(Fernet.generate_key())}
    monkeypatch.setattr(
        encrypter, "encrypt_token", lambda tenant, plaintext: ciphers[tenant].encrypt(plaintext.encode()).decode()
    )
    monkeypatch.setattr(
        encrypter, "decrypt_token", lambda tenant, ciphertext: ciphers[tenant].decrypt(ciphertext.encode()).decode()
    )
    now = datetime(2026, 10, 23)
    return EmailChannelConfiguration(
        id=EmailProviderId("email-1"),
        tenant_id=_TENANT,
        sender_email=NormalizedEmail("sender@example.com"),
        sender_name="Sender",
        encrypted_credentials=seal_email_credentials(_TENANT, ResendCredentials(api_key="private-api-key")),
        configured_by_account_id=None,
        created_at=now,
        updated_at=now,
    )


def test_credentials_are_bound_to_the_workspace(configuration: EmailChannelConfiguration) -> None:
    assert load_email_credentials(configuration.tenant_id, configuration.encrypted_credentials) == ResendCredentials(
        api_key="private-api-key"
    )
    with pytest.raises(InvalidToken):
        load_email_credentials(TenantId("workspace-2"), configuration.encrypted_credentials)


@pytest.mark.parametrize("api_key", ["", " \t ", "arbitrary-key:+/=_", " key with spaces "])
def test_credentials_preserve_the_opaque_api_key(configuration: EmailChannelConfiguration, api_key: str) -> None:
    credentials = ResendCredentials(api_key=api_key)

    envelope = seal_email_credentials(configuration.tenant_id, credentials)

    assert load_email_credentials(configuration.tenant_id, envelope).api_key == api_key


@pytest.mark.parametrize(
    "plaintext",
    [
        "not-json-private-api-key",
        json.dumps({}),
        json.dumps({"api_key": 123}),
        json.dumps({"api_key": None}),
        json.dumps({"api_key": "private-api-key", "provider": "resend"}),
        json.dumps({"api_key": "private-api-key", "sender_email": "sender@example.com"}),
        json.dumps({"api_key": "private-api-key", "sender_name": "Sender"}),
    ],
)
def test_invalid_credentials_raise_validation_errors(configuration: EmailChannelConfiguration, plaintext: str) -> None:
    broken = replace(
        configuration,
        encrypted_credentials=ChannelEncryptedCredentials(ciphertext=encrypter.encrypt_token(str(_TENANT), plaintext)),
    )

    with pytest.raises(ValidationError) as captured:
        load_email_credentials(broken.tenant_id, broken.encrypted_credentials)

    assert "private-api-key" not in "".join(format_exception(captured.value))
    assert "private-api-key" not in repr(broken)
    assert "private-api-key" not in repr(broken.encrypted_credentials)
