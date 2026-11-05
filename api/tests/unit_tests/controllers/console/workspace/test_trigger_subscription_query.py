"""Subscription reads exercise real admission, SQL visibility and daemon transport."""

import json
from contextvars import Context
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import override
from uuid import uuid4

import pytest
from sqlalchemy import delete

from core.plugin.entities.plugin_daemon import CredentialType
from models import TenantAccountJoin
from models.account import Account, AccountStatus, TenantAccountRole
from models.enums import PermissionEnum
from models.trigger import TriggerSubscription
from services.enterprise.base import EnterpriseRequest
from tests.helpers.unit.config_override import config_overrides_context
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_provider_query
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_provider_query import _Daemon

harness = test_trigger_oauth_client.harness
daemon = test_trigger_provider_query.daemon

_LIST = f"/console/api/workspaces/current/trigger-provider/{_PROVIDER}/subscriptions/list"


def _add_subscription(
    harness: _Harness,
    *,
    name: str = "subscription",
    tenant_id: str | None = None,
    user_id: str | None = None,
    provider_id: str = _PROVIDER,
    visibility: PermissionEnum = PermissionEnum.ALL_TEAM,
    credential_type: CredentialType = CredentialType.API_KEY,
    credentials: dict[str, str] | None = None,
    properties: dict[str, object] | None = None,
) -> TriggerSubscription:
    subscription = TriggerSubscription(
        name=name,
        tenant_id=tenant_id or harness.tenant_id,
        user_id=user_id or harness.account_id,
        provider_id=provider_id,
        endpoint_id=str(uuid4()),
        parameters={"event": "push"},
        properties=properties or {},
        credentials=credentials or {},
        credential_type=credential_type,
        visibility=visibility,
    )
    with harness.session_factory.begin() as session:
        session.add(subscription)
    return subscription


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR])
def test_empty_subscriptions_return_array_without_plugin_lookup(
    harness: _Harness, daemon: _Daemon, role: TenantAccountRole
) -> None:
    harness.set_role(role)

    response = Context().run(harness.call, "GET", url=_LIST)

    assert response.status_code == HTTPStatus.OK
    assert response.content_type == "application/json"
    assert response.get_json() == []
    assert daemon.requests == []


def test_owner_cannot_see_other_members_private_or_foreign_subscriptions(harness: _Harness, daemon: _Daemon) -> None:
    _add_subscription(harness, name="private", user_id=str(uuid4()), visibility=PermissionEnum.ONLY_ME)
    _add_subscription(harness, name="unshared", user_id=str(uuid4()), visibility=PermissionEnum.PARTIAL_TEAM)
    _add_subscription(harness, name="foreign-workspace", tenant_id=str(uuid4()))
    _add_subscription(harness, name="foreign-provider", provider_id="langgenius/github/other")

    response = Context().run(harness.call, "GET", url=f"{_LIST}?tenant_id=other-workspace")

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == []
    assert daemon.requests == []


@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
def test_subscriptions_require_editor_role_before_querying_plugin(
    harness: _Harness, daemon: _Daemon, role: TenantAccountRole
) -> None:
    harness.set_role(role)
    _add_subscription(harness)

    response = Context().run(harness.call, "GET", url=_LIST)

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "forbidden"
    assert daemon.requests == []


def test_uninitialized_member_without_editor_role_is_forbidden(harness: _Harness, daemon: _Daemon) -> None:
    harness.set_role(TenantAccountRole.NORMAL)
    with harness.session_factory.begin() as session:
        account = session.get(Account, harness.account_id)
        assert account is not None
        account.status = AccountStatus.UNINITIALIZED

    response = Context().run(harness.call, "GET", url=_LIST)

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "forbidden"
    assert daemon.requests == []


@pytest.mark.parametrize("allowed", [False, True], ids=["permission-denied", "permission-granted"])
def test_rbac_precedes_account_initialization(harness: _Harness, daemon: _Daemon, allowed: bool) -> None:
    harness.set_role(TenantAccountRole.NORMAL)
    with harness.session_factory.begin() as session:
        account = session.get(Account, harness.account_id)
        assert account is not None
        account.status = AccountStatus.UNINITIALIZED

    requests: list[dict[str, object]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            assert self.path == "/rbac/check-access"
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            body = json.dumps({"allowed": allowed}).encode()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    previous_url = EnterpriseRequest.rbac_base_url
    EnterpriseRequest.rbac_base_url = f"http://127.0.0.1:{server.server_port}"
    thread.start()
    try:
        with config_overrides_context(RBAC_ENABLED=True):
            response = Context().run(harness.call, "GET", url=_LIST)
    finally:
        EnterpriseRequest.rbac_base_url = previous_url
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert response.status_code == (HTTPStatus.BAD_REQUEST if allowed else HTTPStatus.FORBIDDEN)
    assert response.get_json()["code"] == ("account_not_initialized" if allowed else "forbidden")
    assert len(requests) == 1
    assert requests[0]["account_id"] == harness.account_id
    assert requests[0]["tenant_id"] == harness.tenant_id
    assert requests[0]["scene"] == "plugin_preferences"
    assert daemon.requests == []


def test_subscriptions_require_login(harness: _Harness, daemon: _Daemon) -> None:
    response = harness.client.get(_LIST)

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert daemon.requests == []


def test_subscriptions_require_workspace_membership(harness: _Harness, daemon: _Daemon) -> None:
    with harness.session_factory.begin() as session:
        session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account_id))

    response = Context().run(harness.call, "GET", url=_LIST)

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert daemon.requests == []


def test_invalid_provider_preserves_not_found_response(harness: _Harness, daemon: _Daemon) -> None:
    response = harness.call("GET", url=_LIST.replace(_PROVIDER, "not/a/valid/provider"))

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json() == {"error": "Invalid plugin id not/a/valid/provider"}
    assert daemon.requests == []


def test_plugin_failure_propagates_after_query_transaction_closes(harness: _Harness, daemon: _Daemon) -> None:
    _add_subscription(harness)
    daemon.status = HTTPStatus.SERVICE_UNAVAILABLE

    response = Context().run(harness.call, "GET", url=_LIST)

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.get_json()["status"] == HTTPStatus.INTERNAL_SERVER_ERROR
    assert len(daemon.requests) == 1
    assert not daemon.requests[0].open_transactions
