"""Provider queries exercise real admission, gateway and plugin-daemon HTTP transport."""

import json
from collections.abc import Iterator
from contextvars import Context
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import override
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import delete
from yarl import URL

from configs import dify_config
from core.plugin.impl import base as plugin_transport
from models import TenantAccountJoin
from models.account import TenantAccountRole
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness

_LIST = "/console/api/workspaces/current/triggers"
_INFO = f"/console/api/workspaces/current/trigger-provider/{_PROVIDER}/info"
_ICON = f"/console/api/workspaces/current/trigger-provider/{_PROVIDER}/icon"
_IDENTIFIER = "langgenius/github:1.0.0@package-hash"


def _provider() -> dict[str, object]:
    return {
        "provider": "github",
        "plugin_id": "langgenius/github",
        "plugin_unique_identifier": _IDENTIFIER,
        "declaration": {
            "identity": {
                "author": "Dify",
                "name": "github",
                "label": {"en_US": "GitHub"},
                "description": {"en_US": "GitHub trigger"},
                "icon": "icon.svg",
                "tags": ["code"],
            },
            "events": [
                {
                    "identity": {"author": "Dify", "name": "push", "label": {"en_US": "Push"}},
                    "description": {"en_US": "Repository push"},
                    "output_schema": {"type": "object"},
                }
            ],
        },
    }


@dataclass(frozen=True)
class _DaemonRequest:
    path: str
    headers: dict[str, str]
    open_transactions: bool


@dataclass
class _Daemon:
    response: dict[str, object] | list[dict[str, object]] = field(default_factory=_provider)
    status: HTTPStatus = HTTPStatus.OK
    requests: list[_DaemonRequest] = field(default_factory=list)


@pytest.fixture
def daemon(harness: _Harness) -> Iterator[_Daemon]:
    daemon = _Daemon()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            daemon.requests.append(
                _DaemonRequest(
                    path=self.path,
                    headers=dict(self.headers.items()),
                    open_transactions=any(session.in_transaction() for session in harness.metadata.sessions),
                )
            )
            response = json.dumps({"code": 0, "message": "", "data": daemon.response}).encode()
            self.send_response(daemon.status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

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


def _localized(text: str) -> dict[str, str]:
    return dict.fromkeys(("en_US", "zh_Hans", "pt_BR", "ja_JP"), text)


def _expected_provider(tenant_id: str) -> dict[str, object]:
    return {
        "author": "Dify",
        "name": _PROVIDER,
        "label": _localized("GitHub"),
        "description": _localized("GitHub trigger"),
        "icon": f"https://console.example.test/console/api/workspaces/current/plugin/icon?tenant_id={tenant_id}&filename=icon.svg",
        "icon_dark": None,
        "tags": ["code"],
        "plugin_id": "langgenius/github",
        "plugin_unique_identifier": _IDENTIFIER,
        "supported_creation_methods": ["MANUAL"],
        "subscription_constructor": None,
        "subscription_schema": [],
        "events": [
            {
                "name": "push",
                "identity": {
                    "author": "Dify",
                    "name": "push",
                    "label": _localized("Push"),
                    "provider": _PROVIDER,
                },
                "description": _localized("Repository push"),
                "parameters": [],
                "output_schema": {"type": "object"},
            }
        ],
    }


@pytest.mark.parametrize("url", [_LIST, _INFO, _ICON], ids=["list", "info", "icon"])
def test_queries_keep_response_shapes_and_use_active_workspace_after_admission(
    harness: _Harness, daemon: _Daemon, url: str
) -> None:
    harness.set_role(TenantAccountRole.NORMAL)
    if url == _LIST:
        daemon.response = [_provider()]

    # A fresh context uses the real per-request provider cache without leaking it
    # to another test. Query-string workspace IDs must not override admission.
    response = Context().run(harness.call, "GET", url=f"{url}?tenant_id=other-workspace")

    assert response.status_code == HTTPStatus.OK
    assert response.content_type == "application/json"
    expected = _expected_provider(harness.tenant_id)
    if url == _LIST:
        assert response.get_json() == [expected]
    elif url == _INFO:
        assert response.get_json() == expected
    else:
        assert response.get_json() == expected["icon"]
        assert "Location" not in response.headers
    assert len(daemon.requests) == 1
    sent = daemon.requests[0]
    upstream = urlsplit(sent.path)
    assert upstream.path == f"/plugin/{harness.tenant_id}/management/{'triggers' if url == _LIST else 'trigger'}"
    assert parse_qs(upstream.query) == (
        {"page": ["1"], "page_size": ["256"]}
        if url == _LIST
        else {"provider": ["github"], "plugin_id": ["langgenius/github"]}
    )
    assert sent.headers["X-Api-Key"] == dify_config.PLUGIN_DAEMON_KEY
    assert harness.metadata.sessions
    assert not sent.open_transactions


def test_empty_provider_list_is_an_empty_json_array(harness: _Harness, daemon: _Daemon) -> None:
    daemon.response = []

    response = Context().run(harness.call, "GET", url=_LIST)

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == []
    assert len(daemon.requests) == 1


@pytest.mark.parametrize("url", [_LIST, _INFO, _ICON], ids=["list", "info", "icon"])
def test_queries_require_login_before_plugin_lookup(harness: _Harness, daemon: _Daemon, url: str) -> None:
    response = Context().run(harness.client.get, url)

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert daemon.requests == []


@pytest.mark.parametrize("url", [_LIST, _INFO, _ICON], ids=["list", "info", "icon"])
def test_queries_reject_account_without_workspace_membership(harness: _Harness, daemon: _Daemon, url: str) -> None:
    with harness.session_factory.begin() as session:
        session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account_id))

    response = Context().run(harness.call, "GET", url=url)

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert daemon.requests == []


@pytest.mark.parametrize("url", [_INFO, _ICON], ids=["info", "icon"])
def test_invalid_provider_is_rejected_before_plugin_lookup(harness: _Harness, daemon: _Daemon, url: str) -> None:
    response = Context().run(harness.call, "GET", url=url.replace(_PROVIDER, "not/a/valid/provider"))

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert daemon.requests == []


@pytest.mark.parametrize("url", [_LIST, _INFO, _ICON], ids=["list", "info", "icon"])
def test_daemon_failure_is_not_returned_as_success(harness: _Harness, daemon: _Daemon, url: str) -> None:
    daemon.status = HTTPStatus.SERVICE_UNAVAILABLE

    response = Context().run(harness.call, "GET", url=url)

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.get_json()["status"] == HTTPStatus.INTERNAL_SERVER_ERROR
    assert len(daemon.requests) == 1
    assert not daemon.requests[0].open_transactions
