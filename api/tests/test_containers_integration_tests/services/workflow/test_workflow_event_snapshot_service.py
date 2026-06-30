from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import override
from uuid import uuid4

from sqlalchemy import Engine, delete
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.workflow.human_input import (
    HumanInputFormStatus,
    session_binding,
)
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from models.enums import CreatorUserRole
from models.human_input import HumanInputForm
from models.model import AppMode
from models.workflow import WorkflowRun
from repositories.entities.workflow_pause import WorkflowPauseEntity
from services.workflow_event_snapshot_service import _build_snapshot_events


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


def _build_resumption_context(workflow_run_id: str) -> WorkflowResumptionContext:
    app_config = WorkflowUIBasedAppConfig(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        app_mode=AppMode.WORKFLOW,
        workflow_id=str(uuid4()),
    )
    generate_entity = WorkflowAppGenerateEntity(
        task_id="task-1",
        app_config=app_config,
        inputs={},
        files=[],
        user_id=str(uuid4()),
        stream=True,
        invoke_from=InvokeFrom.EXPLORE,
        call_depth=0,
        workflow_execution_id=workflow_run_id,
    )
    runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)
    runtime_state.variable_pool.add(("start", "options"), ["approve", "reject"])
    wrapper = _WorkflowGenerateEntityWrapper(entity=generate_entity)
    return WorkflowResumptionContext(
        generate_entity=wrapper,
        serialized_graph_runtime_state=runtime_state.dumps(),
    )


def _build_workflow_run(workflow_run_id: str) -> WorkflowRun:
    return WorkflowRun(
        id=workflow_run_id,
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        workflow_id=str(uuid4()),
        type="workflow",
        triggered_from="app-run",
        version="v1",
        graph=None,
        inputs="{}",
        status=WorkflowExecutionStatus.PAUSED,
        outputs="{}",
        error=None,
        elapsed_time=0.0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.END_USER,
        created_by=str(uuid4()),
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )


def test_build_snapshot_events_resolves_variable_select_options(db_session_with_containers: Session) -> None:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    test_tenant_id = str(uuid4())
    test_app_id = str(uuid4())
    workflow_run_id = str(uuid4())
    form = HumanInputForm(
        tenant_id=test_tenant_id,
        app_id=test_app_id,
        workflow_run_id=workflow_run_id,
        node_id="node-id",
        form_definition='{"display_in_ui": true}',
        rendered_content="Rendered",
        status=HumanInputFormStatus.WAITING,
        expiration_time=(datetime.now(UTC) + timedelta(hours=1)).replace(tzinfo=None),
    )
    db_session_with_containers.add(form)
    db_session_with_containers.commit()
    db_session_with_containers.refresh(form)

    reason = HitlRequired(
        session_id=session_binding.issue_session_id_for_form(form_id=form.id),
        node_id="node-id",
        node_title="Human Input",
    )
    pause_entity = _FakePauseEntity(
        pause_id=str(uuid4()),
        workflow_run_id=workflow_run_id,
        paused_at_value=datetime.now(UTC),
        pause_reasons=[reason],
    )

    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    events = _build_snapshot_events(
        workflow_run=_build_workflow_run(workflow_run_id),
        node_snapshots=[],
        task_id="task-1",
        message_context=None,
        pause_entity=pause_entity,
        resumption_context=_build_resumption_context(workflow_run_id),
        session_maker=session_maker,
    )

    human_input_events = [event for event in events if event.get("event") == "human_input_required"]
    assert len(human_input_events) == 1
    assert human_input_events[0]["data"]["form_id"] == form.id
    assert human_input_events[0]["data"]["inputs"][0]["option_source"]["value"] == ["approve", "reject"]

    db_session_with_containers.execute(delete(HumanInputForm).where(HumanInputForm.id == form.id))
    db_session_with_containers.commit()
