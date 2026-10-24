"""Execution-side ports of the trace pipeline, bound to one Flask application.

Core producers import only these accessors; the composition root binds the
service implementations. Every accessor fails open: tracing never breaks the
operation that is being traced.
"""

import logging
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, Protocol, cast

from dify_trace_sdk.emitter import TraceScope
from flask import Flask, current_app, has_app_context

from configs import dify_config

if TYPE_CHECKING:
    from dify_agent.layers.execution_context import ApplicationTracingContext

    from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
    from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
    from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext

logger = logging.getLogger(__name__)

_SCOPES_KEY = "trace_scopes"
_HOOKS_KEY = "application_tracing_hooks"


class TraceScopeFactory(Protocol):
    def __call__(
        self,
        *,
        tenant_id: str,
        app_id: str | None,
        app_tracing: str | None,
        user_id: str | None,
        extras: Mapping[str, Any],
    ) -> TraceScope | None: ...

    def for_app(
        self, *, tenant_id: str, app_id: str | None, user_id: str | None, extras: Mapping[str, Any]
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


def bind_tracing(app: Flask, *, scopes: TraceScopeFactory, hooks: ApplicationTracingHooks) -> None:
    app.extensions[_SCOPES_KEY] = scopes
    app.extensions[_HOOKS_KEY] = hooks


def _scopes() -> TraceScopeFactory | None:
    if not has_app_context():
        return None
    return cast(TraceScopeFactory | None, current_app.extensions.get(_SCOPES_KEY))


def create_trace_scope(
    *, tenant_id: str, app_id: str | None, app_tracing: str | None, user_id: str | None, extras: Mapping[str, Any]
) -> TraceScope | None:
    """The scope for an execution whose app row is loaded; ``None`` when nothing consumes its events."""
    scopes = _scopes()
    if scopes is None:
        return None
    try:
        return scopes(tenant_id=tenant_id, app_id=app_id, app_tracing=app_tracing, user_id=user_id, extras=extras)
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
        return scopes.for_app(tenant_id=tenant_id, app_id=app_id, user_id=user_id, extras=extras)
    except Exception:
        logger.warning("Tracing scope unavailable: app_id=%s", app_id, exc_info=True)
        return None


def application_tracing_hooks() -> ApplicationTracingHooks | None:
    """The Agent collection hooks, or ``None`` when Agent tracing is off or cannot run here."""
    if not dify_config.OPS_AGENT_TRACE_ENABLED:
        return None
    hooks = cast(ApplicationTracingHooks | None, current_app.extensions.get(_HOOKS_KEY)) if has_app_context() else None
    if hooks is None:
        # Agent runs started here are reported as not collected instead of failing.
        logger.warning("Agent tracing is enabled but its hooks are not bound in this context")
    return hooks
