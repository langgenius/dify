from typing import override

import pytest
from dify_trace_sdk.events import TraceCorrelation, TraceEvent

from services.app_tracing_config_service import AppTraceSettings
from services.tracing.scopes import TraceScopes, TracingPolicyQuery

CORRELATION = TraceCorrelation(
    external_trace_id="caller-trace", session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
)
ENABLED = AppTraceSettings(enabled=True, tracing_provider="langfuse")


class _Recorder:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


class _Policies(TracingPolicyQuery):
    """Stored policies by (tenant, app); records the owner of every lookup."""

    def __init__(self, policies: dict[tuple[str, str], AppTraceSettings], *, fails: bool) -> None:
        self.policies = policies
        self.fails = fails
        self.lookups: list[tuple[str, str]] = []

    @override
    def policy(self, *, tenant_id: str, app_id: str) -> AppTraceSettings | None:
        self.lookups.append((tenant_id, app_id))
        if self.fails:
            raise RuntimeError("database unavailable")
        return self.policies.get((tenant_id, app_id))


def _scopes(policies: _Policies, *, enterprise: bool) -> tuple[TraceScopes, _Recorder]:
    recorder = _Recorder()
    return TraceScopes(emitter=recorder, policies=policies, enterprise_enabled=lambda: enterprise), recorder


@pytest.mark.parametrize(
    "policy",
    [
        AppTraceSettings(),
        AppTraceSettings(enabled=False, tracing_provider="langfuse"),
        AppTraceSettings(enabled=True, tracing_provider=None),
    ],
    ids=["unset", "disabled", "no-provider"],
)
def test_no_scope_exists_when_nothing_consumes_the_events(policy: AppTraceSettings) -> None:
    scopes, _ = _scopes(_Policies({}, fails=False), enterprise=False)

    assert (
        scopes.for_execution(tenant_id="tenant-1", app_id="app-1", policy=policy, user_id=None, correlation=CORRELATION)
        is None
    )


@pytest.mark.parametrize(("policy", "enterprise"), [(ENABLED, False), (AppTraceSettings(), True)])
def test_scopes_stamp_owner_and_correlation(policy: AppTraceSettings, enterprise: bool) -> None:
    scopes, recorder = _scopes(_Policies({}, fails=False), enterprise=enterprise)

    scope = scopes.for_execution(
        tenant_id="tenant-1", app_id="app-1", policy=policy, user_id="end-user-session", correlation=CORRELATION
    )

    assert scope is not None
    assert (scope.tenant_id, scope.app_id, scope.user_id) == ("tenant-1", "app-1", "end-user-session")
    assert scope.correlation == CORRELATION
    assert scope.emitter is recorder


def test_app_scopes_read_the_policy_through_the_callers_workspace() -> None:
    policies = _Policies({("tenant-1", "app-1"): ENABLED, ("tenant-2", "app-1"): ENABLED}, fails=False)
    scopes, _ = _scopes(policies, enterprise=False)

    owned = scopes.for_app(tenant_id="tenant-1", app_id="app-1", user_id=None, correlation=CORRELATION)
    foreign = scopes.for_app(tenant_id="tenant-3", app_id="app-1", user_id=None, correlation=CORRELATION)

    assert owned is not None
    assert owned.tenant_id == "tenant-1"
    assert foreign is None
    assert policies.lookups == [("tenant-1", "app-1"), ("tenant-3", "app-1")]


def test_app_scopes_without_an_app_depend_on_enterprise_telemetry() -> None:
    policies = _Policies({}, fails=False)
    scopes, _ = _scopes(policies, enterprise=True)

    scope = scopes.for_app(tenant_id="tenant-1", app_id=None, user_id=None, correlation=CORRELATION)

    assert scope is not None
    assert scope.app_id is None
    assert policies.lookups == []


def test_a_failed_policy_lookup_stays_out_of_the_request() -> None:
    scopes, _ = _scopes(_Policies({}, fails=True), enterprise=True)

    assert scopes.for_app(tenant_id="tenant-1", app_id="app-1", user_id=None, correlation=CORRELATION) is None
