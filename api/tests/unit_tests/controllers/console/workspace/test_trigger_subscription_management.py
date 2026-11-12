"""Formal subscription admission and scope checks use the real HTTP and SQL paths."""

from contextvars import Context
from http import HTTPStatus
from uuid import uuid4

import pytest

from core.plugin.entities.plugin_daemon import CredentialType
from models.account import TenantAccountRole
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_query import _add_subscription

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


def _url(operation: str, subscription_id: str, provider: str = _PROVIDER) -> str:
    base = "/console/api/workspaces/current/trigger-provider"
    if operation == "verify":
        return f"{base}/{provider}/subscriptions/verify/{subscription_id}"
    return f"{base}/{subscription_id}/subscriptions/{operation}"


def _payload(operation: str) -> dict[str, object]:
    if operation == "verify":
        return {"credentials": {"token": "request-secret"}}
    return {"name": "Updated"} if operation == "update" else {}


@pytest.mark.parametrize("operation", ["update", "delete", "verify"])
def test_management_requires_login(harness: _Harness, daemon: _Daemon, operation: str) -> None:
    response = harness.client.post(_url(operation, str(uuid4())), json=_payload(operation))

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert daemon.requests == []


@pytest.mark.parametrize(
    ("operation", "role"),
    [
        ("update", TenantAccountRole.NORMAL),
        ("update", TenantAccountRole.DATASET_OPERATOR),
        ("verify", TenantAccountRole.NORMAL),
        ("verify", TenantAccountRole.DATASET_OPERATOR),
        ("delete", TenantAccountRole.NORMAL),
        ("delete", TenantAccountRole.DATASET_OPERATOR),
        ("delete", TenantAccountRole.EDITOR),
    ],
)
def test_management_preserves_editor_and_admin_role_boundaries(
    harness: _Harness, daemon: _Daemon, operation: str, role: TenantAccountRole
) -> None:
    harness.set_role(role)
    subscription = _add_subscription(harness)

    response = Context().run(harness.call, "POST", url=_url(operation, subscription.id), payload=_payload(operation))

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "forbidden"
    assert daemon.requests == []


@pytest.mark.parametrize("operation", ["update", "delete", "verify"])
@pytest.mark.parametrize("exists_in_other_tenant", [False, True], ids=["missing", "foreign-tenant"])
def test_missing_or_foreign_subscriptions_fail_before_plugin_or_secret_access(
    harness: _Harness, daemon: _Daemon, operation: str, exists_in_other_tenant: bool
) -> None:
    subscription_id = (
        _add_subscription(harness, tenant_id=str(uuid4()), credentials={"token": "must-not-leave-workspace"}).id
        if exists_in_other_tenant
        else str(uuid4())
    )

    response = Context().run(harness.call, "POST", url=_url(operation, subscription_id), payload=_payload(operation))

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "trigger_subscription_not_found"
    assert daemon.requests == []


def test_verify_provider_mismatch_is_rejected_before_plugin_lookup(harness: _Harness, daemon: _Daemon) -> None:
    subscription = _add_subscription(harness, credentials={"token": "must-not-reach-other-plugin"})

    response = Context().run(
        harness.call,
        "POST",
        url=_url("verify", subscription.id, "langgenius/other/other"),
        payload={"credentials": {}},
    )

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "trigger_subscription_not_found"
    assert daemon.requests == []


@pytest.mark.parametrize(
    ("operation", "payload"),
    [("update", {}), ("update", {"properties": []}), ("verify", {"credentials": []})],
)
def test_management_rejects_invalid_payloads_before_external_io(
    harness: _Harness, daemon: _Daemon, operation: str, payload: dict[str, object]
) -> None:
    response = harness.call("POST", url=_url(operation, str(uuid4())), payload=payload)

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert daemon.requests == []


@pytest.mark.parametrize("credential_type", [CredentialType.UNAUTHORIZED, CredentialType.OAUTH2])
def test_editor_can_verify_non_api_key_subscription_without_plugin_call(
    harness: _Harness, daemon: _Daemon, credential_type: CredentialType
) -> None:
    harness.set_role(TenantAccountRole.EDITOR)
    subscription = _add_subscription(harness, credential_type=credential_type)

    response = harness.call("POST", url=_url("verify", subscription.id), payload={"credentials": {}})

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"verified": True}
    assert daemon.requests == []


def test_verify_provider_failure_returns_specific_error_after_read_transaction_closes(
    harness: _Harness, daemon: _Daemon
) -> None:
    subscription = _add_subscription(harness)
    daemon.status = HTTPStatus.SERVICE_UNAVAILABLE

    response = Context().run(harness.call, "POST", url=_url("verify", subscription.id), payload={"credentials": {}})

    assert response.status_code == HTTPStatus.BAD_GATEWAY
    assert response.get_json()["code"] == "trigger_subscription_provider_error"
    assert _PROVIDER in response.get_json()["message"]
    assert len(daemon.requests) == 1
    assert not daemon.requests[0].open_transactions
