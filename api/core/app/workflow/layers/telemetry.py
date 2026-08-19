from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Union, override

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
from core.helper.trace_id_helper import ParentTraceContext
from core.workflow.system_variables import SystemVariableKey
from core.workflow.variable_prefixes import SYSTEM_VARIABLE_NODE_ID
from graphon.enums import WorkflowNodeExecutionMetadataKey
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import (
    GraphEngineEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.node_events import NodeRunResult

if TYPE_CHECKING:
    from core.ops.ops_trace_manager import TraceQueueManager

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class _NodeStartSnapshot:
    """Captures data from NodeRunStartedEvent needed at completion time."""

    node_id: str
    title: str
    predecessor_node_id: str | None
    start_at: datetime


class NodeTelemetryLayer(GraphEngineLayer):
    """Enqueues NODE_EXECUTION_TRACE tasks when nodes finish execution. """

    def __init__(
        self,
        *,
        application_generate_entity: Union[AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity],
        workflow_id: str,
        trace_manager: "TraceQueueManager | None" = None,
    ) -> None:
        super().__init__()
        self._application_generate_entity = application_generate_entity
        self._workflow_id = workflow_id
        self._trace_manager = trace_manager
        self._node_snapshots: dict[str, _NodeStartSnapshot] = {}
        self._node_index: int = 0

    # ------------------------------------------------------------------
    # GraphEngineLayer lifecycle
    # ------------------------------------------------------------------

    @override
    def on_graph_start(self) -> None:
        self._node_snapshots.clear()
        self._node_index = 0

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        match event:
            case NodeRunStartedEvent():
                self._capture_node_start(event)
            case NodeRunSucceededEvent():
                self._enqueue_node_trace(event, status="succeeded")
            case NodeRunFailedEvent():
                self._enqueue_node_trace(event, status="failed", error=event.error)
            case NodeRunExceptionEvent():
                self._enqueue_node_trace(event, status="exception", error=event.error)

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        self._node_snapshots.clear()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _capture_node_start(self, event: NodeRunStartedEvent) -> None:
        self._node_index += 1
        self._node_snapshots[event.id] = _NodeStartSnapshot(
            node_id=event.node_id,
            title=event.node_title,
            predecessor_node_id=event.predecessor_node_id,
            start_at=event.start_at,
        )

    def _enqueue_node_trace(
        self,
        event: NodeRunSucceededEvent | NodeRunFailedEvent | NodeRunExceptionEvent,
        *,
        status: str,
        error: str | None = None,
    ) -> None:
        snapshot = self._node_snapshots.pop(event.id, None)
        if not snapshot:
            return

        app_config = self._application_generate_entity.app_config
        result: NodeRunResult = event.node_run_result
        metadata = dict(result.metadata) if result.metadata else {}

        finished_at = event.finished_at
        elapsed_time = (
            max((finished_at - snapshot.start_at).total_seconds(), 0.0) if finished_at else 0.0
        )

        # Extract token breakdown from outputs.usage (set by LLM node)
        usage: Mapping[str, Any] = {}
        if isinstance(result.outputs, Mapping):
            raw_usage = result.outputs.get("usage")
            if isinstance(raw_usage, Mapping):
                usage = raw_usage

        # Resolve context
        sys_vars = self.graph_runtime_state.variable_pool.get_by_prefix(SYSTEM_VARIABLE_NODE_ID)
        raw_conversation_id = sys_vars.get(SystemVariableKey.CONVERSATION_ID.value)
        conversation_id = str(raw_conversation_id) if raw_conversation_id else None
        workflow_execution_id = str(sys_vars.get(SystemVariableKey.WORKFLOW_EXECUTION_ID, ""))

        parent_trace_context = None
        extras = self._application_generate_entity.extras
        raw_ctx = extras.get("parent_trace_context")
        if isinstance(raw_ctx, ParentTraceContext):
            parent_trace_context = raw_ctx.model_dump(exclude_none=True)
        elif isinstance(raw_ctx, dict):
            parent_trace_context = raw_ctx

        # Extract typed metadata fields
        tool_info = metadata.get(WorkflowNodeExecutionMetadataKey.TOOL_INFO)
        tool_name = tool_info.get("tool_name") if isinstance(tool_info, dict) else None

        from core.telemetry import NodeExecutionData

        node_data: NodeExecutionData = {
            "workflow_id": self._workflow_id,
            "workflow_execution_id": workflow_execution_id,
            "tenant_id": app_config.tenant_id,
            "app_id": app_config.app_id,
            "node_execution_id": event.id,
            "node_id": snapshot.node_id,
            "node_type": event.node_type,
            "title": snapshot.title,
            "status": status,
            "error": error,
            "elapsed_time": elapsed_time,
            "index": self._node_index,
            "predecessor_node_id": snapshot.predecessor_node_id,
            "created_at": snapshot.start_at,
            "finished_at": finished_at,
            "total_tokens": int(metadata.get(WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS, 0)),
            "total_price": float(metadata.get(WorkflowNodeExecutionMetadataKey.TOTAL_PRICE, 0.0)),
            "currency": str(metadata[WorkflowNodeExecutionMetadataKey.CURRENCY])
            if WorkflowNodeExecutionMetadataKey.CURRENCY in metadata
            else None,
            "model_provider": (result.process_data or {}).get("model_provider"),
            "model_name": (result.process_data or {}).get("model_name"),
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "tool_name": tool_name,
            "iteration_id": str(metadata[WorkflowNodeExecutionMetadataKey.ITERATION_ID])
            if WorkflowNodeExecutionMetadataKey.ITERATION_ID in metadata
            else None,
            "iteration_index": metadata.get(WorkflowNodeExecutionMetadataKey.ITERATION_INDEX),
            "loop_id": str(metadata[WorkflowNodeExecutionMetadataKey.LOOP_ID])
            if WorkflowNodeExecutionMetadataKey.LOOP_ID in metadata
            else None,
            "loop_index": metadata.get(WorkflowNodeExecutionMetadataKey.LOOP_INDEX),
            "parallel_id": str(metadata[WorkflowNodeExecutionMetadataKey.PARALLEL_ID])
            if WorkflowNodeExecutionMetadataKey.PARALLEL_ID in metadata
            else None,
            "node_inputs": result.inputs,
            "node_outputs": result.outputs,
            "process_data": result.process_data,
            "conversation_id": conversation_id,
            "invoke_from": str(self._application_generate_entity.invoke_from),
            "user_id": self._application_generate_entity.user_id,
            "parent_trace_context": parent_trace_context,
        }

        from core.telemetry import NodeExecutionTraceEvent, TelemetryContext
        from core.telemetry import emit as telemetry_emit

        telemetry_emit(
            NodeExecutionTraceEvent(
                context=TelemetryContext(
                    tenant_id=app_config.tenant_id,
                    user_id=self._application_generate_entity.user_id,
                    app_id=app_config.app_id,
                ),
                payload={"node_execution_data": node_data},
            ),
            trace_manager=self._trace_manager,
        )
