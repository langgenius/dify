from __future__ import annotations

import base64
import hashlib
import json
import threading
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    AuthenticatedIMEvent,
    EventAcceptance,
    IMEventIngressKind,
    WebhookRequest,
)
from core.human_input_v2.im_integration.adapters import feishu_lark as adapter_module
from core.human_input_v2.im_integration.adapters.credentials import FeishuCredentials, LarkCredentials
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMProviderAdapter,
    LarkIMProviderAdapter,
)

_RECEIVED_AT = datetime(2026, 8, 6, 10, 0, 0)
_TIMESTAMP = str(int(_RECEIVED_AT.replace(tzinfo=UTC).timestamp()))
_VERIFICATION_TOKEN = "sanitized-verification-token"
_ENCRYPT_KEY = "sanitized-encrypt-key"


class _Gateway:
    def __init__(self, tenant_keys: list[str]) -> None:
        self._tenant_keys = tenant_keys
        self.calls: list[str] = []

    def query_tenant(self) -> Mapping[str, object]:
        self.calls.append("query_tenant")
        return {"code": 0, "data": {"tenant": {"tenant_key": self._tenant_keys.pop(0)}}}

    def list_scope(self, _page_token: str | None) -> Mapping[str, object]:
        raise AssertionError("unexpected scope call")

    def list_departments(self, _department_id: str, _page_token: str | None) -> Mapping[str, object]:
        raise AssertionError("unexpected department call")

    def list_users(self, _department_id: str, _page_token: str | None) -> Mapping[str, object]:
        raise AssertionError("unexpected user call")

    def create_message(self, _receive_id: str, _msg_type: str, _content: str) -> Mapping[str, object]:
        raise AssertionError("unexpected create call")

    def patch_message(self, _message_id: str, _content: str) -> Mapping[str, object]:
        raise AssertionError("unexpected patch call")


class _Consumer:
    def __init__(self, acceptance: EventAcceptance = EventAcceptance.ACCEPTED) -> None:
        self.acceptance = acceptance
        self.events: list[AuthenticatedIMEvent] = []

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        self.events.append(event)
        return self.acceptance


class _FailingConsumer:
    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        del event
        raise RuntimeError("sensitive consumer details")


def _adapter(
    monkeypatch: pytest.MonkeyPatch,
    provider: IMProvider,
    gateway: _Gateway,
    *,
    verification_token: str | None = _VERIFICATION_TOKEN,
    encrypt_key: str | None = _ENCRYPT_KEY,
) -> FeishuIMProviderAdapter | LarkIMProviderAdapter:
    monkeypatch.setattr(adapter_module, "_create_sdk_gateway", lambda _credentials, _domain: gateway)
    values = {
        "provider": provider,
        "app_id": "cli_sanitized_app",
        "app_secret": "sanitized-app-secret",
        "verification_token": verification_token,
        "encrypt_key": encrypt_key,
    }
    if provider is IMProvider.FEISHU:
        return FeishuIMProviderAdapter(FeishuCredentials.model_validate(values))
    return LarkIMProviderAdapter(LarkCredentials.model_validate(values))


def _event_body(
    *,
    token: str = _VERIFICATION_TOKEN,
    create_time: str = "1785981600000",
) -> bytes:
    return json.dumps(
        {
            "schema": "2.0",
            "header": {
                "event_id": "evt_sanitized_event",
                "event_type": "card.action.trigger",
                "create_time": create_time,
                "tenant_key": "tenant_sanitized",
                "token": token,
            },
            "event": {
                "action": {
                    "name": "approve",
                    "value": {
                        "action_id": "approve",
                        "correlation_token": "opaque-correlation-token",
                    },
                },
                "nested": [1, None, {"preserved": True}],
            },
        },
        separators=(",", ":"),
    ).encode()


def _encrypt(plaintext: bytes, *, encrypt_key: str = _ENCRYPT_KEY) -> str:
    key = hashlib.sha256(encrypt_key.encode()).digest()
    iv = bytes(range(16))
    padder = padding.PKCS7(algorithms.AES.block_size).padder()
    padded = padder.update(plaintext) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    return base64.b64encode(iv + encryptor.update(padded) + encryptor.finalize()).decode()


def _signed_request(
    body: bytes,
    *,
    timestamp: str = _TIMESTAMP,
    nonce: str = "sanitized-nonce",
    signature: str | None = None,
) -> WebhookRequest:
    calculated = hashlib.sha256(timestamp.encode() + nonce.encode() + _ENCRYPT_KEY.encode() + body).hexdigest()
    return WebhookRequest(
        method="POST",
        headers=(
            ("X-Lark-Request-Timestamp", timestamp),
            ("X-Lark-Request-Nonce", nonce),
            ("X-Lark-Signature", calculated if signature is None else signature),
        ),
        body=body,
        received_at=_RECEIVED_AT,
    )


def _assert_single_verified_digest_claim(
    handler: object,
    *,
    signature: str,
    body: bytes,
) -> None:
    assert isinstance(handler, adapter_module._FeishuLarkWebhookHandler)
    expected_identity = bytes.fromhex(signature)
    assert len(expected_identity) == hashlib.sha256().digest_size
    assert set(handler._replay_claims) == {expected_identity}
    assert all(isinstance(expires_at, float) for expires_at in handler._replay_claims.values())
    assert body not in handler._replay_claims
    assert _ENCRYPT_KEY.encode() not in handler._replay_claims
    assert signature.encode() not in handler._replay_claims


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_authenticated_plaintext_event_preserves_complete_payload_and_acks_after_acceptance(
    monkeypatch: pytest.MonkeyPatch,
    provider: IMProvider,
) -> None:
    gateway = _Gateway(["tenant_sanitized"])
    consumer = _Consumer()
    adapter = _adapter(monkeypatch, provider, gateway, encrypt_key=None)
    handler = adapter.create_webhook_handler(consumer)
    body = _event_body()

    response = handler.handle(
        WebhookRequest(
            method="POST",
            headers=(("Content-Type", "application/json"),),
            body=body,
            received_at=_RECEIVED_AT,
        )
    )

    assert response.status_code == 200
    assert json.loads(response.body) == {"code": 0}
    assert len(consumer.events) == 1
    event = consumer.events[0]
    assert event.provider is provider
    assert event.provider_tenant_id == "tenant_sanitized"
    assert event.event_id == "evt_sanitized_event"
    assert event.event_type == "card.action.trigger"
    assert event.ingress_kind is IMEventIngressKind.WEBHOOK
    assert json.loads(event.payload) == json.loads(body)


@pytest.mark.parametrize(
    ("create_time", "expected"),
    [
        ("1704067200123456", datetime(2024, 1, 1, 0, 0, 0, 123456)),
        ("1704067200123", datetime(2024, 1, 1, 0, 0, 0, 123000)),
        ("not-a-timestamp", None),
        ("9" * 64, None),
    ],
    ids=("microseconds", "milliseconds", "malformed", "overflow"),
)
def test_authenticated_webhook_event_maps_confirmed_timestamp_units_safely(
    monkeypatch: pytest.MonkeyPatch,
    create_time: str,
    expected: datetime | None,
) -> None:
    consumer = _Consumer()
    handler = _adapter(
        monkeypatch,
        IMProvider.FEISHU,
        _Gateway(["tenant_sanitized"]),
        encrypt_key=None,
    ).create_webhook_handler(consumer)

    response = handler.handle(WebhookRequest("POST", (), _event_body(create_time=create_time), _RECEIVED_AT))

    assert response.status_code == 200
    assert len(consumer.events) == 1
    assert consumer.events[0].occurred_at == expected


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_plaintext_business_event_without_auth_material_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    provider: IMProvider,
) -> None:
    gateway = _Gateway(["tenant_sanitized"])
    consumer = _Consumer()
    handler = _adapter(
        monkeypatch,
        provider,
        gateway,
        verification_token=None,
        encrypt_key=None,
    ).create_webhook_handler(consumer)

    response = handler.handle(WebhookRequest("POST", (), _event_body(), _RECEIVED_AT))

    assert response.status_code != 200
    assert consumer.events == []
    assert gateway.calls == []


def test_encrypted_event_authenticates_exact_envelope_and_exposes_only_plaintext(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = _Gateway(["tenant_sanitized"])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    plaintext = json.dumps(json.loads(_event_body()), ensure_ascii=False, indent=2).encode()
    assert b"\n" in plaintext
    body = json.dumps({"encrypt": _encrypt(plaintext)}, separators=(",", ":")).encode()

    response = handler.handle(_signed_request(body))

    assert response.status_code == 200
    assert len(consumer.events) == 1
    event = consumer.events[0]
    assert event.ingress_kind is IMEventIngressKind.WEBHOOK
    assert json.loads(event.payload) == json.loads(plaintext)
    assert "encrypt" not in json.loads(event.payload)


def test_signed_event_treats_timestamp_as_opaque_signature_material(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = _Gateway(["tenant_sanitized"])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()

    response = handler.handle(_signed_request(body, timestamp="opaque-provider-timestamp"))

    assert response.status_code == 200
    assert len(consumer.events) == 1


@pytest.mark.parametrize(
    ("timestamp", "nonce"),
    [("", "sanitized-nonce"), ("opaque-provider-timestamp", "")],
    ids=("empty-timestamp", "empty-nonce"),
)
def test_signed_event_preserves_official_sdk_empty_signature_material_semantics(
    monkeypatch: pytest.MonkeyPatch,
    timestamp: str,
    nonce: str,
) -> None:
    gateway = _Gateway(["tenant_sanitized"])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()

    response = handler.handle(_signed_request(body, timestamp=timestamp, nonce=nonce))

    assert response.status_code == 200
    assert len(consumer.events) == 1


def test_tampered_signature_never_reaches_consumer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = _Gateway([])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()

    response = handler.handle(_signed_request(body, signature="0" * 64))

    assert response.status_code != 200
    assert consumer.events == []
    assert gateway.calls == []


def test_empty_signature_never_reaches_consumer_or_gateway(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = _Gateway([])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()
    request = _signed_request(body, signature="")

    assert tuple(value for name, value in request.headers if name == "X-Lark-Signature") == ("",)
    response = handler.handle(request)

    assert response.status_code == 401
    assert consumer.events == []
    assert gateway.calls == []


def test_signature_is_bound_to_exact_request_body(monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = _Gateway([])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()
    signed = _signed_request(body)
    modified = WebhookRequest(signed.method, signed.headers, signed.body + b" ", signed.received_at)

    response = handler.handle(modified)

    assert response.status_code != 200
    assert consumer.events == []
    assert gateway.calls == []


@pytest.mark.parametrize(
    "header_name",
    ["X-Lark-Request-Timestamp", "X-Lark-Request-Nonce", "X-Lark-Signature"],
)
def test_signed_event_requires_exactly_one_signature_tuple_header(
    monkeypatch: pytest.MonkeyPatch,
    header_name: str,
) -> None:
    gateway = _Gateway([])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()
    signed = _signed_request(body)
    header = next(header for header in signed.headers if header[0] == header_name)
    missing = WebhookRequest(
        signed.method,
        tuple(candidate for candidate in signed.headers if candidate[0] != header_name),
        signed.body,
        signed.received_at,
    )
    duplicate = WebhookRequest(
        signed.method,
        signed.headers + (header,),
        signed.body,
        signed.received_at,
    )

    assert handler.handle(missing).status_code != 200
    assert handler.handle(duplicate).status_code != 200
    assert consumer.events == []
    assert gateway.calls == []


def test_replayed_signed_delivery_is_rejected_without_second_consumer_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = _Gateway(["tenant_sanitized", "tenant_sanitized"])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()
    request = _signed_request(body)

    first = handler.handle(request)
    replay = handler.handle(request)

    assert first.status_code == 200
    assert replay.status_code != 200
    assert len(consumer.events) == 1


def test_boundary_shifted_signature_material_shares_one_replay_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = _Gateway(["tenant_sanitized", "tenant_sanitized"])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()
    first = _signed_request(body, timestamp="1", nonce="23")
    signature = next(value for name, value in first.headers if name == "X-Lark-Signature")
    boundary_shifted = _signed_request(body, timestamp="12", nonce="3", signature=signature)

    responses = (handler.handle(first), handler.handle(boundary_shifted))

    assert tuple(response.status_code for response in responses) == (200, 409)
    assert len(consumer.events) == 1
    _assert_single_verified_digest_claim(handler, signature=signature, body=body)


def test_concurrent_replayed_signed_delivery_is_claimed_atomically(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_count = 8
    gateway = _Gateway(["tenant_sanitized"] * request_count)
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()
    request = _signed_request(body)

    with ThreadPoolExecutor(max_workers=request_count) as executor:
        responses = tuple(executor.map(handler.handle, (request,) * request_count))

    assert sum(response.status_code == 200 for response in responses) == 1
    assert len(consumer.events) == 1


def test_concurrent_boundary_shifted_signature_material_is_claimed_atomically(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_count = 8
    start_barrier = threading.Barrier(request_count)

    class BarrierGateway(_Gateway):
        def query_tenant(self) -> Mapping[str, object]:
            start_barrier.wait(timeout=5)
            return super().query_tenant()

    gateway = BarrierGateway(["tenant_sanitized"] * request_count)
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()
    first = _signed_request(body, timestamp="1", nonce="23")
    signature = next(value for name, value in first.headers if name == "X-Lark-Signature")
    boundary_shifted = _signed_request(body, timestamp="12", nonce="3", signature=signature)
    requests = (first, boundary_shifted) * (request_count // 2)

    with ThreadPoolExecutor(max_workers=request_count) as executor:
        responses = tuple(executor.map(handler.handle, requests))

    assert sum(response.status_code == 200 for response in responses) == 1
    assert len(consumer.events) == 1
    _assert_single_verified_digest_claim(handler, signature=signature, body=body)


def test_signed_delivery_replay_claims_expire_and_remain_bounded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monotonic_time = 1000.0
    monkeypatch.setattr(adapter_module.time, "monotonic", lambda: monotonic_time)
    monkeypatch.setattr(adapter_module, "_WEBHOOK_REPLAY_CACHE_CAPACITY", 2)
    gateway = _Gateway(["tenant_sanitized"] * 4)
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    assert isinstance(handler, adapter_module._FeishuLarkWebhookHandler)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()

    assert handler.handle(_signed_request(body, nonce="sanitized-nonce-1")).status_code == 200
    assert handler.handle(_signed_request(body, nonce="sanitized-nonce-2")).status_code == 200
    assert handler.handle(_signed_request(body, nonce="sanitized-nonce-3")).status_code != 200
    assert len(handler._replay_claims) == 2

    monotonic_time += adapter_module._WEBHOOK_REPLAY_CLAIM_TTL_SECONDS + 1
    assert handler.handle(_signed_request(body, nonce="sanitized-nonce-3")).status_code == 200
    assert len(consumer.events) == 3


def test_replay_capacity_never_evicts_an_unexpired_delivery_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(adapter_module, "_WEBHOOK_REPLAY_CACHE_CAPACITY", 2)
    gateway = _Gateway(["tenant_sanitized"] * 4)
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps({"encrypt": _encrypt(_event_body())}, separators=(",", ":")).encode()
    first = _signed_request(body, nonce="sanitized-nonce-1")

    assert handler.handle(first).status_code == 200
    assert handler.handle(_signed_request(body, nonce="sanitized-nonce-2")).status_code == 200
    assert handler.handle(_signed_request(body, nonce="sanitized-nonce-3")).status_code != 200
    assert handler.handle(first).status_code != 200
    assert len(consumer.events) == 2


def test_wrong_encryption_material_never_reaches_consumer(monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = _Gateway([])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps(
        {"encrypt": _encrypt(_event_body(), encrypt_key="sanitized-wrong-encrypt-key")},
        separators=(",", ":"),
    ).encode()

    response = handler.handle(_signed_request(body))

    assert response.status_code != 200
    assert consumer.events == []
    assert gateway.calls == []


def test_wrong_verification_token_never_reaches_consumer(monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = _Gateway([])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway, encrypt_key=None).create_webhook_handler(consumer)

    response = handler.handle(WebhookRequest("POST", (), _event_body(token="wrong-token"), _RECEIVED_AT))

    assert response.status_code != 200
    assert consumer.events == []
    assert gateway.calls == []


def test_cross_tenant_webhook_never_reaches_consumer(monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = _Gateway(["tenant_other"])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway, encrypt_key=None).create_webhook_handler(consumer)

    response = handler.handle(WebhookRequest("POST", (), _event_body(), _RECEIVED_AT))

    assert response.status_code == 401
    assert consumer.events == []
    assert gateway.calls == ["query_tenant"]


def test_url_challenge_returns_exact_challenge_without_consumer_or_remote_io(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = _Gateway([])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway, encrypt_key=None).create_webhook_handler(consumer)
    body = json.dumps(
        {"type": "url_verification", "token": _VERIFICATION_TOKEN, "challenge": "sanitized-challenge"},
        separators=(",", ":"),
    ).encode()

    response = handler.handle(WebhookRequest("POST", (), body, _RECEIVED_AT))

    assert response.status_code == 200
    assert response.body == b'{"challenge":"sanitized-challenge"}'
    assert consumer.events == []
    assert gateway.calls == []


def test_url_challenge_does_not_require_business_event_signature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = _Gateway([])
    consumer = _Consumer()
    handler = _adapter(monkeypatch, IMProvider.FEISHU, gateway).create_webhook_handler(consumer)
    body = json.dumps(
        {"type": "url_verification", "token": _VERIFICATION_TOKEN, "challenge": "sanitized-challenge"},
        separators=(",", ":"),
    ).encode()

    response = handler.handle(WebhookRequest("POST", (), body, _RECEIVED_AT))

    assert response.status_code == 200
    assert response.body == b'{"challenge":"sanitized-challenge"}'
    assert consumer.events == []
    assert gateway.calls == []


@pytest.mark.parametrize(
    ("consumer", "expected_status"),
    [(_Consumer(EventAcceptance.NOT_ACCEPTED), 503), (_FailingConsumer(), 503)],
)
def test_consumer_must_accept_before_successful_ack(
    monkeypatch: pytest.MonkeyPatch,
    consumer: _Consumer | _FailingConsumer,
    expected_status: int,
) -> None:
    handler = _adapter(
        monkeypatch,
        IMProvider.FEISHU,
        _Gateway(["tenant_sanitized"]),
        encrypt_key=None,
    ).create_webhook_handler(consumer)

    response = handler.handle(WebhookRequest("POST", (), _event_body(), _RECEIVED_AT))

    assert response.status_code == expected_status
    assert response.body == b'{"code":1}'


def test_webhook_handler_is_independent_of_root_close_and_safe_for_concurrent_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_count = 8
    gateway = _Gateway(["tenant_sanitized"] * request_count)
    consumer = _Consumer()
    adapter = _adapter(monkeypatch, IMProvider.FEISHU, gateway, encrypt_key=None)
    handler = adapter.create_webhook_handler(consumer)
    adapter.close()
    request = WebhookRequest("POST", (), _event_body(), _RECEIVED_AT)

    with ThreadPoolExecutor(max_workers=request_count) as executor:
        responses = tuple(executor.map(handler.handle, (request,) * request_count))

    assert all(response.status_code == 200 for response in responses)
    assert len(consumer.events) == request_count
