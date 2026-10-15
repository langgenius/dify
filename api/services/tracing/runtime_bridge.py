"""Fail-open business hooks and durable terminal handoff for application tracing.

The deployment gate is checked before constructing any database-backed service.
Execution context carries opaque correlation and policy only, never provider keys.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import TYPE_CHECKING, Literal

from dify_agent.layers.execution_context import ApplicationTracingContext

from configs import dify_config

if TYPE_CHECKING:
    from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
    from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
    from core.ops.entities.trace_entity import BaseTraceInfo
    from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext
    from services.tracing.service import ApplicationTracingService

logger = logging.getLogger(__name__)


def workflow_has_agent_v2(graph: object) -> bool:
    """Scope the new pipeline to graphs containing the Dify Agent v2 node."""
    from core.workflow.nodes.agent_v2.discriminator import is_dify_agent_node_data

    if isinstance(graph, str):
        try:
            graph = json.loads(graph)
        except ValueError:
            return False
    if not isinstance(graph, Mapping) or not isinstance(graph.get("nodes"), list):
        return False
    return any(
        isinstance(node, Mapping) and isinstance(node.get("data"), Mapping) and is_dify_agent_node_data(node["data"])
        for node in graph["nodes"]
    )


def _service() -> ApplicationTracingService:
    from services.tracing.service import application_tracing_service

    return application_tracing_service()


def _log_failure(stage: str, error: Exception) -> None:
    from repositories.application_trace_repository import TraceCollectionError

    code = error.code if isinstance(error, TraceCollectionError) else type(error).__name__
    logger.warning("Application tracing hook skipped: stage=%s error_code=%s", stage, code)


def prepare_agent_app(context: AgentAppRuntimeBuildContext) -> ApplicationTracingContext | None:
    if not dify_config.OPS_AGENT_TRACE_ENABLED:
        return None
    try:
        return _service().prepare_invocation(
            tenant_id=context.dify_context.tenant_id,
            app_id=context.dify_context.app_id,
            agent_id=context.agent_id,
            source_kind="message",
            source_id=context.idempotency_key,
            session_id=context.dify_context.trace_session_id or context.conversation_id,
            node_execution_id=None,
            attempt=0,
            call_key=context.idempotency_key,
        )
    except Exception as error:
        _log_failure("agent_app", error)
        return None


def capture_agent_app_terminal(
    *,
    tenant_id: str,
    app_id: str,
    message_id: str,
    outcome: Literal["succeeded", "failed", "cancelled"],
    output: str | None,
) -> None:
    if not dify_config.OPS_AGENT_TRACE_ENABLED:
        return
    try:
        _service().capture_agent_app_terminal(
            tenant_id=tenant_id, app_id=app_id, message_id=message_id, outcome=outcome, output=output
        )
    except Exception as error:
        _log_failure("agent_app_terminal", error)


def prepare_workflow_agent(
    context: WorkflowAgentRuntimeBuildContext, conversation_id: str | None
) -> ApplicationTracingContext | None:
    if not dify_config.OPS_AGENT_TRACE_ENABLED:
        return None
    try:
        source_id = context.workflow_run_id or context.node_execution_id
        return _service().prepare_invocation(
            tenant_id=context.dify_context.tenant_id,
            app_id=context.dify_context.app_id,
            agent_id=context.agent.id,
            source_kind="workflow" if context.workflow_run_id else "node",
            source_id=source_id,
            session_id=context.dify_context.trace_session_id or conversation_id or source_id,
            node_execution_id=context.node_execution_id,
            attempt=context.attempt,
            call_key=f"{context.node_execution_id}:{context.attempt}",
            workflow_id=context.workflow_id,
        )
    except Exception as error:
        _log_failure("workflow_agent", error)
        return None


def freeze_workflow_run(
    entity: AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity,
    *,
    workflow_id: str,
    workflow_run_id: str,
    conversation_id: object,
    graph_data: object,
) -> None:
    """Freeze policy immediately after the business workflow row is saved."""
    if not dify_config.OPS_AGENT_TRACE_ENABLED:
        return
    if not workflow_has_agent_v2(graph_data):
        return
    try:
        explicit_session = entity.extras.get("trace_session_id")
        session_id = next(
            (
                value
                for value in (explicit_session, conversation_id, workflow_run_id)
                if isinstance(value, str) and value
            ),
            workflow_run_id,
        )
        _service().start(
            tenant_id=entity.app_config.tenant_id,
            app_id=entity.app_config.app_id,
            source_kind="workflow",
            source_id=workflow_run_id,
            session_id=session_id,
            workflow_id=workflow_id,
        )
    except Exception as error:
        _log_failure("workflow_start", error)


def queue_enabled_at_start(app_id: object) -> bool:
    """Read the existing application switch without constructing a vendor SDK."""
    if not dify_config.OPS_AGENT_TRACE_ENABLED or app_id is None:
        return False
    from extensions.ext_database import db
    from models.model import App

    try:
        app = db.session.get(App, str(app_id))
        policy = json.loads(app.tracing) if app is not None and app.tracing else {}
        return isinstance(policy, dict) and policy.get("enabled") is True
    except Exception as error:
        _log_failure("queue_policy", error)
        return False


def capture_terminal(info: BaseTraceInfo) -> bool:
    """Transfer ownership before legacy dispatch; transient DB failures retry.

    Unlike request construction, a worker must not fall back to a second export
    path when the durable collector is temporarily inaccessible.
    """
    if not dify_config.OPS_AGENT_TRACE_ENABLED:
        return False
    from sqlalchemy.exc import SQLAlchemyError

    from core.ops.exceptions import RetryableTraceDispatchError

    try:
        return _service().capture_terminal(info)
    except SQLAlchemyError:
        raise RetryableTraceDispatchError("Application tracing persistence temporarily unavailable") from None


class RuntimeApplicationTracingHooks:
    """Stateless app-scoped adapter; database services are created only on invocation."""

    __slots__ = ()

    prepare_agent_app = staticmethod(prepare_agent_app)
    prepare_workflow_agent = staticmethod(prepare_workflow_agent)
    freeze_workflow_run = staticmethod(freeze_workflow_run)
    queue_enabled_at_start = staticmethod(queue_enabled_at_start)
    capture_terminal = staticmethod(capture_terminal)
    capture_agent_app_terminal = staticmethod(capture_agent_app_terminal)
