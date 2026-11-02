from typing import TYPE_CHECKING, Literal, override

from dify_agent.layers.execution_context import ApplicationTracingContext
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import TraceCorrelation, TraceEvent
from flask import Flask

from core.helper.trace_id_helper import ParentTraceContext
from extensions.tracing import (
    ApplicationTracingHooks,
    ExecutionTraceScopes,
    application_tracing_hooks,
    bind_tracing,
    correlation_from_extras,
    create_trace_scope,
    create_trace_scope_for_app,
)

if TYPE_CHECKING:
    from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
    from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
    from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext


class _Recorder:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


class _Scopes(ExecutionTraceScopes):
    def __init__(self, *, fails: bool) -> None:
        self.fails = fails
        self.policies: list[str | None] = []
        self.correlations: list[TraceCorrelation] = []

    def _scope(
        self, *, tenant_id: str, app_id: str | None, user_id: str | None, correlation: TraceCorrelation
    ) -> TraceScope:
        if self.fails:
            raise RuntimeError("policy lookup failed")
        self.correlations.append(correlation)
        return TraceScope(
            emitter=_Recorder(), tenant_id=tenant_id, app_id=app_id, user_id=user_id, correlation=correlation
        )

    @override
    def for_execution(
        self,
        *,
        tenant_id: str,
        app_id: str | None,
        app_tracing: str | None,
        user_id: str | None,
        correlation: TraceCorrelation,
    ) -> TraceScope | None:
        self.policies.append(app_tracing)
        return self._scope(tenant_id=tenant_id, app_id=app_id, user_id=user_id, correlation=correlation)

    @override
    def for_app(
        self, *, tenant_id: str, app_id: str | None, user_id: str | None, correlation: TraceCorrelation
    ) -> TraceScope | None:
        return self._scope(tenant_id=tenant_id, app_id=app_id, user_id=user_id, correlation=correlation)


class _Hooks(ApplicationTracingHooks):
    @override
    def prepare_agent_app(self, context: "AgentAppRuntimeBuildContext") -> ApplicationTracingContext | None:
        return None

    @override
    def prepare_workflow_agent(
        self, context: "WorkflowAgentRuntimeBuildContext", conversation_id: str | None
    ) -> ApplicationTracingContext | None:
        return None

    @override
    def freeze_workflow_run(
        self,
        entity: "AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity",
        *,
        workflow_id: str,
        workflow_run_id: str,
        conversation_id: object,
        graph_data: object,
    ) -> None:
        return None

    @override
    def capture_agent_app_terminal(
        self,
        *,
        tenant_id: str,
        app_id: str,
        message_id: str,
        outcome: Literal["succeeded", "failed", "cancelled"],
        output: str | None,
    ) -> None:
        return None


def _app(scopes: _Scopes, hooks: ApplicationTracingHooks | None) -> Flask:
    app = Flask(__name__)
    bind_tracing(app, scopes=scopes, hooks=hooks)
    return app


def test_correlation_reads_the_caller_extras() -> None:
    nested = correlation_from_extras(
        {
            "external_trace_id": "caller-trace",
            "trace_session_id": "session-1",
            "parent_trace_context": {"parent_workflow_run_id": "outer-run", "parent_node_execution_id": "outer-node"},
        }
    )
    typed = correlation_from_extras(
        {"parent_trace_context": ParentTraceContext(parent_workflow_run_id="outer-run", parent_node_execution_id=None)}
    )

    assert nested == TraceCorrelation(
        external_trace_id="caller-trace",
        session_id="session-1",
        parent_workflow_run_id="outer-run",
        parent_node_execution_id="outer-node",
    )
    assert typed.parent_workflow_run_id == "outer-run"
    assert correlation_from_extras({"external_trace_id": "", "parent_trace_context": {"x": 1}}) == TraceCorrelation(
        external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
    )


def test_scopes_come_from_the_bound_scopes_with_the_raw_policy_and_correlation() -> None:
    scopes = _Scopes(fails=False)
    with _app(scopes, None).app_context():
        scope = create_trace_scope(
            tenant_id="tenant-1",
            app_id="app-1",
            app_tracing='{"enabled": true}',
            user_id="u",
            extras={"external_trace_id": "caller-trace"},
        )
        app_scope = create_trace_scope_for_app(tenant_id="tenant-1", app_id=None, user_id=None, extras={})

    assert scope is not None
    assert (scope.tenant_id, scope.app_id, scope.user_id) == ("tenant-1", "app-1", "u")
    assert scopes.policies == ['{"enabled": true}']
    assert scope.correlation.external_trace_id == "caller-trace"
    assert app_scope is not None
    assert app_scope.app_id is None


def test_scopes_fail_open() -> None:
    assert create_trace_scope(tenant_id="tenant-1", app_id="app-1", app_tracing=None, user_id=None, extras={}) is None
    with _app(_Scopes(fails=True), None).app_context():
        assert (
            create_trace_scope(tenant_id="tenant-1", app_id="app-1", app_tracing=None, user_id=None, extras={}) is None
        )
        assert create_trace_scope_for_app(tenant_id="tenant-1", app_id="app-1", user_id=None, extras={}) is None
    with Flask(__name__).app_context():
        assert create_trace_scope_for_app(tenant_id="tenant-1", app_id="app-1", user_id=None, extras={}) is None


def test_agent_hooks_are_the_ones_the_composition_root_bound() -> None:
    hooks = _Hooks()

    with _app(_Scopes(fails=False), hooks).app_context():
        assert application_tracing_hooks() is hooks
    with _app(_Scopes(fails=False), None).app_context():
        assert application_tracing_hooks() is None
    assert application_tracing_hooks() is None


def test_invalid_extension_bindings_fail_open() -> None:
    app = Flask(__name__)
    app.extensions["trace_scopes"] = object()
    app.extensions["application_tracing_hooks"] = object()

    with app.app_context():
        assert (
            create_trace_scope(tenant_id="tenant-1", app_id="app-1", app_tracing=None, user_id=None, extras={}) is None
        )
        assert create_trace_scope_for_app(tenant_id="tenant-1", app_id="app-1", user_id=None, extras={}) is None
        assert application_tracing_hooks() is None
