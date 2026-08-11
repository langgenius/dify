from __future__ import annotations

# These tests exercise local SDK boundaries with test doubles, not Microsoft systems.
import base64
import json
import pickle
import threading
from collections import deque
from collections.abc import Callable, Generator, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import override

import httpx
import jwt
import pytest
from botframework.connector import ConnectorClient
from botframework.connector.auth import (
    ChannelValidation,
    JwtTokenExtractor,
    MicrosoftAppCredentials,
)
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from msrest.authentication import BasicTokenAuthentication

from core.human_input import ButtonStyle
from core.human_input_v2 import (
    FileInput,
    FileListInput,
    MarkdownText,
    ParagraphInput,
    ResolvedForm,
    ResolvedFormAction,
    ResolvedFormContent,
    SelectInput,
)
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import ms_teams
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryReadFailure,
    DynamicCardMessagingError,
    EventAcceptance,
    MessageAccepted,
    MessageReference,
    MessageSendingError,
    MSTeamsIMIntegrationCredentials,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    StaticCardIntent,
    WebhookRequest,
)

_PUBLIC_SERVICE_URL = "https://smba.trafficmanager.net/teams/"
_RECEIVED_AT = datetime(2026, 8, 6, 8)
_WEBHOOK_FIXTURE_PATH = Path(__file__).parents[4] / "fixtures" / "im_provider" / "ms_teams_webhook_activity.json"


@dataclass(frozen=True, slots=True)
class _QueuedResponse:
    status_code: int
    body: Mapping[str, object]


@dataclass(frozen=True, slots=True)
class _RecordedRequest:
    operation: str
    method: str
    path: str
    headers: Mapping[str, str]
    body: bytes

    def json_body(self) -> dict[str, object]:
        value = json.loads(self.body)
        assert isinstance(value, dict)
        return value


class _ConnectorState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._responses: dict[str, deque[_QueuedResponse]] = {
            "create": deque(),
            "send": deque(),
            "update": deque(),
        }
        self.requests: list[_RecordedRequest] = []

    def enqueue(self, operation: str, status_code: int, body: Mapping[str, object]) -> None:
        with self._lock:
            self._responses[operation].append(_QueuedResponse(status_code, body))

    def respond(self, request: _RecordedRequest) -> _QueuedResponse:
        with self._lock:
            self.requests.append(request)
            responses = self._responses[request.operation]
            if not responses:
                return _QueuedResponse(500, {"error": {"message": "unconfigured sanitized response"}})
            return responses.popleft()

    def requests_for(self, operation: str) -> list[_RecordedRequest]:
        with self._lock:
            return [request for request in self.requests if request.operation == operation]


def _connector_operation(method: str, path: str) -> str | None:
    if method == "POST" and path == "/v3/conversations":
        return "create"
    if method == "POST" and path.endswith("/activities"):
        return "send"
    if method == "PUT" and "/activities/" in path:
        return "update"
    return None


class _ConnectorHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self) -> None:
        self._respond()

    def do_PUT(self) -> None:
        self._respond()

    def _respond(self) -> None:
        assert isinstance(self.server, _ConnectorHTTPServer)
        operation = _connector_operation(self.command, self.path)
        if operation is None:
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        response = self.server.state.respond(
            _RecordedRequest(
                operation=operation,
                method=self.command,
                path=self.path,
                headers=dict(self.headers.items()),
                body=body,
            )
        )
        response_body = json.dumps(response.body, separators=(",", ":")).encode()
        self.send_response(response.status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(response_body)

    @override
    def log_message(self, format: str, *args: object) -> None:
        del format, args


class _ConnectorHTTPServer(ThreadingHTTPServer):
    state: _ConnectorState


@dataclass(frozen=True, slots=True)
class _ConnectorServer:
    server: _ConnectorHTTPServer
    state: _ConnectorState

    @property
    def base_url(self) -> str:
        host = self.server.server_address[0]
        port = self.server.server_address[1]
        assert isinstance(host, str)
        assert isinstance(port, int)
        return f"http://{host}:{port}/"


@pytest.fixture
def connector_server() -> Generator[_ConnectorServer, None, None]:
    state = _ConnectorState()
    server = _ConnectorHTTPServer(("127.0.0.1", 0), _ConnectorHandler)
    server.state = state
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        yield _ConnectorServer(server, state)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)
        assert not thread.is_alive()


class _GraphCredential:
    def __init__(self, token: str, error: Exception | None = None) -> None:
        self.token = token
        self.error = error
        self.close_count = 0

    def get_token(self, scope: str) -> SimpleNamespace:
        assert scope == "https://graph.microsoft.com/.default"
        if self.error is not None:
            raise self.error
        return SimpleNamespace(token=self.token)

    def close(self) -> None:
        self.close_count += 1


class _GraphBoundary:
    def __init__(self, responses: list[httpx.Response | Exception]) -> None:
        self.responses = deque(responses)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        response = self.responses.popleft()
        if isinstance(response, Exception):
            raise response
        return response


def _unsigned_token(claims: Mapping[str, object]) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    return f"{header}.{payload}."


def _credentials() -> MSTeamsIMIntegrationCredentials:
    return MSTeamsIMIntegrationCredentials(
        provider=IMProvider.MS_TEAMS,
        tenant_id="11111111-1111-1111-1111-111111111111",
        client_id="22222222-2222-2222-2222-222222222222",
        client_secret="test-only-client-secret",
    )


def _graph_token(*, tenant_id: str | None = None, roles: list[str] | None = None) -> str:
    claims: dict[str, object] = {
        "aud": "https://graph.microsoft.com",
        "roles": ["User.Read.All"] if roles is None else roles,
    }
    if tenant_id is not None:
        claims["tid"] = tenant_id
    else:
        claims["tid"] = _credentials().tenant_id
    return _unsigned_token(claims)


def _bot_token(*, tenant_id: str | None = None, client_id: str | None = None) -> str:
    return _unsigned_token(
        {
            "aud": "https://api.botframework.com",
            "appid": client_id or _credentials().client_id,
            "tid": tenant_id or _credentials().tenant_id,
        }
    )


def _connector_factory(server: _ConnectorServer) -> Callable[..., ConnectorClient]:
    def factory(*args: object, **kwargs: object) -> ConnectorClient:
        del args, kwargs
        return ConnectorClient(
            BasicTokenAuthentication({"access_token": "test-only-connector-token"}),
            base_url=server.base_url,
        )

    return factory


def _adapter(
    monkeypatch: pytest.MonkeyPatch,
    *,
    graph_responses: list[httpx.Response | Exception] | None = None,
    graph_token: str | None = None,
    graph_error: Exception | None = None,
    bot_token: str | None = None,
    bot_error: Exception | None = None,
    connector_factory: Callable[..., ConnectorClient] | None = None,
    credentials: MSTeamsIMIntegrationCredentials | None = None,
) -> tuple[ms_teams.MSTeamsIMProviderAdapter, _GraphCredential, _GraphBoundary]:
    selected_credentials = credentials or _credentials()
    graph_credential = _GraphCredential(graph_token or _graph_token(), graph_error)
    graph_boundary = _GraphBoundary(graph_responses or [])
    graph_client = httpx.Client(transport=httpx.MockTransport(graph_boundary), timeout=2)
    bot_credentials = MicrosoftAppCredentials(
        selected_credentials.client_id,
        selected_credentials.client_secret,
        channel_auth_tenant=selected_credentials.tenant_id,
    )

    def bot_access_token(force_refresh: bool = False) -> str:
        del force_refresh
        if bot_error is not None:
            raise bot_error
        return bot_token or _bot_token(
            tenant_id=selected_credentials.tenant_id,
            client_id=selected_credentials.client_id,
        )

    def graph_credential_factory(*_args: object, **_kwargs: object) -> _GraphCredential:
        return graph_credential

    def graph_client_factory(*_args: object, **_kwargs: object) -> httpx.Client:
        return graph_client

    def bot_credentials_factory(*_args: object, **_kwargs: object) -> MicrosoftAppCredentials:
        return bot_credentials

    monkeypatch.setattr(bot_credentials, "get_access_token", bot_access_token)
    monkeypatch.setattr(ms_teams, "ClientSecretCredential", graph_credential_factory)
    monkeypatch.setattr(ms_teams.httpx, "Client", graph_client_factory)
    monkeypatch.setattr(ms_teams, "MicrosoftAppCredentials", bot_credentials_factory)
    if connector_factory is not None:
        monkeypatch.setattr(ms_teams, "ConnectorClient", connector_factory)
    return ms_teams.MSTeamsIMProviderAdapter(selected_credentials), graph_credential, graph_boundary


def _card_intent(
    *,
    input_type: str = "select",
    markdown_text: str = "Sanitized **rendered** content",
    action_style: ButtonStyle = ButtonStyle.PRIMARY,
) -> ResolvedForm:
    if input_type == "select":
        input_block: ResolvedFormContent = SelectInput("decision", ("Approve", "Reject"), "Approve")
    elif input_type == "file":
        input_block = FileInput("decision", (), (), ())
    elif input_type == "file-list":
        input_block = FileListInput("decision", (), (), (), 1)
    else:
        input_block = ParagraphInput("decision", "Sanitized initial value")
    return ResolvedForm(
        title="Sanitized title",
        blocks=(MarkdownText(markdown_text), input_block, MarkdownText("Sanitized trailing content")),
        user_actions=(
            ResolvedFormAction("approve", "Approve", action_style),
            ResolvedFormAction("reject", "Reject", ButtonStyle.ACCENT),
        ),
        legacy_form_content="This value must not be rendered",
    )


def _activity_body(
    *,
    event_id: str | None = "test-only-event",
    action_id: str = "approve",
) -> dict[str, object]:
    activity = json.loads(_WEBHOOK_FIXTURE_PATH.read_text())
    assert isinstance(activity, dict)
    conversation = activity["conversation"]
    channel_data = activity["channelData"]
    value = activity["value"]
    assert isinstance(conversation, dict)
    assert isinstance(channel_data, dict)
    assert isinstance(value, dict)
    tenant = channel_data["tenant"]
    assert isinstance(tenant, dict)
    conversation["tenantId"] = _credentials().tenant_id
    tenant["id"] = _credentials().tenant_id
    value["action_id"] = action_id
    if event_id is None:
        activity.pop("id", None)
    else:
        activity["id"] = event_id
    return activity


def _webhook_request(body: dict[str, object], token: str) -> WebhookRequest:
    return WebhookRequest(
        method="POST",
        headers=(
            ("Authorization", f"Bearer {token}"),
            ("Content-Type", "application/json; charset=utf-8"),
        ),
        body=json.dumps(body, separators=(",", ":")).encode(),
        received_at=_RECEIVED_AT,
    )


class _RecordingConsumer:
    def __init__(self, acceptance: EventAcceptance = EventAcceptance.ACCEPTED) -> None:
        self.acceptance = acceptance
        self._lock = threading.Lock()
        self.events: list[AuthenticatedIMEvent] = []

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        with self._lock:
            self.events.append(event)
        return self.acceptance


class _MetadataResponse:
    def __init__(self, body: Mapping[str, object]) -> None:
        self.body = body

    def json(self) -> Mapping[str, object]:
        return self.body

    def raise_for_status(self) -> None:
        return None


def test_real_connector_and_graph_boundaries_round_trip_all_outbound_capabilities(
    monkeypatch: pytest.MonkeyPatch,
    connector_server: _ConnectorServer,
) -> None:
    state = connector_server.state
    for conversation_id in ("test-only-text-conversation", "test-only-card-conversation"):
        state.enqueue(
            "create",
            201,
            {"id": conversation_id, "serviceUrl": _PUBLIC_SERVICE_URL},
        )
    state.enqueue("send", 201, {"id": "test-only-text-activity"})
    state.enqueue("send", 201, {"id": "test-only-card-activity"})
    state.enqueue("update", 200, {"id": "test-only-card-activity"})
    next_link = "https://graph.microsoft.com/v1.0/users?$skiptoken=test-only-page"
    adapter, _, graph_boundary = _adapter(
        monkeypatch,
        graph_responses=[
            httpx.Response(
                200,
                json={
                    "value": [
                        {"id": "test-only-user-a", "displayName": "First", "mail": "first@example.test"},
                        {"id": "test-only-user-b", "displayName": None, "mail": None},
                        {"id": "test-only-user-blank", "displayName": " ", "mail": ""},
                    ],
                    "@odata.nextLink": next_link,
                },
            ),
            httpx.Response(
                200,
                json={"value": [{"id": "test-only-user-c", "displayName": "Third", "mail": None}]},
            ),
        ],
        connector_factory=_connector_factory(connector_server),
    )

    credential_result = adapter.test_credentials()
    directory_result = adapter.directory.read_directory()
    text_result = adapter.messaging.send_text(ProviderUserId("test-only-user-a"), "Sanitized **text**")
    card_result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("test-only-user-b"),
        _card_intent(),
        CorrelationToken("test-only-correlation"),
    )
    assert isinstance(card_result, MessageAccepted)
    persisted_reference: MessageReference = pickle.loads(  # noqa: S301 - trusted in-process test value
        pickle.dumps(card_result.reference)
    )
    recreated_adapter = ms_teams.MSTeamsIMProviderAdapter(_credentials())
    replacement_result = recreated_adapter.dynamic_card_messaging.replace_with_static(
        persisted_reference,
        StaticCardIntent("Sanitized **recorded** presentation"),
    )

    assert credential_result == CredentialTestSuccess(adapter.provider, _credentials().tenant_id)
    assert isinstance(directory_result, Directory)
    assert [str(entry.provider_user_id) for entry in directory_result.entries] == [
        "test-only-user-a",
        "test-only-user-b",
        "test-only-user-blank",
        "test-only-user-c",
    ]
    assert directory_result.entries[2].display_name is None
    assert directory_result.entries[2].email is None
    assert isinstance(text_result, MessageAccepted)
    assert replacement_result is None
    assert len(graph_boundary.requests) == 2
    assert graph_boundary.requests[0].url.params["$select"] == "id,displayName,mail"
    assert graph_boundary.requests[1].url == next_link

    create_requests = state.requests_for("create")
    assert len(create_requests) == 2
    for request, expected_user in zip(create_requests, ("test-only-user-a", "test-only-user-b"), strict=True):
        body = request.json_body()
        assert body["tenantID"] == _credentials().tenant_id
        assert body["bot"] == {"id": f"28:{_credentials().client_id}"}
        assert body["members"] == [{"id": expected_user}]
        assert request.headers["Authorization"] == "Bearer test-only-connector-token"

    send_requests = state.requests_for("send")
    assert len(send_requests) == 2
    text_body = send_requests[0].json_body()
    assert text_body["type"] == "message"
    assert text_body["text"] == "Sanitized **text**"
    card_body = send_requests[1].json_body()
    assert card_body["type"] == "message"
    assert card_body["summary"] == "Sanitized title"
    attachments = card_body["attachments"]
    assert isinstance(attachments, list)
    attachment = attachments[0]
    assert isinstance(attachment, dict)
    assert attachment["contentType"] == "application/vnd.microsoft.card.adaptive"
    content = attachment["content"]
    assert isinstance(content, dict)
    card_elements = content["body"]
    assert isinstance(card_elements, list)
    assert all(isinstance(element, dict) for element in card_elements)
    assert [element["type"] for element in card_elements] == [
        "TextBlock",
        "TextBlock",
        "Input.ChoiceSet",
        "TextBlock",
    ]
    assert content["actions"] == [
        {
            "type": "Action.Submit",
            "title": "Approve",
            "data": {
                "__dify.human_input": {
                    "version": 1,
                    "action_id": "approve",
                    "correlation_token": "test-only-correlation",
                }
            },
        },
        {
            "type": "Action.Submit",
            "title": "Reject",
            "data": {
                "__dify.human_input": {
                    "version": 1,
                    "action_id": "reject",
                    "correlation_token": "test-only-correlation",
                }
            },
        },
    ]

    update_requests = state.requests_for("update")
    assert len(update_requests) == 1
    assert update_requests[0].path == (
        "/v3/conversations/test-only-card-conversation/activities/test-only-card-activity"
    )
    assert update_requests[0].json_body() == {
        "type": "message",
        "text": "Sanitized **recorded** presentation",
    }


def test_real_connector_disables_automatic_replay_for_ambiguous_send(
    monkeypatch: pytest.MonkeyPatch,
    connector_server: _ConnectorServer,
) -> None:
    state = connector_server.state
    state.enqueue(
        "create",
        201,
        {"id": "test-only-conversation", "serviceUrl": _PUBLIC_SERVICE_URL},
    )
    state.enqueue("send", 500, {"error": {"message": "test-only ambiguous outcome"}})
    adapter, _, _ = _adapter(monkeypatch, connector_factory=_connector_factory(connector_server))

    result = adapter.messaging.send_text(ProviderUserId("test-only-user"), "Sanitized text")

    assert isinstance(result, MessageSendingError)
    assert len(state.requests_for("create")) == 1
    assert len(state.requests_for("send")) == 1


def test_real_connector_maps_exact_update_failures_without_selecting_another_message(
    monkeypatch: pytest.MonkeyPatch,
    connector_server: _ConnectorServer,
) -> None:
    state = connector_server.state
    state.enqueue(
        "create",
        201,
        {"id": "test-only-conversation", "serviceUrl": _PUBLIC_SERVICE_URL},
    )
    state.enqueue("send", 201, {"id": "test-only-card-activity"})
    state.enqueue("update", 404, {"error": {"message": "test-only stale activity"}})
    state.enqueue("update", 500, {"error": {"message": "test-only unknown outcome"}})
    adapter, _, _ = _adapter(monkeypatch, connector_factory=_connector_factory(connector_server))
    accepted = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("test-only-user"),
        _card_intent(),
        CorrelationToken("test-only-correlation"),
    )
    assert isinstance(accepted, MessageAccepted)
    assert isinstance(accepted.reference, ms_teams._MSTeamsMessageLocator)
    serialized_value = accepted.reference._serialized_value
    replacement_character = "A" if serialized_value[-1] != "A" else "B"
    altered_reference = object.__new__(ms_teams._MSTeamsMessageLocator)
    object.__setattr__(altered_reference, "_serialized_value", serialized_value[:-1] + replacement_character)

    result = adapter.dynamic_card_messaging.replace_with_static(
        accepted.reference,
        StaticCardIntent("Sanitized static content"),
    )
    invalid = adapter.dynamic_card_messaging.replace_with_static(
        MessageReference(),
        StaticCardIntent("Sanitized static content"),
    )
    altered = adapter.dynamic_card_messaging.replace_with_static(
        altered_reference,
        StaticCardIntent("Sanitized static content"),
    )
    unknown = adapter.dynamic_card_messaging.replace_with_static(
        accepted.reference,
        StaticCardIntent("Sanitized static content"),
    )

    assert isinstance(result, ReplacementError)
    assert result.kind is ReplacementErrorKind.STALE_REFERENCE
    assert isinstance(invalid, ReplacementError)
    assert invalid.kind is ReplacementErrorKind.INVALID_REFERENCE
    assert isinstance(altered, ReplacementError)
    assert altered.kind is ReplacementErrorKind.INVALID_REFERENCE
    assert isinstance(unknown, ReplacementError)
    assert unknown.kind is ReplacementErrorKind.UNKNOWN
    assert len(state.requests_for("update")) == 2


def test_replacement_rejects_locator_without_serialized_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter, _, _ = _adapter(monkeypatch)
    undersized_reference = object.__new__(ms_teams._MSTeamsMessageLocator)
    digest_only = base64.urlsafe_b64encode(b"x" * ms_teams._MESSAGE_LOCATOR_DIGEST_SIZE).rstrip(b"=").decode()
    object.__setattr__(undersized_reference, "_serialized_value", digest_only)

    result = adapter.dynamic_card_messaging.replace_with_static(
        undersized_reference,
        StaticCardIntent("Sanitized static content"),
    )

    assert isinstance(result, ReplacementError)
    assert result.kind is ReplacementErrorKind.INVALID_REFERENCE


@pytest.mark.parametrize(
    ("responses", "expected_request_count"),
    [
        ([httpx.Response(500, json={"error": "test-only"})], 1),
        ([RuntimeError("test-only unexpected Graph failure")], 1),
        (
            [
                httpx.Response(
                    200,
                    json={
                        "value": [{"id": "test-only-partial"}],
                        "@odata.nextLink": "https://example.invalid/v1.0/users?$skiptoken=test-only",
                    },
                )
            ],
            1,
        ),
        (
            [
                httpx.Response(
                    200,
                    json={
                        "value": [{"id": "test-only-partial"}],
                        "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=test-only",
                    },
                ),
                httpx.Response(200, json={"value": "invalid"}),
            ],
            2,
        ),
    ],
    ids=("http-failure", "unexpected-failure", "untrusted-next-link", "malformed-later-page"),
)
def test_graph_boundary_never_publishes_partial_directory(
    monkeypatch: pytest.MonkeyPatch,
    responses: list[httpx.Response | Exception],
    expected_request_count: int,
) -> None:
    adapter, _, graph_boundary = _adapter(monkeypatch, graph_responses=responses)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert "test-only-partial" not in result.reason
    assert len(graph_boundary.requests) == expected_request_count


@pytest.mark.parametrize(
    "intent",
    [
        _card_intent(input_type="file"),
        _card_intent(input_type="file-list"),
        _card_intent(action_style=ButtonStyle.GHOST),
        _card_intent(markdown_text="x" * 30_000),
        ResolvedForm(
            title="Sanitized title",
            blocks=(SelectInput("decision", ("One", "One"), "One"),),
            user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
            legacy_form_content="This value must not be rendered",
        ),
    ],
    ids=("file", "file-list", "action-style", "size", "duplicate-options"),
)
def test_complete_card_assessment_rejects_unrepresentable_intent_without_sdk_io(
    monkeypatch: pytest.MonkeyPatch,
    intent: ResolvedForm,
) -> None:
    connector_calls = 0

    def connector_factory(*args: object, **kwargs: object) -> ConnectorClient:
        nonlocal connector_calls
        del args, kwargs
        connector_calls += 1
        raise AssertionError("unrepresentable card must not reach the connector")

    adapter, _, _ = _adapter(monkeypatch, connector_factory=connector_factory)

    assessment = adapter.dynamic_card_messaging.assess(intent)
    with pytest.raises(DynamicCardMessagingError):
        adapter.dynamic_card_messaging.send_card(
            ProviderUserId("test-only-user"),
            intent,
            CorrelationToken("test-only-correlation"),
        )

    assert assessment.representable is False
    assert assessment.reason
    assert connector_calls == 0


@pytest.mark.parametrize(
    ("graph_token", "graph_error", "bot_token", "bot_error", "expected_kind"),
    [
        ("invalid", None, None, None, CredentialTestFailureKind.UNKNOWN),
        (
            _unsigned_token(
                {
                    "aud": "https://graph.microsoft.com",
                    "roles": ["User.Read.All"],
                }
            ),
            None,
            None,
            None,
            CredentialTestFailureKind.TENANT_ID_UNAVAILABLE,
        ),
        (
            _graph_token(tenant_id="33333333-3333-3333-3333-333333333333"),
            None,
            None,
            None,
            CredentialTestFailureKind.AUTHENTICATION_REJECTED,
        ),
        (_graph_token(roles=[]), None, None, None, CredentialTestFailureKind.UNKNOWN),
        (
            _graph_token(),
            RuntimeError("test-only Graph outage"),
            None,
            None,
            CredentialTestFailureKind.UNKNOWN,
        ),
        (_graph_token(), None, "invalid", None, CredentialTestFailureKind.UNKNOWN),
        (
            _graph_token(),
            None,
            None,
            RuntimeError("test-only Bot outage"),
            CredentialTestFailureKind.UNKNOWN,
        ),
        (
            _graph_token(),
            None,
            None,
            PermissionError("invalid_client: test-only rejection"),
            CredentialTestFailureKind.AUTHENTICATION_REJECTED,
        ),
        (
            _graph_token(),
            None,
            None,
            PermissionError("temporarily_unavailable: test-only outage"),
            CredentialTestFailureKind.UNKNOWN,
        ),
    ],
    ids=(
        "malformed-token",
        "missing-tenant",
        "tenant-mismatch",
        "missing-permission",
        "graph-outage",
        "malformed-bot-token",
        "bot-outage",
        "bot-rejection",
        "bot-transient",
    ),
)
def test_public_credential_boundaries_return_capability_scoped_failures(
    monkeypatch: pytest.MonkeyPatch,
    graph_token: str,
    graph_error: Exception | None,
    bot_token: str | None,
    bot_error: Exception | None,
    expected_kind: CredentialTestFailureKind,
) -> None:
    adapter, _, _ = _adapter(
        monkeypatch,
        graph_token=graph_token,
        graph_error=graph_error,
        bot_token=bot_token,
        bot_error=bot_error,
    )

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is expected_kind
    assert "test-only" not in result.reason


@pytest.mark.parametrize("action_id", ["approve", "reject"])
def test_official_jwt_boundary_authenticates_complete_payload_ack_and_concurrency_for_each_action(
    monkeypatch: pytest.MonkeyPatch,
    action_id: str,
) -> None:
    signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    wrong_signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = RSAAlgorithm.to_jwk(signing_key.public_key(), as_dict=True)
    public_jwk.update({"kid": "test-only-key", "endorsements": []})
    metadata_url = "https://test-only.invalid/openid-configuration"
    jwks_url = "https://test-only.invalid/keys"
    monkeypatch.setattr(ChannelValidation, "open_id_metadata_endpoint", metadata_url)
    JwtTokenExtractor.metadataCache.pop(metadata_url, None)
    metadata_requests: list[str] = []

    def metadata_get(url: str, *args: object, **kwargs: object) -> _MetadataResponse:
        del args, kwargs
        metadata_requests.append(url)
        if url == metadata_url:
            return _MetadataResponse({"jwks_uri": jwks_url})
        assert url == jwks_url
        return _MetadataResponse({"keys": [public_jwk]})

    monkeypatch.setattr(
        "botframework.connector.auth.jwt_token_extractor.requests.get",
        metadata_get,
    )
    adapter, _, _ = _adapter(monkeypatch)
    accepted_consumer = _RecordingConsumer()
    rejected_consumer = _RecordingConsumer(EventAcceptance.NOT_ACCEPTED)
    accepted_handler = adapter.create_webhook_handler(accepted_consumer)
    rejected_handler = adapter.create_webhook_handler(rejected_consumer)
    current_timestamp = int(datetime.now(tz=UTC).timestamp())
    claims = {
        "iss": "https://api.botframework.com",
        "aud": _credentials().client_id,
        "serviceurl": _PUBLIC_SERVICE_URL,
        "nbf": current_timestamp - 60,
        "exp": current_timestamp + 600,
    }
    token = jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "test-only-key"})
    requests = [
        _webhook_request(
            _activity_body(
                event_id=f"test-only-event-{index}",
                action_id=action_id,
            ),
            token,
        )
        for index in range(6)
    ]

    with ThreadPoolExecutor(max_workers=6) as executor:
        responses = tuple(executor.map(accepted_handler.handle, requests))
    rejected_response = rejected_handler.handle(_webhook_request(_activity_body(action_id=action_id), token))
    adapter.close()
    adapter.close()
    after_close_response = accepted_handler.handle(
        _webhook_request(
            _activity_body(
                event_id="test-only-after-close",
                action_id=action_id,
            ),
            token,
        )
    )

    assert [(response.status_code, response.body) for response in responses] == [(200, b"")] * 6
    assert (rejected_response.status_code, rejected_response.body) == (503, b"event not accepted")
    assert (after_close_response.status_code, after_close_response.body) == (200, b"")
    assert len(accepted_consumer.events) == 7
    assert len(rejected_consumer.events) == 1
    assert metadata_requests
    first_event = accepted_consumer.events[0]
    assert first_event.provider.value == "ms_teams"
    assert first_event.provider_tenant_id == _credentials().tenant_id
    assert first_event.received_at == _RECEIVED_AT
    first_payload = json.loads(first_event.payload)
    assert first_payload in [
        _activity_body(
            event_id=f"test-only-event-{index}",
            action_id=action_id,
        )
        for index in range(6)
    ]
    assert first_payload["value"]["action_id"] == action_id

    body_without_timestamp = _activity_body(
        event_id="test-only-no-timestamp",
        action_id=action_id,
    )
    body_without_timestamp.pop("timestamp")
    no_timestamp_response = accepted_handler.handle(_webhook_request(body_without_timestamp, token))

    class FailingConsumer:
        def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
            del event
            raise RuntimeError("test-only consumer failure")

    failing_handler = adapter.create_webhook_handler(FailingConsumer())
    consumer_failure_response = failing_handler.handle(_webhook_request(_activity_body(action_id=action_id), token))

    assert (no_timestamp_response.status_code, no_timestamp_response.body) == (200, b"")
    assert accepted_consumer.events[-1].occurred_at is None
    assert (consumer_failure_response.status_code, consumer_failure_response.body) == (
        503,
        b"event processing failed",
    )

    invalid_tokens = (
        jwt.encode(claims, wrong_signing_key, algorithm="RS256", headers={"kid": "test-only-key"}),
        jwt.encode(
            {**claims, "aud": "test-only-wrong-audience"},
            signing_key,
            algorithm="RS256",
            headers={"kid": "test-only-key"},
        ),
        jwt.encode(
            {**claims, "exp": current_timestamp - 600},
            signing_key,
            algorithm="RS256",
            headers={"kid": "test-only-key"},
        ),
    )
    previous_event_count = len(accepted_consumer.events)
    for invalid_token in invalid_tokens:
        response = accepted_handler.handle(_webhook_request(_activity_body(action_id=action_id), invalid_token))
        assert (response.status_code, response.body) == (401, b"request authentication failed")
    mismatched_tenant = _activity_body(action_id=action_id)
    mismatched_tenant["conversation"] = {
        "id": "test-only-conversation",
        "tenantId": "33333333-3333-3333-3333-333333333333",
    }
    mismatch_response = accepted_handler.handle(_webhook_request(mismatched_tenant, token))
    assert (mismatch_response.status_code, mismatch_response.body) == (
        403,
        b"Microsoft Teams tenant mismatch",
    )
    assert len(accepted_consumer.events) == previous_event_count
    JwtTokenExtractor.metadataCache.pop(metadata_url, None)


@pytest.mark.parametrize(
    "webhook_request",
    [
        WebhookRequest("GET", (), b"{}", _RECEIVED_AT),
        WebhookRequest("POST", (("Content-Type", "application/json"),), b"{}", _RECEIVED_AT),
        WebhookRequest(
            "POST",
            (("Authorization", "Bearer test-only"), ("Content-Type", "text/plain")),
            b"{}",
            _RECEIVED_AT,
        ),
        WebhookRequest(
            "POST",
            (("Authorization", "Bearer test-only"), ("Content-Type", "application/json")),
            b"not-json",
            _RECEIVED_AT,
        ),
        WebhookRequest(
            "POST",
            (("Authorization", "Bearer test-only"), ("Content-Type", "application/json")),
            b"[]",
            _RECEIVED_AT,
        ),
        _webhook_request({}, "test-only"),
        _webhook_request(
            {**_activity_body(), "serviceUrl": "https://example.invalid/teams/"},
            "test-only",
        ),
        _webhook_request({**_activity_body(), "nonStandard": float("nan")}, "test-only"),
    ],
    ids=("method", "auth", "content-type", "invalid-json", "non-object", "schema", "service-url", "non-standard-json"),
)
def test_webhook_public_boundary_rejects_invalid_requests_without_consumer(
    monkeypatch: pytest.MonkeyPatch,
    webhook_request: WebhookRequest,
) -> None:
    adapter, _, _ = _adapter(monkeypatch)
    consumer = _RecordingConsumer()
    handler = adapter.create_webhook_handler(consumer)

    response = handler.handle(webhook_request)

    assert response.status_code >= 400
    assert consumer.events == []


def test_provider_capabilities_are_webhook_only_and_factories_are_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter, graph_credential, graph_boundary = _adapter(monkeypatch)
    consumer = _RecordingConsumer()

    assert adapter.provider.value == "ms_teams"
    assert adapter.directory is adapter.directory
    assert adapter.messaging is adapter.messaging
    assert adapter.dynamic_card_messaging is adapter.dynamic_card_messaging
    assert adapter.create_webhook_handler(consumer) is not None
    assert adapter.create_stream_handler(consumer) is None
    assert graph_boundary.requests == []
    assert graph_credential.close_count == 0
