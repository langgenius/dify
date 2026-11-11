"""Fail-open execution hooks that start Agent trace collection.

The composition root binds these hooks only when the deployment collects Agent
traces. Execution context carries opaque correlation and policy only, never
provider keys.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Literal, override

from dify_agent.layers.execution_context import ApplicationTracingContext

from extensions.tracing import ApplicationTracingHooks
from services.tracing.collection import workflow_has_agent_v2
from services.tracing.errors import TraceCollectionError
from services.tracing.service import ApplicationTracingService

if TYPE_CHECKING:
    from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeBuildContext
    from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
    from core.workflow.nodes.agent_v2.runtime_request_builder import WorkflowAgentRuntimeBuildContext

logger = logging.getLogger(__name__)


def _log_failure(stage: str, error: Exception) -> None:
    code = error.code if isinstance(error, TraceCollectionError) else type(error).__name__
    logger.warning("Application tracing hook skipped: stage=%s error_code=%s", stage, code)


class RuntimeApplicationTracingHooks(ApplicationTracingHooks):
    def __init__(self, traces: ApplicationTracingService) -> None:
        self._traces = traces

    @override
    def prepare_agent_app(self, context: AgentAppRuntimeBuildContext) -> ApplicationTracingContext | None:
        try:
            return self._traces.prepare_invocation(
                tenant_id=context.dify_context.tenant_id,
                app_id=context.dify_context.app_id,
                agent_id=context.agent_id,
                source_kind="message",
                source_id=context.idempotency_key,
                session_id=context.dify_context.trace_session_id or context.conversation_id,
                node_execution_id=None,
                attempt=0,
                call_key=context.idempotency_key,
                workflow_id=None,
            )
        except Exception as error:
            _log_failure("agent_app", error)
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
        try:
            self._traces.capture_agent_app_terminal(
                tenant_id=tenant_id, app_id=app_id, message_id=message_id, outcome=outcome, output=output
            )
        except Exception as error:
            _log_failure("agent_app_terminal", error)

    @override
    def prepare_workflow_agent(
        self, context: WorkflowAgentRuntimeBuildContext, conversation_id: str | None
    ) -> ApplicationTracingContext | None:
        try:
            # Hidden Tool nodes own a different app but share the caller's run and are
            # absent from its outer trace. Neither a source-app snapshot nor an orphan
            # parent is safe. Keep this new nested scope uncollected until it has an
            # explicit owner/parent contract; ordinary nodes and previews are unchanged.
            if context.dify_context.workflow_tool_invocation_id is not None:
                return None
            source_id = context.workflow_run_id or context.node_execution_id
            return self._traces.prepare_invocation(
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

    @override
    def freeze_workflow_run(
        self,
        entity: AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity,
        *,
        workflow_id: str,
        workflow_run_id: str,
        conversation_id: object,
        graph_data: object,
    ) -> None:
        """Freeze policy immediately after the business workflow row is saved."""
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
            self._traces.start(
                tenant_id=entity.app_config.tenant_id,
                app_id=entity.app_config.app_id,
                source_kind="workflow",
                source_id=workflow_run_id,
                session_id=session_id,
                workflow_id=workflow_id,
            )
        except Exception as error:
            _log_failure("workflow_start", error)
