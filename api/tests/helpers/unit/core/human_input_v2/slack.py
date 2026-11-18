"""Local Slack HTTP transport and form builders shared by Human Input tests."""

from __future__ import annotations

import json
import threading
from collections import defaultdict, deque
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import override
from urllib.parse import parse_qs

import pytest
from slack_sdk.web import WebClient

from core.human_input import ButtonStyle
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import slack as slack_adapter_module
from core.human_input_v2.im_integration.adapters.credentials import SlackCredentials
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
from core.human_input_v2.resolved_form import FormPart, MarkdownFragment, ResolvedForm, UserAction

SIGNING_SECRET = "sanitized-signing-material"


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
class SlackApiServer:
    server: _SlackApiHTTPServer
    state: _SlackApiState

    @property
    def base_url(self) -> str:
        address = self.server.server_address
        host = str(address[0])
        port = address[1]
        return f"http://{host}:{port}/api/"


@contextmanager
def run_slack_api_server() -> Generator[SlackApiServer]:
    """Yield a fresh local Slack server and stop its HTTP thread on exit."""
    state = _SlackApiState()
    server = _SlackApiHTTPServer(("127.0.0.1", 0), _SlackApiHandler)
    server.state = state
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    thread.start()
    try:
        yield SlackApiServer(server, state)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)
        assert not thread.is_alive()


def slack_credentials() -> SlackCredentials:
    return SlackCredentials(
        provider=IMProvider.SLACK,
        client_id="sanitized-client-id",
        client_secret="sanitized-client-secret",
        signing_secret=SIGNING_SECRET,
        bot_token="xoxb-sanitized-placeholder",
        app_token="xapp-sanitized-placeholder",
    )


def make_slack_form(
    *,
    blocks: tuple[FormPart, ...] = (MarkdownFragment(text="Sanitized rendered content"),),
    actions: tuple[UserAction, ...] | None = None,
    title: str = "Sanitized title",
) -> ResolvedForm:
    if actions is None:
        actions = (UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),)
    return ResolvedForm(
        title=title,
        parts=blocks,
        actions=actions,
        legacy_form_content="This value must not be rendered",
    )


def make_slack_adapter(
    monkeypatch: pytest.MonkeyPatch, server: SlackApiServer
) -> tuple[SlackIMProviderAdapter, WebClient]:
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
    return SlackIMProviderAdapter(slack_credentials()), client
