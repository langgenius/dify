"""Execution-side access to the trace pipeline, bound to one Flask application.

Legacy producers in the execution kernel import only these accessors; the
composition root binds the services they reach. Every accessor fails open:
tracing never breaks the operation that is being traced.
"""

import logging
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, Protocol, cast

from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import TraceCorrelation, TraceParent
from flask import Flask, current_app, has_app_context

from core.helper.trace_id_helper import ParentTraceContext

if TYPE_CHECKING:
    from dify_agent.layers.execution_context import ApplicationTracingContext

    from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
    from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
    from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext

logger = logging.getLogger(__name__)

_SCOPES_KEY = "trace_scopes"
_HOOKS_KEY = "application_tracing_hooks"


class ExecutionTraceScopes(Protocol):
    """Trace scopes for legacy producers, which hold the app's stored tracing policy as its raw column value."""

    def for_execution(
        self,
        *,
        tenant_id: str,
        app_id: str | None,
        app_tracing: str | None,
        user_id: str | None,
        correlation: TraceCorrelation,
    ) -> TraceScope | None: ...

    def for_app(
        self, *, tenant_id: str, app_id: str | None, user_id: str | None, correlation: TraceCorrelation
    ) -> TraceScope | None: ...


class ApplicationTracingHooks(Protocol):
    """Agent trace collection lifecycle; it never replaces the trace pipeline."""

    def prepare_agent_app(self, context: "AgentAppRuntimeBuildContext") -> "ApplicationTracingContext | None": ...

    def prepare_workflow_agent(
        self, context: "WorkflowAgentRuntimeBuildContext", conversation_id: str | None
    ) -> "ApplicationTracingContext | None": ...

    def freeze_workflow_run(
        self,
        entity: "AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity",
        *,
        workflow_id: str,
        workflow_run_id: str,
        conversation_id: object,
        graph_data: object,
    ) -> None: ...

    def capture_agent_app_terminal(
        self,
        *,
        tenant_id: str,
        app_id: str,
        message_id: str,
        outcome: Literal["succeeded", "failed", "cancelled"],
        output: str | None,
    ) -> None: ...


def bind_tracing(app: Flask, *, scopes: ExecutionTraceScopes, hooks: ApplicationTracingHooks | None) -> None:
    """``hooks`` is ``None`` when this deployment does not collect Agent traces."""
    app.extensions[_SCOPES_KEY] = scopes
    app.extensions[_HOOKS_KEY] = hooks


def _scopes() -> ExecutionTraceScopes | None:
    if not has_app_context():
        return None
    return cast(ExecutionTraceScopes | None, current_app.extensions.get(_SCOPES_KEY))


def _trace_parent(context: ParentTraceContext) -> TraceParent:
    outer = context.parent_trace_context
    return TraceParent(
        workflow_run_id=context.parent_workflow_run_id,
        app_id=context.parent_app_id,
        node_execution_id=context.parent_node_execution_id,
        external_trace_id=context.parent_external_trace_id,
        parent=_trace_parent(outer) if outer is not None else None,
    )


def correlation_from_extras(extras: Mapping[str, Any]) -> TraceCorrelation:
    """The caller-supplied correlation an execution carries in its ``extras``."""
    parent = extras.get("parent_trace_context")
    if isinstance(parent, Mapping):
        try:
            parent = ParentTraceContext.model_validate(parent)
        except ValueError:
            parent = None
    external_trace_id, session_id = extras.get("external_trace_id"), extras.get("trace_session_id")
    return TraceCorrelation(
        external_trace_id=external_trace_id if isinstance(external_trace_id, str) and external_trace_id else None,
        session_id=session_id if isinstance(session_id, str) and session_id else None,
        parent=_trace_parent(parent) if isinstance(parent, ParentTraceContext) else None,
    )


def create_trace_scope(
    *, tenant_id: str, app_id: str | None, app_tracing: str | None, user_id: str | None, extras: Mapping[str, Any]
) -> TraceScope | None:
    """The scope for an execution whose app row is loaded; ``None`` when nothing consumes its events."""
    scopes = _scopes()
    if scopes is None:
        return None
    try:
        return scopes.for_execution(
            tenant_id=tenant_id,
            app_id=app_id,
            app_tracing=app_tracing,
            user_id=user_id,
            correlation=correlation_from_extras(extras),
        )
    except Exception:
        logger.warning("Tracing scope unavailable: app_id=%s", app_id, exc_info=True)
        return None


def create_trace_scope_for_app(
    *, tenant_id: str, app_id: str | None, user_id: str | None, extras: Mapping[str, Any]
) -> TraceScope | None:
    """The scope for a caller that does not hold the app row."""
    scopes = _scopes()
    if scopes is None:
        return None
    try:
        return scopes.for_app(
            tenant_id=tenant_id, app_id=app_id, user_id=user_id, correlation=correlation_from_extras(extras)
        )
    except Exception:
        logger.warning("Tracing scope unavailable: app_id=%s", app_id, exc_info=True)
        return None


def application_tracing_hooks() -> ApplicationTracingHooks | None:
    """The Agent collection hooks; ``None`` when Agent tracing is off or no application is bound here.

    Agent runs started without hooks are reported as not collected instead of failing.
    """
    if not has_app_context():
        return None
    return cast(ApplicationTracingHooks | None, current_app.extensions.get(_HOOKS_KEY))
