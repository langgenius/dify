import time
from contextlib import contextmanager
from unittest.mock import MagicMock

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueStopEvent, QueueWorkflowStartedEvent
from core.workflow.system_variables import build_system_variables
from graphon.entities import WorkflowStartReason
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import GraphRuntimeState
from models.account import Account
from models.model import AppMode
from tests.workflow_test_utils import build_test_variable_pool


def _build_workflow_app_config() -> WorkflowUIBasedAppConfig:
    return WorkflowUIBasedAppConfig(
        tenant_id="tenant-id",
        app_id="app-id",
        app_mode=AppMode.WORKFLOW,
        workflow_id="workflow-id",
    )


def _build_generate_entity(run_id: str) -> WorkflowAppGenerateEntity:
    return WorkflowAppGenerateEntity(
        task_id="task-id",
        app_config=_build_workflow_app_config(),
        inputs={},
        files=[],
        user_id="user-id",
        stream=False,
        invoke_from=InvokeFrom.SERVICE_API,
        workflow_execution_id=run_id,
    )


def _build_runtime_state(run_id: str) -> GraphRuntimeState:
    variable_pool = build_test_variable_pool(variables=build_system_variables(workflow_execution_id=run_id))
    return GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())


@contextmanager
def _noop_session():
    yield MagicMock()


def _build_pipeline(run_id: str) -> WorkflowAppGenerateTaskPipeline:
    queue_manager = MagicMock(spec=AppQueueManager)
    queue_manager.invoke_from = InvokeFrom.SERVICE_API
    queue_manager.graph_runtime_state = _build_runtime_state(run_id)
    workflow = MagicMock()
    workflow.id = "workflow-id"
    workflow.features_dict = {}
    user = Account(name="user", email="user@example.com")
    pipeline = WorkflowAppGenerateTaskPipeline(
        application_generate_entity=_build_generate_entity(run_id),
        workflow=workflow,
        queue_manager=queue_manager,
        user=user,
        stream=False,
        draft_var_saver_factory=MagicMock(),
    )
    pipeline._database_session = _noop_session
    return pipeline


def test_workflow_app_log_saved_only_on_initial_start() -> None:
    run_id = "run-initial"
    pipeline = _build_pipeline(run_id)
    pipeline._save_workflow_app_log = MagicMock()

    event = QueueWorkflowStartedEvent(reason=WorkflowStartReason.INITIAL)
    list(pipeline._handle_workflow_started_event(event))

    pipeline._save_workflow_app_log.assert_called_once()
    _, kwargs = pipeline._save_workflow_app_log.call_args
    assert kwargs["workflow_run_id"] == run_id
    assert pipeline._workflow_execution_id == run_id


def test_workflow_app_log_skipped_on_resumption_start() -> None:
    run_id = "run-resume"
    pipeline = _build_pipeline(run_id)
    pipeline._save_workflow_app_log = MagicMock()

    event = QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION)
    list(pipeline._handle_workflow_started_event(event))

    pipeline._save_workflow_app_log.assert_not_called()
    assert pipeline._workflow_execution_id == run_id


def test_stop_event_persists_workflow_run_status() -> None:
    run_id = "run-stop"
    pipeline = _build_pipeline(run_id)

    started_event = QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION)
    list(pipeline._handle_workflow_started_event(started_event))

    workflow_run = MagicMock()
    workflow_run.tenant_id = "tenant-id"
    workflow_run.created_at = pipeline._workflow_response_converter._workflow_started_at  # type: ignore[attr-defined]
    workflow_run.finished_at = None
    workflow_run.elapsed_time = 0.0
    workflow_run.error = None
    workflow_run.status = WorkflowExecutionStatus.RUNNING

    session = MagicMock()
    session.get.return_value = workflow_run

    @contextmanager
    def _session_context():
        yield session

    pipeline._database_session = _session_context  # type: ignore[method-assign]

    stop_event = QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL)
    list(pipeline._handle_workflow_failed_and_stop_events(stop_event))

    assert workflow_run.status == WorkflowExecutionStatus.STOPPED
    assert workflow_run.error is not None
    assert workflow_run.finished_at is not None
    session.add.assert_called_once_with(workflow_run)


def test_stop_event_still_yields_finish_when_persistence_fails() -> None:
    run_id = "run-stop-persistence-fails"
    pipeline = _build_pipeline(run_id)

    started_event = QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION)
    list(pipeline._handle_workflow_started_event(started_event))
    pipeline._database_session = MagicMock(side_effect=RuntimeError("db unavailable"))  # type: ignore[method-assign]
    pipeline._workflow_response_converter.workflow_finish_to_stream_response = MagicMock(return_value="finish")

    stop_event = QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL)
    responses = list(pipeline._handle_workflow_failed_and_stop_events(stop_event))

    assert responses == ["finish"]
    pipeline._workflow_response_converter.workflow_finish_to_stream_response.assert_called_once()
