"""Builder admission and transport failures run through the real Console HTTP entrypoints."""

import json
from collections.abc import Iterator
from contextvars import Context
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import override

import pytest
from yarl import URL

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl import base as plugin_transport
from core.plugin.impl.trigger import PluginTriggerClient
from extensions.ext_redis import redis_client
from models.account import TenantAccountRole
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_provider_query import _provider

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness

_BASE = f"/console/api/workspaces/current/trigger-provider/{_PROVIDER}/subscriptions/builder"
_ROUTES = [
    pytest.param("POST", "create", {"credential_type": "api-key"}, id="create"),
    pytest.param("GET", "builder-id", None, id="get"),
    pytest.param("POST", "update/builder-id", {"name": "Updated"}, id="update"),
    pytest.param("POST", "verify-and-update/builder-id", {"credentials": {}}, id="verify"),
    pytest.param("GET", "logs/builder-id", None, id="logs"),
    pytest.param("POST", "build/builder-id", {"name": "Built"}, id="build"),
]


@dataclass(frozen=True)
class _DaemonRequest:
    method: str
    path: str
    headers: dict[str, str]
    payload: dict[str, object]
    open_transactions: bool
    lock_held: bool | None


@dataclass
class _Daemon:
    provider: dict[str, object] = field(default_factory=_provider)
    response_data: dict[str, object] | None = field(default_factory=lambda: {"result": True})
    responses_by_path: dict[str, dict[str, object] | None] = field(default_factory=dict)
    response_codes_by_path: dict[str, int] = field(default_factory=dict)
    observed_lock_key: str | None = None
    response_code: int = 0
    response_message: str = ""
    status: HTTPStatus = HTTPStatus.OK
    post_status: HTTPStatus = HTTPStatus.OK
    requests: list[_DaemonRequest] = field(default_factory=list)


@pytest.fixture
def daemon(harness: _Harness) -> Iterator[_Daemon]:
    daemon = _Daemon()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.respond({}, daemon.provider, daemon.status, streamed=False)

        def do_POST(self) -> None:
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            data = daemon.responses_by_path.get(self.path, daemon.response_data)
            self.respond(payload, data, daemon.post_status, streamed=True)

        def respond(
            self, payload: dict[str, object], data: dict[str, object] | None, status: HTTPStatus, *, streamed: bool
        ) -> None:
            daemon.requests.append(
                _DaemonRequest(
                    self.command,
                    self.path,
                    dict(self.headers.items()),
                    payload,
                    any(session.in_transaction() for session in harness.metadata.sessions),
                    bool(redis_client.exists(daemon.observed_lock_key))
                    if daemon.observed_lock_key is not None
                    else None,
                )
            )
            body = json.dumps(
                {
                    "code": daemon.response_codes_by_path.get(self.path, daemon.response_code) if streamed else 0,
                    "message": daemon.response_message if streamed else "",
                    "data": data,
                }
            )
            encoded = f"data: {body}\n\n".encode() if streamed else body.encode()
            self.send_response(status)
            self.send_header("Content-Type", "text/event-stream" if streamed else "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

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


@pytest.mark.parametrize(("method", "path", "payload"), _ROUTES)
def test_builder_routes_require_login(
    harness: _Harness, daemon: _Daemon, method: str, path: str, payload: dict[str, object] | None
) -> None:
    response = harness.client.open(f"{_BASE}/{path}", method=method, json=payload)

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert daemon.requests == []


@pytest.mark.parametrize(("method", "path", "payload"), _ROUTES)
@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
def test_builder_routes_require_editor_role_before_external_io(
    harness: _Harness,
    daemon: _Daemon,
    method: str,
    path: str,
    payload: dict[str, object] | None,
    role: TenantAccountRole,
) -> None:
    harness.set_role(role)

    response = Context().run(harness.call, method, url=f"{_BASE}/{path}", payload=payload)

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "forbidden"
    assert daemon.requests == []


@pytest.mark.parametrize(("method", "path", "payload"), _ROUTES)
def test_builder_routes_reject_invalid_provider_before_external_io(
    harness: _Harness, daemon: _Daemon, method: str, path: str, payload: dict[str, object] | None
) -> None:
    url = f"{_BASE}/{path}".replace(_PROVIDER, "not/a/valid/provider")

    response = Context().run(harness.call, method, url=url, payload=payload)

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert daemon.requests == []


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        pytest.param("create", {"credential_type": []}, id="create"),
        pytest.param("update/builder-id", {"parameters": []}, id="update"),
        pytest.param("verify-and-update/builder-id", {"credentials": []}, id="verify"),
        pytest.param("build/builder-id", {"name": []}, id="build"),
    ],
)
def test_builder_routes_validate_payload_before_external_io(
    harness: _Harness, daemon: _Daemon, path: str, payload: dict[str, object]
) -> None:
    response = Context().run(harness.call, "POST", url=f"{_BASE}/{path}", payload=payload)

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert daemon.requests == []


def test_create_provider_failure_occurs_after_admission_transaction_closes(harness: _Harness, daemon: _Daemon) -> None:
    daemon.status = HTTPStatus.SERVICE_UNAVAILABLE

    response = Context().run(harness.call, "POST", url=f"{_BASE}/create", payload={"credential_type": "api-key"})

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.get_json()["status"] == HTTPStatus.INTERNAL_SERVER_ERROR
    assert len(daemon.requests) == 1
    assert not daemon.requests[0].open_transactions


def test_subscribe_transport_preserves_explicit_plugin_rejection(harness: _Harness, daemon: _Daemon) -> None:
    daemon.response_code = 1
    daemon.response_message = "subscription rejected"
    daemon.response_data = None
    client = PluginTriggerClient(plugin_unique_identifier="langgenius/github:1.0.0@package-hash")

    with pytest.raises(ValueError, match="^plugin daemon: subscription rejected, code: 1$"):
        client.subscribe(
            tenant_id=harness.tenant_id,
            user_id=harness.account_id,
            provider=_PROVIDER,
            credentials={},
            credential_type=CredentialType.OAUTH2,
            endpoint="https://example.test/triggers/plugin/builder",
            parameters={},
        )

    assert len(daemon.requests) == 1
    assert daemon.requests[0].path.endswith("/dispatch/trigger/subscribe")
