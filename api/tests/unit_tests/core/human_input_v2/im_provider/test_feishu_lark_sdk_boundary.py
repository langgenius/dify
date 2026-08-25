from __future__ import annotations

import asyncio
import base64
import hashlib
import inspect
import json
import threading
from collections.abc import Callable, Generator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
from urllib.parse import parse_qs, urlsplit

import pytest
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from controllers.console.human_input_v2.providers import (
    FeishuCredentials as FeishuCredentialRequest,
)
from controllers.console.human_input_v2.providers import LarkCredentials as LarkCredentialRequest
from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ParagraphInput, ResolvedForm, ResolvedFormAction
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import feishu_lark as adapter_module
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    FeishuIMProviderAdapter,
    LarkIMIntegrationCredentials,
    LarkIMProviderAdapter,
    _FeishuLarkDirectory,
    _OfficialSDKGateway,
    _SynchronousEventChannel,
)
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    DynamicCardMessagingError,
    EventAcceptance,
    IMEventIngressKind,
    IMStreamStartError,
    IMStreamStopError,
    MessageAccepted,
    MessageSendingError,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    StaticCardIntent,
    WebhookRequest,
)


@dataclass(slots=True)
class _RequestRecord:
    method: str
    path: str
    body: dict[str, object] | None


@dataclass(slots=True)
class _ServerState:
    requests: list[_RequestRecord] = field(default_factory=list)
    paginated_scope: bool = False
    paginated_directory: bool = False
    live_readiness_directory: bool = False
    omitted_empty_directory: bool = False


class _SDKHTTPServer(ThreadingHTTPServer):
    state: _ServerState


def _provider_confirmed_card_content() -> dict[str, object]:
    return dict(
        adapter_module._MSFeishuLarkCardCodec().encode(
            _intent(),
            CorrelationToken("opaque-correlation-token"),
        )
    )


def _is_provider_confirmed_card_request(request_body: dict[str, object] | None) -> bool:
    if request_body is None or request_body.get("msg_type") != "interactive":
        return False
    content = request_body.get("content")
    if not isinstance(content, str):
        return False
    try:
        decoded_content = json.loads(content)
    except json.JSONDecodeError:
        return False
    return decoded_content == _provider_confirmed_card_content()


class _SDKRequestHandler(BaseHTTPRequestHandler):
    server: _SDKHTTPServer

    def do_GET(self) -> None:
        self._handle()

    def do_POST(self) -> None:
        self._handle()

    def do_PATCH(self) -> None:
        self._handle()

    def log_message(self, format: str, *args: object) -> None:
        del format, args

    def _handle(self) -> None:
        body = self._body()
        self.server.state.requests.append(
            _RequestRecord(
                method=self.command,
                path=self.path,
                body=body,
            )
        )
        route = self.path.split("?", maxsplit=1)[0]
        if route == "/open-apis/auth/v3/tenant_access_token/internal":
            self._respond(
                {
                    "code": 0,
                    "msg": "ok",
                    "tenant_access_token": "t-sanitized-access-token",
                    "expire": 7200,
                }
            )
            return
        if route == "/open-apis/tenant/v2/tenant/query":
            self._respond({"code": 0, "msg": "ok", "data": {"tenant": {"tenant_key": "tenant_sanitized"}}})
            return
        if route == "/open-apis/contact/v3/scopes":
            if self.server.state.paginated_directory:
                self._respond(
                    {
                        "code": 0,
                        "msg": "ok",
                        "data": {
                            "department_ids": ["dept_root"],
                            "user_ids": ["union_scope_direct"],
                            "has_more": False,
                        },
                    }
                )
                return
            if self.server.state.paginated_scope:
                if "page_token=scope-next" in self.path:
                    self._respond(
                        {
                            "code": 0,
                            "msg": "ok",
                            "data": {
                                "department_ids": [],
                                "user_ids": ["union_scope_second"],
                                "has_more": False,
                            },
                        }
                    )
                    return
                self._respond(
                    {
                        "code": 0,
                        "msg": "ok",
                        "data": {
                            "department_ids": [],
                            "user_ids": ["union_scope_first"],
                            "has_more": True,
                            "page_token": "scope-next",
                        },
                    }
                )
                return
            self._respond(
                {
                    "code": 0,
                    "msg": "ok",
                    "data": {"department_ids": ["0"], "user_ids": [], "has_more": False},
                }
            )
            return
        if route == "/open-apis/contact/v3/departments/0/children":
            if self.server.state.omitted_empty_directory:
                self._respond({"code": 0, "msg": "ok", "data": {"has_more": False}})
                return
            if self.server.state.live_readiness_directory:
                self._respond(
                    {
                        "code": 0,
                        "msg": "ok",
                        "data": {"items": [{"open_department_id": "open_dept_child"}], "has_more": False},
                    }
                )
                return
            items = [{"department_id": "dept_root"}] if self.server.state.paginated_directory else []
            self._respond({"code": 0, "msg": "ok", "data": {"items": items, "has_more": False}})
            return
        if route == "/open-apis/contact/v3/departments/dept_sanitized/children":
            self._respond({"code": 0, "msg": "ok", "data": {"items": [], "has_more": False}})
            return
        if route == "/open-apis/contact/v3/departments/dept_root/children":
            if "page_token=departments-next" in self.path:
                self._respond({"code": 0, "msg": "ok", "data": {"items": [], "has_more": False}})
                return
            self._respond(
                {
                    "code": 0,
                    "msg": "ok",
                    "data": {
                        "items": [{"department_id": "dept_child"}],
                        "has_more": True,
                        "page_token": "departments-next",
                    },
                }
            )
            return
        if route == "/open-apis/contact/v3/departments/dept_child/children":
            self._respond({"code": 0, "msg": "ok", "data": {"items": [], "has_more": False}})
            return
        if route == "/open-apis/contact/v3/departments/open_dept_child/children":
            self._respond({"code": 0, "msg": "ok", "data": {"has_more": False}})
            return
        if route == "/open-apis/contact/v3/users/find_by_department":
            query = parse_qs(urlsplit(self.path).query)
            if self.server.state.omitted_empty_directory:
                self._respond({"code": 0, "msg": "ok", "data": {"has_more": False}})
                return
            if self.server.state.live_readiness_directory:
                department_id = query.get("department_id", [""])[0]
                if department_id == "0":
                    self._respond(
                        {
                            "code": 0,
                            "msg": "ok",
                            "data": {
                                "items": [
                                    {
                                        "union_id": "union_first",
                                        "name": "First Observation",
                                        "enterprise_email": "first@example.invalid",
                                    },
                                    {"union_id": "union_withheld"},
                                ],
                                "has_more": False,
                            },
                        }
                    )
                    return
                if department_id == "open_dept_child":
                    self._respond(
                        {
                            "code": 0,
                            "msg": "ok",
                            "data": {
                                "items": [
                                    {
                                        "union_id": "union_first",
                                        "name": "Later Observation",
                                        "email": "later@example.invalid",
                                    },
                                    {
                                        "union_id": "union_child",
                                        "name": "Child User",
                                        "email": "child@example.invalid",
                                    },
                                ],
                                "has_more": False,
                            },
                        }
                    )
                    return
            if self.server.state.paginated_directory:
                department_id = query.get("department_id", [""])[0]
                if department_id == "dept_root" and query.get("page_token") == ["users-next"]:
                    self._respond(
                        {
                            "code": 0,
                            "msg": "ok",
                            "data": {
                                "items": [{"union_id": "union_root_second"}],
                                "has_more": False,
                            },
                        }
                    )
                    return
                if department_id == "dept_root":
                    self._respond(
                        {
                            "code": 0,
                            "msg": "ok",
                            "data": {
                                "items": [
                                    {
                                        "union_id": "union_root_first",
                                        "name": "Root User",
                                        "enterprise_email": "root@example.invalid",
                                    }
                                ],
                                "has_more": True,
                                "page_token": "users-next",
                            },
                        }
                    )
                    return
                if department_id == "dept_child":
                    self._respond(
                        {
                            "code": 0,
                            "msg": "ok",
                            "data": {
                                "items": [{"union_id": "union_child", "name": "Child User"}],
                                "has_more": False,
                            },
                        }
                    )
                    return
            self._respond(
                {
                    "code": 0,
                    "msg": "ok",
                    "data": {
                        "items": [
                            {
                                "union_id": "union_sanitized_user",
                                "name": "Sanitized User",
                                "email": "user@example.invalid",
                            }
                        ],
                        "has_more": False,
                    },
                }
            )
            return
        if route == "/open-apis/im/v1/messages" and self.command == "POST":
            if (
                body is not None
                and body.get("msg_type") == "interactive"
                and not _is_provider_confirmed_card_request(body)
            ):
                self._respond({"code": 230001, "msg": "sanitized card contract rejection"})
                return
            self._respond({"code": 0, "msg": "ok", "data": {"message_id": "om_sanitized_message"}})
            return
        if route == "/open-apis/im/v1/messages/om_sanitized_message" and self.command == "PATCH":
            self._respond({"code": 0, "msg": "ok", "data": {}})
            return
        self._respond({"code": 404, "msg": "not found"}, status=404)

    def _body(self) -> dict[str, object] | None:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length == 0:
            return None
        decoded = json.loads(self.rfile.read(content_length))
        assert isinstance(decoded, dict)
        return decoded

    def _respond(self, body: dict[str, object], *, status: int = 200) -> None:
        encoded = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


@dataclass(frozen=True, slots=True)
class _RunningServer:
    domain: str
    state: _ServerState


def _credentials() -> FeishuIMIntegrationCredentials:
    return FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_sanitized_app",
        app_secret="sanitized-app-secret",
        verification_token=None,
        encrypt_key=None,
    )


def _secure_credentials() -> FeishuIMIntegrationCredentials:
    return FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_sanitized_app",
        app_secret="sanitized-app-secret",
        verification_token="sanitized-verification-token",
        encrypt_key="sanitized-encrypt-key",
    )


def _intent() -> ResolvedForm:
    return ResolvedForm(
        title="Approval",
        blocks=(MarkdownText("Rendered **content**"), ParagraphInput("comment", "Initial")),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="This value must not be rendered",
    )


class _Consumer:
    def __init__(self, acceptance: EventAcceptance = EventAcceptance.ACCEPTED) -> None:
        self.acceptance = acceptance
        self.events: list[AuthenticatedIMEvent] = []

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        self.events.append(event)
        return self.acceptance


class _FailingConsumer:
    def accept(self, _event: AuthenticatedIMEvent) -> EventAcceptance:
        raise RuntimeError("sanitized consumer failure")


class _ScriptedGateway:
    def __init__(self) -> None:
        self.tenant: list[Mapping[str, object] | Exception] = []
        self.scope: list[Mapping[str, object] | Exception] = []
        self.departments: list[Mapping[str, object] | Exception] = []
        self.users: list[Mapping[str, object] | Exception] = []
        self.creates: list[Mapping[str, object] | Exception] = []
        self.patches: list[Mapping[str, object] | Exception] = []
        self.calls: list[str] = []

    @staticmethod
    def _next(values: list[Mapping[str, object] | Exception]) -> Mapping[str, object]:
        value = values.pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    def query_tenant(self) -> Mapping[str, object]:
        self.calls.append("tenant")
        return self._next(self.tenant)

    def list_scope(self, _page_token: str | None) -> Mapping[str, object]:
        self.calls.append("scope")
        return self._next(self.scope)

    def list_departments(self, _department_id: str, _page_token: str | None) -> Mapping[str, object]:
        self.calls.append("departments")
        return self._next(self.departments)

    def list_users(self, _department_id: str, _page_token: str | None) -> Mapping[str, object]:
        self.calls.append("users")
        return self._next(self.users)

    def create_message(self, _receive_id: str, _msg_type: str, _content: str) -> Mapping[str, object]:
        self.calls.append("create")
        return self._next(self.creates)

    def patch_message(self, _message_id: str, _content: str) -> Mapping[str, object]:
        self.calls.append("patch")
        return self._next(self.patches)


def _tenant_response(tenant_key: str = "tenant_sanitized") -> Mapping[str, object]:
    return {"code": 0, "data": {"tenant": {"tenant_key": tenant_key}}}


def _page(items: list[Mapping[str, object]]) -> Mapping[str, object]:
    return {"code": 0, "data": {"items": items, "has_more": False}}


def _scripted_adapter(monkeypatch: pytest.MonkeyPatch, gateway: _ScriptedGateway) -> FeishuIMProviderAdapter:
    monkeypatch.setattr(adapter_module, "_create_sdk_gateway", lambda _credentials, _domain: gateway)
    return FeishuIMProviderAdapter(_secure_credentials())


def _event_payload() -> dict[str, object]:
    return {
        "schema": "2.0",
        "header": {
            "event_id": "evt_sanitized_event",
            "event_type": "card.action.trigger",
            "create_time": "1785981600000",
            "tenant_key": "tenant_sanitized",
            "token": "sanitized-verification-token",
        },
        "event": {
            "action": {
                "name": "approve",
                "value": {
                    "action_id": "approve",
                    "correlation_token": "opaque-correlation-token",
                },
            }
        },
    }


def _sdk_transport_envelope(event: Mapping[str, object]) -> adapter_module._SDKEventEnvelope:
    header = event.get("header")
    assert isinstance(header, Mapping)
    tenant_key = header.get("tenant_key")
    event_id = header.get("event_id")
    event_type = header.get("event_type")
    create_time = header.get("create_time")
    assert isinstance(tenant_key, str)
    return adapter_module._SDKEventEnvelope(
        native_payload=json.dumps(event, ensure_ascii=False, separators=(",", ":")),
        provider_tenant_id=tenant_key,
        event_id=event_id if isinstance(event_id, str) else None,
        event_type=event_type if isinstance(event_type, str) else None,
        occurred_at=adapter_module._webhook_occurred_at(create_time if isinstance(create_time, str) else None),
    )


def _encrypt(plaintext: bytes, encrypt_key: str = "sanitized-encrypt-key") -> str:
    key = hashlib.sha256(encrypt_key.encode()).digest()
    iv = bytes(range(16))
    padder = padding.PKCS7(algorithms.AES.block_size).padder()
    padded = padder.update(plaintext) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    return base64.b64encode(iv + encryptor.update(padded) + encryptor.finalize()).decode()


def _signed_request(
    body: bytes,
    *,
    nonce: str = "sanitized-nonce",
    timestamp: str | None = None,
) -> WebhookRequest:
    received_at = datetime(2026, 8, 6, 10, tzinfo=UTC)
    signed_timestamp = timestamp or str(int(received_at.timestamp()))
    signature = hashlib.sha256(signed_timestamp.encode() + nonce.encode() + b"sanitized-encrypt-key" + body).hexdigest()
    return WebhookRequest(
        "POST",
        (
            ("X-Lark-Request-Timestamp", signed_timestamp),
            ("X-Lark-Request-Nonce", nonce),
            ("X-Lark-Signature", signature),
        ),
        body,
        received_at,
    )


@pytest.fixture
def sdk_server() -> Generator[_RunningServer, None, None]:
    state = _ServerState()
    server = _SDKHTTPServer(("127.0.0.1", 0), _SDKRequestHandler)
    server.state = state
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield _RunningServer(f"http://{host}:{port}", state)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_official_sdk_gateway_maps_tenant_directory_and_message_operations(sdk_server: _RunningServer) -> None:
    gateway = _OfficialSDKGateway(_credentials(), sdk_server.domain)

    tenant_response = gateway.query_tenant()
    scope_response = gateway.list_scope(None)
    root_department = adapter_module._DepartmentIdentity("0", "department_id")
    department_response = gateway.list_departments(root_department, None)
    user_response = gateway.list_users(root_department, None)
    create_response = gateway.create_message(
        "union_sanitized_user",
        "text",
        '{"text":"Rendered **CommonMark**"}',
    )
    patch_response = gateway.patch_message(
        "om_sanitized_message",
        '{"schema":"2.0","body":{"elements":[]}}',
    )

    assert tenant_response["data"] == {"tenant": {"tenant_key": "tenant_sanitized"}}
    assert scope_response["code"] == department_response["code"] == user_response["code"] == 0
    assert create_response["data"] == {"message_id": "om_sanitized_message"}
    assert patch_response["code"] == 0
    operation_requests = [
        request
        for request in sdk_server.state.requests
        if request.path != "/open-apis/auth/v3/tenant_access_token/internal"
    ]
    scope_request = next(request for request in operation_requests if "/contact/v3/scopes" in request.path)
    assert "department_id_type=department_id" in scope_request.path
    assert "user_id_type=union_id" in scope_request.path
    assert "page_size=50" in scope_request.path
    department_request = next(request for request in operation_requests if "/departments/0/children" in request.path)
    assert "department_id_type=department_id" in department_request.path
    assert "user_id_type=union_id" in department_request.path
    department_query = parse_qs(urlsplit(department_request.path).query)
    assert department_query["fetch_child"][0].casefold() == "false"
    user_request = next(request for request in operation_requests if "find_by_department" in request.path)
    assert "department_id=0" in user_request.path
    assert "department_id_type=department_id" in user_request.path
    assert "user_id_type=union_id" in user_request.path
    message_request = next(
        request for request in operation_requests if request.path.startswith("/open-apis/im/v1/messages?")
    )
    assert "receive_id_type=union_id" in message_request.path
    assert message_request.body == {
        "receive_id": "union_sanitized_user",
        "msg_type": "text",
        "content": '{"text":"Rendered **CommonMark**"}',
    }


def test_official_sdk_gateway_preserves_provider_string_department_ids(sdk_server: _RunningServer) -> None:
    gateway = _OfficialSDKGateway(_credentials(), sdk_server.domain)

    response = gateway.list_departments(
        adapter_module._DepartmentIdentity("dept_sanitized", "department_id"),
        None,
    )

    assert response["code"] == 0
    assert any(
        request.path.startswith("/open-apis/contact/v3/departments/dept_sanitized/children?")
        for request in sdk_server.state.requests
    )


def test_credentials_read_every_scope_page_before_root_permission_proof(
    monkeypatch: pytest.MonkeyPatch,
    sdk_server: _RunningServer,
) -> None:
    sdk_server.state.paginated_scope = True
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_gateway",
        lambda credentials, _domain: _OfficialSDKGateway(credentials, sdk_server.domain),
    )
    adapter = FeishuIMProviderAdapter(_credentials())

    result = adapter.test_credentials()

    assert result == CredentialTestSuccess(IMProvider.FEISHU, "tenant_sanitized")
    operation_requests = [
        request
        for request in sdk_server.state.requests
        if request.path != "/open-apis/auth/v3/tenant_access_token/internal"
    ]
    scope_requests = [request for request in operation_requests if "/contact/v3/scopes" in request.path]
    assert len(scope_requests) == 2
    assert "page_token=scope-next" in scope_requests[1].path
    root_proof_requests = [request for request in operation_requests if "/departments/0/children" in request.path]
    assert len(root_proof_requests) == 1
    assert operation_requests.index(root_proof_requests[0]) > operation_requests.index(scope_requests[1])


def test_directory_starts_at_root_without_reading_scope(sdk_server: _RunningServer) -> None:
    directory = _FeishuLarkDirectory(_OfficialSDKGateway(_credentials(), sdk_server.domain), IMProvider.FEISHU)

    result = directory.read_directory()

    assert result == Directory(
        (
            DirectoryEntry(
                ProviderUserId("union_sanitized_user"),
                "Sanitized User",
                "user@example.invalid",
            ),
        )
    )
    operation_requests = [
        request
        for request in sdk_server.state.requests
        if request.path != "/open-apis/auth/v3/tenant_access_token/internal"
    ]
    assert not any("/contact/v3/scopes" in request.path for request in operation_requests)
    assert "department_id=0" in operation_requests[0].path
    assert "/departments/0/children" in operation_requests[1].path


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_live_readiness_minimal_shapes_preserve_official_sdk_department_identity(
    monkeypatch: pytest.MonkeyPatch,
    sdk_server: _RunningServer,
    provider: IMProvider,
) -> None:
    sdk_server.state.live_readiness_directory = True
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_gateway",
        lambda credentials, _domain: _OfficialSDKGateway(credentials, sdk_server.domain),
    )
    if provider is IMProvider.FEISHU:
        adapter = FeishuIMProviderAdapter(_secure_credentials())
    else:
        adapter = LarkIMProviderAdapter(
            LarkIMIntegrationCredentials(
                provider=IMProvider.LARK,
                app_id="cli_sanitized_app",
                app_secret="sanitized-app-secret",
                verification_token="sanitized-verification-token",
                encrypt_key="sanitized-encrypt-key",
            )
        )

    assert adapter.test_credentials() == CredentialTestSuccess(provider, "tenant_sanitized")
    directory_request_start = len(sdk_server.state.requests)

    result = adapter.directory.read_directory()

    assert result == Directory(
        (
            DirectoryEntry(ProviderUserId("union_first"), "First Observation", "first@example.invalid"),
            DirectoryEntry(ProviderUserId("union_withheld"), None, None),
            DirectoryEntry(ProviderUserId("union_child"), "Child User", "child@example.invalid"),
        )
    )
    directory_requests = sdk_server.state.requests[directory_request_start:]
    assert not any("/contact/v3/scopes" in request.path for request in directory_requests)
    assert not any(
        "/contact/v3/users/" in request.path and "find_by_department" not in request.path
        for request in directory_requests
    )
    user_requests = [request for request in directory_requests if "find_by_department" in request.path]
    department_requests = [request for request in directory_requests if "/departments/" in request.path]
    assert [parse_qs(urlsplit(request.path).query)["department_id"] for request in user_requests] == [
        ["0"],
        ["open_dept_child"],
    ]
    assert [parse_qs(urlsplit(request.path).query)["department_id_type"] for request in user_requests] == [
        ["department_id"],
        ["open_department_id"],
    ]
    assert all(parse_qs(urlsplit(request.path).query)["user_id_type"] == ["union_id"] for request in user_requests)
    assert [urlsplit(request.path).path for request in department_requests] == [
        "/open-apis/contact/v3/departments/0/children",
        "/open-apis/contact/v3/departments/open_dept_child/children",
    ]
    assert [parse_qs(urlsplit(request.path).query)["department_id_type"] for request in department_requests] == [
        ["department_id"],
        ["open_department_id"],
    ]


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_official_sdk_directory_accepts_omitted_items_on_empty_terminal_pages(
    monkeypatch: pytest.MonkeyPatch,
    sdk_server: _RunningServer,
    provider: IMProvider,
) -> None:
    sdk_server.state.omitted_empty_directory = True
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_gateway",
        lambda credentials, _domain: _OfficialSDKGateway(credentials, sdk_server.domain),
    )
    if provider is IMProvider.FEISHU:
        adapter = FeishuIMProviderAdapter(_secure_credentials())
    else:
        adapter = LarkIMProviderAdapter(
            LarkIMIntegrationCredentials(
                provider=IMProvider.LARK,
                app_id="cli_sanitized_app",
                app_secret="sanitized-app-secret",
                verification_token="sanitized-verification-token",
                encrypt_key="sanitized-encrypt-key",
            )
        )

    result = adapter.directory.read_directory()

    assert result == Directory(())
    operation_requests = [
        request
        for request in sdk_server.state.requests
        if request.path != "/open-apis/auth/v3/tenant_access_token/internal"
    ]
    assert len([request for request in operation_requests if "find_by_department" in request.path]) == 1
    assert len([request for request in operation_requests if "/departments/0/children" in request.path]) == 1
    assert not any("/contact/v3/scopes" in request.path for request in operation_requests)


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_full_adapter_over_official_http_sdk_preserves_wrapper_parity(
    monkeypatch: pytest.MonkeyPatch,
    sdk_server: _RunningServer,
    provider: IMProvider,
) -> None:
    sdk_server.state.paginated_directory = True
    observed_domains: list[str] = []

    def gateway_factory(credentials, domain: str):
        observed_domains.append(domain)
        return _OfficialSDKGateway(credentials, sdk_server.domain)

    monkeypatch.setattr(adapter_module, "_create_sdk_gateway", gateway_factory)
    if provider is IMProvider.FEISHU:
        credentials = _secure_credentials()
        adapter = FeishuIMProviderAdapter(credentials)
        expected_domain = "https://open.feishu.cn"
    else:
        credentials = LarkIMIntegrationCredentials(
            provider=IMProvider.LARK,
            app_id="cli_sanitized_app",
            app_secret="sanitized-app-secret",
            verification_token="sanitized-verification-token",
            encrypt_key="sanitized-encrypt-key",
        )
        adapter = LarkIMProviderAdapter(credentials)
        expected_domain = "https://open.larksuite.com"

    assert adapter.test_credentials() == CredentialTestSuccess(provider, "tenant_sanitized")
    directory = adapter.directory.read_directory()
    assert isinstance(directory, Directory)
    assert [str(entry.provider_user_id) for entry in directory.entries] == [
        "union_sanitized_user",
        "union_root_first",
        "union_root_second",
        "union_child",
    ]

    text_result = adapter.messaging.send_text(
        ProviderUserId("union_root_first"),
        "Decision: **Approve**",
    )
    assert isinstance(text_result, MessageAccepted)
    card_result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("union_root_first"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(card_result, MessageAccepted)
    assert (
        adapter.dynamic_card_messaging.replace_with_static(
            card_result.locator,
            StaticCardIntent("Submitted **successfully**"),
        )
        is None
    )
    assert observed_domains == [expected_domain]

    operation_requests = [
        request
        for request in sdk_server.state.requests
        if request.path != "/open-apis/auth/v3/tenant_access_token/internal"
    ]
    scope_requests = [request for request in operation_requests if "/contact/v3/scopes" in request.path]
    user_requests = [request for request in operation_requests if "find_by_department" in request.path]
    department_requests = [request for request in operation_requests if "/children" in request.path]
    message_requests = [
        request for request in operation_requests if request.method == "POST" and "/messages?" in request.path
    ]
    patch_requests = [request for request in operation_requests if request.method == "PATCH"]
    assert len(scope_requests) == 1
    assert len(user_requests) == 4
    assert len(department_requests) == 5
    assert not any(
        "/contact/v3/users/" in request.path and "find_by_department" not in request.path
        for request in operation_requests
    )
    assert len(message_requests) == 2
    assert len(patch_requests) == 1
    assert json.loads(message_requests[0].body["content"]) == {"text": "Decision: Approve"}
    assert message_requests[1].body["msg_type"] == "interactive"


def test_controller_projections_feed_typed_adapter_construction(
    monkeypatch: pytest.MonkeyPatch,
    sdk_server: _RunningServer,
) -> None:
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_gateway",
        lambda credentials, _domain: _OfficialSDKGateway(credentials, sdk_server.domain),
    )
    feishu_request = FeishuCredentialRequest(
        provider=IMProvider.FEISHU,
        app_id="cli_sanitized_app",
        app_secret="sanitized-app-secret",
        verification_token="sanitized-new-verification-token",
        encrypt_key=None,
    )
    feishu_resolved = feishu_request.to_owner_credentials()
    assert FeishuIMProviderAdapter(feishu_resolved).test_credentials() == CredentialTestSuccess(
        IMProvider.FEISHU,
        "tenant_sanitized",
    )
    lark_request = LarkCredentialRequest(
        provider=IMProvider.LARK,
        app_id="cli_sanitized_app",
        app_secret="sanitized-app-secret",
        verification_token=None,
        encrypt_key="sanitized-encrypt-key",
    )
    lark_resolved = lark_request.to_owner_credentials()
    assert LarkIMProviderAdapter(lark_resolved).provider is IMProvider.LARK


def test_webhook_crypto_challenge_replay_and_ack_over_official_tenant_boundary(
    monkeypatch: pytest.MonkeyPatch,
    sdk_server: _RunningServer,
) -> None:
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_gateway",
        lambda credentials, _domain: _OfficialSDKGateway(credentials, sdk_server.domain),
    )
    consumer = _Consumer()
    adapter = FeishuIMProviderAdapter(_secure_credentials())
    handler = adapter.create_webhook_handler(consumer)
    plaintext = json.dumps(_event_payload(), separators=(",", ":")).encode()
    encrypted_body = json.dumps({"encrypt": _encrypt(plaintext)}, separators=(",", ":")).encode()
    request = _signed_request(encrypted_body, timestamp="opaque-provider-timestamp")

    response = handler.handle(request)
    replay = handler.handle(request)

    assert response.status_code == 200
    assert replay.status_code == 409
    assert len(consumer.events) == 1
    assert consumer.events[0].ingress_kind is IMEventIngressKind.WEBHOOK
    assert json.loads(consumer.events[0].payload) == json.loads(plaintext)

    challenge_consumer = _Consumer()
    challenge_credentials = FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_sanitized_app",
        app_secret="sanitized-app-secret",
        verification_token="sanitized-verification-token",
        encrypt_key=None,
    )
    challenge_handler = adapter_module._FeishuLarkWebhookHandler(
        _OfficialSDKGateway(challenge_credentials, sdk_server.domain),
        challenge_credentials,
        IMProvider.FEISHU,
        challenge_consumer,
    )
    challenge_body = json.dumps(
        {
            "type": "url_verification",
            "token": "sanitized-verification-token",
            "challenge": "sanitized-challenge",
        },
        separators=(",", ":"),
    ).encode()
    challenge = challenge_handler.handle(WebhookRequest("POST", (), challenge_body, datetime(2026, 8, 6, 10)))
    assert challenge.status_code == 200
    assert challenge.body == b'{"challenge":"sanitized-challenge"}'
    assert challenge_consumer.events == []


def test_socket_dispatcher_wire_ack_and_outer_lifecycle_are_integrated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    trace: list[str] = []
    consumer = _Consumer()
    credentials = _secure_credentials()

    class Writer:
        def __init__(self) -> None:
            self.frames: list[bytes] = []

        async def _write_message(self, data: bytes) -> None:
            trace.append("wire-ack")
            self.frames.append(data)

    class SDKClient:
        def __init__(
            self,
            callback: Callable[[Mapping[str, object], Callable[[], None]], None],
        ) -> None:
            self.channel = _SynchronousEventChannel(
                credentials=credentials,
                domain="https://open.feishu.cn",
                callback=callback,
            )
            self.writer = Writer()
            self.started = False
            self.stopped = False

        def start(self) -> None:
            self.channel._wire_ack_tracking_enabled = True
            self.channel._install_wire_ack_hook(self.writer)
            self.started = True
            trace.append("sdk-ready")

        def emit(self) -> None:
            async def dispatch_and_write() -> None:
                payload = json.dumps(_event_payload(), separators=(",", ":")).encode()
                response = self.channel._build_dispatcher()._do_without_validation(payload)
                assert response is not None
                await self.writer._write_message(b"accepted-ack")

            asyncio.run(dispatch_and_write())

        def stop(self) -> None:
            self.channel.wait_for_pending_wire_acks()
            self.stopped = True
            trace.append("sdk-close")

    clients: list[SDKClient] = []

    def client_factory(_credentials, _domain, callback):
        client = SDKClient(callback)
        clients.append(client)
        return client

    monkeypatch.setattr(adapter_module, "_create_sdk_gateway", lambda _credentials, _domain: object())
    monkeypatch.setattr(adapter_module, "_create_sdk_stream_client", client_factory)
    stream = FeishuIMProviderAdapter(credentials).create_stream_handler(consumer)

    stream.start()
    clients[0].emit()
    stream.stop()

    assert clients[0].started
    assert clients[0].stopped
    assert len(consumer.events) == 1
    assert trace == ["sdk-ready", "wire-ack", "sdk-close"]


@pytest.mark.parametrize(
    ("tenant_result", "scope_result", "expected_kind"),
    [
        (RuntimeError("sanitized transport failure"), None, CredentialTestFailureKind.UNKNOWN),
        ({"code": 99991663}, None, CredentialTestFailureKind.AUTHENTICATION_REJECTED),
        ({"code": 0, "data": {"tenant": {}}}, None, CredentialTestFailureKind.TENANT_ID_UNAVAILABLE),
        (_tenant_response(), RuntimeError("sanitized scope failure"), CredentialTestFailureKind.UNKNOWN),
        (_tenant_response(), {"code": 403}, CredentialTestFailureKind.UNKNOWN),
    ],
)
def test_credential_failures_remain_typed_across_adapter_composition(
    monkeypatch: pytest.MonkeyPatch,
    tenant_result: Mapping[str, object] | Exception,
    scope_result: Mapping[str, object] | Exception | None,
    expected_kind: CredentialTestFailureKind,
) -> None:
    gateway = _ScriptedGateway()
    gateway.tenant.append(tenant_result)
    if scope_result is not None:
        gateway.scope.append(scope_result)
    adapter = _scripted_adapter(monkeypatch, gateway)

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is expected_kind
    assert "sanitized" not in result.reason.casefold()


def test_directory_message_and_card_failures_are_safe_and_single_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory_gateway = _ScriptedGateway()
    directory_gateway.users.append(_page([{"union_id": "union_partial", "name": "Partial User"}]))
    directory_gateway.departments.append(RuntimeError("sanitized later-page failure"))
    directory_result = _scripted_adapter(monkeypatch, directory_gateway).directory.read_directory()
    assert isinstance(directory_result, DirectoryReadFailure)
    assert "union_partial" not in directory_result.reason

    text_gateway = _ScriptedGateway()
    text_gateway.tenant.append(RuntimeError("sanitized tenant failure"))
    text_result = _scripted_adapter(monkeypatch, text_gateway).messaging.send_text(
        ProviderUserId("union_sanitized"),
        "Rendered text",
    )
    assert isinstance(text_result, MessageSendingError)

    rejected_text_gateway = _ScriptedGateway()
    rejected_text_gateway.tenant.append(_tenant_response())
    rejected_text_gateway.creates.append({"code": 230001})
    rejected_text = _scripted_adapter(monkeypatch, rejected_text_gateway).messaging.send_text(
        ProviderUserId("union_sanitized"),
        "Rendered text",
    )
    assert isinstance(rejected_text, MessageSendingError)
    assert rejected_text_gateway.calls.count("create") == 1

    card_gateway = _ScriptedGateway()
    card_gateway.tenant.append(_tenant_response())
    card_gateway.creates.append(RuntimeError("sanitized create failure"))
    card_adapter = _scripted_adapter(monkeypatch, card_gateway)
    card_result = card_adapter.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(card_result, MessageSendingError)

    empty_intent = ResolvedForm(
        title=None,
        blocks=(),
        user_actions=(),
        legacy_form_content="This value must not be rendered",
    )
    assert card_adapter.dynamic_card_messaging.assess(empty_intent).representable is False
    with pytest.raises(DynamicCardMessagingError):
        card_adapter.dynamic_card_messaging.send_card(
            ProviderUserId("union_sanitized"),
            empty_intent,
            CorrelationToken("opaque-correlation-token"),
        )


def test_card_reference_update_failures_preserve_exact_mutation_semantics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_gateway = _ScriptedGateway()
    source_gateway.tenant.append(_tenant_response())
    source_gateway.creates.append({"code": 0, "data": {"message_id": "om_sanitized_message"}})
    source = _scripted_adapter(monkeypatch, source_gateway)
    accepted = source.dynamic_card_messaging.send_card(
        ProviderUserId("union_sanitized"),
        _intent(),
        CorrelationToken("opaque-correlation-token"),
    )
    assert isinstance(accepted, MessageAccepted)

    unknown_tenant_gateway = _ScriptedGateway()
    unknown_tenant_gateway.tenant.append(RuntimeError("sanitized tenant failure"))
    unknown_tenant = _scripted_adapter(monkeypatch, unknown_tenant_gateway).dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )
    assert isinstance(unknown_tenant, ReplacementError)
    assert unknown_tenant.kind is ReplacementErrorKind.UNKNOWN

    cross_tenant_gateway = _ScriptedGateway()
    cross_tenant_gateway.tenant.append(_tenant_response("tenant_other"))
    cross_tenant = _scripted_adapter(monkeypatch, cross_tenant_gateway).dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )
    assert isinstance(cross_tenant, ReplacementError)
    assert cross_tenant.kind is ReplacementErrorKind.UNKNOWN

    patch_failure_gateway = _ScriptedGateway()
    patch_failure_gateway.tenant.append(_tenant_response())
    patch_failure_gateway.patches.append(RuntimeError("sanitized patch failure"))
    patch_failure = _scripted_adapter(monkeypatch, patch_failure_gateway).dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )
    assert isinstance(patch_failure, ReplacementError)
    assert patch_failure.kind is ReplacementErrorKind.UNKNOWN

    stale_gateway = _ScriptedGateway()
    stale_gateway.tenant.append(_tenant_response())
    stale_gateway.patches.append({"code": 230011})
    stale = _scripted_adapter(monkeypatch, stale_gateway).dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )
    assert isinstance(stale, ReplacementError)
    assert stale.kind is ReplacementErrorKind.STALE_REFERENCE

    unknown_gateway = _ScriptedGateway()
    unknown_gateway.tenant.append(_tenant_response())
    unknown_gateway.patches.append({"code": 500})
    unknown = _scripted_adapter(monkeypatch, unknown_gateway).dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )
    assert isinstance(unknown, ReplacementError)
    assert unknown.kind is ReplacementErrorKind.UNKNOWN


def test_webhook_failure_ack_matrix_covers_auth_tenant_and_consumer_boundaries() -> None:
    plaintext_credentials = FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_sanitized_app",
        app_secret="sanitized-app-secret",
        verification_token="sanitized-verification-token",
        encrypt_key=None,
    )

    def handler(gateway: _ScriptedGateway, consumer: _Consumer | _FailingConsumer | None = None):
        return adapter_module._FeishuLarkWebhookHandler(
            gateway,
            plaintext_credentials,
            IMProvider.FEISHU,
            consumer or _Consumer(),
        )

    assert handler(_ScriptedGateway()).handle(WebhookRequest("GET", (), b"{}", datetime.now())).status_code == 405
    assert handler(_ScriptedGateway()).handle(WebhookRequest("POST", (), b"{", datetime.now())).status_code == 401

    invalid_challenge = json.dumps(
        {"type": "url_verification", "token": "sanitized-verification-token"},
        separators=(",", ":"),
    ).encode()
    assert (
        handler(_ScriptedGateway()).handle(WebhookRequest("POST", (), invalid_challenge, datetime.now())).status_code
        == 400
    )
    wrong_challenge = json.dumps(
        {"type": "url_verification", "token": "wrong", "challenge": "sanitized-challenge"},
        separators=(",", ":"),
    ).encode()
    assert (
        handler(_ScriptedGateway()).handle(WebhookRequest("POST", (), wrong_challenge, datetime.now())).status_code
        == 401
    )
    assert handler(_ScriptedGateway()).handle(WebhookRequest("POST", (), b"{}", datetime.now())).status_code == 400

    wrong_token_body = _event_payload()
    wrong_token_body["header"]["token"] = "wrong"
    assert (
        handler(_ScriptedGateway())
        .handle(
            WebhookRequest(
                "POST",
                (),
                json.dumps(wrong_token_body, separators=(",", ":")).encode(),
                datetime.now(),
            )
        )
        .status_code
        == 401
    )

    tenant_failure = _ScriptedGateway()
    tenant_failure.tenant.append(RuntimeError("sanitized tenant failure"))
    event_body = json.dumps(_event_payload(), separators=(",", ":")).encode()
    assert handler(tenant_failure).handle(WebhookRequest("POST", (), event_body, datetime.now())).status_code == 503

    cross_tenant = _ScriptedGateway()
    cross_tenant.tenant.append(_tenant_response("tenant_other"))
    assert handler(cross_tenant).handle(WebhookRequest("POST", (), event_body, datetime.now())).status_code == 401

    for consumer in (_Consumer(EventAcceptance.NOT_ACCEPTED), _FailingConsumer()):
        gateway = _ScriptedGateway()
        gateway.tenant.append(_tenant_response())
        response = handler(gateway, consumer).handle(WebhookRequest("POST", (), event_body, datetime.now()))
        assert response.status_code == 503


def test_official_stream_client_and_channel_hooks_close_owned_resources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    channels: list[object] = []

    class ReadyChannel:
        def __init__(self, **_kwargs: object) -> None:
            self.stop_calls = 0
            channels.append(self)

        async def connect_until_ready(self, *, timeout: float) -> None:
            assert timeout > 0

        def wait_for_pending_wire_acks(self) -> None:
            return

        def stop(self) -> None:
            self.stop_calls += 1

    monkeypatch.setattr(adapter_module, "_SynchronousEventChannel", ReadyChannel)
    client = adapter_module._OfficialSDKStreamClient(
        _secure_credentials(),
        "https://open.feishu.cn",
        lambda _event, _ack: None,
    )
    client.start()
    client.stop()
    client.stop()
    assert channels[0].stop_calls == 1
    assert client._loop.is_closed()
    assert client._loop_thread is not None
    assert not client._loop_thread.is_alive()

    stopped_before_start = adapter_module._OfficialSDKStreamClient(
        _secure_credentials(),
        "https://open.feishu.cn",
        lambda _event, _ack: None,
    )
    stopped_before_start.stop()
    assert stopped_before_start._loop.is_closed()


def test_official_stream_client_releases_loop_when_sdk_close_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingCloseChannel:
        def __init__(self, **_kwargs: object) -> None:
            return

        async def connect_until_ready(self, *, timeout: float) -> None:
            assert timeout > 0

        def wait_for_pending_wire_acks(self) -> None:
            return

        def stop(self) -> None:
            raise RuntimeError("sanitized SDK close failure")

    monkeypatch.setattr(adapter_module, "_SynchronousEventChannel", FailingCloseChannel)
    client = adapter_module._OfficialSDKStreamClient(
        _secure_credentials(),
        "https://open.feishu.cn",
        lambda _event, _ack: None,
    )
    client.start()

    with pytest.raises(RuntimeError, match="sanitized SDK close failure"):
        client.stop()

    assert client._loop.is_closed()
    assert client._loop_thread is not None
    assert not client._loop_thread.is_alive()


def test_official_stream_private_seam_matches_exact_lark_oapi_1_7_2() -> None:
    from lark_oapi.ws import client as sdk_ws_client_module

    assert version("lark-oapi") == "1.7.2"
    assert tuple(inspect.signature(sdk_ws_client_module.Client.__init__).parameters) == (
        "self",
        "app_id",
        "app_secret",
        "log_level",
        "event_handler",
        "domain",
        "auto_reconnect",
        "source",
        "extra_ua_tags",
        "headers",
        "client_assertion_provider",
    )
    assert tuple(inspect.signature(sdk_ws_client_module.Client.start).parameters) == ("self",)
    assert tuple(inspect.signature(sdk_ws_client_module.Client._connect).parameters) == ("self",)
    assert tuple(inspect.signature(sdk_ws_client_module.Client._receive_message_loop).parameters) == ("self",)
    assert tuple(inspect.signature(sdk_ws_client_module.Client._write_message).parameters) == ("self", "data")
    assert inspect.iscoroutinefunction(sdk_ws_client_module.Client._connect)
    assert inspect.iscoroutinefunction(sdk_ws_client_module.Client._receive_message_loop)
    assert inspect.iscoroutinefunction(sdk_ws_client_module.Client._write_message)
    assert not hasattr(sdk_ws_client_module.Client, "stop")
    assert issubclass(adapter_module._PerClientSDKWSClient, sdk_ws_client_module.Client)
    assert tuple(inspect.signature(adapter_module._PerClientSDKWSClient.stop).parameters) == ("self",)


def test_per_client_sdk_close_failure_releases_its_actual_owned_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from lark_oapi.ws import client as sdk_ws_client_module

    transport_connected = threading.Event()

    class WebSocketConnection:
        async def recv(self) -> bytes:
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

        async def close(self) -> None:
            return

        async def send(self, _data: bytes) -> None:
            return

    async def connect(_url: str, **_kwargs: object) -> WebSocketConnection:
        transport_connected.set()
        return WebSocketConnection()

    monkeypatch.setattr(
        sdk_ws_client_module.Client,
        "_get_conn_url",
        lambda _self: "wss://sanitized.invalid/connect?device_id=device-sanitized&service_id=1",
    )
    monkeypatch.setattr(sdk_ws_client_module.websockets, "connect", connect)
    client = adapter_module._PerClientSDKWSClient(
        credentials=_secure_credentials(),
        domain="https://open.feishu.cn",
        event_handler=object(),
    )
    start_errors: list[Exception] = []

    def start_client() -> None:
        try:
            client.start()
        except Exception as exc:
            start_errors.append(exc)

    start_thread = threading.Thread(target=start_client)
    start_thread.start()
    assert transport_connected.wait(timeout=2)

    async def failing_disconnect() -> None:
        raise RuntimeError("sanitized SDK close failure")

    monkeypatch.setattr(client, "_disconnect", failing_disconnect)
    with pytest.raises(RuntimeError, match="sanitized SDK close failure"):
        client.stop()
    start_thread.join(timeout=2)

    assert not start_thread.is_alive()
    assert start_errors == []
    assert client._dify_loop.is_closed()


def test_official_stream_clients_own_independent_sdk_event_loops(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from lark_oapi.ws import client as sdk_ws_client_module

    class WebSocketConnection:
        def __init__(self) -> None:
            self.closed = asyncio.Event()

        async def recv(self) -> bytes:
            await self.closed.wait()
            raise RuntimeError("sanitized connection closed")

        async def close(self) -> None:
            self.closed.set()

        async def send(self, _data: bytes) -> None:
            return

    transport_loops: dict[str, asyncio.AbstractEventLoop] = {}

    def connection_url(ws_client: object) -> str:
        app_id = ws_client._app_id
        return f"wss://sanitized.invalid/{app_id}?device_id=device-sanitized&service_id=1"

    async def connect(url: str, **_kwargs: object) -> WebSocketConnection:
        app_id = urlsplit(url).path.removeprefix("/")
        transport_loops[app_id] = asyncio.get_running_loop()
        return WebSocketConnection()

    monkeypatch.setattr(adapter_module._SynchronousEventChannel, "_fetch_bot_identity_sync", lambda _self: None)
    monkeypatch.setattr(sdk_ws_client_module.Client, "_get_conn_url", connection_url)
    monkeypatch.setattr(sdk_ws_client_module.websockets, "connect", connect)
    credentials = [
        FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id=f"cli_sanitized_app_{index}",
            app_secret="sanitized-app-secret",
            verification_token="sanitized-verification-token",
            encrypt_key="sanitized-encrypt-key",
        )
        for index in range(2)
    ]
    clients = [
        adapter_module._OfficialSDKStreamClient(
            credential,
            "https://open.feishu.cn",
            lambda _event, _ack: None,
        )
        for credential in credentials
    ]
    start_errors: list[Exception | None] = [None, None]

    def start_client(index: int) -> None:
        try:
            clients[index].start()
        except Exception as exc:
            start_errors[index] = exc

    start_threads = [threading.Thread(target=start_client, args=(index,)) for index in range(2)]
    try:
        for thread in start_threads:
            thread.start()
        for thread in start_threads:
            thread.join(timeout=5)

        assert not any(thread.is_alive() for thread in start_threads)
        assert start_errors == [None, None]
        first_loop = transport_loops[credentials[0].app_id]
        second_loop = transport_loops[credentials[1].app_id]
        assert first_loop is not second_loop

        clients[0].stop()

        async def second_client_probe() -> str:
            return "second-client-running"

        probe = asyncio.run_coroutine_threadsafe(second_client_probe(), second_loop)
        assert probe.result(timeout=1) == "second-client-running"
        assert second_loop.is_running()
    finally:
        for client in clients:
            client.stop()


def test_official_stream_stop_during_start_prevents_late_transport_creation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    initialization_entered = threading.Event()
    release_initialization = threading.Event()
    base_stop_completed = threading.Event()
    created_clients: list[object] = []

    def blocked_identity_fetch(_channel: object) -> None:
        initialization_entered.set()
        assert release_initialization.wait(timeout=2)

    class RecordingClient:
        def __init__(self, **_kwargs: object) -> None:
            self._conn: object | None = None
            created_clients.append(self)

        def start(self) -> None:
            self._conn = object()

        def stop(self) -> None:
            self._conn = None

        async def _write_message(self, _data: bytes) -> None:
            return

    original_base_stop = adapter_module.FeishuChannel.stop

    def observed_base_stop(channel: object, *, join_timeout: float = 5.0) -> None:
        original_base_stop(channel, join_timeout=join_timeout)
        base_stop_completed.set()

    monkeypatch.setattr(adapter_module._SynchronousEventChannel, "_fetch_bot_identity_sync", blocked_identity_fetch)
    monkeypatch.setattr(adapter_module, "_PerClientSDKWSClient", RecordingClient)
    monkeypatch.setattr(adapter_module.FeishuChannel, "stop", observed_base_stop)
    client = adapter_module._OfficialSDKStreamClient(
        _secure_credentials(),
        "https://open.feishu.cn",
        lambda _event, _ack: None,
    )
    start_errors: list[Exception] = []

    def start_client() -> None:
        try:
            client.start()
        except Exception as exc:
            start_errors.append(exc)

    start_thread = threading.Thread(target=start_client)
    stop_thread = threading.Thread(target=client.stop)

    start_thread.start()
    assert initialization_entered.wait(timeout=2)
    stop_thread.start()
    assert base_stop_completed.wait(timeout=2)
    release_initialization.set()
    start_thread.join(timeout=2)
    stop_thread.join(timeout=2)

    assert not start_thread.is_alive()
    assert not stop_thread.is_alive()
    assert created_clients == []
    assert len(start_errors) <= 1


def test_synchronous_channel_installs_write_hook_during_public_ready_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    writes: list[bytes] = []

    class ReadyClient:
        def __init__(self, **_kwargs: object) -> None:
            self._conn: object | None = None
            self.hook_installed = threading.Event()

        def start(self) -> None:
            self._conn = object()
            assert self.hook_installed.wait(timeout=1)

        def stop(self) -> None:
            self._conn = None

        async def _write_message(self, data: bytes) -> None:
            writes.append(data)

    monkeypatch.setattr(adapter_module, "_PerClientSDKWSClient", ReadyClient)
    channel = adapter_module._SynchronousEventChannel(
        credentials=_secure_credentials(),
        domain="https://open.feishu.cn",
        callback=lambda _event, acknowledge: acknowledge(),
    )
    channel._fetch_bot_identity_sync = lambda: None

    original_install = channel._install_wire_ack_hook

    def install_and_release(ws_client: object) -> None:
        original_install(ws_client)
        assert isinstance(ws_client, ReadyClient)
        ws_client.hook_installed.set()

    channel._install_wire_ack_hook = install_and_release

    asyncio.run(channel.connect_until_ready(timeout=1))
    writer = channel._ws_client
    assert isinstance(writer, ReadyClient)
    asyncio.run(writer._write_message(b"control-frame"))
    channel.stop()

    assert channel._wire_ack_hook_installed.is_set()
    assert writes == [b"control-frame"]
    with pytest.raises(RuntimeError, match="write seam"):
        channel._install_wire_ack_hook(object())


@pytest.mark.parametrize(
    "failure_case",
    [
        "user_rejected",
        "user_invalid_pagination",
        "department_rejected",
        "department_invalid_identity",
        "department_invalid_pagination",
    ],
)
def test_directory_rejects_incomplete_or_ambiguous_provider_pages(failure_case: str) -> None:
    gateway = _ScriptedGateway()
    if failure_case == "user_rejected":
        gateway.users.append({"code": 403})
    elif failure_case == "user_invalid_pagination":
        gateway.users.append({"code": 0, "data": {"items": [], "has_more": True, "page_token": ""}})
    else:
        gateway.users.append(_page([]))
        if failure_case == "department_rejected":
            gateway.departments.append({"code": 403})
        elif failure_case == "department_invalid_identity":
            gateway.departments.append(_page([{}]))
        else:
            gateway.departments.append({"code": 0, "data": {"items": [], "has_more": True, "page_token": ""}})

    result = _FeishuLarkDirectory(gateway, IMProvider.FEISHU).read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert result.reason == "Feishu directory could not be read completely."


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
@pytest.mark.parametrize(
    "malformed_boundary",
    [
        "user-non-list-items",
        "user-missing-union-id",
        "department-non-list-items",
        "department-missing-open-id",
    ],
)
def test_directory_rejects_malformed_non_empty_sdk_pages_without_partial_result(
    provider: IMProvider,
    malformed_boundary: str,
) -> None:
    gateway = _ScriptedGateway()
    if malformed_boundary.startswith("user-"):
        malformed_items: object = (
            {"union_id": "union_malformed"}
            if malformed_boundary == "user-non-list-items"
            else [{"name": "Missing Union ID"}]
        )
        gateway.users.extend(
            [
                {
                    "code": 0,
                    "data": {
                        "items": [{"union_id": "union_partial"}],
                        "has_more": True,
                        "page_token": "users-next",
                    },
                },
                {"code": 0, "data": {"items": malformed_items, "has_more": False}},
            ]
        )
        expected_calls = ["users", "users"]
    else:
        malformed_items = (
            {"open_department_id": "open_dept_malformed"}
            if malformed_boundary == "department-non-list-items"
            else [{"open_department_id": ""}]
        )
        gateway.users.append(_page([{"union_id": "union_partial"}]))
        gateway.departments.extend(
            [
                {
                    "code": 0,
                    "data": {
                        "items": [{"open_department_id": "open_dept_pending"}],
                        "has_more": True,
                        "page_token": "departments-next",
                    },
                },
                {"code": 0, "data": {"items": malformed_items, "has_more": False}},
            ]
        )
        expected_calls = ["users", "departments", "departments"]

    result = _FeishuLarkDirectory(gateway, provider).read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert "union_partial" not in result.reason
    assert "malformed" not in result.reason.casefold()
    assert "open_dept_pending" not in result.reason
    assert gateway.calls == expected_calls


def test_directory_deduplicates_users_and_department_cycles_from_root() -> None:
    gateway = _ScriptedGateway()
    gateway.users.append(
        _page(
            [
                {"union_id": "union_sanitized", "name": "Sanitized User", "email": " "},
                {"union_id": "union_sanitized", "name": "Duplicate User"},
            ]
        )
    )
    gateway.departments.append(_page([{"department_id": "0"}, {"department_id": "0"}]))

    result = _FeishuLarkDirectory(gateway, IMProvider.FEISHU).read_directory()

    assert result == Directory((DirectoryEntry(ProviderUserId("union_sanitized"), "Sanitized User", None),))
    assert gateway.calls == ["users", "departments"]


def test_commonmark_conversion_preserves_semantics_over_official_message_boundary(
    monkeypatch: pytest.MonkeyPatch,
    sdk_server: _RunningServer,
) -> None:
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_gateway",
        lambda credentials, _domain: _OfficialSDKGateway(credentials, sdk_server.domain),
    )
    adapter = FeishuIMProviderAdapter(_credentials())

    result = adapter.messaging.send_text(
        ProviderUserId("union_sanitized_user"),
        "# Decision\n\n- **Approve**\n- [Review](https://example.invalid)\n\n"
        "![Diagram](https://image.invalid)\n\n`inline`  \nnext\n\n```text\ncode\n```",
    )

    assert isinstance(result, MessageAccepted)
    message_request = next(
        request
        for request in sdk_server.state.requests
        if request.method == "POST" and "/open-apis/im/v1/messages?" in request.path
    )
    assert json.loads(message_request.body["content"]) == {
        "text": "Decision\nApprove\nReview (https://example.invalid)\nDiagram\ninline\nnext\ncode"
    }


def test_secure_webhook_rejects_auth_crypto_boundaries_and_fails_closed_at_replay_capacity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    encrypted_payload = json.dumps(
        {"encrypt": _encrypt(json.dumps(_event_payload(), separators=(",", ":")).encode())},
        separators=(",", ":"),
    ).encode()
    unauthenticated_handler = adapter_module._FeishuLarkWebhookHandler(
        _ScriptedGateway(),
        _secure_credentials(),
        IMProvider.FEISHU,
        _Consumer(),
    )
    assert (
        unauthenticated_handler.handle(WebhookRequest("POST", (), encrypted_payload, datetime.now())).status_code == 401
    )
    valid_request = _signed_request(encrypted_payload)
    wrong_signature_request = WebhookRequest(
        "POST",
        valid_request.headers[:-1] + (("X-Lark-Signature", "wrong"),),
        encrypted_payload,
        valid_request.received_at,
    )
    assert unauthenticated_handler.handle(wrong_signature_request).status_code == 401

    malformed_encrypted_body = b'{"encrypt":"AA=="}'
    assert unauthenticated_handler.handle(_signed_request(malformed_encrypted_body)).status_code == 401
    plaintext_handler = adapter_module._FeishuLarkWebhookHandler(
        _ScriptedGateway(),
        _credentials(),
        IMProvider.FEISHU,
        _Consumer(),
    )
    assert plaintext_handler.handle(WebhookRequest("POST", (), encrypted_payload, datetime.now())).status_code == 401

    monkeypatch.setattr(adapter_module, "_WEBHOOK_REPLAY_CACHE_CAPACITY", 1)
    gateway = _ScriptedGateway()
    gateway.tenant.extend([_tenant_response(), _tenant_response(), _tenant_response()])
    consumer = _Consumer()
    handler = adapter_module._FeishuLarkWebhookHandler(
        gateway,
        _secure_credentials(),
        IMProvider.FEISHU,
        consumer,
    )

    assert handler.handle(_signed_request(encrypted_payload, nonce="nonce-first")).status_code == 200
    assert handler.handle(_signed_request(encrypted_payload, nonce="nonce-capacity")).status_code == 409
    for replay_identity in handler._replay_claims:
        handler._replay_claims[replay_identity] = 0
    assert handler.handle(_signed_request(encrypted_payload, nonce="nonce-after-expiry")).status_code == 200
    assert len(consumer.events) == 2


def test_stream_failure_stop_and_late_callback_boundaries_are_one_shot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clients: list[LifecycleClient] = []

    class LifecycleClient:
        def __init__(
            self,
            callback: Callable[[Mapping[str, object], Callable[[], None]], None],
            *,
            fail_start: bool,
            fail_stop: bool,
        ) -> None:
            self.callback = callback
            self.fail_start = fail_start
            self.fail_stop = fail_stop
            self.stop_calls = 0

        def start(self) -> None:
            if self.fail_start:
                raise RuntimeError("sanitized start failure")

        def stop(self) -> None:
            self.stop_calls += 1
            if self.fail_stop:
                raise RuntimeError("sanitized stop failure")

        def emit(self, event: Mapping[str, object]) -> int:
            acknowledgements = 0

            def acknowledge() -> None:
                nonlocal acknowledgements
                acknowledgements += 1

            self.callback(_sdk_transport_envelope(event), acknowledge)
            return acknowledgements

    def client_factory(_credentials, _domain, callback):
        client = LifecycleClient(
            callback,
            fail_start=not clients,
            fail_stop=bool(clients),
        )
        clients.append(client)
        return client

    monkeypatch.setattr(adapter_module, "_create_sdk_gateway", lambda _credentials, _domain: _ScriptedGateway())
    monkeypatch.setattr(adapter_module, "_create_sdk_stream_client", client_factory)
    adapter = FeishuIMProviderAdapter(_secure_credentials())

    failed_stream = adapter.create_stream_handler(_Consumer())
    with pytest.raises(IMStreamStartError, match="could not be started"):
        failed_stream.start()
    with pytest.raises(IMStreamStartError, match="already been started"):
        failed_stream.start()
    assert clients[0].stop_calls == 1

    consumer = _Consumer(EventAcceptance.NOT_ACCEPTED)
    running_stream = adapter.create_stream_handler(consumer)
    running_stream.start()
    assert clients[1].emit(_event_payload()) == 0
    with pytest.raises(IMStreamStopError, match="could not be stopped"):
        running_stream.stop()
    with pytest.raises(IMStreamStopError, match="could not be stopped"):
        running_stream.stop()
    assert clients[1].stop_calls == 1
    assert clients[1].emit(_event_payload()) == 0
    assert len(consumer.events) == 1

    stopped_before_start = adapter.create_stream_handler(_Consumer())
    stopped_before_start.stop()
    with pytest.raises(IMStreamStartError, match="already been started"):
        stopped_before_start.start()
    assert len(clients) == 2
