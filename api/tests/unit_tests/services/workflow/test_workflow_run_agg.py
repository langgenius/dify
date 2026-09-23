"""Workflow orchestration against real Engine, SQLAlchemy, and filesystem storage."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.workflow.app_config_manager import WorkflowAppConfig
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.apps.workflow.app_runner import WorkflowAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueNodeStartedEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowSucceededEvent,
)
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig, WorkflowResumptionContext
from core.app.layers.trigger_post_layer import TriggerPostLayer
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.nodes.human_input.entities import HumanInputNodeData, ParagraphInputConfig, UserActionConfig
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from graphon.nodes.start.entities import StartNodeData
from graphon.runtime import RuntimeState
from graphon.variable_loader import DUMMY_VARIABLE_LOADER
from models import Account
from models.enums import WorkflowRunTriggeredFrom, WorkflowTriggerStatus
from models.model import AppMode
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowPause,
    WorkflowRun,
)
from repositories.workflow_tool_source_repository import SQLAlchemyWorkflowToolSourceRepository
from services.workflow_run_agg import WorkflowRunAgg


def make_workflow_runner(sqlite_engine: Engine, *, human_input: bool = False) -> WorkflowAppRunner:
    """Build the same runner/repositories/queue used by a workflow worker."""
    tenant_id, app_id, workflow_id, user_id, run_id = (str(uuid4()) for _ in range(5))
    graph: dict[str, list[dict[str, object]]] = {
        "nodes": [{"id": "start", "data": {"type": "start", **StartNodeData(title="Start").model_dump(mode="json")}}],
        "edges": [],
    }
    if human_input:
        data = HumanInputNodeData(
            title="Approval",
            form_content="Decision: {{#$output.answer#}}",
            inputs=[ParagraphInputConfig(output_variable_name="answer")],
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        )
        graph["nodes"].append({"id": "approval", "data": {"type": "human-input", **data.model_dump(mode="json")}})
        graph["edges"].append({"id": "start-approval", "source": "start", "target": "approval"})
        graph["nodes"].append(
            {
                "id": "end",
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [
                        {"variable": "answer", "value_selector": ["approval", "answer"]},
                    ],
                },
            }
        )
        graph["edges"].append({"id": "approval-end", "source": "approval", "target": "end", "sourceHandle": "approve"})
    workflow = Workflow(
        id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type="workflow",
        version="draft",
        graph=json.dumps(graph),
        features="{}",
        created_by=user_id,
    )
    entity = WorkflowAppGenerateEntity(
        task_id=str(uuid4()),
        app_config=WorkflowAppConfig(
            tenant_id=tenant_id, app_id=app_id, workflow_id=workflow_id, app_mode=AppMode.WORKFLOW
        ),
        inputs={},
        files=[],
        user_id=user_id,
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_execution_id=run_id,
    )
    user = Account(name="Workflow Tester", email=f"{user_id}@example.com")
    user.id = user_id
    queue = WorkflowAppQueueManager(entity.task_id, user_id, entity.invoke_from, AppMode.WORKFLOW)
    return WorkflowAppRunner(
        application_generate_entity=entity,
        queue_manager=queue,
        variable_loader=DUMMY_VARIABLE_LOADER,
        workflow=workflow,
        system_user_id=user_id,
        workflow_execution_repository=SQLAlchemyWorkflowExecutionRepository(
            sqlite_engine,
            tenant_id=tenant_id,
            user=user,
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        ),
        workflow_node_execution_repository=SQLAlchemyWorkflowNodeExecutionRepository(
            sqlite_engine,
            tenant_id=tenant_id,
            user=user,
            app_id=app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        ),
        workflow_tool_source_repository=SQLAlchemyWorkflowToolSourceRepository(
            session_maker=sessionmaker(sqlite_engine)
        ),
        execution_driver=WorkflowRunAgg.run,
    )


def test_driver_publishes_persisted_start_index_and_success(sqlite_engine: Engine) -> None:
    runner = make_workflow_runner(sqlite_engine)
    WorkflowRunAgg.run(runner, None)
    events = [message.event for message in runner._queue_manager.listen()]
    starts = [event for event in events if isinstance(event, QueueNodeStartedEvent)]
    assert len(starts) == 1
    assert isinstance(events[-1], QueueWorkflowSucceededEvent)
    with Session(sqlite_engine) as session:
        execution = session.scalar(select(WorkflowNodeExecutionModel))
        assert execution is not None
        assert execution.index == starts[0].node_run_index == 1
        run = session.get(WorkflowRun, runner.application_generate_entity.workflow_execution_id)
        assert run is not None
        assert run.status == "succeeded"


@pytest.fixture
def _local_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(storage, "storage_runner", OpenDALStorage(scheme="fs", root=str(tmp_path)), raising=False)
    from core.app.apps import workflow_app_runner

    monkeypatch.setattr(workflow_app_runner, "dispatch_human_input_email_task", MagicMock())


@pytest.mark.usefixtures("_local_storage")
@pytest.mark.parametrize("persist_snapshot", [False, True])
def test_pause_publication_persists_summary_and_optional_snapshot(
    sqlite_engine: Engine, persist_snapshot: bool
) -> None:
    runner = make_workflow_runner(sqlite_engine, human_input=True)
    config = (
        PauseStateLayerConfig(sqlite_engine, runner.application_generate_entity.user_id) if persist_snapshot else None
    )
    WorkflowRunAgg.run(runner, config)
    events = [message.event for message in runner._queue_manager.listen()]
    assert isinstance(events[-1], QueueWorkflowPausedEvent), events
    with Session(sqlite_engine) as session:
        run = session.get(WorkflowRun, runner.application_generate_entity.workflow_execution_id)
        assert run is not None
        pause = session.scalar(select(WorkflowPause).where(WorkflowPause.workflow_run_id == run.id))
        assert run.status == "paused"
        assert run.finished_at is None
        assert run.total_steps == 2
        if not persist_snapshot:
            assert pause is None
            return
        assert pause is not None
        snapshot = WorkflowResumptionContext.loads(storage.load(pause.state_object_key).decode())
        restored = RuntimeState.from_snapshot(snapshot.serialized_graph_runtime_state)
        assert restored.graph_execution.paused
        assert snapshot.get_response_stream_filter().dumps() == snapshot.serialized_response_stream_filter_state
        assert snapshot.get_generate_entity().model_dump(mode="json") == runner.application_generate_entity.model_dump(
            mode="json"
        )


@pytest.mark.usefixtures("_local_storage")
def test_pause_database_failure_publishes_failure_instead_of_resume_ready(
    sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "repositories.sqlalchemy_api_workflow_run_repository.DifyAPISQLAlchemyWorkflowRunRepository.create_workflow_pause",
        MagicMock(side_effect=RuntimeError("pause-write-failed")),
    )
    trigger_log = SimpleNamespace(elapsed_time=5.0)
    trigger_repository = MagicMock()
    trigger_repository.get_by_id.return_value = trigger_log
    monkeypatch.setattr(
        "core.app.layers.trigger_post_layer.SQLAlchemyWorkflowTriggerLogRepository",
        MagicMock(return_value=trigger_repository),
    )
    retire = MagicMock(return_value=["workspace-1"])
    enqueue = MagicMock()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.workspace_retirement_layer.WorkflowAgentWorkspaceStore.retire_workflow_run",
        retire,
    )
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.workspace_retirement_layer.enqueue_agent_resource_collection", enqueue
    )
    start_time = datetime(2026, 2, 20, tzinfo=UTC)
    trigger_clock = MagicMock()
    trigger_clock.now.return_value = start_time + timedelta(seconds=10)
    monkeypatch.setattr("core.app.layers.trigger_post_layer.datetime", trigger_clock)
    runner = make_workflow_runner(sqlite_engine, human_input=True)
    runner._graph_engine_layers = (TriggerPostLayer(MagicMock(), start_time, "trigger-log"),)
    WorkflowRunAgg.run(runner, PauseStateLayerConfig(sqlite_engine, runner.application_generate_entity.user_id))
    events = [message.event for message in runner._queue_manager.listen()]
    assert isinstance(events[-1], QueueWorkflowFailedEvent), events
    assert "pause-write-failed" in events[-1].error
    assert not any(isinstance(event, QueueWorkflowPausedEvent) for event in events)
    assert trigger_log.status == WorkflowTriggerStatus.FAILED
    assert trigger_log.elapsed_time == 15.0
    retire.assert_called_once_with(
        tenant_id=runner.application_generate_entity.app_config.tenant_id,
        app_id=runner.application_generate_entity.app_config.app_id,
        workflow_run_id=runner.application_generate_entity.workflow_execution_id,
    )
    enqueue.assert_called_once_with(
        tenant_id=runner.application_generate_entity.app_config.tenant_id, workspace_ids=["workspace-1"]
    )
    with Session(sqlite_engine) as session:
        run = session.get(WorkflowRun, runner.application_generate_entity.workflow_execution_id)
        assert run is not None
        assert run.status == "failed"
        assert session.scalar(select(WorkflowPause)) is None


def test_late_form_submission_is_refreshed_before_the_real_queue_closes(sqlite_session: Session) -> None:
    from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
    from core.app.entities.queue_entities import QueueHumanInputFormFilledEvent
    from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
    from core.workflow.nodes.human_input.enums import HumanInputFormStatus
    from graphon.engine_events import NodeRunStartedEvent
    from tests.unit_tests.core.app.apps.test_workflow_human_input_completion import (
        _make_paused_workflow,
        _resume_events,
        _save_form,
    )

    first = _save_form(sqlite_session, status=HumanInputFormStatus.SUBMITTED)
    late = _save_form(sqlite_session, status=HumanInputFormStatus.WAITING)
    queue = WorkflowAppQueueManager("form-refresh-task", "user", InvokeFrom.DEBUGGER, AppMode.WORKFLOW)
    runner = WorkflowBasedAppRunner(queue_manager=queue, app_id="app")
    entry = _make_paused_workflow(runner, [first, late])
    for event in _resume_events(runner, entry):
        runner.handle_event(entry, event)
        if isinstance(event, NodeRunStartedEvent):
            HumanInputFormSubmissionRepository().mark_submitted(
                form_id=late.id,
                recipient_id=None,
                selected_action_id="approve",
                form_data={"answer": "late answer"},
                submission_user_id=None,
                submission_end_user_id=None,
            )
    events = [message.event for message in queue.listen()]
    completions = [event for event in events if isinstance(event, QueueHumanInputFormFilledEvent)]
    assert [event.form_id for event in completions] == [first.id, late.id]
    assert completions[-1].rendered_content == "Decision: late answer"
    assert isinstance(events[-1], QueueWorkflowSucceededEvent)


@pytest.mark.usefixtures("_local_storage")
def test_durable_pause_resumes_with_one_form_completion_and_continuing_indexes(sqlite_engine: Engine) -> None:
    from core.app.entities.queue_entities import QueueHumanInputFormFilledEvent, QueueWorkflowStartedEvent
    from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
    from models.human_input import HumanInputForm

    original = make_workflow_runner(sqlite_engine, human_input=True)
    config = PauseStateLayerConfig(sqlite_engine, original.application_generate_entity.user_id)
    WorkflowRunAgg.run(original, config)
    before = [message.event for message in original._queue_manager.listen()]
    assert isinstance(before[-1], QueueWorkflowPausedEvent)
    with Session(sqlite_engine) as session:
        pause = session.scalar(select(WorkflowPause))
        form = session.scalar(select(HumanInputForm))
        assert pause is not None
        assert form is not None
        form_id = form.id
        snapshot = WorkflowResumptionContext.loads(storage.load(pause.state_object_key).decode())
    HumanInputFormSubmissionRepository().mark_submitted(
        form_id=form_id,
        recipient_id=None,
        selected_action_id="approve",
        form_data={"answer": "approved result"},
        submission_user_id=None,
        submission_end_user_id=None,
    )
    entity = original.application_generate_entity.model_copy(update={"task_id": str(uuid4())})
    queue = WorkflowAppQueueManager(entity.task_id, entity.user_id, entity.invoke_from, AppMode.WORKFLOW)
    resumed = WorkflowAppRunner(
        application_generate_entity=entity,
        queue_manager=queue,
        variable_loader=DUMMY_VARIABLE_LOADER,
        workflow=original._workflow,
        system_user_id=entity.user_id,
        workflow_execution_repository=original._workflow_execution_repository,
        workflow_node_execution_repository=original._workflow_node_execution_repository,
        workflow_tool_source_repository=original._workflow_tool_source_repository,
        graph_runtime_state=RuntimeState.from_snapshot(snapshot.serialized_graph_runtime_state),
        response_stream_filter=snapshot.get_response_stream_filter(),
        execution_driver=WorkflowRunAgg.run,
    )
    WorkflowRunAgg.run(resumed, config)
    after = [message.event for message in queue.listen()]
    assert isinstance(after[0], QueueWorkflowStartedEvent)
    assert len(after[0].node_execution_snapshots) == 2
    completions = [event for event in after if isinstance(event, QueueHumanInputFormFilledEvent)]
    assert [event.form_id for event in completions] == [form_id]
    starts = [event for event in after if isinstance(event, QueueNodeStartedEvent)]
    assert [(event.node_id, event.node_run_index) for event in starts] == [("approval", 2), ("end", 3)]
    assert isinstance(after[-1], QueueWorkflowSucceededEvent)
    assert after[-1].outputs == {"answer": "approved result"}
    with Session(sqlite_engine) as session:
        executions = session.scalars(
            select(WorkflowNodeExecutionModel).order_by(WorkflowNodeExecutionModel.index)
        ).all()
        assert [(row.node_id, row.index) for row in executions] == [("start", 1), ("approval", 2), ("end", 3)]


def test_active_execution_snapshot_failure_is_not_published_as_a_pause(sqlite_engine: Engine) -> None:
    from graphon.engine_events import GraphRunFailedEvent, GraphRunPausedEvent

    runner = make_workflow_runner(sqlite_engine, human_input=True)
    prepared = runner.prepare()
    assert prepared is not None
    aggregate = WorkflowRunAgg(
        prepared, runner, PauseStateLayerConfig(sqlite_engine, runner.application_generate_entity.user_id)
    )
    # A participant that has not shut down must prevent a resume-ready snapshot.
    with prepared.entry.graph_engine.runtime_state.graph_execution.track_execution():
        events = list(aggregate.iter_events())
    assert isinstance(events[-1], GraphRunFailedEvent)
    assert "during active execution" in events[-1].error
    assert not any(isinstance(event, GraphRunPausedEvent) for event in events)
    with Session(sqlite_engine) as session:
        run = session.get(WorkflowRun, runner.application_generate_entity.workflow_execution_id)
        assert run is not None
        assert run.status == "failed"
        assert session.scalar(select(WorkflowPause)) is None
