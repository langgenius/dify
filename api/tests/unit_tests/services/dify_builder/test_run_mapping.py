"""Tests for the pure run-result mapping used by ``run_draft``/``verify``.

``AppGenerateService.generate(..., streaming=False)`` returns a blocking
response whose ``["data"]`` sub-mapping (plus a sequence of per-node
execution rows) is all the dify_builder domain ``Run``/``NodeEvent`` need. These
mapping functions are pure — no DB, no services, no I/O — so tests use
``SimpleNamespace`` stand-ins for the node-execution rows instead of the
real ``WorkflowNodeExecutionModel``.
"""

from types import SimpleNamespace

from core.dify_builder.models import NodeEvent, NodeOutput, Run
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from services.dify_builder.run_mapping import map_run_result, to_node_event


def _node_exec(
    node_id: str,
    node_type: str,
    title: str,
    status: WorkflowNodeExecutionStatus,
    *,
    error: str | None = None,
    outputs_dict: dict | None = None,
    inputs_dict: dict | None = None,
):
    return SimpleNamespace(
        node_id=node_id,
        node_type=node_type,
        title=title,
        status=status,
        error=error,
        outputs_dict=outputs_dict or {},
        inputs_dict=inputs_dict or {},
    )


def _succeeded_data() -> dict:
    return {
        "id": "run-1",
        "workflow_id": "wf-1",
        "status": WorkflowExecutionStatus.SUCCEEDED,
        "outputs": {"answer": "42"},
        "error": None,
        "elapsed_time": 1.5,
        "total_tokens": 42,
        "total_steps": 2,
    }


def test_succeeded_run_maps_to_succeeded_domain_run():
    data = _succeeded_data()
    node_execs = [
        _node_exec("node-1", "start", "Start", WorkflowNodeExecutionStatus.SUCCEEDED, outputs_dict={"x": 1}),
        _node_exec("node-2", "llm", "LLM", WorkflowNodeExecutionStatus.SUCCEEDED, outputs_dict={"text": "hi"}),
    ]

    run = map_run_result(data, node_execs)

    assert isinstance(run, Run)
    assert run.id == ""
    assert run.kind == "verify"
    assert run.immutable is True
    assert run.dify_run_id == "run-1"
    assert run.status == "succeeded"
    assert run.culprit_node_id == ""
    assert run.tokens == 42
    assert run.elapsed_ms == 1500
    assert run.per_node == [
        NodeOutput(node_id="node-1", title="Start", status="succeeded", error="", outputs={"x": 1}),
        NodeOutput(node_id="node-2", title="LLM", status="succeeded", error="", outputs={"text": "hi"}),
    ]


def test_failed_run_maps_to_failed_status_and_finds_culprit_node():
    data = {
        "id": "run-2",
        "workflow_id": "wf-1",
        "status": WorkflowExecutionStatus.FAILED,
        "outputs": None,
        "error": "boom",
        "elapsed_time": 0.4,
        "total_tokens": 7,
        "total_steps": 2,
    }
    node_execs = [
        _node_exec("node-1", "start", "Start", WorkflowNodeExecutionStatus.SUCCEEDED),
        _node_exec("node-2", "code", "Code", WorkflowNodeExecutionStatus.FAILED, error="boom"),
    ]

    run = map_run_result(data, node_execs)

    assert run.status == "failed"
    assert run.culprit_node_id == "node-2"
    assert run.per_node[1] == NodeOutput(node_id="node-2", title="Code", status="failed", error="boom", outputs={})


def test_exception_node_status_is_also_treated_as_culprit():
    data = _succeeded_data()
    data["status"] = WorkflowExecutionStatus.FAILED
    node_execs = [
        _node_exec("node-1", "start", "Start", WorkflowNodeExecutionStatus.SUCCEEDED),
        _node_exec("node-2", "tool", "Tool", WorkflowNodeExecutionStatus.EXCEPTION, error="tool exploded"),
    ]

    run = map_run_result(data, node_execs)

    assert run.culprit_node_id == "node-2"


def test_first_failed_or_exception_node_wins_when_several_present():
    data = _succeeded_data()
    data["status"] = WorkflowExecutionStatus.FAILED
    node_execs = [
        _node_exec("node-1", "start", "Start", WorkflowNodeExecutionStatus.SUCCEEDED),
        _node_exec("node-2", "code", "Code", WorkflowNodeExecutionStatus.EXCEPTION, error="first"),
        _node_exec("node-3", "code", "Code2", WorkflowNodeExecutionStatus.FAILED, error="second"),
    ]

    run = map_run_result(data, node_execs)

    assert run.culprit_node_id == "node-2"


def test_partial_succeeded_and_stopped_are_conservatively_mapped_to_failed():
    for status in (WorkflowExecutionStatus.PARTIAL_SUCCEEDED, WorkflowExecutionStatus.STOPPED):
        data = _succeeded_data()
        data["status"] = status

        run = map_run_result(data, [])

        assert run.status == "failed"


def test_paused_status_run_maps_to_failed():
    data = _succeeded_data()
    data["status"] = WorkflowExecutionStatus.PAUSED

    run = map_run_result(data, [])

    assert run.status == "failed"


def test_paused_shape_response_without_status_key_maps_to_failed():
    # A paused (human-input node) response carries "paused_nodes"/"reasons"
    # instead of a clean "status"/"outputs"/"error" shape.
    data = {
        "id": "run-3",
        "workflow_id": "wf-1",
        "paused_nodes": ["node-2"],
        "reasons": ["awaiting human input"],
        "elapsed_time": 0.2,
        "total_tokens": 3,
        "total_steps": 1,
    }

    run = map_run_result(data, [])

    assert run.status == "failed"
    assert run.dify_run_id == "run-3"


def test_status_accepts_plain_string_value_defensively():
    data = _succeeded_data()
    data["status"] = "succeeded"

    run = map_run_result(data, [])

    assert run.status == "succeeded"


def test_missing_total_tokens_and_elapsed_time_default_to_zero():
    data = {
        "id": "run-4",
        "workflow_id": "wf-1",
        "status": WorkflowExecutionStatus.SUCCEEDED,
        "outputs": {},
        "error": None,
    }

    run = map_run_result(data, [])

    assert run.tokens == 0
    assert run.elapsed_ms == 0


def test_to_node_event_maps_fields_for_running_node():
    node = _node_exec("node-1", "llm", "LLM", WorkflowNodeExecutionStatus.RUNNING)

    event = to_node_event(node)

    assert event == NodeEvent(node_id="node-1", title="LLM", status="running", error="")


def test_to_node_event_maps_fields_for_succeeded_node():
    node = _node_exec("node-2", "code", "Code", WorkflowNodeExecutionStatus.SUCCEEDED)

    event = to_node_event(node)

    assert event == NodeEvent(node_id="node-2", title="Code", status="succeeded", error="")


def test_to_node_event_maps_error_for_failed_node():
    node = _node_exec("node-3", "code", "Code", WorkflowNodeExecutionStatus.FAILED, error="kaboom")

    event = to_node_event(node)

    assert event == NodeEvent(node_id="node-3", title="Code", status="failed", error="kaboom")


def test_to_node_event_defaults_missing_error_to_empty_string():
    node = _node_exec("node-4", "code", "Code", WorkflowNodeExecutionStatus.SUCCEEDED, error=None)

    event = to_node_event(node)

    assert event.error == ""
