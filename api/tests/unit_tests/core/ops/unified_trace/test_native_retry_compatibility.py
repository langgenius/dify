"""Preserve the existing Native retry summary using real persisted-record values."""

from datetime import datetime, timedelta

from core.ops.unified_trace.trace_builder import CanonicalTraceBuilder
from domain.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY
from graphon.enums import WorkflowNodeExecutionStatus
from tests.helpers.unit.core.ops.trace_fixtures import workflow_node_execution, workflow_trace_info


def test_native_workflow_trace_keeps_compact_retry_summary_and_parent_order() -> None:
    attempts = [
        {
            "retry_index": index,
            "inputs": {"private_input": "not exported"},
            "process_data": {"private_request": "not exported"},
            "outputs": {"status_code": 500},
            "error": f"attempt {index} failed",
            "elapsed_time": float(index),
            "execution_metadata": {"internal": True},
            "created_at": 1_700_000_000,
            "finished_at": 1_700_000_001,
        }
        for index in [1, 2, 3]
    ]
    node = workflow_node_execution()
    node.process_data = {
        RETRY_HISTORY_PROCESS_DATA_KEY: [attempts[0], "malformed", {"retry_index": True}, *attempts[1:]]
    }
    node.status = WorkflowNodeExecutionStatus.SUCCEEDED
    node.elapsed_time = 1.0
    info = workflow_trace_info()
    info.start_time = datetime(2026, 1, 1)
    info.end_time = info.start_time + timedelta(seconds=5)

    trace = CanonicalTraceBuilder(lambda _info: [node]).build(info)

    assert trace is not None
    assert trace.spans[0].id == trace.root_span_id
    child = trace.spans[-1]
    assert child.parent_id == trace.root_span_id
    assert child.metadata["retry_count"] == 3
    assert child.metadata["retry_attempts"] == [
        {
            key: value
            for key, value in attempt.items()
            if key in {"retry_index", "error", "elapsed_time", "created_at", "finished_at"}
        }
        for attempt in attempts
    ]
    for field in ["inputs", "outputs", "process_data", "execution_metadata"]:
        assert all(field not in attempt for attempt in child.metadata["retry_attempts"])


def test_native_workflow_without_retry_history_has_no_retry_metadata() -> None:
    node = workflow_node_execution()
    info = workflow_trace_info()

    trace = CanonicalTraceBuilder(lambda _info: [node]).build(info)

    assert trace is not None
    assert "retry_count" not in trace.spans[-1].metadata
    assert "retry_attempts" not in trace.spans[-1].metadata
