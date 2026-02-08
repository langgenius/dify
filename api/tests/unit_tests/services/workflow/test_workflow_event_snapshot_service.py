from __future__ import annotations

import json
import queue
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Event

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.workflow.entities.pause_reason import HumanInputRequired
from core.workflow.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from core.workflow.runtime import GraphRuntimeState, VariablePool
from models.enums import CreatorUserRole
from models.model import AppMode
from models.workflow import WorkflowRun
from repositories.api_workflow_node_execution_repository import WorkflowNodeExecutionSnapshot
from repositories.entities.workflow_pause import WorkflowPauseEntity
from services.workflow_event_snapshot_service import (
    BufferState,
    MessageContext,
    _build_snapshot_events,
    _resolve_task_id,
)


@dataclass(frozen=True)
class _FakePauseEntity(WorkflowPauseEntity):
    pause_id: str
    workflow_run_id: str
    paused_at_value: datetime
    pause_reasons: Sequence[HumanInputRequired]

    @property
    def id(self) -> str:
        return self.pause_id

    @property
    def workflow_execution_id(self) -> str:
        return self.workflow_run_id

    def get_state(self) -> bytes:
        raise AssertionError("state is not required for snapshot tests")

    @property
    def resumed_at(self) -> datetime | None:
        return None

    @property
    def paused_at(self) -> datetime:
        return self.paused_at_value

    def get_pause_reasons(self) -> Sequence[HumanInputRequired]:
        return self.pause_reasons


def _build_workflow_run(status: WorkflowExecutionStatus) -> WorkflowRun:
    return WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type="workflow",
        triggered_from="app-run",
        version="v1",
        graph=None,
        inputs=json.dumps({"input": "value"}),
        status=status,
        outputs=json.dumps({}),
        error=None,
        elapsed_time=0.0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.END_USER,
        created_by="user-1",
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )


def _build_snapshot(status: WorkflowNodeExecutionStatus) -> WorkflowNodeExecutionSnapshot:
    created_at = datetime(2024, 1, 1, tzinfo=UTC)
    finished_at = datetime(2024, 1, 1, 0, 0, 5, tzinfo=UTC)
    return WorkflowNodeExecutionSnapshot(
        execution_id="exec-1",
        node_id="node-1",
        node_type="human-input",
        title="Human Input",
        index=1,
        status=status.value,
        elapsed_time=0.5,
        created_at=created_at,
        finished_at=finished_at,
        iteration_id=None,
        loop_id=None,
    )


def _build_resumption_context(task_id: str) -> WorkflowResumptionContext:
    app_config = WorkflowUIBasedAppConfig(
        tenant_id="tenant-1",
        app_id="app-1",
        app_mode=AppMode.WORKFLOW,
        workflow_id="workflow-1",
    )
    generate_entity = WorkflowAppGenerateEntity(
        task_id=task_id,
        app_config=app_config,
        inputs={},
        files=[],
        user_id="user-1",
        stream=True,
        invoke_from=InvokeFrom.EXPLORE,
        call_depth=0,
        workflow_execution_id="run-1",
    )
    runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)
    runtime_state.register_paused_node("node-1")
    runtime_state.outputs = {"result": "value"}
    wrapper = _WorkflowGenerateEntityWrapper(entity=generate_entity)
    return WorkflowResumptionContext(
        generate_entity=wrapper,
        serialized_graph_runtime_state=runtime_state.dumps(),
    )


def test_build_snapshot_events_includes_pause_event() -> None:
    workflow_run = _build_workflow_run(WorkflowExecutionStatus.PAUSED)
    snapshot = _build_snapshot(WorkflowNodeExecutionStatus.PAUSED)
    resumption_context = _build_resumption_context("task-ctx")
    pause_entity = _FakePauseEntity(
        pause_id="pause-1",
        workflow_run_id="run-1",
        paused_at_value=datetime(2024, 1, 1, tzinfo=UTC),
        pause_reasons=[
            HumanInputRequired(
                form_id="form-1",
                form_content="content",
                node_id="node-1",
                node_title="Human Input",
            )
        ],
    )

    events = _build_snapshot_events(
        workflow_run=workflow_run,
        node_snapshots=[snapshot],
        task_id="task-ctx",
        message_context=None,
        pause_entity=pause_entity,
        resumption_context=resumption_context,
    )

    assert [event["event"] for event in events] == [
        "workflow_started",
        "node_started",
        "node_finished",
        "workflow_paused",
    ]
    assert events[2]["data"]["status"] == WorkflowNodeExecutionStatus.PAUSED.value
    pause_data = events[-1]["data"]
    assert pause_data["paused_nodes"] == ["node-1"]
    assert pause_data["outputs"] == {"result": "value"}
    assert pause_data["status"] == WorkflowExecutionStatus.PAUSED.value
    assert pause_data["created_at"] == int(workflow_run.created_at.timestamp())
    assert pause_data["elapsed_time"] == workflow_run.elapsed_time
    assert pause_data["total_tokens"] == workflow_run.total_tokens
    assert pause_data["total_steps"] == workflow_run.total_steps


def test_build_snapshot_events_applies_message_context() -> None:
    workflow_run = _build_workflow_run(WorkflowExecutionStatus.RUNNING)
    snapshot = _build_snapshot(WorkflowNodeExecutionStatus.SUCCEEDED)
    message_context = MessageContext(
        conversation_id="conv-1",
        message_id="msg-1",
        created_at=1700000000,
        answer="snapshot message",
    )

    events = _build_snapshot_events(
        workflow_run=workflow_run,
        node_snapshots=[snapshot],
        task_id="task-1",
        message_context=message_context,
        pause_entity=None,
        resumption_context=None,
    )

    assert [event["event"] for event in events] == [
        "workflow_started",
        "message_replace",
        "node_started",
        "node_finished",
    ]
    assert events[1]["answer"] == "snapshot message"
    for event in events:
        assert event["conversation_id"] == "conv-1"
        assert event["message_id"] == "msg-1"
        assert event["created_at"] == 1700000000


@pytest.mark.parametrize(
    ("context_task_id", "buffered_task_id", "expected"),
    [
        ("task-ctx", "task-buffer", "task-ctx"),
        (None, "task-buffer", "task-buffer"),
        (None, None, "run-1"),
    ],
)
def test_resolve_task_id_priority(context_task_id, buffered_task_id, expected) -> None:
    resumption_context = _build_resumption_context(context_task_id) if context_task_id else None
    buffer_state = BufferState(
        queue=queue.Queue(),
        stop_event=Event(),
        done_event=Event(),
        task_id_ready=Event(),
        task_id_hint=buffered_task_id,
    )
    if buffered_task_id:
        buffer_state.task_id_ready.set()
    task_id = _resolve_task_id(resumption_context, buffer_state, "run-1", wait_timeout=0.0)
    assert task_id == expected
