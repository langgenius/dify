from __future__ import annotations

import base64
import hashlib
import inspect
import json
from datetime import UTC, datetime
from typing import cast, get_type_hints, is_protocol

import pytest

from core.human_input import ButtonStyle
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import adapters as adapters_package
from core.human_input_v2.im_integration.adapters import (
    CorrelationToken,
    IMStreamStartError,
    IMStreamStopError,
    MessageLocator,
    WebhookRequest,
)
from core.human_input_v2.im_integration.adapters import feishu_lark as adapter_module
from core.human_input_v2.im_integration.adapters.credentials import FeishuCredentials, LarkCredentials
from core.human_input_v2.im_integration.adapters.entities import IMProviderError
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMProviderAdapter,
    LarkIMProviderAdapter,
)
from core.human_input_v2.resolved_form import (
    FormPart,
    MarkdownFragment,
    ParagraphInput,
    ResolvedForm,
    SelectInput,
    UserAction,
)


def test_stream_factory_returns_private_concrete_type_without_stream_contract_stub() -> None:
    return_type = get_type_hints(adapter_module._FeishuLarkIMProviderAdapter.create_stream_handler)["return"]
    stream_protocols = {
        name
        for name, candidate in vars(adapter_module).items()
        if name.startswith("_") and "Stream" in name and is_protocol(candidate)
    }

    assert return_type is adapter_module._FeishuLarkEventStream
    assert not is_protocol(return_type)
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


def _credentials() -> FeishuCredentials:
    return FeishuCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_sanitized_app",
        app_secret="sanitized-app-secret",
        verification_token="sanitized-verification-token",
        encrypt_key="sanitized-encrypt-key",
    )


def _intent(
    *,
    blocks: tuple[FormPart, ...] = (MarkdownFragment(text="Rendered content"),),
    actions: tuple[UserAction, ...] = (),
    title: str = "",
) -> ResolvedForm:
    return ResolvedForm(
        title=title,
        parts=blocks,
        actions=actions,
        legacy_form_content="This value must not be rendered",
    )


def test_official_gateway_builds_every_sdk_request_with_pagination(monkeypatch: pytest.MonkeyPatch) -> None:
    client = adapter_module.lark.Client.builder().app_id("test-app").app_secret("test-secret").build()
    assert client.tenant is not None
    assert client.contact is not None
    assert client.im is not None
    tenant_requests: list[adapter_module.tenant.v2.QueryTenantRequest] = []

    def tenant_call(
        request: adapter_module.tenant.v2.QueryTenantRequest, option: adapter_module.lark.RequestOption | None = None
    ) -> adapter_module.tenant.v2.QueryTenantResponse:
        del option
        tenant_requests.append(request)
        return adapter_module.tenant.v2.QueryTenantResponse(
            {"code": 0, "data": {"tenant": {"tenant_key": "tenant_sanitized"}}}
        )

    monkeypatch.setattr(client.tenant.v2.tenant, "query", tenant_call)
    scope_requests: list[adapter_module.contact.v3.ListScopeRequest] = []

    def scope_call(
        request: adapter_module.contact.v3.ListScopeRequest, option: adapter_module.lark.RequestOption | None = None
    ) -> adapter_module.contact.v3.ListScopeResponse:
        del option
        scope_requests.append(request)
        return adapter_module.contact.v3.ListScopeResponse(
            {"code": 0, "data": {"department_ids": [], "user_ids": [], "has_more": False}}
        )

    monkeypatch.setattr(client.contact.v3.scope, "list", scope_call)
    department_requests: list[adapter_module.contact.v3.ChildrenDepartmentRequest] = []

    def department_call(
        request: adapter_module.contact.v3.ChildrenDepartmentRequest,
        option: adapter_module.lark.RequestOption | None = None,
    ) -> adapter_module.contact.v3.ChildrenDepartmentResponse:
        del option
        department_requests.append(request)
        return adapter_module.contact.v3.ChildrenDepartmentResponse(
            {"code": 0, "data": {"items": [], "has_more": False}}
        )

    monkeypatch.setattr(client.contact.v3.department, "children", department_call)
    user_requests: list[adapter_module.contact.v3.FindByDepartmentUserRequest] = []

    def user_call(
        request: adapter_module.contact.v3.FindByDepartmentUserRequest,
        option: adapter_module.lark.RequestOption | None = None,
    ) -> adapter_module.contact.v3.FindByDepartmentUserResponse:
        del option
        user_requests.append(request)
        return adapter_module.contact.v3.FindByDepartmentUserResponse(
            {"code": 0, "data": {"items": [], "has_more": False}}
        )

    monkeypatch.setattr(client.contact.v3.user, "find_by_department", user_call)
    create_requests: list[adapter_module.im.v1.CreateMessageRequest] = []

    def create_call(
        request: adapter_module.im.v1.CreateMessageRequest, option: adapter_module.lark.RequestOption | None = None
    ) -> adapter_module.im.v1.CreateMessageResponse:
        del option
        create_requests.append(request)
        return adapter_module.im.v1.CreateMessageResponse({"code": 0, "data": {"message_id": "om_sanitized"}})

    monkeypatch.setattr(client.im.v1.message, "create", create_call)
    patch_requests: list[adapter_module.im.v1.PatchMessageRequest] = []

    def patch_call(
        request: adapter_module.im.v1.PatchMessageRequest, option: adapter_module.lark.RequestOption | None = None
    ) -> adapter_module.im.v1.PatchMessageResponse:
        del option
        patch_requests.append(request)
        return adapter_module.im.v1.PatchMessageResponse({"code": 0, "data": {}})

    monkeypatch.setattr(client.im.v1.message, "patch", patch_call)

    def build_client(_builder: object) -> adapter_module.lark.Client:
        return client

    monkeypatch.setattr(type(adapter_module.lark.Client.builder()), "build", build_client)
    gateway = adapter_module._create_sdk_gateway(_credentials(), "https://open.feishu.cn")
    department = adapter_module._DepartmentIdentity("dept_sanitized", "department_id")

    assert gateway.query_tenant()["code"] == 0
    assert gateway.list_scope("scope-next")["code"] == 0
    assert gateway.list_departments(department, "departments-next")["code"] == 0
    assert gateway.list_users(department, "users-next")["code"] == 0
    assert gateway.create_message("union_sanitized", "text", '{"text":"hello"}')["code"] == 0
    assert gateway.patch_message("om_sanitized", '{"schema":"2.0"}')["code"] == 0
    assert len(tenant_requests) == len(scope_requests) == len(department_requests) == 1
    assert len(user_requests) == len(create_requests) == len(patch_requests) == 1
    assert department_requests[0].paths["department_id"] == "dept_sanitized"
    assert ("page_token", "scope-next") in scope_requests[0].queries


def test_official_gateway_rejects_an_incomplete_sdk_client(monkeypatch: pytest.MonkeyPatch) -> None:
    client = adapter_module.lark.Client()

    def build_client(_builder: object) -> adapter_module.lark.Client:
        return client

    monkeypatch.setattr(type(adapter_module.lark.Client.builder()), "build", build_client)
    with pytest.raises(RuntimeError, match="required services"):
        adapter_module._OfficialSDKGateway(_credentials(), "https://open.feishu.cn")


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
    with pytest.raises(IMProviderError, match="response is empty"):
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
        _intent(blocks=(MarkdownFragment(text=""),)),
        _intent(
            blocks=(SelectInput(output_variable_name="decision", options=("Approve", ""), default_value="Approve"),)
        ),
        _intent(
            blocks=(
                SelectInput(output_variable_name="decision", options=("Approve", "Approve"), default_value="Approve"),
            )
        ),
        _intent(
            blocks=(
                ParagraphInput(output_variable_name="duplicate", default_value=None),
                ParagraphInput(output_variable_name="duplicate", default_value=None),
            )
        ),
        _intent(actions=(UserAction(id="approve", title="Approve", button_style=ButtonStyle.GHOST),)),
    ],
)
def test_card_assessment_rejects_every_lossy_shape(intent: ResolvedForm) -> None:
    assert adapter_module._MSFeishuLarkCardCodec().assess(intent).representable is False


def test_headerless_resolved_paragraph_renders_without_default() -> None:
    intent = _intent(blocks=(ParagraphInput(output_variable_name="comment", default_value=None),))
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
    lark = LarkCredentials(
        provider=IMProvider.LARK,
        app_id=feishu.app_id,
        app_secret=feishu.app_secret,
        verification_token=feishu.verification_token,
        encrypt_key=feishu.encrypt_key,
    )
    with pytest.raises(TypeError, match="Feishu adapter"):
        FeishuIMProviderAdapter(cast(FeishuCredentials, lark))
    with pytest.raises(TypeError, match="Lark adapter"):
        LarkIMProviderAdapter(cast(LarkCredentials, feishu))

    with pytest.raises(ValueError, match="locator must be unpadded URL-safe Base64"):
        adapter_module._FeishuLarkLocatorPayload.decode(str(MessageLocator("invalid.")))


def test_sdk_mapping_rejects_non_object_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(adapter_module.lark.JSON, "marshal", lambda _value: json.dumps(["not", "an", "object"]))
    with pytest.raises(IMProviderError, match="response is not"):
        adapter_module._sdk_response_mapping(object())
    with pytest.raises(ValueError, match="event is not"):
        adapter_module._sdk_event_mapping(object())
