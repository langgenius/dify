"""Replay redacted Lark captures through the real SDK without network I/O."""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import Callable, Iterator
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
import requests
from lark_oapi.core.cache import LocalCache
from lark_oapi.core.token import TokenManager
from lark_oapi.ws import client as sdk_ws_module
from lark_oapi.ws.pb.pbbp2_pb2 import Frame
from pydantic import BaseModel, ConfigDict, JsonValue, TypeAdapter

from core.human_input import ButtonStyle
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import feishu_lark as adapter_module
from core.human_input_v2.im_integration.adapters.credentials import FeishuCredentials, LarkCredentials
from core.human_input_v2.im_integration.adapters.entities import (
    AuthenticatedIMEvent,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    EventAcceptance,
    IMCardEvent,
    IMEventIngressKind,
    IMStreamStartError,
    MessageAccepted,
    MessageSendingError,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    StaticCardIntent,
    WebhookRequest,
)
from core.human_input_v2.im_integration.adapters.feishu_lark import FeishuIMProviderAdapter, LarkIMProviderAdapter
from core.human_input_v2.resolved_form import MarkdownFragment, ParagraphInput, ResolvedForm, SelectInput, UserAction

_FIXTURE_PATH = Path(__file__).with_name("fixtures") / "lark" / "sanitized_protocol.json"
_JSON_OBJECT = TypeAdapter(dict[str, JsonValue])


class _CapturedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    method: str
    url: str
    body: dict[str, JsonValue] | None


class _CapturedResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: int
    headers: dict[str, str]
    body: dict[str, JsonValue]


class _CapturedExchange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    request: _CapturedRequest
    response: _CapturedResponse


class _CapturedEvent(BaseModel):
    provider: IMProvider
    provider_tenant_id: str
    event_id: str
    event_type: str
    occurred_at: datetime
    received_at: datetime
    ingress_kind: IMEventIngressKind
    payload: str


class _CallbackRequest(BaseModel):
    method: str
    received_at: datetime
    body: str
    headers: tuple[tuple[str, str], ...]


class _CallbackResponse(BaseModel):
    status: int
    body: str


class _CallbackHTTP(BaseModel):
    request: _CallbackRequest
    response: _CallbackResponse


class _SDKSerialization(BaseModel):
    method: str
    value: str


class _SDKCallbackResponse(BaseModel):
    object_type: str
    sdk_serialization: _SDKSerialization


class _SDKCallback(BaseModel):
    callback: str
    object_type: str
    sdk_serialization: _SDKSerialization
    callback_response: _SDKCallbackResponse


class _WebhookCapture(BaseModel):
    provider: IMProvider
    authenticated_event: _CapturedEvent
    http: _CallbackHTTP


class _StreamCapture(BaseModel):
    provider: IMProvider
    authenticated_event: _CapturedEvent
    stream: _SDKCallback


class _ACKCapture(BaseModel):
    body_encoding: str
    body: str
    response_payload: str


class _RecordingConsumer:
    def __init__(self, acceptance: EventAcceptance = EventAcceptance.ACCEPTED) -> None:
        self.events: list[AuthenticatedIMEvent] = []
        self.acceptance = acceptance

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        self.events.append(event)
        return self.acceptance


def _live_intent(mode: str) -> ResolvedForm:
    return ResolvedForm(
        title=f"Lark {mode} fixture capture",
        parts=(
            MarkdownFragment(text="Lark confirmed card form."),
            ParagraphInput(output_variable_name="comment", default_value=None),
            SelectInput(output_variable_name="decision", options=("ship", "hold"), default_value="hold"),
        ),
        actions=(
            UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),
            UserAction(id="reject", title="Reject", button_style=ButtonStyle.ACCENT),
        ),
        legacy_form_content="",
    )


def _webhook_capture() -> _WebhookCapture:
    return _WebhookCapture.model_validate_json(
        _FIXTURE_PATH.with_name("sanitized_card_action_webhook.json").read_text()
    )


def _webhook_request(capture: _WebhookCapture) -> WebhookRequest:
    request = capture.http.request
    return WebhookRequest(
        method=request.method, headers=request.headers, body=request.body.encode(), received_at=request.received_at
    )


class _RecordedSDKStreamClient:
    def __init__(
        self,
        credentials: FeishuCredentials | LarkCredentials,
        domain: str,
        callback: Callable[[adapter_module._SDKEventEnvelope, Callable[[], None]], None],
    ) -> None:
        capture = _StreamCapture.model_validate_json(
            _FIXTURE_PATH.with_name("sanitized_card_action_stream.json").read_text()
        )
        ack = _ACKCapture.model_validate_json(_FIXTURE_PATH.with_name("sanitized_stream_ack.json").read_text())
        channel = adapter_module._SynchronousEventChannel(credentials=credentials, domain=domain, callback=callback)
        self._credentials = credentials
        self._domain = domain
        self._dispatcher = channel._build_dispatcher()
        self._frame = Frame()
        self._frame.ParseFromString(base64.b64decode(ack.body))
        # The recorded ACK supplies the delivery headers. The incoming payload is
        # reconstructed from the separately captured, redacted SDK serialization.
        self._frame.payload = capture.stream.sdk_serialization.value.encode()
        self.writes: list[bytes] = []
        self.stopped = False

    async def _write(self, data: bytes) -> None:
        self.writes.append(data)

    async def _deliver(self) -> None:
        client = sdk_ws_module.Client(
            self._credentials.app_id,
            self._credentials.app_secret,
            event_handler=self._dispatcher,
            domain=self._domain,
        )
        client._write_message = self._write
        await client._handle_data_frame(self._frame)

    def start(self) -> None:
        asyncio.run(self._deliver())

    def stop(self) -> None:
        self.stopped = True


class _LarkHTTPReplay:
    def __init__(self) -> None:
        self.exchanges = TypeAdapter(dict[str, _CapturedExchange]).validate_json(_FIXTURE_PATH.read_text())
        # Reuse captured responses while checking the current Markdown request contract.
        for operation, markdown in (
            ("text", "Lark protocol capture: **unit tests**\n\n测试消息"),
            ("invalid_recipient", "Lark unit test invalid recipient"),
        ):
            exchange = self.exchanges[operation]
            assert exchange.request.body is not None
            request_body = {
                **exchange.request.body,
                "msg_type": "interactive",
                "content": json.dumps(
                    {"schema": "2.0", "body": {"elements": [{"tag": "markdown", "content": markdown}]}},
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            }
            current_request = exchange.request.model_copy(update={"body": request_body})
            self.exchanges[operation] = exchange.model_copy(update={"request": current_request})
        self.responses: dict[str, _CapturedResponse] = {}
        self.requests: list[_CapturedRequest] = []
        self.unmatched: list[_CapturedRequest] = []

    def send(self, request: requests.PreparedRequest) -> requests.Response:
        assert request.method is not None
        assert request.url is not None
        body = None
        if request.body is not None:
            assert isinstance(request.body, (bytes, str))
            body = _JSON_OBJECT.validate_json(request.body)
        observed = _CapturedRequest(method=request.method, url=request.url, body=body)
        self.requests.append(observed)
        self.unmatched.append(observed)
        url = urlsplit(observed.url)
        assert url.scheme == "https"
        assert url.netloc == "open.larksuite.com"
        for operation, exchange in self.exchanges.items():
            expected = exchange.request
            expected_url = urlsplit(expected.url)
            if (
                observed.method == expected.method
                and url.path == expected_url.path
                and parse_qs(url.query) == parse_qs(expected_url.query)
                and body == expected.body
            ):
                if operation not in {"token", "invalid_credentials", "stream_connect", "stream_connect_invalid"}:
                    assert request.headers["Authorization"] == "Bearer t-sanitized-lark-access-token"
                captured = self.responses.get(operation, exchange.response)
                response = requests.Response()
                response.status_code = captured.status
                response.headers.update(captured.headers)
                response._content = json.dumps(captured.body, ensure_ascii=False).encode()
                response.request = request
                response.url = request.url
                self.unmatched.pop()
                return response
        raise AssertionError("SDK request did not match a sanitized Lark capture")


@pytest.fixture
def replay(monkeypatch: pytest.MonkeyPatch) -> Iterator[_LarkHTTPReplay]:
    replay = _LarkHTTPReplay()
    # The SDK token cache is process-wide; isolate it so every test exercises auth.
    monkeypatch.setattr(TokenManager, "cache", LocalCache())

    def send(_session: requests.Session, request: requests.PreparedRequest, **_kwargs: object) -> requests.Response:
        return replay.send(request)

    monkeypatch.setattr(requests.Session, "send", send)

    async def async_send(_client: httpx.AsyncClient, request: httpx.Request, **_kwargs: object) -> httpx.Response:
        prepared = requests.Request(
            request.method, str(request.url), headers=dict(request.headers), data=request.content or None
        ).prepare()
        response = replay.send(prepared)
        return httpx.Response(response.status_code, headers=response.headers, content=response.content, request=request)

    monkeypatch.setattr(httpx.AsyncClient, "send", async_send)
    yield replay
    # Adapters translate transport exceptions into failures; do not let that hide
    # an unmatched request in a test which expects a provider failure.
    assert replay.unmatched == []


def _credentials(*, app_secret: str = "sanitized-lark-app-secret") -> LarkCredentials:
    return LarkCredentials(
        provider=IMProvider.LARK,
        app_id="cli_sanitized_lark_app",
        app_secret=app_secret,
        verification_token="sanitized-lark-verification-token",
        encrypt_key="sanitized-lark-encrypt-key",
    )


def _intent() -> ResolvedForm:
    return ResolvedForm(
        title="Lark unit test capture",
        parts=(
            MarkdownFragment(text="Protocol capture for **Lark** unit tests."),
            ParagraphInput(output_variable_name="comment", default_value="Initial comment"),
            SelectInput(output_variable_name="decision", options=("Approve", "Reject"), default_value="Approve"),
        ),
        actions=(UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),),
        legacy_form_content="",
    )


def _send_card(adapter: LarkIMProviderAdapter) -> MessageAccepted:
    result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("union_lark_user"), _intent(), CorrelationToken("lark-unit-test-correlation")
    )
    assert isinstance(result, MessageAccepted)
    return result


class _NoEventsExpected:
    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        del event
        raise AssertionError("Endpoint discovery must not fabricate a callback")


def test_lark_credentials_require_root_access_despite_a_successful_user_scope(replay: _LarkHTTPReplay) -> None:
    replay.responses["scope"] = replay.exchanges["scope_restricted"].response
    replay.responses["departments"] = replay.exchanges["departments_denied"].response
    adapter = LarkIMProviderAdapter(_credentials())

    assert adapter.test_credentials() == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "Lark baseline permissions could not be confirmed.",
        provider_error_code="40004",
        http_status=403,
    )


@pytest.mark.usefixtures("replay")
def test_lark_credentials_accept_the_captured_scope_without_department_ids() -> None:
    assert LarkIMProviderAdapter(_credentials()).test_credentials() == CredentialTestSuccess(
        IMProvider.LARK, "tenant_lark_sanitized"
    )


@pytest.mark.usefixtures("replay")
def test_lark_invalid_app_secret_returns_a_safe_failure() -> None:
    adapter = LarkIMProviderAdapter(_credentials(app_secret="invalid-test-secret"))

    assert adapter.test_credentials() == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "Lark rejected the credential test.",
        provider_error_code="10014",
    )


def test_lark_invalid_tenant_token_is_classified_as_authentication_rejected(replay: _LarkHTTPReplay) -> None:
    replay.responses["tenant"] = replay.exchanges["invalid_token"].response

    assert LarkIMProviderAdapter(_credentials()).test_credentials() == CredentialTestFailure(
        CredentialTestFailureKind.AUTHENTICATION_REJECTED,
        "Lark rejected the credential test.",
        provider_error_code="99991663",
        http_status=400,
    )


def test_lark_directory_does_not_publish_the_scoped_user_when_root_access_is_denied(replay: _LarkHTTPReplay) -> None:
    replay.responses["users"] = replay.exchanges["users_denied"].response
    assert LarkIMProviderAdapter(_credentials()).directory.read_directory() == DirectoryReadFailure(
        "Lark directory could not be read completely."
    )


@pytest.mark.usefixtures("replay")
def test_lark_directory_preserves_captured_order_and_missing_names_and_avatars() -> None:
    assert LarkIMProviderAdapter(_credentials()).directory.read_directory() == Directory(
        (
            DirectoryEntry(ProviderUserId("union_lark_user"), None, "lark-user@example.invalid", None),
            DirectoryEntry(ProviderUserId("union_lark_user_2"), None, "lark-user-2@example.invalid", None),
        )
    )


def test_lark_directory_discards_captured_users_when_department_access_fails(replay: _LarkHTTPReplay) -> None:
    replay.responses["departments"] = replay.exchanges["departments_denied"].response

    assert LarkIMProviderAdapter(_credentials()).directory.read_directory() == DirectoryReadFailure(
        "Lark directory could not be read completely."
    )


def test_lark_text_send_matches_the_captured_union_id_and_plain_text_request(replay: _LarkHTTPReplay) -> None:
    result = LarkIMProviderAdapter(_credentials()).messaging.send_text(
        ProviderUserId("union_lark_user"), "Lark protocol capture: **unit tests**\n\n测试消息"
    )

    assert isinstance(result, MessageAccepted)
    assert str(result.locator)
    assert replay.requests[-1] == replay.exchanges["text"].request


def test_lark_card_is_sent_and_only_the_original_message_is_replaced(replay: _LarkHTTPReplay) -> None:
    adapter = LarkIMProviderAdapter(_credentials())
    accepted = _send_card(adapter)

    assert (
        adapter.dynamic_card_messaging.replace_with_static(accepted.locator, StaticCardIntent("Capture **completed**."))
        is None
    )
    assert replay.requests[-2:] == [replay.exchanges["card"].request, replay.exchanges["replace"].request]


def test_lark_invalid_recipient_is_rejected_without_retry(replay: _LarkHTTPReplay) -> None:
    result = LarkIMProviderAdapter(_credentials()).messaging.send_text(
        ProviderUserId("union_lark_invalid"), "Lark unit test invalid recipient"
    )

    assert result == MessageSendingError("Lark message acceptance could not be confirmed.")
    assert replay.requests == [replay.exchanges["token"].request, replay.exchanges["invalid_recipient"].request]


def test_lark_reference_rejection_does_not_recreate_the_card(replay: _LarkHTTPReplay) -> None:
    adapter = LarkIMProviderAdapter(_credentials())
    accepted = _send_card(adapter)
    replay.responses["replace"] = replay.exchanges["invalid_reference"].response

    assert adapter.dynamic_card_messaging.replace_with_static(
        accepted.locator, StaticCardIntent("Capture **completed**.")
    ) == ReplacementError(ReplacementErrorKind.UNKNOWN, "Lark replacement acceptance is unknown.")
    assert replay.requests == [
        replay.exchanges["token"].request,
        replay.exchanges["card"].request,
        replay.exchanges["replace"].request,
    ]


def test_lark_card_rejection_is_safe_and_does_not_retry(replay: _LarkHTTPReplay) -> None:
    replay.responses["card"] = replay.exchanges["invalid_recipient"].response

    result = LarkIMProviderAdapter(_credentials()).dynamic_card_messaging.send_card(
        ProviderUserId("union_lark_user"), _intent(), CorrelationToken("lark-unit-test-correlation")
    )

    assert result == MessageSendingError("Lark card acceptance could not be confirmed.")
    assert replay.requests == [replay.exchanges["token"].request, replay.exchanges["card"].request]


@pytest.mark.parametrize("operation", ["text", "card"])
@pytest.mark.parametrize(
    "response_body", [{"code": 0}, {"code": 0, "data": {}}, {"code": 0, "data": {"message_id": ""}}]
)
def test_lark_cannot_confirm_acceptance_without_a_message_id(
    replay: _LarkHTTPReplay, operation: str, response_body: dict[str, JsonValue]
) -> None:
    replay.responses[operation] = _CapturedResponse(
        status=200, headers={"Content-Type": "application/json"}, body=response_body
    )
    adapter = LarkIMProviderAdapter(_credentials())

    if operation == "text":
        result = adapter.messaging.send_text(
            ProviderUserId("union_lark_user"), "Lark protocol capture: **unit tests**\n\n测试消息"
        )
    else:
        result = adapter.dynamic_card_messaging.send_card(
            ProviderUserId("union_lark_user"), _intent(), CorrelationToken("lark-unit-test-correlation")
        )

    assert isinstance(result, MessageSendingError)
    assert replay.requests == [replay.exchanges["token"].request, replay.exchanges[operation].request]


def test_lark_message_locator_is_rejected_by_feishu_without_a_mutation(replay: _LarkHTTPReplay) -> None:
    accepted = _send_card(LarkIMProviderAdapter(_credentials()))
    feishu = FeishuIMProviderAdapter(
        FeishuCredentials(
            provider=IMProvider.FEISHU,
            app_id="cli_sanitized_feishu_app",
            app_secret="sanitized-feishu-app-secret",
            verification_token=None,
            encrypt_key=None,
        )
    )

    assert feishu.dynamic_card_messaging.replace_with_static(
        accepted.locator, StaticCardIntent("Capture **completed**.")
    ) == ReplacementError(ReplacementErrorKind.INVALID_REFERENCE, "The Feishu message reference is invalid.")
    assert replay.requests == [replay.exchanges["token"].request, replay.exchanges["card"].request]


def test_lark_stream_discovers_its_endpoint_and_closes_the_official_transport(
    replay: _LarkHTTPReplay, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Socket:
        def __init__(self) -> None:
            self.closed = asyncio.Event()

        async def recv(self) -> bytes:
            await self.closed.wait()
            raise sdk_ws_module.ConnectionClosedException("sanitized connection closed")

        async def send(self, _body: bytes) -> None:
            return

        async def close(self) -> None:
            self.closed.set()

    connections: list[Socket] = []
    connected_urls: list[str] = []

    async def connect(url: str, **_kwargs: object) -> Socket:
        connected_urls.append(url)
        socket = Socket()
        connections.append(socket)
        return socket

    monkeypatch.setattr(sdk_ws_module.websockets, "connect", connect)
    adapter = LarkIMProviderAdapter(_credentials())
    stream = adapter.create_stream_handler(_NoEventsExpected())
    try:
        stream.start()
        stream.stop()
    finally:
        adapter.close()

    endpoint = replay.exchanges["stream_connect"].response.body["data"]
    assert isinstance(endpoint, dict)
    assert connected_urls == [endpoint["URL"]]
    assert len(connections) == 1
    assert connections[0].closed.is_set()
    assert replay.exchanges["stream_connect"].request in replay.requests
    assert replay.exchanges["bot_info"].request in replay.requests


def test_lark_stream_discovery_rejection_returns_a_safe_error_without_opening_a_socket(
    replay: _LarkHTTPReplay, monkeypatch: pytest.MonkeyPatch
) -> None:
    connection_attempts: list[str] = []

    async def connect(url: str, **_kwargs: object) -> None:
        connection_attempts.append(url)
        raise AssertionError("Rejected credentials must not open a WebSocket")

    monkeypatch.setattr(sdk_ws_module.websockets, "connect", connect)
    adapter = LarkIMProviderAdapter(_credentials(app_secret="invalid-test-secret"))
    stream = adapter.create_stream_handler(_NoEventsExpected())
    try:
        with pytest.raises(IMStreamStartError, match=r"^The Lark event stream could not be started\.$"):
            stream.start()
    finally:
        stream.stop()
        adapter.close()

    assert connection_attempts == []
    assert replay.exchanges["stream_connect_invalid"].request in replay.requests


def test_lark_captured_webhook_authenticates_decodes_and_updates_the_sent_card(replay: _LarkHTTPReplay) -> None:
    capture = _webhook_capture()
    consumer = _RecordingConsumer()
    adapter = LarkIMProviderAdapter(_credentials())
    accepted = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("union_lark_user"), _live_intent("webhook"), CorrelationToken("lark-live-webhook-correlation")
    )
    assert isinstance(accepted, MessageAccepted)

    response = adapter.create_webhook_handler(consumer).handle(_webhook_request(capture))

    assert response.status_code == capture.http.response.status
    assert response.body.decode() == capture.http.response.body
    assert len(consumer.events) == 1
    event = consumer.events[0]
    assert event.provider is IMProvider.LARK
    assert event.provider_tenant_id == capture.authenticated_event.provider_tenant_id
    assert event.event_id == capture.authenticated_event.event_id
    assert event.occurred_at == capture.authenticated_event.occurred_at
    assert event.ingress_kind is IMEventIngressKind.WEBHOOK
    assert event.payload == capture.authenticated_event.payload
    assert adapter.card_event_decoder().decode(event) == IMCardEvent(
        provider_user_id=ProviderUserId("union_lark_user"),
        action_id="approve",
        inputs={"comment": "Ready to ship", "decision": "hold"},
        correlation_token=CorrelationToken("lark-live-webhook-correlation"),
    )
    assert (
        adapter.dynamic_card_messaging.replace_with_static(
            accepted.locator, StaticCardIntent("Lark webhook capture completed.")
        )
        is None
    )
    assert replay.requests[-1] == replay.exchanges["webhook_replace"].request


def test_lark_captured_encrypted_url_challenge_needs_no_signature_or_tenant_lookup(replay: _LarkHTTPReplay) -> None:
    capture = _CallbackHTTP.model_validate_json(_FIXTURE_PATH.with_name("sanitized_url_challenge.json").read_text())
    request = capture.request
    handler = LarkIMProviderAdapter(_credentials()).create_webhook_handler(_NoEventsExpected())

    response = handler.handle(
        WebhookRequest(
            method=request.method, headers=request.headers, body=request.body.encode(), received_at=request.received_at
        )
    )

    assert response.status_code == capture.response.status
    assert json.loads(response.body) == json.loads(capture.response.body)
    assert replay.requests == []


@pytest.mark.parametrize("rejection", ["signature", "verification-token", "tenant"])
def test_lark_captured_webhook_rejects_untrusted_delivery_before_consuming(
    replay: _LarkHTTPReplay, rejection: str
) -> None:
    capture = _webhook_capture()
    credentials = _credentials()
    request = _webhook_request(capture)
    if rejection == "signature":
        request = WebhookRequest(
            method=request.method, headers=request.headers, body=request.body + b" ", received_at=request.received_at
        )
    elif rejection == "verification-token":
        credentials = credentials.model_copy(update={"verification_token": "different-test-token"})
    else:
        replay.responses["tenant"] = _CapturedResponse(
            status=200,
            headers={"Content-Type": "application/json"},
            body={"code": 0, "data": {"tenant": {"tenant_key": "different-test-tenant"}}},
        )
    consumer = _RecordingConsumer()

    response = LarkIMProviderAdapter(credentials).create_webhook_handler(consumer).handle(request)

    assert response.status_code == 401
    assert consumer.events == []


@pytest.mark.usefixtures("replay")
def test_lark_captured_webhook_does_not_ack_success_before_consumer_acceptance() -> None:
    consumer = _RecordingConsumer(EventAcceptance.NOT_ACCEPTED)
    handler = LarkIMProviderAdapter(_credentials()).create_webhook_handler(consumer)

    response = handler.handle(_webhook_request(_webhook_capture()))

    assert response.status_code == 503
    assert len(consumer.events) == 1


@pytest.mark.parametrize("acceptance", [EventAcceptance.ACCEPTED, EventAcceptance.NOT_ACCEPTED])
def test_lark_captured_stream_callback_and_wire_ack_follow_consumer_acceptance(
    replay: _LarkHTTPReplay, monkeypatch: pytest.MonkeyPatch, acceptance: EventAcceptance
) -> None:
    capture = _StreamCapture.model_validate_json(
        _FIXTURE_PATH.with_name("sanitized_card_action_stream.json").read_text()
    )
    ack = _ACKCapture.model_validate_json(_FIXTURE_PATH.with_name("sanitized_stream_ack.json").read_text())
    clients: list[_RecordedSDKStreamClient] = []

    def create_client(
        credentials: FeishuCredentials | LarkCredentials,
        domain: str,
        callback: Callable[[adapter_module._SDKEventEnvelope, Callable[[], None]], None],
    ) -> _RecordedSDKStreamClient:
        client = _RecordedSDKStreamClient(credentials, domain, callback)
        clients.append(client)
        return client

    monkeypatch.setattr(adapter_module, "_create_sdk_stream_client", create_client)
    consumer = _RecordingConsumer(acceptance)
    adapter = LarkIMProviderAdapter(_credentials())
    accepted = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("union_lark_user"), _live_intent("stream"), CorrelationToken("lark-live-stream-correlation")
    )
    assert isinstance(accepted, MessageAccepted)
    stream = adapter.create_stream_handler(consumer)
    try:
        stream.start()
    finally:
        stream.stop()
        adapter.close()

    assert len(consumer.events) == 1
    assert replay.exchanges["stream_card"].request in replay.requests
    event = consumer.events[0]
    assert event.provider is IMProvider.LARK
    assert event.ingress_kind is IMEventIngressKind.STREAM
    assert event.provider_tenant_id == capture.authenticated_event.provider_tenant_id
    assert event.event_id == capture.authenticated_event.event_id
    assert event.payload == capture.stream.sdk_serialization.value
    assert LarkIMProviderAdapter.card_event_decoder().decode(event) == IMCardEvent(
        provider_user_id=ProviderUserId("union_lark_user"),
        action_id="reject",
        inputs={"comment": "Ready to ship", "decision": "hold"},
        correlation_token=CorrelationToken("lark-live-stream-correlation"),
    )
    assert clients[0].stopped is True
    assert len(clients[0].writes) == 1
    response = Frame()
    response.ParseFromString(clients[0].writes[0])
    if acceptance is EventAcceptance.ACCEPTED:
        assert json.loads(response.payload) == json.loads(ack.response_payload)
        assert json.loads(base64.b64decode(json.loads(response.payload)["data"])) == {}
    else:
        assert json.loads(response.payload)["code"] == 500


def test_lark_captured_stream_card_reference_updates_only_the_sent_message(replay: _LarkHTTPReplay) -> None:
    adapter = LarkIMProviderAdapter(_credentials())
    accepted = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("union_lark_user"), _live_intent("stream"), CorrelationToken("lark-live-stream-correlation")
    )
    assert isinstance(accepted, MessageAccepted)

    assert (
        adapter.dynamic_card_messaging.replace_with_static(
            accepted.locator, StaticCardIntent("Lark stream capture completed.")
        )
        is None
    )
    assert replay.requests[-1] == replay.exchanges["stream_replace"].request
