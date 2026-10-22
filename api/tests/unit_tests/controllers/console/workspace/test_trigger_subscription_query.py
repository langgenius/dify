"""Subscription reads exercise real admission, SQL visibility and daemon transport."""

from contextvars import Context
from http import HTTPStatus
from uuid import uuid4

import pytest
from sqlalchemy import delete

from core.plugin.entities.plugin_daemon import CredentialType
from models import TenantAccountJoin
from models.account import TenantAccountRole
from models.enums import PermissionEnum
from models.trigger import TriggerSubscription
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_provider_query
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_provider_query import _Daemon

application_redis = test_trigger_oauth_client.application_redis
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
