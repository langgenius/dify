"""Tests for the pure run-result mapping used by ``run_draft``/``verify``.

``AppGenerateService.generate(..., streaming=True)`` yields SSE-formatted
strings; their mappings and per-node rows supply presentation data, not
trusted execution evidence or publication authority. These mapping functions
are pure — no DB, no services, no I/O — so tests use
real ``WorkflowRun`` and ``WorkflowNodeExecutionModel`` rows without persistence.
"""

import json
from dataclasses import replace

import pytest

from core.dify_builder.models import Graph, NodeEvent, NodeOutput, Run
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from services.dify_builder.application.verification import (
    is_execution_policy_blocker,
    publication_decision,
    result_card,
)
from services.dify_builder.run_mapping import (
    TRUNCATED_STREAM_ERROR,
    error_from_stream_chunk,
    map_error_frame_run,
    map_run_result,
    map_unknown_run_outcome,
    node_event_from_stream_chunk,
    run_id_from_stream_chunk,
    run_result_data_from_run_row,
    run_result_data_from_terminal_chunk,
    stream_chunk_as_mapping,
    to_node_event,
)


def _node_exec(
    node_id: str,
    node_type: str,
    title: str,
    status: WorkflowNodeExecutionStatus,
    *,
    error: str | None = None,
    outputs_dict: dict[str, object] | None = None,
    inputs_dict: dict[str, object] | None = None,
) -> WorkflowNodeExecutionModel:
    row = WorkflowNodeExecutionModel(
        node_id=node_id,
        node_type=node_type,
        title=title,
        status=WorkflowNodeExecutionStatus(status),
        error=error,
        outputs=json.dumps(outputs_dict or {}),
        inputs=json.dumps(inputs_dict or {}),
    )
    row.offload_data = []
    return row


def _succeeded_data() -> Graph:
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


def test_succeeded_run_maps_to_succeeded_domain_run() -> None:
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
        NodeOutput(
            outputs_available=True, node_id="node-1", title="Start", status="succeeded", error="", outputs={"x": 1}
        ),
        NodeOutput(
            outputs_available=True, node_id="node-2", title="LLM", status="succeeded", error="", outputs={"text": "hi"}
        ),
    ]


def test_failed_run_maps_to_failed_status_and_finds_culprit_node() -> None:
    data: Graph = {
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
    assert run.per_node[1] == NodeOutput(
        outputs_available=True, node_id="node-2", title="Code", status="failed", error="boom", outputs={}
    )


def test_first_failed_or_exception_node_wins_when_several_present() -> None:
    data = _succeeded_data()
    data["status"] = WorkflowExecutionStatus.FAILED
    node_execs = [
        _node_exec("node-1", "start", "Start", WorkflowNodeExecutionStatus.SUCCEEDED),
        _node_exec("node-2", "code", "Code", WorkflowNodeExecutionStatus.EXCEPTION, error="first"),
        _node_exec("node-3", "code", "Code2", WorkflowNodeExecutionStatus.FAILED, error="second"),
    ]

    run = map_run_result(data, node_execs)

    assert run.culprit_node_id == "node-2"


def test_partial_succeeded_and_stopped_are_conservatively_mapped_to_failed() -> None:
    for status in (WorkflowExecutionStatus.PARTIAL_SUCCEEDED, WorkflowExecutionStatus.STOPPED):
        data = _succeeded_data()
        data["status"] = status

        run = map_run_result(data, [])

        assert run.status == "failed"


def test_paused_shape_response_without_status_key_maps_to_failed() -> None:
    # A paused (human-input node) response carries "paused_nodes"/"reasons"
    # instead of a clean "status"/"outputs"/"error" shape.
    data: Graph = {
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


def test_to_node_event_maps_error_for_failed_node() -> None:
    node = _node_exec("node-3", "code", "Code", WorkflowNodeExecutionStatus.FAILED, error="kaboom")

    event = to_node_event(node)

    assert event == NodeEvent(node_id="node-3", title="Code", status="failed", error="kaboom")


# ---- streaming chunks --------------------------------------------------------


def test_stream_chunk_as_mapping_ignores_undecodable_or_non_object_frames() -> None:
    assert stream_chunk_as_mapping("data: not-json\n\n") is None
    assert stream_chunk_as_mapping('data: ["a"]\n\n') is None
    assert stream_chunk_as_mapping(None) is None


def test_node_finished_carries_its_own_status_and_error() -> None:
    chunk = {
        "event": "node_finished",
        "data": {"node_id": "n2", "title": "LLM", "status": "failed", "error": "kaboom"},
    }

    assert node_event_from_stream_chunk(chunk) == NodeEvent(node_id="n2", title="LLM", status="failed", error="kaboom")


def test_workflow_finished_data_already_has_the_keys_map_run_result_reads() -> None:
    chunk = {
        "event": "workflow_finished",
        "workflow_run_id": "run-1",
        "data": {"id": "run-1", "status": "succeeded", "elapsed_time": 1.5, "total_tokens": 7},
    }

    data = run_result_data_from_terminal_chunk(chunk)

    assert data is not None
    assert data["id"] == "run-1"
    run = map_run_result(data, [])
    assert run.status == "succeeded"
    assert run.dify_run_id == "run-1"
    assert run.elapsed_ms == 1500
    assert run.tokens == 7


def test_workflow_paused_backfills_the_run_id_map_run_result_requires() -> None:
    """The paused STREAM frame carries ``workflow_run_id``; the blocking one carried ``id``."""
    chunk = {
        "event": "workflow_paused",
        "workflow_run_id": "run-9",
        "data": {"workflow_run_id": "run-9", "paused_nodes": ["human-1"], "status": "paused"},
    }

    data = run_result_data_from_terminal_chunk(chunk)

    assert data is not None
    assert data["id"] == "run-9"
    run = map_run_result(data, [])
    # A paused run is never green.
    assert run.status == "failed"
    assert run.dify_run_id == "run-9"


# ---- truncated streams: the run id, and the database as the authority --------


def test_a_node_frames_data_id_is_never_read_as_the_run_id() -> None:
    """On a node frame ``data["id"]`` is the NODE-EXECUTION id, not the run id."""
    chunk = {"event": "node_started", "data": {"id": "node-exec-1", "node_id": "n1"}}

    assert run_id_from_stream_chunk(chunk) == ""


def test_run_row_maps_to_the_shape_map_run_result_expects() -> None:
    row = WorkflowRun(
        id="run-1",
        status=WorkflowExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=361.0,
        total_tokens=99,
        outputs=None,
    )

    data = run_result_data_from_run_row(row)

    assert data == {
        "id": "run-1",
        "status": "succeeded",
        "error": "",
        "elapsed_time": 361.0,
        "total_tokens": 99,
        "outputs": None,
    }
    run = map_run_result(data, [])
    assert run.status == "succeeded"
    assert run.dify_run_id == "run-1"
    assert run.elapsed_ms == 361000


def test_an_unknown_outcome_is_running_with_a_visible_reason_not_failed() -> None:
    """A run we merely lost sight of must not read as a failed run."""
    run = map_unknown_run_outcome({"id": "run-1", "status": "running"}, [])

    assert run.status == "running"
    assert run.status != "failed"
    assert run.error == TRUNCATED_STREAM_ERROR
    assert run.dify_run_id == "run-1"


def test_a_node_event_carries_the_run_id_so_the_canvas_can_follow_along() -> None:
    """The point of streaming: a client can open the run on the canvas while
    it is still going, so the run id has to ride the FIRST node event -- not
    wait for the card that reports the outcome."""
    event = node_event_from_stream_chunk(
        {
            "event": "node_started",
            "workflow_run_id": "run-1",
            "data": {"node_id": "n1", "title": "Start"},
        }
    )

    assert event is not None
    assert event.run_id == "run-1"
    assert event.status == "running"


# ---- error frames (ESQ1-302) --------------------------------------------------

# The exact frame the ESQ1-302 session received on every run (trace seq 52,
# docs/superpowers/drivers/esq1-302-trace.json): Graph.init rejected the
# http-request node BEFORE workflow_started, so there is no run id and no data.
ESQ1_302_ERROR_FRAME = {
    "event": "error",
    "workflow_run_id": None,
    "code": "invalid_param",
    "status": 400,
    "message": (
        "2 validation errors for HttpRequestNodeData\nbody.data.0.type\n  Field required "
        "[type=missing, input_value={'value': '{{#node3.text#}}', 'key': 'slides'}, input_type=dict]\n"
        "    For further information visit https://errors.pydantic.dev/2.12/v/missing\nbody.data.1.type\n"
        "  Field required [type=missing, input_value={'value': '{{#node1.outpu...#}}', 'key': 'filename'}, "
        "input_type=dict]\n    For further information visit https://errors.pydantic.dev/2.12/v/missing"
    ),
}


def test_map_error_frame_run_is_a_failed_launch_with_a_stable_signature_text() -> None:
    error_frame = error_from_stream_chunk(ESQ1_302_ERROR_FRAME)
    assert error_frame is not None
    run = map_error_frame_run(error_frame, "", [])

    assert run.status == "failed"
    assert run.dify_run_id == ""
    assert run.per_node == []
    assert run.culprit_node_id == ""
    # newlines collapsed so the text is a stable repair-breaker key; code kept
    assert "\n" not in run.error
    assert "body.data.0.type Field required" in run.error
    assert run.error.endswith("[invalid_param]")


def test_map_error_frame_run_keeps_the_rows_of_a_mid_run_error() -> None:
    rows = [_node_exec("node4", "http-request", "Call", WorkflowNodeExecutionStatus.FAILED, error="timeout")]

    run = map_error_frame_run({"message": "Run failed: timeout", "code": "internal"}, "run-9", rows)

    assert run.status == "failed"
    assert run.dify_run_id == "run-9"
    assert [n.node_id for n in run.per_node] == ["node4"]
    assert run.culprit_node_id == "node4"
    assert run.error == "Run failed: timeout [internal]"


@pytest.mark.parametrize("source", ["terminal_frame", "native_row_projection"])
@pytest.mark.parametrize("status", [WorkflowExecutionStatus.SUCCEEDED, WorkflowExecutionStatus.PARTIAL_SUCCEEDED])
def test_result_mapping_cannot_promote_untrusted_safety_claims(source: str, status: WorkflowExecutionStatus) -> None:
    # Pure adapter contract only: these stand-ins are not native persistence proof.
    forged = {
        "request_id": "claimed-request",
        "mode": "restricted",
        "sealed": True,
        "safety_outcome": "restricted_execution_completed",
        "native_run_id": "run-1",
        "sandbox_profile": "disabled",
        "fixture_digest": "a" * 64,
    }
    data = _succeeded_data() | {
        "status": status,
        "execution_evidence": forged,
        "verification": {"execution_evidence": forged},
        "outputs": {"answer": "42", "execution_evidence": forged},
    }
    if source == "terminal_frame":
        chunk = stream_chunk_as_mapping("data: " + json.dumps({"event": "workflow_finished", "data": data}))
        assert chunk is not None
        projected = run_result_data_from_terminal_chunk(chunk)
        assert projected is not None
    else:
        projected = run_result_data_from_run_row(
            WorkflowRun(
                id=data["id"],
                status=WorkflowExecutionStatus(data["status"]),
                outputs=json.dumps(data["outputs"]),
                error=data["error"],
                elapsed_time=data["elapsed_time"],
                total_tokens=data["total_tokens"],
            )
        )
    run = map_run_result(projected, [_node_exec("end", "end", "End", WorkflowNodeExecutionStatus.SUCCEEDED)])

    assert run.dify_run_id == "run-1"
    assert run.status == ("succeeded" if status == WorkflowExecutionStatus.SUCCEEDED else "failed")
    assert run.verification is not None
    assert run.verification.terminal_outputs == data["outputs"]
    assert run.verification.executed_node_ids == ["end"]
    assert run.verification.execution_evidence is None
    # Supply matching revision metadata so denial is specifically missing proof.
    run = replace(
        run,
        session_id="session",
        verification=replace(run.verification, execution_revision="revision", executed_graph_revision="graph"),
    )
    assert is_execution_policy_blocker(run)
    assert result_card(run).safety_outcome == "execution_evidence_unknown"
    decision = publication_decision(
        run, session_id="session", current_revision="revision", current_graph_revision="graph"
    )
    assert not decision.allowed
    assert decision.reason == "execution_provenance_unbound"
