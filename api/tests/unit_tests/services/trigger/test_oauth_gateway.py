"""Exercise the trigger gateway and real OAuth transport against a local HTTP server."""

import json
from collections.abc import Iterator
from contextlib import closing
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import override

import pytest
from werkzeug import Request
from werkzeug.test import EnvironBuilder
from yarl import URL

from configs import dify_config
from core.plugin.impl import base as plugin_transport
from core.plugin.impl.oauth import OAuthHandler
from models.provider_ids import TriggerProviderID
from services.plugin.dispatch_identity import PluginOAuthClientConfig
from services.trigger.oauth_gateway import PluginTriggerOAuthGateway
from services.trigger.oauth_service import TriggerOAuthCallbackRequest, TriggerOAuthProviderError

_PROVIDER = TriggerProviderID("langgenius/github/github")
_REDIRECT_URI = "https://console.example/console/api/oauth/plugin/langgenius/github/github/trigger/callback"
_CLIENT_PARAMS: dict[str, object] = {"client_id": "client-id", "client_secret": "client-secret"}
_IDENTIFIER = "langgenius/github:1.0.0@test"
_CLIENT_CONFIG = PluginOAuthClientConfig(_IDENTIFIER, _CLIENT_PARAMS)


@dataclass(frozen=True)
class _DaemonRequest:
    path: str
    headers: dict[str, str]
    payload: dict[str, object]


@dataclass
class _Daemon:
    gateway: PluginTriggerOAuthGateway
    response: bytes = b""
    requests: list[_DaemonRequest] = field(default_factory=list)

    def respond(self, payload: dict[str, object]) -> None:
        self.response = f"data: {json.dumps(payload)}\n\n".encode()


@pytest.fixture
def daemon() -> Iterator[_Daemon]:
    daemon = _Daemon(gateway=PluginTriggerOAuthGateway(oauth=OAuthHandler()))

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            daemon.requests.append(_DaemonRequest(self.path, dict(self.headers.items()), payload))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(daemon.response)))
            self.end_headers()
            self.wfile.write(daemon.response)

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    previous_url = plugin_transport.plugin_daemon_inner_api_baseurl
    plugin_transport.plugin_daemon_inner_api_baseurl = URL(f"http://127.0.0.1:{server.server_port}")
    thread.start()
    try:
        yield daemon
    finally:
        plugin_transport.plugin_daemon_inner_api_baseurl = previous_url
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_authorization_url_preserves_provider_and_client_configuration(daemon: _Daemon) -> None:
    daemon.respond({"code": 0, "message": "", "data": {"authorization_url": "https://github.example/authorize"}})

    result = daemon.gateway.authorization_url(
        tenant_id="workspace",
        user_id="account",
        provider_id=_PROVIDER,
        redirect_uri=_REDIRECT_URI,
        client_config=_CLIENT_CONFIG,
    )

    assert result == "https://github.example/authorize"
    assert len(daemon.requests) == 1
    sent = daemon.requests[0]
    assert sent.path == "/plugin/workspace/dispatch/oauth/get_authorization_url"
    assert sent.headers["X-Plugin-ID"] == "langgenius/github"
    assert sent.headers["X-Plugin-Unique-Identifier"] == _IDENTIFIER
    assert sent.headers["X-Api-Key"] == dify_config.PLUGIN_DAEMON_KEY
    assert sent.payload == {
        "user_id": "account",
        "data": {"provider": "github", "redirect_uri": _REDIRECT_URI, "system_credentials": _CLIENT_PARAMS},
    }


@pytest.mark.parametrize(
    ("query_string", "headers", "body"),
    [
        pytest.param("", {}, b"", id="trailing-query-marker"),
        pytest.param("code=a%2Bb&state=first&state=second&empty=", {}, b"", id="raw-query"),
        pytest.param("code=abc", {"HTTP_VERSION": "HTTP/2", "X-Custom": "value"}, b"", id="http-version"),
        pytest.param("code=abc", {"Content-Type": "application/octet-stream"}, b"\x00\xffpayload", id="raw-body"),
    ],
)
def test_exchange_preserves_legacy_raw_request_bytes(
    daemon: _Daemon, query_string: str, headers: dict[str, str], body: bytes
) -> None:
    daemon.respond(
        {"code": 0, "message": "", "data": {"credentials": {"access_token": "provider-token"}, "expires_at": 12345}}
    )
    with closing(
        EnvironBuilder(method="GET", path="/callback", query_string=query_string, headers=headers.items(), data=body)
    ) as builder:
        request = Request(builder.get_environ())
        expected_raw_request = OAuthHandler()._convert_request_to_raw_data(request)
        callback = TriggerOAuthCallbackRequest(
            method=request.method,
            full_path=request.full_path,
            headers=tuple(request.headers.items()),
            body=request.get_data(),
        )

    result = daemon.gateway.exchange_credentials(
        tenant_id="workspace",
        user_id="account",
        provider_id=_PROVIDER,
        redirect_uri=_REDIRECT_URI,
        client_config=_CLIENT_CONFIG,
        callback=callback,
    )

    assert result.credentials == {"access_token": "provider-token"}
    assert result.expires_at == 12345
    assert len(daemon.requests) == 1
    sent = daemon.requests[0]
    assert sent.path == "/plugin/workspace/dispatch/oauth/get_credentials"
    assert sent.headers["X-Plugin-ID"] == "langgenius/github"
    assert sent.headers["X-Plugin-Unique-Identifier"] == _IDENTIFIER
    assert sent.payload == {
        "user_id": "account",
        "data": {
            "provider": "github",
            "redirect_uri": _REDIRECT_URI,
            "system_credentials": _CLIENT_PARAMS,
            "raw_http_request": expected_raw_request.hex(),
        },
    }


@pytest.mark.parametrize("identifier", [None, _IDENTIFIER], ids=["legacy-unpinned", "pinned-package"])
def test_request_wrapper_preserves_optional_package_identifier(daemon: _Daemon, identifier: str | None) -> None:
    daemon.respond(
        {"code": 0, "message": "", "data": {"credentials": {"access_token": "provider-token"}, "expires_at": 12345}}
    )
    with closing(Request.from_values("/callback?code=abc")) as request:
        handler = OAuthHandler()
        raw_request = handler._convert_request_to_raw_data(request)
        result = handler.get_credentials(
            tenant_id="workspace",
            user_id="account",
            plugin_id=_PROVIDER.plugin_id,
            provider=_PROVIDER.provider_name,
            redirect_uri=_REDIRECT_URI,
            system_credentials=_CLIENT_PARAMS,
            request=request,
            plugin_unique_identifier=identifier,
        )

    assert result.credentials == {"access_token": "provider-token"}
    assert len(daemon.requests) == 1
    sent = daemon.requests[0]
    assert sent.headers.get("X-Plugin-Unique-Identifier") == identifier
    assert sent.payload == {
        "user_id": "account",
        "data": {
            "provider": "github",
            "redirect_uri": _REDIRECT_URI,
            "system_credentials": _CLIENT_PARAMS,
            "raw_http_request": raw_request.hex(),
        },
    }


@pytest.mark.parametrize("operation", ["authorization", "exchange"])
@pytest.mark.parametrize("failure", ["rejected", "invalid-response", "empty-stream"])
def test_provider_failures_become_domain_errors(daemon: _Daemon, operation: str, failure: str) -> None:
    if failure == "rejected":
        daemon.respond({"code": 42, "message": "OAuth provider rejected the request", "data": None})
    elif failure == "invalid-response":
        daemon.respond({"code": 0, "message": "", "data": {}})

    if operation == "authorization":
        with pytest.raises(TriggerOAuthProviderError) as caught:
            daemon.gateway.authorization_url(
                tenant_id="workspace",
                user_id="account",
                provider_id=_PROVIDER,
                redirect_uri=_REDIRECT_URI,
                client_config=_CLIENT_CONFIG,
            )
    else:
        with pytest.raises(TriggerOAuthProviderError) as caught:
            daemon.gateway.exchange_credentials(
                tenant_id="workspace",
                user_id="account",
                provider_id=_PROVIDER,
                redirect_uri=_REDIRECT_URI,
                client_config=_CLIENT_CONFIG,
                callback=TriggerOAuthCallbackRequest("GET", "/callback?code=abc", (), b""),
            )

    assert len(daemon.requests) == 1
    assert isinstance(caught.value.__cause__, ValueError)
    assert "client-secret" not in str(caught.value)
