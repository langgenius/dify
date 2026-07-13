"""Expand persisted node executions into public terminal and retry trace records."""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError

from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY, WorkflowNodeRetryAttempt
from libs.helper import to_timestamp
from models.workflow import WorkflowNodeExecutionModel
from repositories.api_workflow_node_execution_repository import DifyAPIWorkflowNodeExecutionRepository
from services.variable_truncator import VariableTruncator

logger = logging.getLogger(__name__)


class WorkflowNodeExecutionTrace(BaseModel):
    """Response-neutral read model for a persisted terminal or virtual retry trace."""

    id: str
    index: int | None = None
    predecessor_node_id: str | None = None
    node_id: str | None = None
    node_type: str | None = None
    title: str | None = None
    inputs: Mapping[str, Any] | None = None
    process_data: Mapping[str, Any] | None = None
    outputs: Mapping[str, Any] | None = None
    status: str | None = None
    error: str | None = None
    elapsed_time: float | None = None
    execution_metadata: Mapping[str, Any] | None = None
    extras: Any = None
    created_at: int | None = None
    created_by_role: str | None = None
    created_by_account: Any = None
    created_by_end_user: Any = None
    finished_at: int | None = None
    inputs_truncated: bool = False
    outputs_truncated: bool = False
    process_data_truncated: bool = False
    retry_index: int | None = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


def assemble_workflow_node_execution_traces(
    executions: Sequence[WorkflowNodeExecutionModel],
    repository: DifyAPIWorkflowNodeExecutionRepository,
) -> list[WorkflowNodeExecutionTrace]:
    """Expand valid persisted retry attempts before each terminal execution."""
    traces: list[WorkflowNodeExecutionTrace] = []
    for execution in executions:
        traces.extend(_expand_execution(execution, repository))
    return traces


def _expand_execution(
    execution: WorkflowNodeExecutionModel,
    repository: DifyAPIWorkflowNodeExecutionRepository,
) -> list[WorkflowNodeExecutionTrace]:
    full_process_data = _load_full_process_data(execution, repository)
    retry_attempts = _parse_retry_attempts(execution, full_process_data)
    terminal_metadata = execution.execution_metadata_dict
    traces = [_retry_trace(execution, attempt, terminal_metadata) for attempt in retry_attempts]
    traces.append(_terminal_trace(execution))
    return traces


def _load_full_process_data(
    execution: WorkflowNodeExecutionModel,
    repository: DifyAPIWorkflowNodeExecutionRepository,
) -> Mapping[str, Any] | None:
    try:
        return repository.load_full_process_data(execution)
    except Exception:
        logger.warning(
            "Failed to load full Process Data for workflow run %s node execution %s; using inline preview",
            execution.workflow_run_id,
            execution.id,
            exc_info=True,
        )
        return execution.process_data_dict


def _parse_retry_attempts(
    execution: WorkflowNodeExecutionModel,
    process_data: Mapping[str, Any] | None,
) -> list[WorkflowNodeRetryAttempt]:
    raw_history = (process_data or {}).get(RETRY_HISTORY_PROCESS_DATA_KEY)
    if not isinstance(raw_history, list):
        return []

    attempts: list[WorkflowNodeRetryAttempt] = []
    seen_indices: set[int] = set()
    for raw_attempt in raw_history:
        try:
            attempt = WorkflowNodeRetryAttempt.model_validate(raw_attempt)
        except ValidationError:
            logger.warning(
                "Skipping malformed retry history for workflow run %s node execution %s",
                execution.workflow_run_id,
                execution.id,
                exc_info=True,
            )
            continue
        if attempt.retry_index in seen_indices:
            logger.warning(
                "Skipping duplicate retry index %s for workflow run %s node execution %s",
                attempt.retry_index,
                execution.workflow_run_id,
                execution.id,
            )
            continue
        seen_indices.add(attempt.retry_index)
        attempts.append(attempt)

    return sorted(attempts, key=lambda attempt: attempt.retry_index)


def _retry_trace(
    execution: WorkflowNodeExecutionModel,
    attempt: WorkflowNodeRetryAttempt,
    terminal_metadata: Mapping[str, Any],
) -> WorkflowNodeExecutionTrace:
    truncator = VariableTruncator.default()
    inputs, inputs_truncated = truncator.truncate_variable_mapping(attempt.inputs)
    process_data, process_data_truncated = truncator.truncate_variable_mapping(attempt.process_data)
    outputs, outputs_truncated = truncator.truncate_variable_mapping(attempt.outputs)
    execution_metadata = {**terminal_metadata, **attempt.execution_metadata}
    return WorkflowNodeExecutionTrace(
        id=f"{execution.id}:retry:{attempt.retry_index}",
        index=execution.index,
        predecessor_node_id=execution.predecessor_node_id,
        node_id=execution.node_id,
        node_type=execution.node_type,
        title=execution.title,
        inputs=inputs,
        process_data=process_data,
        outputs=outputs,
        status="retry",
        error=attempt.error,
        elapsed_time=attempt.elapsed_time,
        execution_metadata=execution_metadata,
        extras=execution.extras,
        created_at=attempt.created_at,
        created_by_role=_enum_value(execution.created_by_role),
        created_by_account=execution.created_by_account,
        created_by_end_user=execution.created_by_end_user,
        finished_at=attempt.finished_at,
        inputs_truncated=inputs_truncated,
        outputs_truncated=outputs_truncated,
        process_data_truncated=process_data_truncated,
        retry_index=attempt.retry_index,
    )


def _terminal_trace(execution: WorkflowNodeExecutionModel) -> WorkflowNodeExecutionTrace:
    process_data = execution.process_data_dict
    if process_data is not None and RETRY_HISTORY_PROCESS_DATA_KEY in process_data:
        process_data = dict(process_data)
        process_data.pop(RETRY_HISTORY_PROCESS_DATA_KEY, None)
    return WorkflowNodeExecutionTrace(
        id=execution.id,
        index=execution.index,
        predecessor_node_id=execution.predecessor_node_id,
        node_id=execution.node_id,
        node_type=execution.node_type,
        title=execution.title,
        inputs=execution.inputs_dict,
        process_data=process_data,
        outputs=execution.outputs_dict,
        status=_enum_value(execution.status),
        error=execution.error,
        elapsed_time=execution.elapsed_time,
        execution_metadata=execution.execution_metadata_dict,
        extras=execution.extras,
        created_at=to_timestamp(execution.created_at),
        created_by_role=_enum_value(execution.created_by_role),
        created_by_account=execution.created_by_account,
        created_by_end_user=execution.created_by_end_user,
        finished_at=to_timestamp(execution.finished_at),
        inputs_truncated=execution.inputs_truncated,
        outputs_truncated=execution.outputs_truncated,
        process_data_truncated=execution.process_data_truncated,
    )


def _enum_value(value: Enum | str | None) -> str | None:
    if value is None or isinstance(value, str):
        return value
    return str(value.value)
