from __future__ import annotations

import base64
import hashlib
import inspect
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast, get_type_hints

import pytest

from core.human_input import ButtonStyle
from core.human_input_v2 import (
    MarkdownText,
    ParagraphInput,
    ResolvedForm,
    ResolvedFormAction,
    ResolvedFormContent,
    SelectInput,
)
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import adapters as adapters_package
from core.human_input_v2.im_integration.adapters import feishu_lark as adapter_module
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    FeishuIMProviderAdapter,
    LarkIMIntegrationCredentials,
    LarkIMProviderAdapter,
)
from core.human_input_v2.im_provider import (
    CorrelationToken,
    IMStreamStartError,
    IMStreamStopError,
    MessageReference,
    WebhookRequest,
)


class _CallRecorder:
    def __init__(self, result: dict[str, object]) -> None:
        self.result = result
        self.requests: list[object] = []

    def __call__(self, request: object) -> dict[str, object]:
        self.requests.append(request)
        return self.result


def test_stream_factory_returns_private_concrete_type_without_stream_contract_stub() -> None:
    return_type = get_type_hints(adapter_module._FeishuLarkIMProviderAdapter.create_stream_handler)["return"]
    stream_protocols = {
        name
        for name, candidate in vars(adapter_module).items()
        if name.startswith("_") and "Stream" in name and getattr(candidate, "_is_protocol", False)
    }

    assert return_type is adapter_module._FeishuLarkEventStream
    assert not getattr(return_type, "_is_protocol", False)
    assert return_type.__name__.startswith("_")
    assert not hasattr(adapters_package, return_type.__name__)
    public_methods = {
        name for name, member in vars(return_type).items() if not name.startswith("_") and callable(member)
    }
    assert public_methods == {"start", "stop"}
    assert not hasattr(adapter_module, "_IMEventStream")
    assert not hasattr(adapter_module, "StopSignal")
    assert stream_protocols == set()
    source = inspect.getsource(adapter_module)
    assert "def run(" not in source
    assert ".run(signal" not in source


def test_stream_errors_use_integrated_provider_contract_split() -> None:
    assert adapter_module.IMStreamStartError is IMStreamStartError
    assert adapter_module.IMStreamStopError is IMStreamStopError
    assert not hasattr(adapter_module, "IMStreamRunError")


class _ClientBuilder:
    def __init__(self, client: object) -> None:
        self.client = client

    def app_id(self, _value: str) -> _ClientBuilder:
        return self

    def app_secret(self, _value: str) -> _ClientBuilder:
        return self

    def domain(self, _value: str) -> _ClientBuilder:
        return self

    def log_level(self, _value: object) -> _ClientBuilder:
        return self

    def build(self) -> object:
        return self.client


def _credentials() -> FeishuIMIntegrationCredentials:
    return FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_sanitized_app",
        app_secret="sanitized-app-secret",
        verification_token="sanitized-verification-token",
        encrypt_key="sanitized-encrypt-key",
    )


def _intent(
    *,
    blocks: tuple[ResolvedFormContent, ...] = (MarkdownText("Rendered content"),),
    actions: tuple[ResolvedFormAction, ...] = (),
    title: str | None = None,
) -> ResolvedForm:
    return ResolvedForm(
        title=title,
        blocks=blocks,
        user_actions=actions,
        legacy_form_content="This value must not be rendered",
    )


def test_official_gateway_builds_every_sdk_request_with_pagination(monkeypatch: pytest.MonkeyPatch) -> None:
    tenant_call = _CallRecorder({"code": 0, "data": {"tenant": {"tenant_key": "tenant_sanitized"}}})
    scope_call = _CallRecorder({"code": 0, "data": {"department_ids": [], "user_ids": [], "has_more": False}})
    department_call = _CallRecorder({"code": 0, "data": {"items": [], "has_more": False}})
    user_call = _CallRecorder({"code": 0, "data": {"items": [], "has_more": False}})
    create_call = _CallRecorder({"code": 0, "data": {"message_id": "om_sanitized"}})
    patch_call = _CallRecorder({"code": 0, "data": {}})
    client = SimpleNamespace(
        tenant=SimpleNamespace(v2=SimpleNamespace(tenant=SimpleNamespace(query=tenant_call))),
        contact=SimpleNamespace(
            v3=SimpleNamespace(
                scope=SimpleNamespace(list=scope_call),
                department=SimpleNamespace(children=department_call),
                user=SimpleNamespace(find_by_department=user_call),
            )
        ),
        im=SimpleNamespace(v1=SimpleNamespace(message=SimpleNamespace(create=create_call, patch=patch_call))),
    )
    monkeypatch.setattr(adapter_module.lark.Client, "builder", lambda: _ClientBuilder(client))

    gateway = adapter_module._create_sdk_gateway(_credentials(), "https://open.feishu.cn")
    department = adapter_module._DepartmentIdentity("dept_sanitized", "department_id")

    assert gateway.query_tenant()["code"] == 0
    assert gateway.list_scope("scope-next")["code"] == 0
    assert gateway.list_departments(department, "departments-next")["code"] == 0
    assert gateway.list_users(department, "users-next")["code"] == 0
    assert gateway.create_message("union_sanitized", "text", '{"text":"hello"}')["code"] == 0
    assert gateway.patch_message("om_sanitized", '{"schema":"2.0"}')["code"] == 0
    assert len(tenant_call.requests) == len(scope_call.requests) == len(department_call.requests) == 1
    assert len(user_call.requests) == len(create_call.requests) == len(patch_call.requests) == 1
    assert department_call.requests[0].paths["department_id"] == "dept_sanitized"
    assert ("page_token", "scope-next") in scope_call.requests[0].queries


def test_official_gateway_rejects_an_incomplete_sdk_client(monkeypatch: pytest.MonkeyPatch) -> None:
    client = SimpleNamespace(tenant=None, contact=object(), im=object())
    monkeypatch.setattr(adapter_module.lark.Client, "builder", lambda: _ClientBuilder(client))

    with pytest.raises(RuntimeError, match="required services"):
        adapter_module._OfficialSDKGateway(_credentials(), "https://open.feishu.cn")


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("# Heading\n\n- First\n- Second", "Heading\nFirst\nSecond"),
        ("[Dify](https://dify.ai) and `code`", "Dify (https://dify.ai) and code"),
        ("![logo](https://example.invalid/logo.png)  \nNext", "logo\nNext"),
        ("```python\nprint('sanitized')\n```", "print('sanitized')"),
    ],
)
def test_commonmark_plain_text_preserves_visible_content(body: str, expected: str) -> None:
    assert adapter_module._commonmark_plain_text(body) == expected


@pytest.mark.parametrize(
    ("create_time", "expected"),
    [
        ("1704067200123456", datetime(2024, 1, 1, 0, 0, 0, 123456)),
        ("1704067200123", datetime(2024, 1, 1, 0, 0, 0, 123000)),
        ("not-a-timestamp", None),
        ("9" * 64, None),
    ],
)
def test_webhook_occurred_at_supports_provider_microseconds_and_legacy_milliseconds(
    create_time: str,
    expected: datetime | None,
) -> None:
    assert adapter_module._webhook_occurred_at(create_time) == expected


def test_webhook_and_sdk_mapping_helpers_reject_malformed_boundaries(monkeypatch: pytest.MonkeyPatch) -> None:
    received_at = datetime(2026, 8, 6, 10, tzinfo=UTC)
    invalid_timestamp = WebhookRequest(
        "POST",
        (
            ("X-Lark-Request-Timestamp", "not-a-timestamp"),
            ("X-Lark-Request-Nonce", "sanitized-nonce"),
            ("X-Lark-Signature", "0" * 64),
        ),
        b"{}",
        received_at,
    )
    assert adapter_module._valid_webhook_signature(invalid_timestamp, "sanitized-encrypt-key") is None
    assert adapter_module._webhook_occurred_at(None) is None
    with pytest.raises(ValueError, match="invalid encrypted"):
        adapter_module._decrypt_webhook_payload(base64.b64encode(b"too-short").decode(), "sanitized-key")
    with pytest.raises(ValueError, match="JSON object"):
        adapter_module._decode_json_object(b"[]")

    monkeypatch.setattr(adapter_module.lark.JSON, "marshal", lambda _value: None)
    with pytest.raises(ValueError, match="response is empty"):
        adapter_module._sdk_response_mapping(object())
    with pytest.raises(ValueError, match="event is empty"):
        adapter_module._sdk_event_mapping(object())


def test_signature_accepts_timezone_aware_received_at() -> None:
    received_at = datetime(2026, 8, 6, 10, tzinfo=UTC)
    timestamp = str(int(received_at.timestamp()))
    nonce = "sanitized-nonce"
    body = b'{"sanitized":true}'
    encrypt_key = "sanitized-encrypt-key"
    signature = hashlib.sha256(timestamp.encode() + nonce.encode() + encrypt_key.encode() + body).hexdigest()
    request = WebhookRequest(
        "POST",
        (
            ("X-Lark-Request-Timestamp", timestamp),
            ("X-Lark-Request-Nonce", nonce),
            ("X-Lark-Signature", signature),
        ),
        body,
        received_at,
    )

    assert (
        adapter_module._valid_webhook_signature(request, encrypt_key)
        == hashlib.sha256(timestamp.encode() + nonce.encode() + encrypt_key.encode() + body).digest()
    )


@pytest.mark.parametrize(
    "intent",
    [
        _intent(blocks=(), actions=()),
        _intent(blocks=(MarkdownText(""),)),
        _intent(blocks=(SelectInput("decision", ("Approve", ""), "Approve"),)),
        _intent(blocks=(SelectInput("decision", ("Approve", "Approve"), "Approve"),)),
        _intent(
            blocks=(
                ParagraphInput("duplicate", None),
                ParagraphInput("duplicate", None),
            )
        ),
        _intent(actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.GHOST),)),
    ],
)
def test_card_assessment_rejects_every_lossy_shape(intent: ResolvedForm) -> None:
    assert adapter_module._MSFeishuLarkCardCodec().assess(intent).representable is False


def test_headerless_resolved_paragraph_renders_without_default() -> None:
    intent = _intent(blocks=(ParagraphInput("comment", None),))
    card = adapter_module._MSFeishuLarkCardCodec().encode(intent, CorrelationToken("opaque-correlation-token"))
    assert "header" not in card
    body = card["body"]
    assert isinstance(body, dict)
    body_elements = body["elements"]
    assert isinstance(body_elements, list)
    form = body_elements[0]
    assert isinstance(form, dict)
    form_elements = form["elements"]
    assert isinstance(form_elements, list)
    paragraph = form_elements[0]
    assert isinstance(paragraph, dict)
    assert "default_value" not in paragraph


def test_wrong_wrapper_credentials_and_invalid_reference_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(adapter_module, "_create_sdk_gateway", lambda _credentials, _domain: object())
    feishu = _credentials()
    lark = LarkIMIntegrationCredentials(
        provider=IMProvider.LARK,
        app_id=feishu.app_id,
        app_secret=feishu.app_secret,
        verification_token=feishu.verification_token,
        encrypt_key=feishu.encrypt_key,
    )
    with pytest.raises(TypeError, match="Feishu adapter"):
        FeishuIMProviderAdapter(cast(FeishuIMIntegrationCredentials, lark))
    with pytest.raises(TypeError, match="Lark adapter"):
        LarkIMProviderAdapter(cast(LarkIMIntegrationCredentials, feishu))

    class ForeignReference(MessageReference):
        pass

    assert adapter_module._decode_reference(ForeignReference(), "sanitized-app-secret") is None


def test_sdk_mapping_rejects_non_object_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(adapter_module.lark.JSON, "marshal", lambda _value: json.dumps(["not", "an", "object"]))
    with pytest.raises(ValueError, match="response is not"):
        adapter_module._sdk_response_mapping(object())
    with pytest.raises(ValueError, match="event is not"):
        adapter_module._sdk_event_mapping(object())
