"""Run tracing endpoints preserve resource ownership, acknowledgement and error contracts."""

import inspect
from datetime import UTC, datetime, timedelta, timezone
from functools import wraps
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from flask import Flask
from flask_restx import Resource
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.rbac import AgentId, PlainApp
from controllers.console import flask_admission
from controllers.console.agent import tracing_runs
from libs.external_api import ExternalApi
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, AccountStatus, TenantAccountRole
from repositories.application_trace_repository import TraceCollectionError
from services.app.agent_app_contracts import AgentAppNotFoundError
from tests.unit_tests.config_override import apply_config_overrides

CONTEXT = RequestContext("request", None, "account", "tenant")
AGENT_ID = UUID("01a11111-1111-7111-8111-111111111111")
APP_ID = UUID("01a22222-2222-7222-8222-222222222222")
SOURCE_ID = UUID("01a33333-3333-7333-8333-333333333333")
NODE_ID = UUID("01a44444-4444-7444-8444-444444444444")


@pytest.fixture
def services(monkeypatch):
    owners, runs = MagicMock(), MagicMock()
    owners.resolve_app_id.return_value = str(APP_ID)
    status = {"status": "not_collected", "source_kind": "message", "source_id": str(SOURCE_ID)}
    runs.status.return_value = status
    runs.retry.return_value = {**status, "status": "retrying"}
    monkeypatch.setattr(tracing_runs, "application_services", lambda: SimpleNamespace(agent_tracing_configs=owners))
    monkeypatch.setattr(tracing_runs, "application_tracing_service", lambda: runs)
    return owners, runs


@pytest.mark.parametrize(
    "accepted_at",
    [
        datetime(2026, 1, 1),
        datetime(2026, 1, 1, tzinfo=UTC),
        datetime(2026, 1, 1, 8, tzinfo=timezone(timedelta(hours=8))),
    ],
)
def test_agent_status_resolves_owner_and_never_exposes_destination_secrets(app: Flask, services, accepted_at) -> None:
    owners, runs = services
    runs.status.return_value.update(
        {
            "status": "accepted",
            "provider": "langfuse",
            "trace_id": "trace-id",
            "trace_url": "https://example.com/trace",
            "accepted_at": accepted_at,
            "queryable": None,
            "provider_config": {"secret_key": "do-not-return"},
            "config_revision": "frozen-revision",
        }
    )
    with app.test_request_context(f"/?node_execution_id={NODE_ID}"):
        result = inspect.unwrap(tracing_runs.AgentTraceRunApi.get)(
            tracing_runs.AgentTraceRunApi(), CONTEXT, AGENT_ID, SOURCE_ID
        )
    owners.resolve_app_id.assert_called_once_with(CONTEXT, str(AGENT_ID))
    runs.status.assert_called_once_with(
        tenant_id="tenant",
        app_id=str(APP_ID),
        source_kind="message",
        source_id=str(SOURCE_ID),
        node_execution_id=str(NODE_ID),
    )
    assert result["accepted_at"] == "2026-01-01T00:00:00Z"
    assert result["queryable"] is None
    assert result["config_revision"] == "frozen-revision"
    assert "provider_config" not in result
    assert "do-not-return" not in str(result)


@pytest.mark.parametrize("kind", ["message", "workflow", "node"])
def test_app_status_source_scope_and_not_collected(app: Flask, services, kind) -> None:
    owners, runs = services
    runs.status.return_value["source_kind"] = kind
    with app.test_request_context():
        result = inspect.unwrap(tracing_runs.AppTraceRunApi.get)(
            tracing_runs.AppTraceRunApi(), CONTEXT, APP_ID, kind, SOURCE_ID
        )
    owners.resolve_app_id.assert_not_called()
    assert result["status"] == "not_collected"
    runs.status.assert_called_once_with(
        tenant_id="tenant", app_id=str(APP_ID), source_kind=kind, source_id=str(SOURCE_ID), node_execution_id=None
    )


@pytest.mark.parametrize("ack", [False, True])
@pytest.mark.parametrize("agent", [False, True])
def test_retry_forwards_only_frozen_run_identity_and_explicit_ack(app: Flask, services, ack, agent) -> None:
    _, runs = services
    with app.test_request_context(
        f"/?node_execution_id={NODE_ID}", method="POST", json={"acknowledge_possible_duplicates": ack} if ack else {}
    ):
        if agent:
            result = inspect.unwrap(tracing_runs.AgentTraceRunRetryApi.post)(
                tracing_runs.AgentTraceRunRetryApi(), CONTEXT, AGENT_ID, SOURCE_ID
            )
        else:
            result = inspect.unwrap(tracing_runs.AppTraceRunRetryApi.post)(
                tracing_runs.AppTraceRunRetryApi(), CONTEXT, APP_ID, "message", SOURCE_ID
            )
    assert result["status"] == "retrying"
    runs.retry.assert_called_once_with(
        tenant_id="tenant",
        app_id=str(APP_ID),
        source_kind="message",
        source_id=str(SOURCE_ID),
        node_execution_id=str(NODE_ID),
        acknowledge_possible_duplicates=ack,
    )


@pytest.mark.parametrize("payload", [{"provider": "different-provider"}, {"acknowledge_possible_duplicates": "true"}])
def test_retry_rejects_destination_changes_and_non_boolean_ack(app: Flask, services, payload) -> None:
    _, runs = services
    with app.test_request_context(method="POST", json=payload), pytest.raises(ValidationError):
        inspect.unwrap(tracing_runs.AppTraceRunRetryApi.post)(
            tracing_runs.AppTraceRunRetryApi(), CONTEXT, APP_ID, "message", SOURCE_ID
        )
    runs.retry.assert_not_called()


def test_source_kind_is_validated_before_service_lookup(app: Flask, services) -> None:
    _, runs = services
    with app.test_request_context(), pytest.raises(ValidationError):
        inspect.unwrap(tracing_runs.AppTraceRunApi.get)(
            tracing_runs.AppTraceRunApi(), CONTEXT, APP_ID, "unknown", SOURCE_ID
        )
    runs.status.assert_not_called()


def test_agent_owner_rejection_prevents_run_lookup(app: Flask, services) -> None:
    owners, runs = services
    owners.resolve_app_id.side_effect = AgentAppNotFoundError
    with app.test_request_context(), pytest.raises(NotFound):
        inspect.unwrap(tracing_runs.AgentTraceRunApi.get)(tracing_runs.AgentTraceRunApi(), CONTEXT, AGENT_ID, SOURCE_ID)
    runs.status.assert_not_called()


@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("tracing_source_not_found", 404),
        ("tracing_node_not_found", 404),
        ("tracing_run_not_found", 404),
        ("tracing_already_accepted", 409),
        ("tracing_retry_not_allowed", 409),
        ("tracing_duplicate_acknowledgement_required", 409),
    ],
)
def test_retry_business_errors_match_served_error_contract(services, code, status) -> None:
    _, runs = services
    runs.retry.side_effect = TraceCollectionError(code, status)
    target = tracing_runs.AppTraceRunRetryApi.post

    @wraps(target)
    def post(self):
        return inspect.unwrap(target)(self, CONTEXT, APP_ID, "message", SOURCE_ID)

    resource = type("RetryContractResource", (Resource,), {"post": post})
    app = Flask("trace-error-contract")
    api = ExternalApi(app)
    api.add_resource(resource, "/retry")
    with app.test_client() as client:
        response = client.post("/retry", json={})
    assert response.status_code == status
    assert response.json["code"] == code
    assert response.json["status"] == status


@pytest.mark.parametrize(
    ("method", "permission", "locator"),
    [
        (tracing_runs.AgentTraceRunApi.get, tracing_runs.RBACPermission.AGENT_LOG_MANAGE, AgentId),
        (tracing_runs.AppTraceRunApi.get, tracing_runs.RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp),
        (tracing_runs.AgentTraceRunRetryApi.post, tracing_runs.RBACPermission.AGENT_EDIT, AgentId),
        (tracing_runs.AppTraceRunRetryApi.post, tracing_runs.RBACPermission.APP_TRACING_CONFIG, PlainApp),
    ],
)
def test_run_endpoints_enforce_resource_permissions(app: Flask, monkeypatch, method, permission, locator) -> None:
    account = Account(name="Reader", email="reader@example.com", status=AccountStatus.ACTIVE)
    account.id, account.role = "account", TenantAccountRole.NORMAL
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(
        flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account=account, tenant_id="tenant")
    )
    denied = MagicMock(side_effect=Forbidden())
    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", denied)
    admission = inspect.unwrap(
        method, stop=lambda candidate: "allowed_roles" in inspect.getclosurevars(candidate).nonlocals
    )
    with app.test_request_context(), pytest.raises(Forbidden):
        admission(None, agent_id=AGENT_ID) if locator is AgentId else admission(None, app_id=APP_ID)
    (check,) = denied.call_args.kwargs["checks"]
    assert check.scene == permission
    assert isinstance(check.locator, locator)


@pytest.mark.parametrize("method", [tracing_runs.AgentTraceRunRetryApi.post, tracing_runs.AppTraceRunRetryApi.post])
def test_retry_rejects_readonly_members_without_rbac(app: Flask, monkeypatch, method) -> None:
    account = Account(name="Reader", email="reader@example.com", status=AccountStatus.ACTIVE)
    account.id, account.role = "account", TenantAccountRole.NORMAL
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    monkeypatch.setattr(
        flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account=account, tenant_id="tenant")
    )
    admission = inspect.unwrap(
        method, stop=lambda candidate: "allowed_roles" in inspect.getclosurevars(candidate).nonlocals
    )
    with app.test_request_context(), pytest.raises(Forbidden):
        admission(None)
