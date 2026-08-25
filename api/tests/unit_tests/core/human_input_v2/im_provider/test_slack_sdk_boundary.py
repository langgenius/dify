"""Slack SDK boundary tests backed by local test doubles rather than Slack."""

from __future__ import annotations

import json
import threading
from collections import defaultdict, deque
from collections.abc import Callable, Generator, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import override
from urllib.parse import parse_qs, urlencode

import pytest
from slack_sdk.errors import SlackClientError
from slack_sdk.signature import SignatureVerifier
from slack_sdk.socket_mode.request import SocketModeRequest
from slack_sdk.web import WebClient

from core.human_input import ButtonStyle
from core.human_input_v2 import (
    FileInput,
    MarkdownText,
    ParagraphInput,
    ResolvedForm,
    ResolvedFormAction,
    ResolvedFormContent,
    SelectInput,
)
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    AuthenticatedIMEvent,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryReadFailure,
    DynamicCardMessagingError,
    EventAcceptance,
    IMStreamStartError,
    IMStreamStopError,
    MessageAccepted,
    MessageLocator,
    MessageSendingError,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    SlackCredentials,
    StaticCardIntent,
    WebhookRequest,
)
from core.human_input_v2.im_integration.adapters import slack as slack_adapter_module
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter

_SIGNING_SECRET = "sanitized-signing-material"
_RECEIVED_AT = datetime(2026, 8, 6, 8)


@dataclass(frozen=True, slots=True)
class _QueuedResponse:
    body: Mapping[str, object]
    status: int = 200
    headers: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class _RecordedRequest:
    api_method: str
    headers: Mapping[str, str]
    body: bytes

    def parameters(self) -> dict[str, object]:
        content_type = self.headers.get("Content-Type", "")
        if content_type.startswith("application/json"):
            decoded = json.loads(self.body)
            assert isinstance(decoded, dict)
            return decoded
        return {
            name: values[0] if len(values) == 1 else values
            for name, values in parse_qs(self.body.decode(), keep_blank_values=True).items()
        }


class _SlackApiState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._responses: defaultdict[str, deque[_QueuedResponse]] = defaultdict(deque)
        self.requests: list[_RecordedRequest] = []

    def enqueue(
        self,
        api_method: str,
        body: Mapping[str, object],
        *,
        status: int = 200,
        headers: tuple[tuple[str, str], ...] = (),
    ) -> None:
        with self._lock:
            self._responses[api_method].append(_QueuedResponse(body, status, headers))

    def respond(self, request: _RecordedRequest) -> _QueuedResponse:
        with self._lock:
            self.requests.append(request)
            responses = self._responses[request.api_method]
            if not responses:
                return _QueuedResponse({"ok": False, "error": "unconfigured_test_response"}, status=500)
            return responses.popleft()

    def requests_for(self, api_method: str) -> list[_RecordedRequest]:
        with self._lock:
            return [request for request in self.requests if request.api_method == api_method]


class _SlackApiHTTPServer(ThreadingHTTPServer):
    state: _SlackApiState


class _SlackApiHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self) -> None:
        assert isinstance(self.server, _SlackApiHTTPServer)
        content_length = int(self.headers.get("Content-Length", "0"))
        request_body = self.rfile.read(content_length)
        api_method = self.path.removeprefix("/api/")
        recorded = _RecordedRequest(api_method, dict(self.headers.items()), request_body)
        response = self.server.state.respond(recorded)
        response_body = json.dumps(response.body, separators=(",", ":")).encode()
        self.send_response(response.status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_body)))
        self.send_header("Connection", "close")
        for name, value in response.headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(response_body)

    @override
    def log_message(self, format: str, *args: object) -> None:
        del format, args


@dataclass(frozen=True, slots=True)
class _SlackApiServer:
    server: _SlackApiHTTPServer
    state: _SlackApiState

    @property
    def base_url(self) -> str:
        address = self.server.server_address
        host = str(address[0])
        port = address[1]
        return f"http://{host}:{port}/api/"


@pytest.fixture
def slack_api_server() -> Generator[_SlackApiServer, None, None]:
    state = _SlackApiState()
    server = _SlackApiHTTPServer(("127.0.0.1", 0), _SlackApiHandler)
    server.state = state
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        yield _SlackApiServer(server, state)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)
        assert not thread.is_alive()


class _RecordingConsumer:
    def __init__(self, acceptance: EventAcceptance = EventAcceptance.ACCEPTED) -> None:
        self.acceptance = acceptance
        self.events: list[AuthenticatedIMEvent] = []

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        self.events.append(event)
        return self.acceptance


def _credentials() -> SlackCredentials:
    return SlackCredentials(
        provider=IMProvider.SLACK,
        client_id="sanitized-client-id",
        client_secret="sanitized-client-secret",
        signing_secret=_SIGNING_SECRET,
        bot_token="xoxb-sanitized-placeholder",
        app_token="xapp-sanitized-placeholder",
    )


def _intent(*, input_type: str = "select") -> ResolvedForm:
    if input_type == "select":
        input_block = SelectInput("decision", ("Approve", "Reject"), "Approve")
    else:
        input_block = ParagraphInput("decision", "Sanitized initial value")
    return ResolvedForm(
        title="Sanitized title",
        blocks=(
            MarkdownText("Sanitized rendered content"),
            input_block,
            MarkdownText("Sanitized trailing content"),
        ),
        user_actions=(
            ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),
            ResolvedFormAction("reject", "Reject", ButtonStyle.ACCENT),
        ),
        legacy_form_content="This value must not be rendered",
    )


def _custom_intent(
    *,
    blocks: tuple[ResolvedFormContent, ...] = (MarkdownText("Sanitized rendered content"),),
    actions: tuple[ResolvedFormAction, ...] | None = None,
    title: str | None = "Sanitized title",
) -> ResolvedForm:
    if actions is None:
        actions = (ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),)
    return ResolvedForm(
        title=title,
        blocks=blocks,
        user_actions=actions,
        legacy_form_content="This value must not be rendered",
    )


def _adapter(monkeypatch: pytest.MonkeyPatch, server: _SlackApiServer) -> tuple[SlackIMProviderAdapter, WebClient]:
    client = WebClient(
        token="xoxb-sanitized-placeholder",
        base_url=server.base_url,
        timeout=2,
        retry_handlers=[],
    )

    def _client_factory(**kwargs: object) -> WebClient:
        del kwargs
        return client

    monkeypatch.setattr(slack_adapter_module, "WebClient", _client_factory)
    return SlackIMProviderAdapter(_credentials()), client


def _signed_request(
    body: bytes,
    *,
    method: str = "POST",
    valid_signature: bool = True,
    content_type: str = "application/json",
) -> WebhookRequest:
    timestamp = str(int(_RECEIVED_AT.replace(tzinfo=UTC).timestamp()))
    signature = SignatureVerifier(_SIGNING_SECRET).generate_signature(timestamp=timestamp, body=body)
    assert signature is not None
    if not valid_signature:
        signature = "v0=invalid"
    return WebhookRequest(
        method=method,
        headers=(
            ("X-Slack-Request-Timestamp", timestamp),
            ("X-Slack-Signature", signature),
            ("Content-Type", content_type),
        ),
        body=body,
        received_at=_RECEIVED_AT,
    )


def test_real_web_client_round_trips_credentials_directory_messages_and_cards(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    state = slack_api_server.state
    state.enqueue(
        "auth.test",
        {"ok": True, "team_id": "sanitized-team"},
        headers=(("X-OAuth-Scopes", "chat:write,users:read,users:read.email"),),
    )
    state.enqueue("apps.connections.open", {"ok": True, "url": "wss://sanitized.invalid/socket"})
    state.enqueue(
        "users.list",
        {
            "ok": True,
            "members": [
                {
                    "id": "sanitized-user-1",
                    "profile": {"display_name_normalized": "First", "email": "first@example.com"},
                },
                {"id": "sanitized-bot", "is_bot": True, "profile": {}},
            ],
            "response_metadata": {"next_cursor": "sanitized-cursor"},
        },
    )
    state.enqueue(
        "users.list",
        {
            "ok": True,
            "members": [{"id": "sanitized-user-2", "profile": {"real_name_normalized": "Second"}}],
            "response_metadata": {"next_cursor": ""},
        },
    )
    state.enqueue("chat.postMessage", {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"})
    state.enqueue("chat.postMessage", {"ok": True, "channel": "sanitized-channel", "ts": "1000.000002"})
    state.enqueue("chat.update", {"ok": True, "channel": "sanitized-channel", "ts": "1000.000002"})
    adapter, client = _adapter(monkeypatch, slack_api_server)
    card_intent = _intent()

    credential_result = adapter.test_credentials()
    directory_result = adapter.directory.read_directory()
    text_result = adapter.messaging.send_text(ProviderUserId("sanitized-user-1"), "Sanitized text")
    card_result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user-2"),
        card_intent,
        CorrelationToken("sanitized-correlation"),
    )
    assert isinstance(card_result, MessageAccepted)
    replacement_result = adapter.dynamic_card_messaging.replace_with_static(
        card_result.locator,
        StaticCardIntent("Sanitized static content"),
    )

    assert isinstance(client, WebClient)
    assert credential_result == CredentialTestSuccess(IMProvider.SLACK, "sanitized-team")
    assert isinstance(directory_result, Directory)
    assert [entry.provider_user_id for entry in directory_result.entries] == [
        "sanitized-user-1",
        "sanitized-user-2",
    ]
    assert isinstance(text_result, MessageAccepted)
    assert replacement_result is None
    assert len(state.requests_for("auth.test")) == 1
    assert state.requests_for("users.list")[1].parameters()["cursor"] == "sanitized-cursor"
    text_parameters = state.requests_for("chat.postMessage")[0].parameters()
    assert text_parameters["channel"] == "sanitized-user-1"
    assert text_parameters["markdown_text"] == "Sanitized text"
    card_parameters = state.requests_for("chat.postMessage")[1].parameters()
    assert set(card_parameters) == {"blocks", "channel"}
    assert card_parameters["channel"] == "sanitized-user-2"
    assert "text" not in card_parameters
    assert "markdown_text" not in card_parameters
    blocks = card_parameters["blocks"]
    if isinstance(blocks, str):
        blocks = json.loads(blocks)
    assert isinstance(blocks, list)
    assert [block["type"] for block in blocks] == ["header", "markdown", "input", "markdown", "actions"]
    update_parameters = state.requests_for("chat.update")[0].parameters()
    assert set(update_parameters) == {"blocks", "channel", "text", "ts"}
    assert update_parameters["channel"] == "sanitized-channel"
    assert update_parameters["ts"] == "1000.000002"
    assert update_parameters["text"] == "Sanitized static content"
    assert update_parameters["blocks"] == []
    assert "markdown_text" not in update_parameters


def test_real_web_client_reuses_card_reference_across_in_process_adapter_instances(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    state = slack_api_server.state
    state.enqueue("chat.postMessage", {"ok": True, "channel": "D0123456789", "ts": "1712345678.123456"})
    state.enqueue("chat.update", {"ok": True, "channel": "D0123456789", "ts": "1712345678.123456"})
    first_adapter, _ = _adapter(monkeypatch, slack_api_server)
    accepted = first_adapter.dynamic_card_messaging.send_card(
        ProviderUserId("U0123456789"),
        _intent(),
        CorrelationToken("sanitized-correlation"),
    )
    assert isinstance(accepted, MessageAccepted)
    first_adapter.close()
    second_adapter, _ = _adapter(monkeypatch, slack_api_server)

    replacement = second_adapter.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Sanitized static content"),
    )

    assert replacement is None
    assert state.requests_for("auth.test") == []
    assert len(state.requests_for("chat.update")) == 1


def test_real_adapter_rejects_foreign_reference_before_http(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    result = adapter.dynamic_card_messaging.replace_with_static(
        MessageLocator("invalid."),
        StaticCardIntent("Sanitized static content"),
    )

    assert isinstance(result, ReplacementError)
    assert result.kind is ReplacementErrorKind.INVALID_REFERENCE

    assert slack_api_server.state.requests == []


def test_real_adapter_rejects_text_reference_without_update(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    state = slack_api_server.state
    state.enqueue("chat.postMessage", {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"})
    state.enqueue("chat.update", {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"})
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    accepted = adapter.messaging.send_text(ProviderUserId("sanitized-user"), "Sanitized text")
    assert isinstance(accepted, MessageAccepted)

    result = adapter.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Sanitized static content"),
    )

    assert result is None
    assert state.requests_for("auth.test") == []
    assert len(state.requests_for("chat.update")) == 1


@pytest.mark.parametrize(
    ("auth_body", "auth_headers", "expected_kind"),
    [
        ({"ok": False, "error": "invalid_auth"}, (), CredentialTestFailureKind.AUTHENTICATION_REJECTED),
        (
            {"ok": True},
            (("X-OAuth-Scopes", "chat:write,users:read,users:read.email"),),
            CredentialTestFailureKind.TENANT_ID_UNAVAILABLE,
        ),
        (
            {"ok": True, "team_id": "sanitized-team"},
            (("X-OAuth-Scopes", "chat:write"),),
            CredentialTestFailureKind.UNKNOWN,
        ),
    ],
    ids=("authentication-rejected", "missing-tenant", "missing-scopes"),
)
def test_real_web_client_credential_failures_are_typed_and_sanitized(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
    auth_body: Mapping[str, object],
    auth_headers: tuple[tuple[str, str], ...],
    expected_kind: CredentialTestFailureKind,
) -> None:
    slack_api_server.state.enqueue("auth.test", auth_body, headers=auth_headers)
    adapter, _ = _adapter(monkeypatch, slack_api_server)

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is expected_kind
    assert "invalid_auth" not in result.reason


@pytest.mark.parametrize(
    ("connection_body", "expected_kind"),
    [
        ({"ok": False, "error": "invalid_auth"}, CredentialTestFailureKind.AUTHENTICATION_REJECTED),
        ({"ok": False, "error": "internal_error"}, CredentialTestFailureKind.UNKNOWN),
        ({"ok": True, "url": ""}, CredentialTestFailureKind.UNKNOWN),
    ],
    ids=("socket-authentication", "socket-provider", "socket-url"),
)
def test_real_web_client_socket_credential_failures_are_typed(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
    connection_body: Mapping[str, object],
    expected_kind: CredentialTestFailureKind,
) -> None:
    slack_api_server.state.enqueue(
        "auth.test",
        {"ok": True, "team_id": "sanitized-team"},
        headers=(("X-OAuth-Scopes", "chat:write,users:read,users:read.email"),),
    )
    slack_api_server.state.enqueue("apps.connections.open", connection_body)
    adapter, _ = _adapter(monkeypatch, slack_api_server)

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is expected_kind


def test_real_web_client_provider_failures_do_not_return_partial_success(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    state = slack_api_server.state
    state.enqueue(
        "users.list",
        {
            "ok": True,
            "members": [{"id": "sanitized-user", "profile": {}}],
            "response_metadata": {"next_cursor": "sanitized-cursor"},
        },
    )
    state.enqueue("users.list", {"ok": False, "error": "ratelimited"})
    state.enqueue(
        "auth.test",
        {"ok": True, "team_id": "sanitized-team"},
        headers=(("X-OAuth-Scopes", "chat:write,users:read,users:read.email"),),
    )
    state.enqueue("chat.postMessage", {"ok": False, "error": "internal_error"})
    state.enqueue("chat.postMessage", {"ok": False, "error": "internal_error"})
    adapter, _ = _adapter(monkeypatch, slack_api_server)

    directory_result = adapter.directory.read_directory()
    message_result = adapter.messaging.send_text(ProviderUserId("sanitized-user"), "Sanitized text")
    card_result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user"),
        _intent(),
        CorrelationToken("sanitized-correlation"),
    )

    assert isinstance(directory_result, DirectoryReadFailure)
    assert not hasattr(directory_result, "entries")
    assert "sanitized-user" not in directory_result.reason
    assert isinstance(message_result, MessageSendingError)
    assert isinstance(card_result, MessageSendingError)
    assert len(state.requests_for("users.list")) == 2
    assert len(state.requests_for("chat.postMessage")) == 2


@pytest.mark.parametrize(
    "response_body",
    [
        {
            "ok": True,
            "members": [{"id": "sanitized-user", "profile": {}}],
        },
        {
            "ok": True,
            "members": [{"id": "sanitized-user", "profile": {}}],
            "response_metadata": "malformed-metadata",
        },
        {
            "ok": True,
            "members": [{"id": "sanitized-user", "profile": {}}],
            "response_metadata": {},
        },
        {
            "ok": True,
            "members": [{"id": "sanitized-user", "profile": {}}],
            "response_metadata": {"next_cursor": None},
        },
        {
            "ok": True,
            "members": [{"id": "sanitized-user", "profile": {}}],
            "response_metadata": {"next_cursor": 1},
        },
    ],
    ids=(
        "missing-metadata",
        "malformed-metadata",
        "missing-cursor",
        "null-cursor",
        "non-string-cursor",
    ),
)
def test_real_web_client_rejects_invalid_directory_pagination_without_partial_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
    response_body: Mapping[str, object],
) -> None:
    slack_api_server.state.enqueue("users.list", response_body)
    adapter, _ = _adapter(monkeypatch, slack_api_server)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert not hasattr(result, "entries")
    assert "sanitized-user" not in result.reason
    assert len(slack_api_server.state.requests_for("users.list")) == 1


@pytest.mark.parametrize(
    "second_page_body",
    [
        {
            "ok": True,
            "members": [{"id": "sanitized-user-2", "profile": {}}],
            "response_metadata": "malformed-metadata",
        },
        {
            "ok": True,
            "members": [{"id": "sanitized-user-2", "profile": {}}],
            "response_metadata": {"next_cursor": "sanitized-cursor"},
        },
    ],
    ids=("malformed-pagination", "repeated-cursor"),
)
def test_real_web_client_later_pagination_failure_discards_accumulated_entries(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
    second_page_body: Mapping[str, object],
) -> None:
    state = slack_api_server.state
    state.enqueue(
        "users.list",
        {
            "ok": True,
            "members": [{"id": "sanitized-user-1", "profile": {}}],
            "response_metadata": {"next_cursor": "sanitized-cursor"},
        },
    )
    state.enqueue("users.list", second_page_body)
    adapter, _ = _adapter(monkeypatch, slack_api_server)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert not hasattr(result, "entries")
    assert "sanitized-user-1" not in result.reason
    assert "sanitized-user-2" not in result.reason
    requests = state.requests_for("users.list")
    assert len(requests) == 2
    assert requests[1].parameters()["cursor"] == "sanitized-cursor"


@pytest.mark.parametrize(
    "intent",
    [
        _custom_intent(blocks=(), actions=(), title=None),
        _custom_intent(blocks=(MarkdownText(""),)),
        _custom_intent(blocks=(MarkdownText("x" * 20_000),)),
        _custom_intent(title="x" * 151),
        _custom_intent(blocks=tuple(ParagraphInput(f"input_{index}", None) for index in range(49))),
        _custom_intent(
            actions=tuple(
                ResolvedFormAction(f"action_{index}", f"Action {index}", ButtonStyle.DEFAULT) for index in range(26)
            )
        ),
        _custom_intent(
            blocks=(
                ParagraphInput("duplicate", None),
                ParagraphInput("duplicate", None),
            )
        ),
        _custom_intent(actions=(ResolvedFormAction("x" * 256, "Action", ButtonStyle.DEFAULT),)),
        _custom_intent(actions=(ResolvedFormAction("action", "Action", ButtonStyle.GHOST),)),
        _custom_intent(blocks=(FileInput("attachment", (), (), ()),)),
        _custom_intent(blocks=(ParagraphInput("x" * 256, None),)),
        _custom_intent(blocks=(ParagraphInput("input", "x" * 3_001),)),
        _custom_intent(blocks=(SelectInput("input", (), None),)),
        _custom_intent(blocks=(SelectInput("input", ("",), None),)),
    ],
    ids=(
        "empty-card",
        "empty-markdown",
        "oversized-markdown",
        "oversized-title",
        "block-count",
        "action-count",
        "duplicate-input",
        "action-identifier",
        "action-style",
        "file-input",
        "input-identifier",
        "paragraph-default",
        "select-count",
        "select-option",
    ),
)
def test_card_assessment_rejects_sdk_representation_boundaries_without_http(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
    intent: ResolvedForm,
) -> None:
    adapter, _ = _adapter(monkeypatch, slack_api_server)

    assessment = adapter.dynamic_card_messaging.assess(intent)

    assert assessment.representable is False
    with pytest.raises(DynamicCardMessagingError):
        adapter.dynamic_card_messaging.send_card(
            ProviderUserId("sanitized-user"),
            intent,
            CorrelationToken("sanitized-correlation"),
        )
    assert slack_api_server.state.requests == []


def test_real_paragraph_resolved_default_survives_sdk_serialization(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    state = slack_api_server.state
    state.enqueue(
        "auth.test",
        {"ok": True, "team_id": "sanitized-team"},
        headers=(("X-OAuth-Scopes", "chat:write,users:read,users:read.email"),),
    )
    state.enqueue("chat.postMessage", {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"})
    intent = _custom_intent(
        blocks=(ParagraphInput("comment", "Sanitized preserved default"),),
        actions=(),
        title=None,
    )
    adapter, _ = _adapter(monkeypatch, slack_api_server)

    assessment = adapter.dynamic_card_messaging.assess(intent)
    result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user"),
        intent,
        CorrelationToken("sanitized-correlation"),
    )

    assert assessment.representable is True
    assert isinstance(result, MessageAccepted)
    blocks = state.requests_for("chat.postMessage")[0].parameters()["blocks"]
    if isinstance(blocks, str):
        blocks = json.loads(blocks)
    assert isinstance(blocks, list)
    input_element = next(block["element"] for block in blocks if block["type"] == "input")
    assert input_element["initial_value"] == "Sanitized preserved default"


def test_real_web_client_renders_optional_card_sections(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    state = slack_api_server.state
    state.enqueue(
        "auth.test",
        {"ok": True, "team_id": "sanitized-team"},
        headers=(("X-OAuth-Scopes", "chat:write,users:read,users:read.email"),),
    )
    state.enqueue("chat.postMessage", {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"})
    state.enqueue("chat.postMessage", {"ok": True, "channel": "sanitized-channel", "ts": "1000.000002"})
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    paragraph_intent = _custom_intent(
        blocks=(ParagraphInput("comment", None),),
        actions=(),
        title=None,
    )
    default_action_intent = _custom_intent(
        actions=(ResolvedFormAction("continue", "Continue", ButtonStyle.DEFAULT),),
        title=None,
    )

    paragraph_result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user"),
        paragraph_intent,
        CorrelationToken("sanitized-correlation"),
    )
    default_action_result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user"),
        default_action_intent,
        CorrelationToken("sanitized-correlation"),
    )

    assert isinstance(paragraph_result, MessageAccepted)
    assert isinstance(default_action_result, MessageAccepted)
    first_blocks = state.requests_for("chat.postMessage")[0].parameters()["blocks"]
    second_blocks = state.requests_for("chat.postMessage")[1].parameters()["blocks"]
    if isinstance(first_blocks, str):
        first_blocks = json.loads(first_blocks)
    if isinstance(second_blocks, str):
        second_blocks = json.loads(second_blocks)
    assert isinstance(first_blocks, list)
    assert isinstance(second_blocks, list)
    paragraph_element = next(block["element"] for block in first_blocks if block["type"] == "input")
    assert "initial_value" not in paragraph_element
    assert all(block["type"] != "header" for block in first_blocks)
    assert all(block["type"] != "actions" for block in first_blocks)
    default_action = next(block["elements"][0] for block in second_blocks if block["type"] == "actions")
    assert "style" not in default_action


def test_card_rejects_oversized_serialized_correlation_before_http(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    adapter, _ = _adapter(monkeypatch, slack_api_server)

    with pytest.raises(DynamicCardMessagingError, match="correlation token"):
        adapter.dynamic_card_messaging.send_card(
            ProviderUserId("sanitized-user"),
            _custom_intent(),
            CorrelationToken("x" * 2_100),
        )

    assert slack_api_server.state.requests == []


@pytest.mark.parametrize(
    ("provider_error", "expected_kind"),
    [
        ("message_not_found", ReplacementErrorKind.STALE_REFERENCE),
        ("internal_error", ReplacementErrorKind.UNKNOWN),
    ],
    ids=("stale", "unknown"),
)
def test_real_web_client_replacement_failures_are_typed(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
    provider_error: str,
    expected_kind: ReplacementErrorKind,
) -> None:
    state = slack_api_server.state
    state.enqueue(
        "auth.test",
        {"ok": True, "team_id": "sanitized-team"},
        headers=(("X-OAuth-Scopes", "chat:write,users:read,users:read.email"),),
    )
    state.enqueue("chat.postMessage", {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"})
    state.enqueue("chat.update", {"ok": False, "error": provider_error})
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    accepted = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user"),
        _intent(),
        CorrelationToken("sanitized-correlation"),
    )
    assert isinstance(accepted, MessageAccepted)

    result = adapter.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Sanitized static content"),
    )

    assert isinstance(result, ReplacementError)
    assert result.kind is expected_kind
    assert provider_error not in result.reason
    assert len(state.requests_for("chat.update")) == 1


def test_real_signature_verifier_authenticates_json_and_form_webhooks(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    consumer = _RecordingConsumer()
    handler = adapter.create_webhook_handler(consumer)
    challenge_body = json.dumps({"type": "url_verification", "challenge": "sanitized-challenge"}).encode()
    event_body = json.dumps(
        {
            "type": "event_callback",
            "team_id": "sanitized-team",
            "event_id": "sanitized-event",
            "event_time": 1e300,
            "event": {"type": "message", "text": "Sanitized text"},
        },
        separators=(",", ":"),
    ).encode()
    form_body = urlencode(
        {
            "payload": json.dumps(
                {
                    "type": "block_actions",
                    "payload": {"team_id": "sanitized-team"},
                    "actions": [],
                },
                separators=(",", ":"),
            )
        }
    ).encode()

    challenge_response = handler.handle(_signed_request(challenge_body))
    event_response = handler.handle(_signed_request(event_body, content_type="Application/JSON; charset=utf-8"))
    form_response = handler.handle(
        _signed_request(form_body, content_type="application/x-www-form-urlencoded; charset=utf-8")
    )

    assert challenge_response.status_code == 200
    assert json.loads(challenge_response.body) == {"challenge": "sanitized-challenge"}
    assert event_response.status_code == 200
    assert form_response.status_code == 200
    assert [event.provider_tenant_id for event in consumer.events] == ["sanitized-team", "sanitized-team"]
    assert consumer.events[0].occurred_at is None
    assert json.loads(consumer.events[1].payload)["payload"]["team_id"] == "sanitized-team"


@pytest.mark.parametrize(
    ("webhook_request", "expected_status"),
    [
        (_signed_request(b"not-json"), 400),
        (
            _signed_request(
                json.dumps(
                    {"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}
                ).encode(),
                content_type="text/plain",
            ),
            400,
        ),
        (_signed_request(json.dumps({"type": "url_verification", "challenge": 1}).encode()), 400),
        (_signed_request(json.dumps({"type": "event_callback", "event": {"type": "message"}}).encode()), 400),
        (
            _signed_request(
                json.dumps(
                    {"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}
                ).encode(),
                method="GET",
            ),
            405,
        ),
        (
            _signed_request(
                json.dumps(
                    {"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}
                ).encode(),
                valid_signature=False,
            ),
            401,
        ),
    ],
    ids=("malformed", "media-type", "challenge", "tenant", "method", "signature"),
)
def test_webhook_rejects_invalid_transport_and_payload_boundaries(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
    webhook_request: WebhookRequest,
    expected_status: int,
) -> None:
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    consumer = _RecordingConsumer()

    response = adapter.create_webhook_handler(consumer).handle(webhook_request)

    assert response.status_code == expected_status
    assert consumer.events == []


def test_webhook_only_acknowledges_consumer_acceptance(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    body = json.dumps({"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}).encode()
    rejected_consumer = _RecordingConsumer(EventAcceptance.NOT_ACCEPTED)

    class _FailingConsumer:
        def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
            del event
            raise RuntimeError("sanitized consumer details")

    rejected_response = adapter.create_webhook_handler(rejected_consumer).handle(_signed_request(body))
    failed_response = adapter.create_webhook_handler(_FailingConsumer()).handle(_signed_request(body))

    assert rejected_response.status_code == 503
    assert failed_response.status_code == 503
    assert len(rejected_consumer.events) == 1


def test_real_socket_request_serialization_is_acked_only_after_acceptance(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    control_request = SocketModeRequest(type="hello", envelope_id="sanitized-control", payload={})
    invalid_request = SocketModeRequest(type="events_api", envelope_id="sanitized-invalid", payload={})
    accepted_request = SocketModeRequest(
        type="events_api",
        envelope_id="sanitized-accepted",
        payload={
            "team_id": "sanitized-team",
            "event_id": "sanitized-event",
            "event_time": 1786003200,
            "event": {"type": "message", "text": "Sanitized text"},
        },
    )

    class _SocketTransport:
        instance: _SocketTransport | None = None

        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []
            self.responses: list[object] = []
            self.closed = False
            self.__class__.instance = self

        def connect(self) -> None:
            listener = self.socket_mode_request_listeners[0]
            listener(self, control_request)
            listener(self, invalid_request)
            listener(self, accepted_request)

        def send_socket_mode_response(self, response: object) -> None:
            self.responses.append(response)

        def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(slack_adapter_module, "SocketModeClient", _SocketTransport)
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    consumer = _RecordingConsumer()
    stream = adapter.create_stream_handler(consumer)

    stream.start()

    transport = _SocketTransport.instance
    assert transport is not None
    assert transport.kwargs["app_token"] == "xapp-sanitized-placeholder"
    assert transport.closed is False
    assert len(transport.responses) == 1
    assert [event.event_id for event in consumer.events] == ["sanitized-event"]
    assert json.loads(consumer.events[0].payload) == accepted_request.to_dict()

    stream.stop()

    assert transport.closed is True


@pytest.mark.parametrize("failure_stage", ["connect", "close"])
def test_socket_transport_failures_are_normalized(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
    failure_stage: str,
) -> None:
    class _FailingSocketTransport:
        def __init__(self, **kwargs: object) -> None:
            del kwargs
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []

        def connect(self) -> None:
            if failure_stage == "connect":
                raise SlackClientError("sanitized connection details")

        def close(self) -> None:
            if failure_stage == "close":
                raise SlackClientError("sanitized close details")

    monkeypatch.setattr(slack_adapter_module, "SocketModeClient", _FailingSocketTransport)
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    stream = adapter.create_stream_handler(_RecordingConsumer())

    if failure_stage == "connect":
        with pytest.raises(IMStreamStartError):
            stream.start()
        stream.stop()
    else:
        stream.start()
        with pytest.raises(IMStreamStopError):
            stream.stop()


@pytest.mark.parametrize("disconnect_kind", ["error", "close"])
def test_socket_sdk_disconnect_listeners_are_observable_and_safe(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
    disconnect_kind: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sensitive_marker = f"sanitized-sensitive-remote-{disconnect_kind}"
    request = SocketModeRequest(
        type="events_api",
        envelope_id="sanitized-business",
        payload={"team_id": "sanitized-team", "event": {"type": "message"}},
    )
    consumer = _RecordingConsumer()

    class _ListenerSocketTransport:
        instance: _ListenerSocketTransport | None = None

        def __init__(
            self,
            *,
            on_error_listeners: list[Callable[[Exception], None]],
            on_close_listeners: list[Callable[[int, str | None], None]],
            **kwargs: object,
        ) -> None:
            del kwargs
            self.on_error_listeners = on_error_listeners
            self.on_close_listeners = on_close_listeners
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []
            self.responses: list[object] = []
            self.closed = False
            self.__class__.instance = self

        def connect(self) -> None:
            return None

        def send_socket_mode_response(self, response: object) -> None:
            self.responses.append(response)

        def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(slack_adapter_module, "SocketModeClient", _ListenerSocketTransport)
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    stream = adapter.create_stream_handler(consumer)

    with caplog.at_level("ERROR", logger=slack_adapter_module.__name__):
        stream.start()
        transport = _ListenerSocketTransport.instance
        assert transport is not None
        if disconnect_kind == "error":
            transport.on_error_listeners[0](RuntimeError(sensitive_marker))
        else:
            transport.on_close_listeners[0](1006, sensitive_marker)
        transport.socket_mode_request_listeners[0](transport, request)
        stream.stop()

    transport = _ListenerSocketTransport.instance
    assert transport is not None
    assert transport.closed is True
    assert len(transport.responses) == 1
    assert len(consumer.events) == 1
    assert sensitive_marker not in caplog.text


def test_socket_start_waits_for_transport_construction(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    construction_started = threading.Event()
    release_construction = threading.Event()
    start_returned = threading.Event()
    allow_stop = threading.Event()
    lifecycle_errors: list[BaseException] = []

    class _ConstructionBlockedSocketTransport:
        instance: _ConstructionBlockedSocketTransport | None = None

        def __init__(self, **kwargs: object) -> None:
            del kwargs
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []
            self.connect_calls = 0
            self.closed = False
            self.__class__.instance = self
            construction_started.set()
            assert release_construction.wait(2)

        def connect(self) -> None:
            self.connect_calls += 1

        def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(slack_adapter_module, "SocketModeClient", _ConstructionBlockedSocketTransport)
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    stream = adapter.create_stream_handler(_RecordingConsumer())

    def _manage_stream() -> None:
        try:
            stream.start()
            start_returned.set()
            assert allow_stop.wait(2)
            stream.stop()
        except BaseException as error:
            lifecycle_errors.append(error)

    owner_thread = threading.Thread(target=_manage_stream)
    owner_thread.start()
    assert construction_started.wait(2)
    assert start_returned.is_set() is False
    release_construction.set()
    assert start_returned.wait(2)

    transport = _ConstructionBlockedSocketTransport.instance
    assert transport is not None
    assert transport.connect_calls == 1
    assert transport.closed is False

    allow_stop.set()
    owner_thread.join(2)

    assert not owner_thread.is_alive()
    assert transport.closed is True
    assert lifecycle_errors == []


def test_socket_start_waits_for_connection_readiness_and_accepts_sdk_callback(
    monkeypatch: pytest.MonkeyPatch,
    slack_api_server: _SlackApiServer,
) -> None:
    connect_started = threading.Event()
    release_connect = threading.Event()
    start_returned = threading.Event()
    allow_stop = threading.Event()
    lifecycle_errors: list[BaseException] = []
    consumer = _RecordingConsumer()
    request = SocketModeRequest(
        type="events_api",
        envelope_id="sanitized-business",
        payload={"team_id": "sanitized-team", "event": {"type": "message"}},
    )

    class _SuccessfulSocketTransport:
        instance: _SuccessfulSocketTransport | None = None

        def __init__(self, **kwargs: object) -> None:
            del kwargs
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []
            self.responses: list[object] = []
            self.connect_calls = 0
            self.closed = False
            self.__class__.instance = self

        def connect(self) -> None:
            self.connect_calls += 1
            connect_started.set()
            assert release_connect.wait(2)
            self.socket_mode_request_listeners[0](self, request)

        def send_socket_mode_response(self, response: object) -> None:
            self.responses.append(response)

        def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(slack_adapter_module, "SocketModeClient", _SuccessfulSocketTransport)
    adapter, _ = _adapter(monkeypatch, slack_api_server)
    stream = adapter.create_stream_handler(consumer)

    def _manage_stream() -> None:
        try:
            stream.start()
            start_returned.set()
            assert allow_stop.wait(2)
            stream.stop()
        except BaseException as error:
            lifecycle_errors.append(error)

    owner_thread = threading.Thread(target=_manage_stream)
    owner_thread.start()
    assert connect_started.wait(2)
    assert start_returned.is_set() is False
    release_connect.set()
    assert start_returned.wait(2)

    transport = _SuccessfulSocketTransport.instance
    assert transport is not None
    assert transport.connect_calls == 1
    assert len(transport.responses) == 1
    assert len(consumer.events) == 1
    assert transport.closed is False

    allow_stop.set()
    owner_thread.join(2)

    assert not owner_thread.is_alive()
    assert transport.closed is True
    assert lifecycle_errors == []
