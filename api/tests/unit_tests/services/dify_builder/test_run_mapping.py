"""Tests for the pure run-result mapping used by ``run_draft``/``verify``.

``AppGenerateService.generate(..., streaming=True)`` yields SSE-formatted
strings; the event mapping one carries (plus a sequence of per-node
execution rows) is all the dify_builder domain ``Run``/``NodeEvent`` need. These
mapping functions are pure — no DB, no services, no I/O — so tests use
``SimpleNamespace`` stand-ins for the node-execution rows instead of the
real ``WorkflowNodeExecutionModel``.
"""

from types import SimpleNamespace

from core.dify_builder.models import NodeEvent, NodeOutput, Run
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from services.dify_builder.run_mapping import (
    TRUNCATED_STREAM_ERROR,
    is_unfinished_run_status,
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


# ---- streaming chunks --------------------------------------------------------


def test_stream_chunk_as_mapping_unwraps_the_sse_data_frame():
    """What ``convert_to_event_stream`` actually emits for an event mapping."""
    chunk = 'data: {"event": "node_started", "data": {"node_id": "n1"}}\n\n'

    assert stream_chunk_as_mapping(chunk) == {"event": "node_started", "data": {"node_id": "n1"}}


def test_stream_chunk_as_mapping_passes_a_plain_mapping_through():
    chunk = {"event": "node_started", "data": {"node_id": "n1"}}

    assert stream_chunk_as_mapping(chunk) == chunk


def test_stream_chunk_as_mapping_ignores_keep_alives():
    # Both the bare keep-alive and its SSE wrapping carry no event.
    assert stream_chunk_as_mapping("ping") is None
    assert stream_chunk_as_mapping("event: ping\n\n") is None


def test_stream_chunk_as_mapping_ignores_undecodable_or_non_object_frames():
    assert stream_chunk_as_mapping("data: not-json\n\n") is None
    assert stream_chunk_as_mapping('data: ["a"]\n\n') is None
    assert stream_chunk_as_mapping(None) is None


def test_a_ping_chunk_is_not_a_node_event():
    assert node_event_from_stream_chunk({"event": "ping"}) is None


def test_a_workflow_level_chunk_is_not_a_node_event():
    assert node_event_from_stream_chunk({"event": "workflow_finished", "data": {"id": "r1"}}) is None


def test_node_started_reports_running_because_it_has_no_status_yet():
    chunk = {"event": "node_started", "data": {"node_id": "n1", "title": "Start"}}

    assert node_event_from_stream_chunk(chunk) == NodeEvent(node_id="n1", title="Start", status="running", error="")


def test_node_finished_carries_its_own_status_and_error():
    chunk = {
        "event": "node_finished",
        "data": {"node_id": "n2", "title": "LLM", "status": "failed", "error": "kaboom"},
    }

    assert node_event_from_stream_chunk(chunk) == NodeEvent(node_id="n2", title="LLM", status="failed", error="kaboom")


def test_node_finished_unwraps_an_enum_status():
    chunk = {
        "event": "node_finished",
        "data": {"node_id": "n3", "title": "Code", "status": WorkflowNodeExecutionStatus.SUCCEEDED},
    }

    assert node_event_from_stream_chunk(chunk).status == "succeeded"


def test_node_chunk_tolerates_missing_fields():
    assert node_event_from_stream_chunk({"event": "node_started"}) == NodeEvent(
        node_id="", title="", status="running", error=""
    )


def test_terminal_chunk_adapter_ignores_non_terminal_events():
    assert run_result_data_from_terminal_chunk({"event": "node_finished", "data": {}}) is None


def test_workflow_finished_data_already_has_the_keys_map_run_result_reads():
    chunk = {
        "event": "workflow_finished",
        "workflow_run_id": "run-1",
        "data": {"id": "run-1", "status": "succeeded", "elapsed_time": 1.5, "total_tokens": 7},
    }

    data = run_result_data_from_terminal_chunk(chunk)

    assert data["id"] == "run-1"
    run = map_run_result(data, [])
    assert run.status == "succeeded"
    assert run.dify_run_id == "run-1"
    assert run.elapsed_ms == 1500
    assert run.tokens == 7


def test_workflow_paused_backfills_the_run_id_map_run_result_requires():
    """The paused STREAM frame carries ``workflow_run_id``; the blocking one carried ``id``."""
    chunk = {
        "event": "workflow_paused",
        "workflow_run_id": "run-9",
        "data": {"workflow_run_id": "run-9", "paused_nodes": ["human-1"], "status": "paused"},
    }

    data = run_result_data_from_terminal_chunk(chunk)

    assert data["id"] == "run-9"
    run = map_run_result(data, [])
    # A paused run is never green.
    assert run.status == "failed"
    assert run.dify_run_id == "run-9"


# ---- truncated streams: the run id, and the database as the authority --------


def test_every_non_ping_frame_carries_the_run_id_at_the_top_level():
    """``convert_stream_full_response`` stamps ``workflow_run_id`` on each frame."""
    chunk = {"event": "node_started", "workflow_run_id": "run-1", "data": {"node_id": "n1"}}

    assert run_id_from_stream_chunk(chunk) == "run-1"


def test_a_node_frames_data_id_is_never_read_as_the_run_id():
    """On a node frame ``data["id"]`` is the NODE-EXECUTION id, not the run id."""
    chunk = {"event": "node_started", "data": {"id": "node-exec-1", "node_id": "n1"}}

    assert run_id_from_stream_chunk(chunk) == ""


def test_workflow_level_frames_fall_back_to_their_data_id():
    assert run_id_from_stream_chunk({"event": "workflow_started", "data": {"id": "run-1"}}) == "run-1"
    assert run_id_from_stream_chunk({"event": "workflow_finished", "data": {"id": "run-2"}}) == "run-2"


def test_paused_frames_fall_back_to_their_data_workflow_run_id():
    chunk = {"event": "workflow_paused", "data": {"workflow_run_id": "run-9"}}

    assert run_id_from_stream_chunk(chunk) == "run-9"


def test_a_frame_with_no_run_id_yields_empty_string():
    assert run_id_from_stream_chunk({"event": "ping"}) == ""
    assert run_id_from_stream_chunk({"event": "node_started", "data": "not-a-mapping"}) == ""


def test_run_row_maps_to_the_shape_map_run_result_expects():
    row = SimpleNamespace(
        id="run-1",
        status=WorkflowExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=361.0,
        total_tokens=99,
    )

    data = run_result_data_from_run_row(row)

    assert data == {"id": "run-1", "status": "succeeded", "error": "", "elapsed_time": 361.0, "total_tokens": 99}
    run = map_run_result(data, [])
    assert run.status == "succeeded"
    assert run.dify_run_id == "run-1"
    assert run.elapsed_ms == 361000


def test_unfinished_statuses_are_the_ones_that_mean_not_over_yet():
    assert is_unfinished_run_status("running") is True
    assert is_unfinished_run_status("scheduled") is True
    assert is_unfinished_run_status(WorkflowExecutionStatus.RUNNING) is True
    assert is_unfinished_run_status("") is True
    assert is_unfinished_run_status(None) is True
    assert is_unfinished_run_status("succeeded") is False
    assert is_unfinished_run_status("failed") is False
    assert is_unfinished_run_status(WorkflowExecutionStatus.PARTIAL_SUCCEEDED) is False


def test_an_unknown_outcome_is_running_with_a_visible_reason_not_failed():
    """A run we merely lost sight of must not read as a failed run."""
    run = map_unknown_run_outcome({"id": "run-1", "status": "running"}, [])

    assert run.status == "running"
    assert run.status != "failed"
    assert run.error == TRUNCATED_STREAM_ERROR
    assert run.dify_run_id == "run-1"


def test_an_unknown_outcome_still_carries_the_per_node_rows_it_has():
    node = _node_exec("node-1", "code", "Code", WorkflowNodeExecutionStatus.SUCCEEDED, outputs_dict={"x": 1})

    run = map_unknown_run_outcome({"id": "run-1"}, [node])

    assert run.status == "running"
    assert [n.node_id for n in run.per_node] == ["node-1"]
    assert run.per_node[0].outputs == {"x": 1}
