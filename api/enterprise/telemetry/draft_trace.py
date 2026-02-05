from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from core.telemetry import TelemetryContext, TelemetryEvent, TelemetryFacade, TraceTaskName
from core.workflow.enums import WorkflowNodeExecutionMetadataKey
from models.workflow import WorkflowNodeExecutionModel


def enqueue_draft_node_execution_trace(
    *,
    execution: WorkflowNodeExecutionModel,
    outputs: Mapping[str, Any] | None,
    workflow_execution_id: str | None,
    user_id: str,
) -> None:
    node_data = _build_node_execution_data(
        execution=execution,
        outputs=outputs,
        workflow_execution_id=workflow_execution_id,
    )
    TelemetryFacade.emit(
        TelemetryEvent(
            name=TraceTaskName.DRAFT_NODE_EXECUTION_TRACE,
            context=TelemetryContext(
                tenant_id=execution.tenant_id,
                user_id=user_id,
                app_id=execution.app_id,
            ),
            payload={"node_execution_data": node_data},
        )
    )


def _build_node_execution_data(
    *,
    execution: WorkflowNodeExecutionModel,
    outputs: Mapping[str, Any] | None,
    workflow_execution_id: str | None,
) -> dict[str, Any]:
    metadata = execution.execution_metadata_dict
    node_outputs = outputs if outputs is not None else execution.outputs_dict
    execution_id = workflow_execution_id or execution.workflow_run_id or execution.id

    return {
        "workflow_id": execution.workflow_id,
        "workflow_execution_id": execution_id,
        "tenant_id": execution.tenant_id,
        "app_id": execution.app_id,
        "node_execution_id": execution.id,
        "node_id": execution.node_id,
        "node_type": execution.node_type,
        "title": execution.title,
        "status": execution.status,
        "error": execution.error,
        "elapsed_time": execution.elapsed_time,
        "index": execution.index,
        "predecessor_node_id": execution.predecessor_node_id,
        "created_at": execution.created_at,
        "finished_at": execution.finished_at,
        "total_tokens": metadata.get(WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS, 0),
        "total_price": metadata.get(WorkflowNodeExecutionMetadataKey.TOTAL_PRICE, 0.0),
        "currency": metadata.get(WorkflowNodeExecutionMetadataKey.CURRENCY),
        "tool_name": (metadata.get(WorkflowNodeExecutionMetadataKey.TOOL_INFO) or {}).get("tool_name")
        if isinstance(metadata.get(WorkflowNodeExecutionMetadataKey.TOOL_INFO), dict)
        else None,
        "iteration_id": metadata.get(WorkflowNodeExecutionMetadataKey.ITERATION_ID),
        "iteration_index": metadata.get(WorkflowNodeExecutionMetadataKey.ITERATION_INDEX),
        "loop_id": metadata.get(WorkflowNodeExecutionMetadataKey.LOOP_ID),
        "loop_index": metadata.get(WorkflowNodeExecutionMetadataKey.LOOP_INDEX),
        "parallel_id": metadata.get(WorkflowNodeExecutionMetadataKey.PARALLEL_ID),
        "node_inputs": execution.inputs_dict,
        "node_outputs": node_outputs,
        "process_data": execution.process_data_dict,
    }
