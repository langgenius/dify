"""Run tracing endpoints preserve resource ownership, acknowledgement and error contracts."""

import inspect
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta, timezone
from functools import wraps
from uuid import UUID

import pytest
from flask import Flask
from flask_restx import Resource
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.rbac import AgentId, PlainApp, RBACCheck
from controllers.console import flask_admission
from controllers.console.agent import tracing_runs
from domain.tracing.trace_run_agg import TraceRunState, TraceSourceKind
from extensions.ext_application_services import ApplicationServices
from libs.external_api import ExternalApi
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, AccountStatus, TenantAccountRole
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.tracing.collection import TraceRunStatus
from services.tracing.errors import TraceCollectionConflictError, TraceCollectionError, TraceCollectionNotFoundError
from tests.helpers.unit.config_override import apply_config_overrides

CONTEXT = RequestContext("request", None, "account", "tenant")
AGENT_ID = UUID("01a11111-1111-7111-8111-111111111111")
APP_ID = UUID("01a22222-2222-7222-8222-222222222222")
SOURCE_ID = UUID("01a33333-3333-7333-8333-333333333333")
NODE_ID = UUID("01a44444-4444-7444-8444-444444444444")
NOT_COLLECTED = TraceRunStatus(
    status=TraceRunState.NOT_COLLECTED,
    source_kind="message",
    source_id=str(SOURCE_ID),
    provider=None,
    trace_id=None,
    trace_url=None,
    span_url=None,
    project_url=None,
    config_revision=None,
    capture_content=None,
    capture_agent=None,
    span_count=None,
    attempts=None,
    error_code=None,
    accepted_at=None,
    capabilities=None,
)


@dataclass
class RunCase:
    services: ApplicationServices
    """The composition root the handlers resolve; its Agent trace runs answer with ``response``."""
    owner_calls: list[tuple[RequestContext, str]] = field(default_factory=list)
    status_calls: list[dict[str, object]] = field(default_factory=list)
    retry_calls: list[dict[str, object]] = field(default_factory=list)
    response: TraceRunStatus = NOT_COLLECTED
    owner_error: Exception | None = None
    retry_error: Exception | None = None


@pytest.fixture
def services(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
) -> RunCase:
    case = RunCase(account_application_services)

    def resolve(context: RequestContext, agent_id: str) -> str:
        case.owner_calls.append((context, agent_id))
        if case.owner_error is not None:
            raise case.owner_error
        return str(APP_ID)

    def status(**kwargs: object) -> TraceRunStatus:
        case.status_calls.append(kwargs)
        return case.response

    def retry(**kwargs: object) -> TraceRunStatus:
        case.retry_calls.append(kwargs)
        if case.retry_error is not None:
            raise case.retry_error
        return replace(case.response, status=TraceRunState.RETRYING)

    runs = account_application_services.tracing.agent_traces
    monkeypatch.setattr(account_application_services.agent_tracing_configs, "resolve_app_id", resolve)
    monkeypatch.setattr(runs, "status", status)
    monkeypatch.setattr(runs, "retry", retry)
    monkeypatch.setitem(app.extensions, "application_services", account_application_services)
    return case


@pytest.mark.parametrize(
    "accepted_at",
    [
        datetime(2026, 1, 1),
        datetime(2026, 1, 1, tzinfo=UTC),
        datetime(2026, 1, 1, 8, tzinfo=timezone(timedelta(hours=8))),
    ],
)
def test_agent_status_resolves_owner_and_never_exposes_destination_secrets(
    app: Flask, services: RunCase, accepted_at: datetime
) -> None:
    services.response = replace(
        services.response,
        status=TraceRunState.ACCEPTED,
        provider="langfuse",
        trace_id="trace-id",
        trace_url="https://example.com/trace",
        project_url="https://example.com/project/frozen",
        accepted_at=accepted_at,
        config_revision="frozen-revision",
    )
    with app.test_request_context(f"/?node_execution_id={NODE_ID}"):
        result = inspect.unwrap(tracing_runs.AgentTraceRunApi.get)(
            tracing_runs.AgentTraceRunApi(), CONTEXT, AGENT_ID, SOURCE_ID
        )
    assert services.owner_calls == [(CONTEXT, str(AGENT_ID))]
    assert services.status_calls == [
        {
            "tenant_id": "tenant",
            "app_id": str(APP_ID),
            "source_kind": "message",
            "source_id": str(SOURCE_ID),
            "node_execution_id": str(NODE_ID),
        }
    ]
    assert result["accepted_at"] == "2026-01-01T00:00:00Z"
    assert result["queryable"] is None
    assert result["config_revision"] == "frozen-revision"
    assert result["project_url"] == "https://example.com/project/frozen"
    assert "provider_config" not in result


@pytest.mark.parametrize("kind", ["message", "workflow", "node"])
def test_app_status_source_scope_and_not_collected(app: Flask, services: RunCase, kind: TraceSourceKind) -> None:
    services.response = replace(services.response, source_kind=kind)
    with app.test_request_context():
        result = inspect.unwrap(tracing_runs.AppTraceRunApi.get)(
            tracing_runs.AppTraceRunApi(), CONTEXT, APP_ID, kind, SOURCE_ID
        )
    assert services.owner_calls == []
    assert result["status"] == "not_collected"
    assert result["project_url"] is None
    assert services.status_calls == [
        {
            "tenant_id": "tenant",
            "app_id": str(APP_ID),
            "source_kind": kind,
            "source_id": str(SOURCE_ID),
            "node_execution_id": None,
        }
    ]


@pytest.mark.parametrize("ack", [False, True])
@pytest.mark.parametrize("agent", [False, True])
def test_retry_forwards_only_frozen_run_identity_and_explicit_ack(
    app: Flask, services: RunCase, ack: bool, agent: bool
) -> None:
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
    assert services.retry_calls == [
        {
            "tenant_id": "tenant",
            "app_id": str(APP_ID),
            "source_kind": "message",
            "source_id": str(SOURCE_ID),
            "node_execution_id": str(NODE_ID),
            "acknowledge_possible_duplicates": ack,
        }
    ]


@pytest.mark.parametrize("payload", [{"provider": "different-provider"}, {"acknowledge_possible_duplicates": "true"}])
def test_retry_rejects_destination_changes_and_non_boolean_ack(
    app: Flask, services: RunCase, payload: dict[str, str]
) -> None:
    with app.test_request_context(method="POST", json=payload), pytest.raises(ValidationError):
        inspect.unwrap(tracing_runs.AppTraceRunRetryApi.post)(
            tracing_runs.AppTraceRunRetryApi(), CONTEXT, APP_ID, "message", SOURCE_ID
        )
    assert services.retry_calls == []


def test_source_kind_is_validated_before_service_lookup(app: Flask, services: RunCase) -> None:
    with app.test_request_context(), pytest.raises(ValidationError):
        inspect.unwrap(tracing_runs.AppTraceRunApi.get)(
            tracing_runs.AppTraceRunApi(), CONTEXT, APP_ID, "unknown", SOURCE_ID
        )
    assert services.status_calls == []


def test_agent_owner_rejection_prevents_run_lookup(app: Flask, services: RunCase) -> None:
    services.owner_error = AgentAppNotFoundError()
    with app.test_request_context(), pytest.raises(NotFound):
        inspect.unwrap(tracing_runs.AgentTraceRunApi.get)(tracing_runs.AgentTraceRunApi(), CONTEXT, AGENT_ID, SOURCE_ID)
    assert services.status_calls == []


@pytest.mark.parametrize(
    ("error", "code", "status"),
    [
        (TraceCollectionNotFoundError, "tracing_source_not_found", 404),
        (TraceCollectionNotFoundError, "tracing_node_not_found", 404),
        (TraceCollectionNotFoundError, "tracing_run_not_found", 404),
        (TraceCollectionConflictError, "tracing_already_accepted", 409),
        (TraceCollectionConflictError, "tracing_retry_not_allowed", 409),
        (TraceCollectionConflictError, "tracing_duplicate_acknowledgement_required", 409),
    ],
)
def test_retry_business_errors_match_served_error_contract(
    services: RunCase, error: type[TraceCollectionError], code: str, status: int
) -> None:
    services.retry_error = error(code)
    target = tracing_runs.AppTraceRunRetryApi.post

    @wraps(target)
    def post(self: Resource) -> dict[str, object]:
        return inspect.unwrap(target)(self, CONTEXT, APP_ID, "message", SOURCE_ID)

    resource = type("RetryContractResource", (Resource,), {"post": post})
    app = Flask("trace-error-contract")
    app.extensions["application_services"] = services.services
    api = ExternalApi(app)
    api.add_resource(resource, "/retry")
    with app.test_client() as client:
        response = client.post("/retry", json={})
    assert response.status_code == status
    body = response.json
    assert body is not None
    assert body["code"] == code
    assert body["status"] == status


@pytest.mark.parametrize(
    ("method", "permission", "locator"),
    [
        (tracing_runs.AgentTraceRunApi.get, tracing_runs.RBACPermission.AGENT_LOG_MANAGE, AgentId),
        (tracing_runs.AppTraceRunApi.get, tracing_runs.RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp),
        (tracing_runs.AgentTraceRunRetryApi.post, tracing_runs.RBACPermission.AGENT_EDIT, AgentId),
        (tracing_runs.AppTraceRunRetryApi.post, tracing_runs.RBACPermission.APP_TRACING_CONFIG, PlainApp),
    ],
)
def test_run_endpoints_enforce_resource_permissions(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method: Callable[..., object],
    permission: tracing_runs.RBACPermission,
    locator: type[AgentId] | type[PlainApp],
) -> None:
    account = Account(name="Reader", email="reader@example.com", status=AccountStatus.ACTIVE)
    account.id, account.role = "account", TenantAccountRole.NORMAL
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(
        flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account=account, tenant_id="tenant")
    )
    denied_calls: list[dict[str, object]] = []

    def denied(**kwargs: object) -> None:
        denied_calls.append(kwargs)
        raise Forbidden()

    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", denied)
    admission = inspect.unwrap(
        method, stop=lambda candidate: "allowed_roles" in inspect.getclosurevars(candidate).nonlocals
    )
    with app.test_request_context(), pytest.raises(Forbidden):
        admission(None, agent_id=AGENT_ID) if locator is AgentId else admission(None, app_id=APP_ID)
    checks = denied_calls[0]["checks"]
    assert isinstance(checks, (list, tuple))
    (check,) = checks
    assert isinstance(check, RBACCheck)
    assert check.scene == permission
    assert isinstance(check.locator, locator)


@pytest.mark.parametrize("method", [tracing_runs.AgentTraceRunRetryApi.post, tracing_runs.AppTraceRunRetryApi.post])
def test_retry_rejects_readonly_members_without_rbac(
    app: Flask, monkeypatch: pytest.MonkeyPatch, method: Callable[..., object]
) -> None:
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
