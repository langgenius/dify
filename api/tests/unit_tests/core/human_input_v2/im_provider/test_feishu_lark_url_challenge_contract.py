from __future__ import annotations

import base64
import hashlib
import json
from collections.abc import Mapping
from datetime import datetime

import pytest
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import AuthenticatedIMEvent, EventAcceptance, WebhookRequest
from core.human_input_v2.im_integration.adapters import feishu_lark as adapter_module
from core.human_input_v2.im_integration.adapters.credentials import FeishuCredentials, LarkCredentials
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMProviderAdapter,
    LarkIMProviderAdapter,
)

_RECEIVED_AT = datetime(2026, 8, 6, 10, 0, 0)
_VERIFICATION_TOKEN = "test-only-verification-token"
_ENCRYPT_KEY = "test-only-encrypt-key"
_CHALLENGE = "test-only-challenge"


class _NoRemoteGateway:
    def query_tenant(self) -> Mapping[str, object]:
        raise AssertionError("URL verification must not query the tenant")

    def list_scope(self, page_token: str | None) -> Mapping[str, object]:
        raise AssertionError(f"unexpected directory request: {page_token}")

    def list_departments(self, department_id: str, page_token: str | None) -> Mapping[str, object]:
        raise AssertionError(f"unexpected department request: {department_id}:{page_token}")

    def list_users(self, department_id: str, page_token: str | None) -> Mapping[str, object]:
        raise AssertionError(f"unexpected user request: {department_id}:{page_token}")

    def create_message(self, receive_id: str, msg_type: str, content: str) -> Mapping[str, object]:
        raise AssertionError(f"unexpected message request: {receive_id}:{msg_type}:{content}")

    def patch_message(self, message_id: str, content: str) -> Mapping[str, object]:
        raise AssertionError(f"unexpected patch request: {message_id}:{content}")


class _CountingConsumer:
    def __init__(self) -> None:
        self.events: list[AuthenticatedIMEvent] = []

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        self.events.append(event)
        return EventAcceptance.ACCEPTED


def _create_handler(
    monkeypatch: pytest.MonkeyPatch,
    provider: IMProvider,
    consumer: _CountingConsumer,
    *,
    verification_token: str | None,
    encrypt_key: str | None,
):
    gateway = _NoRemoteGateway()
    monkeypatch.setattr(adapter_module, "_create_sdk_gateway", lambda _credentials, _domain: gateway)
    credential_values = {
        "provider": provider,
        "app_id": "cli_test_only_app",
        "app_secret": "test-only-app-secret",
        "verification_token": verification_token,
        "encrypt_key": encrypt_key,
    }
    adapter: FeishuIMProviderAdapter | LarkIMProviderAdapter
    if provider is IMProvider.FEISHU:
        credentials = FeishuCredentials.model_validate(credential_values)
        adapter = FeishuIMProviderAdapter(credentials)
    else:
        credentials = LarkCredentials.model_validate(credential_values)
        adapter = LarkIMProviderAdapter(credentials)
    return adapter.create_webhook_handler(consumer)


def _plaintext_challenge(*, token: str | None = _VERIFICATION_TOKEN) -> bytes:
    challenge: dict[str, object] = {
        "type": "url_verification",
        "challenge": _CHALLENGE,
    }
    if token is not None:
        challenge["token"] = token
    return json.dumps(challenge, separators=(",", ":")).encode()


def _encrypted_challenge(*, token: str | None = _VERIFICATION_TOKEN, encrypt_key: str = _ENCRYPT_KEY) -> bytes:
    plaintext = _plaintext_challenge(token=token)
    key = hashlib.sha256(encrypt_key.encode()).digest()
    iv = bytes(range(16))
    padder = padding.PKCS7(algorithms.AES.block_size).padder()
    padded = padder.update(plaintext) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    ciphertext = iv + encryptor.update(padded) + encryptor.finalize()
    return json.dumps({"encrypt": base64.b64encode(ciphertext).decode()}, separators=(",", ":")).encode()


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
@pytest.mark.parametrize(
    ("verification_token", "encrypt_key", "body"),
    [
        (_VERIFICATION_TOKEN, None, _plaintext_challenge()),
        (_VERIFICATION_TOKEN, _ENCRYPT_KEY, _plaintext_challenge()),
        (_VERIFICATION_TOKEN, _ENCRYPT_KEY, _encrypted_challenge()),
        (None, _ENCRYPT_KEY, _encrypted_challenge(token=None)),
    ],
    ids=(
        "plaintext-token-auth",
        "plaintext-token-auth-with-encryption-configured",
        "encrypted-token-and-decryption-auth",
        "encrypted-decryption-auth",
    ),
)
def test_valid_url_verification_returns_exact_response_without_consumer_or_remote_io(
    monkeypatch: pytest.MonkeyPatch,
    provider: IMProvider,
    verification_token: str | None,
    encrypt_key: str | None,
    body: bytes,
) -> None:
    consumer = _CountingConsumer()
    handler = _create_handler(
        monkeypatch,
        provider,
        consumer,
        verification_token=verification_token,
        encrypt_key=encrypt_key,
    )

    response = handler.handle(WebhookRequest("POST", (), body, _RECEIVED_AT))

    assert response.status_code == 200
    assert response.headers == (("Content-Type", "application/json"),)
    assert response.body == b'{"challenge":"test-only-challenge"}'
    assert consumer.events == []


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
@pytest.mark.parametrize(
    ("verification_token", "encrypt_key", "body"),
    [
        (_VERIFICATION_TOKEN, None, _plaintext_challenge(token="wrong-test-only-token")),
        (_VERIFICATION_TOKEN, _ENCRYPT_KEY, _encrypted_challenge(token="wrong-test-only-token")),
        (_VERIFICATION_TOKEN, _ENCRYPT_KEY, _encrypted_challenge(encrypt_key="wrong-test-only-key")),
        (_VERIFICATION_TOKEN, None, _encrypted_challenge()),
        (None, None, _plaintext_challenge(token=None)),
        (None, _ENCRYPT_KEY, _plaintext_challenge(token=None)),
    ],
    ids=(
        "plaintext-wrong-token",
        "encrypted-wrong-token",
        "encrypted-wrong-key",
        "encrypted-missing-key",
        "plaintext-no-auth-material",
        "plaintext-bypasses-configured-encryption",
    ),
)
def test_invalid_or_unauthenticated_url_verification_fails_closed_without_consumer(
    monkeypatch: pytest.MonkeyPatch,
    provider: IMProvider,
    verification_token: str | None,
    encrypt_key: str | None,
    body: bytes,
) -> None:
    consumer = _CountingConsumer()
    handler = _create_handler(
        monkeypatch,
        provider,
        consumer,
        verification_token=verification_token,
        encrypt_key=encrypt_key,
    )

    response = handler.handle(WebhookRequest("POST", (), body, _RECEIVED_AT))

    assert response.status_code != 200
    assert response.body == b'{"code":1}'
    assert consumer.events == []
