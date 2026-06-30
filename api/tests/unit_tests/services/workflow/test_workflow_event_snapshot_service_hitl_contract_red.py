from __future__ import annotations

import importlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, override

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.workflow.human_input import FormDefinition, ParagraphInputConfig, UserActionConfig
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from models.enums import CreatorUserRole
from models.model import AppMode
from models.workflow import WorkflowRun
from repositories.api_workflow_node_execution_repository import WorkflowNodeExecutionSnapshot
from repositories.entities.workflow_pause import WorkflowPauseEntity


@dataclass(frozen=True)
class _FakePauseEntity(WorkflowPauseEntity):
    pause_id: str
    workflow_run_id: str
    paused_at_value: datetime
    pause_reasons: Sequence[HitlRequired]

    @property
    @override
    def id(self) -> str:
        return self.pause_id

    @property
    @override
    def workflow_execution_id(self) -> str:
        return self.workflow_run_id

    @override
    def get_state(self) -> bytes:
        raise AssertionError("state is not required for snapshot tests")

    @property
    @override
    def resumed_at(self) -> datetime | None:
        return None

    @property
    @override
    def paused_at(self) -> datetime:
        return self.paused_at_value

    @override
    def get_pause_reasons(self) -> Sequence[HitlRequired]:
        return self.pause_reasons


class _SessionContext:
    def __init__(self, session: Any) -> None:
        self._session = session

    def __enter__(self) -> Any:
        return self._session

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


class _SessionMaker:
    def __init__(self, session: Any) -> None:
        self._session = session

    def __call__(self) -> _SessionContext:
        return _SessionContext(self._session)


def _build_workflow_run() -> WorkflowRun:
    return WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type="workflow",
        triggered_from="app-run",
        version="v1",
        graph=None,
        inputs=json.dumps({"query": "hello"}),
        status=WorkflowExecutionStatus.PAUSED,
        outputs=json.dumps({}),
        error=None,
        elapsed_time=0.0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.END_USER,
        created_by="user-1",
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )


def _build_snapshot() -> WorkflowNodeExecutionSnapshot:
    created_at = datetime(2024, 1, 1, tzinfo=UTC)
    finished_at = datetime(2024, 1, 1, 0, 0, 5, tzinfo=UTC)
    return WorkflowNodeExecutionSnapshot(
        execution_id="exec-1",
        node_id="node-1",
        node_type="human-input",
        title="Human Input",
        index=1,
        status=WorkflowNodeExecutionStatus.PAUSED.value,
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
    return WorkflowResumptionContext(
        generate_entity=_WorkflowGenerateEntityWrapper(entity=generate_entity),
        serialized_graph_runtime_state=runtime_state.dumps(),
    )


def _build_form_definition_json(*, expiration_time: datetime) -> str:
    return FormDefinition(
        form_content="Need manager approval",
        inputs=[ParagraphInputConfig(output_variable_name="decision_comment")],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        rendered_content="Need manager approval",
        expiration_time=expiration_time,
        default_values={"decision_comment": "prefilled from dify"},
        node_title="Approval Gate",
        display_in_ui=True,
    ).model_dump_json()


def test_snapshot_builder_rehydrates_hitl_payload_from_form_definition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = importlib.import_module("services.workflow_event_snapshot_service")
    expiration_time = datetime(2024, 1, 1, tzinfo=UTC)
    resolved_session_ids: list[str] = []

    class _Binding:
        @staticmethod
        def resolve_form_id_from_session_id(*, session_id: str) -> str:
            resolved_session_ids.append(session_id)
            return "form-1"

    monkeypatch.setattr(module, "session_binding", _Binding(), raising=False)
    monkeypatch.setattr(
        module,
        "load_form_dispositions_by_form_id",
        lambda form_ids, session=None, surface=None: {
            "form-1": module.FormDisposition(form_token="token-1", approval_channels=["console"])
        },
    )

    events = module._build_snapshot_events(
        workflow_run=_build_workflow_run(),
        node_snapshots=[_build_snapshot()],
        task_id="task-1",
        message_context=None,
        pause_entity=_FakePauseEntity(
            pause_id="pause-1",
            workflow_run_id="run-1",
            paused_at_value=datetime(2024, 1, 1, tzinfo=UTC),
            pause_reasons=[HitlRequired(session_id="session-1", node_id="node-1", node_title="Approval Gate")],
        ),
        resumption_context=_build_resumption_context("task-1"),
        session_maker=_SessionMaker(
            SimpleNamespace(
                execute=lambda _stmt: [
                    ("form-1", expiration_time, _build_form_definition_json(expiration_time=expiration_time))
                ]
            )
        ),
    )

    assert resolved_session_ids == ["session-1"]

    human_input_event = next(event for event in events if event["event"] == "human_input_required")
    assert human_input_event["data"]["form_id"] == "form-1"
    assert human_input_event["data"]["node_id"] == "node-1"
    assert human_input_event["data"]["node_title"] == "Approval Gate"
    assert human_input_event["data"]["form_content"] == "Need manager approval"
    assert human_input_event["data"]["inputs"][0]["output_variable_name"] == "decision_comment"
    assert human_input_event["data"]["actions"][0]["id"] == "approve"
    assert human_input_event["data"]["resolved_default_values"] == {"decision_comment": "prefilled from dify"}
    assert human_input_event["data"]["form_token"] == "token-1"
    assert human_input_event["data"]["display_in_ui"] is True
    assert human_input_event["data"]["expiration_time"] == int(expiration_time.timestamp())

    pause_event = next(event for event in events if event["event"] == "workflow_paused")
    assert pause_event["data"]["reasons"] == [
        {
            "TYPE": "hitl_required",
            "form_id": "form-1",
            "node_id": "node-1",
            "node_title": "Approval Gate",
            "form_token": "token-1",
            "approval_channels": ["console"],
            "expiration_time": int(expiration_time.timestamp()),
        }
    ]
