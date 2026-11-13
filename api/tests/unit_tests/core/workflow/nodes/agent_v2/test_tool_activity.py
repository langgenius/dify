from __future__ import annotations

import json
from datetime import UTC, datetime

from dify_agent.protocol import PydanticAIStreamRunEvent
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    OutputToolCallEvent,
    PartDeltaEvent,
    PartStartEvent,
    RetryPromptPart,
    TextPartDelta,
    ToolCallPart,
    ToolReturnPart,
)

from clients.agent_backend import AgentBackendRunEventAdapter, AgentBackendStreamInternalEvent
from core.workflow.nodes.agent_v2.tool_activity import (
    _TOOL_FIELD_LIMIT,
    WorkflowAgentToolActivityProjector,
)

_CREATED_AT = datetime(2026, 1, 1, tzinfo=UTC)


def _projector() -> WorkflowAgentToolActivityProjector:
    return WorkflowAgentToolActivityProjector(
        node_id="agent-node",
        node_execution_id="exec-1",
        node_title="Research agent",
    )


def _internal(event_kind: str, data: dict[str, object], *, run_id: str = "run-1") -> AgentBackendStreamInternalEvent:
    return AgentBackendStreamInternalEvent(run_id=run_id, event_kind=event_kind, data=data)


def _part_start(
    tool_call_id: str,
    *,
    tool_name: str = "shell_run",
    part_kind: str = "tool-call",
    args: dict[str, object] | None = None,
    run_id: str = "run-1",
) -> AgentBackendStreamInternalEvent:
    return _internal(
        "part_start",
        {
            "part": {
                "part_kind": part_kind,
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "args": args if args is not None else {"script": "ls"},
            }
        },
        run_id=run_id,
    )


def _tool_call(
    tool_call_id: str,
    *,
    tool_name: str = "shell_run",
    args: dict[str, object] | None = None,
    run_id: str = "run-1",
) -> AgentBackendStreamInternalEvent:
    return _internal(
        "function_tool_call",
        {
            "part": {
                "part_kind": "tool-call",
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "args": args if args is not None else {"command": "ls"},
            }
        },
        run_id=run_id,
    )


def _tool_result(
    tool_call_id: str,
    *,
    tool_name: str = "shell_run",
    content: object = "file.txt",
    outcome: str = "success",
    run_id: str = "run-1",
) -> AgentBackendStreamInternalEvent:
    return _internal(
        "function_tool_result",
        {
            "part": {
                "part_kind": "tool-return",
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "content": content,
                "outcome": outcome,
            }
        },
        run_id=run_id,
    )


def _retry_result(
    tool_call_id: str, *, content: str = "invalid arguments", run_id: str = "run-1"
) -> AgentBackendStreamInternalEvent:
    return _internal(
        "function_tool_result",
        {
            "part": {
                "part_kind": "retry-prompt",
                "tool_call_id": tool_call_id,
                "tool_name": "shell_run",
                "content": content,
            }
        },
        run_id=run_id,
    )


def test_start_then_result_emits_matching_snapshots_with_full_fields() -> None:
    projector = _projector()

    running = projector.handle(_tool_call("call-1", args={"command": "ls -la"}))
    assert len(running) == 1
    activity = running[0]
    assert activity.id == "run-1:call-1"
    assert activity.node_id == "agent-node"
    assert activity.node_execution_id == "exec-1"
    assert activity.label == "shell_run"
    assert activity.status == "running"
    assert activity.error is None
    assert activity.data.tool_call_id == "call-1"
    assert activity.data.tool_name == "shell_run"
    assert json.loads(activity.data.tool_input) == {"command": "ls -la"}
    assert activity.data.tool_output == ""
    assert activity.data.node_title == "Research agent"
    assert activity.metadata == {"agent_node_version": "2", "kind": "tool"}

    finished = projector.handle(_tool_result("call-1", content="a.txt\nb.txt"))
    assert len(finished) == 1
    assert finished[0].id == activity.id
    assert finished[0].status == "succeeded"
    assert finished[0].data.tool_input == activity.data.tool_input
    assert finished[0].data.tool_output == "a.txt\nb.txt"


def test_same_name_parallel_calls_correlate_by_call_id_out_of_order() -> None:
    projector = _projector()

    first = projector.handle(_tool_call("call-a", args={"command": "one"}))[0]
    second = projector.handle(_tool_call("call-b", args={"command": "two"}))[0]
    assert first.id != second.id
    assert first.status == second.status == "running"

    done_b = projector.handle(_tool_result("call-b", content="out-b"))[0]
    assert done_b.id == second.id
    assert done_b.status == "succeeded"
    assert done_b.data.tool_output == "out-b"

    done_a = projector.handle(_tool_result("call-a", content="out-a"))[0]
    assert done_a.id == first.id
    assert done_a.status == "succeeded"
    assert done_a.data.tool_output == "out-a"


def test_duplicate_start_and_terminal_events_do_not_duplicate_or_regress() -> None:
    projector = _projector()

    assert len(projector.handle(_tool_call("call-1"))) == 1
    assert projector.handle(_tool_call("call-1")) == []
    assert len(projector.handle(_tool_result("call-1"))) == 1
    assert projector.handle(_tool_result("call-1")) == []
    assert projector.handle(_tool_call("call-1")) == []
    late = projector.handle(_tool_result("call-1", outcome="failure", content="boom"))
    assert late == []
    assert projector.finish("succeeded") == []


def test_unrelated_text_and_output_tool_events_are_ignored() -> None:
    projector = _projector()

    assert projector.handle(_internal("part_delta", {"delta": "hi"})) == []
    assert projector.handle(_internal("part_start", {"part": {"part_kind": "text", "content": "hi"}})) == []
    assert (
        projector.handle(
            _internal(
                "output_tool_call",
                {"part": {"part_kind": "tool-call", "tool_call_id": "out-1", "tool_name": "final", "args": {}}},
            )
        )
        == []
    )
    assert (
        projector.handle(
            _internal(
                "output_tool_result",
                {
                    "part": {
                        "part_kind": "tool-return",
                        "tool_call_id": "out-1",
                        "tool_name": "final",
                        "content": "done",
                        "outcome": "success",
                    }
                },
            )
        )
        == []
    )
    assert projector.finish("succeeded") == []


def test_retry_prompt_result_marks_call_failed() -> None:
    projector = _projector()

    projector.handle(_tool_call("call-1", args={"bad": True}))
    retried = projector.handle(_retry_result("call-1", content="arguments failed validation"))

    assert len(retried) == 1
    assert retried[0].status == "failed"
    assert retried[0].error == "arguments failed validation"
    assert retried[0].data.tool_output == ""


def test_tool_return_failure_outcome_marks_call_failed_with_output_as_error() -> None:
    projector = _projector()

    projector.handle(_tool_call("call-1"))
    failed = projector.handle(_tool_result("call-1", outcome="failure", content="command not found"))

    assert len(failed) == 1
    assert failed[0].status == "failed"
    assert failed[0].error == "command not found"
    assert failed[0].data.tool_output == "command not found"


def test_early_shell_part_start_then_call_then_result_emits_three_phases() -> None:
    projector = _projector()

    previewed = projector.handle(_part_start("call-1", args={"script": "ls"}))
    assert len(previewed) == 1
    assert previewed[0].status == "started"
    assert previewed[0].id == "run-1:call-1"
    assert json.loads(previewed[0].data.tool_input) == {"script": "ls"}

    running = projector.handle(_tool_call("call-1", args={"script": "ls -la", "timeout": 30}))
    assert len(running) == 1
    assert running[0].id == previewed[0].id
    assert running[0].status == "running"
    assert json.loads(running[0].data.tool_input) == {"script": "ls -la", "timeout": 30}

    finished = projector.handle(_tool_result("call-1", content="a.txt"))
    assert len(finished) == 1
    assert finished[0].id == previewed[0].id
    assert finished[0].status == "succeeded"
    assert finished[0].data.tool_input == running[0].data.tool_input


def test_generic_tool_call_has_no_early_started_phase() -> None:
    projector = _projector()

    assert projector.handle(_part_start("call-1", tool_name="web_search", args={"q": "dify"})) == []

    running = projector.handle(_tool_call("call-1", tool_name="web_search", args={"q": "dify docs"}))
    assert len(running) == 1
    assert running[0].status == "running"
    assert running[0].data.tool_name == "web_search"

    finished = projector.handle(_tool_result("call-1", tool_name="web_search", content="docs"))
    assert finished[0].status == "succeeded"


def test_early_part_start_rejects_non_shell_and_incomplete_payloads() -> None:
    projector = _projector()

    assert projector.handle(_part_start("call-1", tool_name="web_search")) == []
    assert projector.handle(_part_start("call-2", part_kind="text")) == []
    assert (
        projector.handle(
            _internal(
                "part_start",
                {"part": {"part_kind": "tool-call", "tool_name": "shell_run", "args": {}}},
            )
        )
        == []
    )
    assert (
        projector.handle(
            _internal(
                "part_start",
                {"part": {"part_kind": "tool-call", "tool_call_id": "call-3", "args": {}}},
            )
        )
        == []
    )
    assert projector.finish("succeeded") == []


def test_late_early_start_does_not_regress_running_or_terminal() -> None:
    projector = _projector()

    projector.handle(_tool_call("call-1", args={"script": "ls -la"}))
    assert projector.handle(_part_start("call-1", args={"script": "ls"})) == []

    projector.handle(_tool_result("call-1", content="a.txt"))
    assert projector.handle(_part_start("call-1", args={"script": "ls"})) == []
    assert projector.finish("succeeded") == []


def test_duplicate_running_start_does_not_duplicate_or_regress() -> None:
    projector = _projector()

    first = projector.handle(_tool_call("call-1", args={"script": "ls"}))
    assert len(first) == 1
    assert first[0].status == "running"
    assert projector.handle(_tool_call("call-1", args={"script": "pwd"})) == []
    assert projector.handle(_part_start("call-1", args={"script": "ls"})) == []


def test_unmatched_result_still_emits_one_completed_snapshot() -> None:
    projector = _projector()

    finished = projector.handle(_tool_result("orphan-1", tool_name="web_search", content="results"))
    assert len(finished) == 1
    assert finished[0].status == "succeeded"
    assert finished[0].data.tool_input == ""
    assert projector.handle(_tool_result("orphan-1")) == []


def test_result_event_accepts_result_and_top_level_payload_shapes() -> None:
    projector = _projector()
    projector.handle(_tool_call("call-1"))
    projector.handle(_tool_call("call-2"))
    projector.handle(_tool_call("call-3"))

    via_result = projector.handle(
        _internal(
            "function_tool_result",
            {
                "result": {
                    "tool_call_id": "call-1",
                    "tool_name": "shell_run",
                    "content": "via-result",
                }
            },
        )
    )
    assert len(via_result) == 1
    assert via_result[0].status == "succeeded"
    assert via_result[0].data.tool_output == "via-result"

    via_top_level = projector.handle(
        _internal(
            "function_tool_result",
            {
                "tool_call_id": "call-2",
                "tool_name": "shell_run",
                "content": "via-top-level",
            },
        )
    )
    assert len(via_top_level) == 1
    assert via_top_level[0].status == "succeeded"
    assert via_top_level[0].data.tool_output == "via-top-level"

    via_bare_part = projector.handle(
        _internal(
            "function_tool_result",
            {
                "part": {
                    "tool_call_id": "call-3",
                    "tool_name": "shell_run",
                    "content": "via-bare-part",
                }
            },
        )
    )
    assert len(via_bare_part) == 1
    assert via_bare_part[0].status == "succeeded"
    assert via_bare_part[0].data.tool_output == "via-bare-part"


def test_result_event_does_not_infer_kind_for_declared_unknown_part_kind() -> None:
    projector = _projector()
    projector.handle(_tool_call("call-1"))

    ignored = projector.handle(
        _internal(
            "function_tool_result",
            {
                "part": {
                    "part_kind": "text",
                    "tool_call_id": "call-1",
                    "tool_name": "shell_run",
                    "content": "not a tool return",
                }
            },
        )
    )
    assert ignored == []
    assert projector.finish("succeeded")[0].status == "failed"


def test_unmatched_result_without_tool_name_is_rejected() -> None:
    projector = _projector()

    assert (
        projector.handle(
            _internal(
                "function_tool_result",
                {"tool_call_id": "orphan-1", "content": "no name"},
            )
        )
        == []
    )
    assert (
        projector.handle(
            _internal(
                "function_tool_result",
                {"part": {"part_kind": "tool-return", "tool_call_id": "orphan-2", "content": "no name"}},
            )
        )
        == []
    )
    assert projector.finish("succeeded") == []


def test_finish_error_is_bounded() -> None:
    projector = _projector()
    projector.handle(_tool_call("call-1"))

    closed = projector.finish("failed", error="e" * (_TOOL_FIELD_LIMIT * 2))
    assert len(closed[0].error or "") <= _TOOL_FIELD_LIMIT


def test_finish_closes_unfinished_started_and_running_calls() -> None:
    projector = _projector()

    projector.handle(_part_start("call-preview", args={"script": "ls"}))
    projector.handle(_tool_call("call-running", args={"command": "pwd"}))
    projector.handle(_tool_call("call-done"))
    projector.handle(_tool_result("call-done"))

    closed = projector.finish("succeeded")
    assert [activity.id for activity in closed] == ["run-1:call-preview", "run-1:call-running"]
    assert [activity.status for activity in closed] == ["failed", "failed"]
    assert all(activity.error == "Tool call did not return a result." for activity in closed)
    assert projector.finish("succeeded") == []


def test_finish_failed_and_cancelled_propagate_error() -> None:
    failed_projector = _projector()
    failed_projector.handle(_tool_call("call-1"))
    failed = failed_projector.finish("failed", error="backend exploded")
    assert failed[0].status == "failed"
    assert failed[0].error == "backend exploded"

    cancelled_projector = _projector()
    cancelled_projector.handle(_tool_call("call-1"))
    cancelled = cancelled_projector.finish("cancelled", error="user stopped")
    assert cancelled[0].status == "cancelled"
    assert cancelled[0].error == "user stopped"


def test_builtin_tool_part_start_events_project_activity() -> None:
    projector = _projector()

    running = projector.handle(
        _internal(
            "part_start",
            {
                "part": {
                    "part_kind": "builtin-tool-call",
                    "tool_call_id": "builtin-1",
                    "tool_name": "web_search",
                    "args": {"query": "dify"},
                }
            },
        )
    )
    assert len(running) == 1
    assert running[0].status == "running"
    assert running[0].data.tool_name == "web_search"

    finished = projector.handle(
        _internal(
            "part_start",
            {
                "part": {
                    "part_kind": "builtin-tool-return",
                    "tool_call_id": "builtin-1",
                    "tool_name": "web_search",
                    "content": "search results",
                    "outcome": "success",
                }
            },
        )
    )
    assert len(finished) == 1
    assert finished[0].status == "succeeded"
    assert finished[0].data.tool_output == "search results"


def test_malformed_payloads_and_missing_ids_are_ignored() -> None:
    projector = _projector()

    assert projector.handle(_internal("function_tool_call", {"unexpected": True})) == []
    assert projector.handle(_internal("function_tool_call", {"part": "not-a-dict"})) == []
    assert (
        projector.handle(
            _internal(
                "function_tool_call",
                {"part": {"part_kind": "tool-call", "tool_name": "shell_run", "args": {}}},
            )
        )
        == []
    )
    assert (
        projector.handle(
            _internal(
                "function_tool_call",
                {"part": {"part_kind": "tool-call", "tool_call_id": "call-1", "args": {}}},
            )
        )
        == []
    )
    assert projector.handle(_internal("function_tool_result", {"part": {"part_kind": "unknown"}})) == []
    assert projector.finish("succeeded") == []


def test_large_tool_fields_are_bounded() -> None:
    projector = _projector()

    big_input: dict[str, object] = {"blob": "x" * (_TOOL_FIELD_LIMIT * 2)}
    big_output = "y" * (_TOOL_FIELD_LIMIT * 2)
    started = projector.handle(_tool_call("call-1", args=big_input))[0]
    finished = projector.handle(_tool_result("call-1", content=big_output))[0]

    assert len(started.data.tool_input) <= _TOOL_FIELD_LIMIT
    assert len(finished.data.tool_output) <= _TOOL_FIELD_LIMIT
    assert started.data.tool_input.startswith('{"blob": "xxx')
    assert finished.data.tool_output == "y" * _TOOL_FIELD_LIMIT


def test_identity_separates_runs_and_call_ids() -> None:
    projector = _projector()

    a = projector.handle(_tool_call("call-1", run_id="run-1"))[0]
    b = projector.handle(_tool_call("call-1", run_id="run-2"))[0]
    assert a.id == "run-1:call-1"
    assert b.id == "run-2:call-1"
    assert a.id != b.id


def test_real_pydantic_ai_stream_events_through_adapter() -> None:
    adapter = AgentBackendRunEventAdapter()
    projector = _projector()

    public_events = [
        PydanticAIStreamRunEvent(
            id="e-0",
            run_id="run-1",
            created_at=_CREATED_AT,
            data=PartStartEvent(
                index=0,
                part=ToolCallPart(tool_name="shell_run", args={"script": "pwd"}, tool_call_id="call-9"),
            ),
        ),
        PydanticAIStreamRunEvent(
            id="e-1",
            run_id="run-1",
            created_at=_CREATED_AT,
            data=FunctionToolCallEvent(
                part=ToolCallPart(
                    tool_name="shell_run",
                    args={"script": "pwd", "timeout": 30},
                    tool_call_id="call-9",
                )
            ),
        ),
        PydanticAIStreamRunEvent(
            id="e-2",
            run_id="run-1",
            created_at=_CREATED_AT,
            data=FunctionToolResultEvent(
                part=ToolReturnPart(tool_name="shell_run", content="/workspace", tool_call_id="call-9")
            ),
        ),
        PydanticAIStreamRunEvent(
            id="e-3",
            run_id="run-1",
            created_at=_CREATED_AT,
            data=OutputToolCallEvent(
                part=ToolCallPart(tool_name="final_result", args={"answer": "done"}, tool_call_id="out-1")
            ),
        ),
        PydanticAIStreamRunEvent(
            id="e-4",
            run_id="run-1",
            created_at=_CREATED_AT,
            data=PartDeltaEvent(
                index=0,
                delta=TextPartDelta(content_delta="thinking"),
            ),
        ),
    ]

    activities = []
    for public_event in public_events:
        for internal_event in adapter.adapt(public_event):
            if isinstance(internal_event, AgentBackendStreamInternalEvent):
                activities.extend(projector.handle(internal_event))

    assert [a.status for a in activities] == ["started", "running", "succeeded"]
    assert activities[0].id == "run-1:call-9"
    assert activities[0].data.tool_name == "shell_run"
    assert json.loads(activities[0].data.tool_input) == {"script": "pwd"}
    assert activities[1].status == "running"
    assert json.loads(activities[1].data.tool_input) == {"script": "pwd", "timeout": 30}
    assert activities[2].data.tool_output == "/workspace"
    assert projector.finish("succeeded") == []


def test_real_retry_prompt_event_through_adapter_fails_call() -> None:
    adapter = AgentBackendRunEventAdapter()
    projector = _projector()

    events = [
        PydanticAIStreamRunEvent(
            id="e-1",
            run_id="run-1",
            created_at=_CREATED_AT,
            data=FunctionToolCallEvent(
                part=ToolCallPart(tool_name="shell_run", args={"command": 42}, tool_call_id="call-7")
            ),
        ),
        PydanticAIStreamRunEvent(
            id="e-2",
            run_id="run-1",
            created_at=_CREATED_AT,
            data=FunctionToolResultEvent(
                part=RetryPromptPart(content="command must be a string", tool_name="shell_run", tool_call_id="call-7")
            ),
        ),
    ]

    activities = []
    for public_event in events:
        for internal_event in adapter.adapt(public_event):
            if isinstance(internal_event, AgentBackendStreamInternalEvent):
                activities.extend(projector.handle(internal_event))

    assert [a.status for a in activities] == ["running", "failed"]
    assert activities[1].error == "command must be a string"
