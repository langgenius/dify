import time
from contextlib import contextmanager
from unittest.mock import MagicMock

from graphon.entities import WorkflowStartReason
from graphon.runtime import GraphRuntimeState

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueWorkflowStartedEvent
from core.workflow.system_variables import build_system_variables
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
