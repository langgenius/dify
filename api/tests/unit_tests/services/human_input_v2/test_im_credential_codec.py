"""Encrypted credentials accept additive fields while retaining known-field validation."""

import json

import pytest
from cryptography.fernet import Fernet
from pydantic import JsonValue

from core.human_input_v2.entities import IMProvider
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from services.human_input_v2.im_credential_codec import IMCredentialCodec, IMCredentialError


class _Cipher:
    def __init__(self) -> None:
        self._fernet = Fernet(Fernet.generate_key())

    def encrypt(self, plaintext: str) -> bytes:
        return self._fernet.encrypt(plaintext.encode())

    def decrypt(self, ciphertext: bytes) -> str:
        return self._fernet.decrypt(ciphertext).decode()


@pytest.mark.parametrize(
    ("provider", "known"),
    [
        (
            IMProvider.FEISHU,
            {"app_id": "app", "app_secret": "secret", "encrypt_key": "key"},
        ),
        (
            IMProvider.LARK,
            {"app_id": "app", "app_secret": "secret", "encrypt_key": "key"},
        ),
        (
            IMProvider.SLACK,
            {
                "client_id": "client",
                "client_secret": "secret",
                "signing_secret": "signing",
                "bot_token": "xoxb-old",
                "app_token": "xapp-old",
            },
        ),
        (
            IMProvider.DING_TALK,
            {"corp_id": "corp", "client_id": "client", "client_secret": "secret"},
        ),
        (
            IMProvider.MS_TEAMS,
            {
                "tenant_id": "11111111-1111-1111-1111-111111111111",
                "client_id": "22222222-2222-2222-2222-222222222222",
                "client_secret": "secret",
            },
        ),
        (
            IMProvider.WE_COM,
            {"corp_id": "corp", "agent_id": "1", "secret": "secret"},
        ),
    ],
)
def test_encrypted_credentials_accept_additive_fields(provider: IMProvider, known: dict[str, str]) -> None:
    from base64 import b64encode

    cipher = _Cipher()
    codec = IMCredentialCodec(cipher)
    plaintext = {
        "provider": provider,
        **known,
        "future_optional": None,
        "future_credentials": {"nested": {"token": "opaque", "optional": None}},
    }
    envelope = ChannelEncryptedCredentials(ciphertext=b64encode(cipher.encrypt(json.dumps(plaintext))).decode())
    recovered = codec.load(provider, envelope).model_dump(mode="json")
    assert recovered.items() >= known.items()
    assert recovered["future_credentials"] == plaintext["future_credentials"]
    assert "future_optional" in recovered
    assert recovered["future_optional"] is None


@pytest.mark.parametrize(
    "payload",
    [
        {
            "provider": "slack",
            "client_id": "id",
            "client_secret": "secret",
            "signing_secret": "secret",
            "bot_token": "invalid",
        },
        {"provider": "future_provider"},
    ],
)
def test_credential_codec_still_rejects_invalid_known_fields_and_providers(payload: dict[str, JsonValue]) -> None:
    from base64 import b64encode

    cipher = _Cipher()
    envelope = ChannelEncryptedCredentials(ciphertext=b64encode(cipher.encrypt(json.dumps(payload))).decode())
    with pytest.raises(IMCredentialError):
        IMCredentialCodec(cipher).load(IMProvider.SLACK, envelope)
