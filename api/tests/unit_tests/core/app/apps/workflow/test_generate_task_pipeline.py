from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.draft_variable_saver import NoopDraftVariableSaver
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueWorkflowStartedEvent
from core.workflow.system_variables import build_system_variables
from extensions.application_services.workflow import build_workflow_execution_dependencies
from extensions.ext_redis import RedisClientWrapper
from graphon.entities import WorkflowStartReason
from graphon.runtime import GraphRuntimeState
from models.base import TypeBase
from models.enums import CreatorUserRole
from models.model import AppMode
from models.workflow import WorkflowAppLog
from services.workflow.execution.adapters.workflow.app_queue_manager import WorkflowAppQueueManager
from services.workflow.execution.adapters.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from tests.unit_tests.model_factories import make_account, make_end_user, make_workflow
from tests.workflow_test_utils import build_test_variable_pool


@pytest.fixture(autouse=True)
def bind_queue_redis(monkeypatch: pytest.MonkeyPatch, redis_transport: tuple[RedisClientWrapper, MagicMock]) -> None:
    monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client", redis_transport[0])


@pytest.fixture
def log_store():
    # This database is deliberately separate from the application's global database.
    engine = create_engine("sqlite://", poolclass=QueuePool)
    TypeBase.metadata.create_all(engine, tables=[WorkflowAppLog.__table__])
    sessions = sessionmaker(engine, expire_on_commit=False)
    try:
        yield sessions, build_workflow_execution_dependencies(sessions)
    finally:
        engine.dispose()


def build_pipeline(runtime, invoke_from, user, *, tool_providers):
    workflow = make_workflow(workflow_id="workflow-id", app_id="app-id", tenant_id="tenant-id", features="{}")
    entity = WorkflowAppGenerateEntity(
        task_id="task-id",
        app_config=WorkflowUIBasedAppConfig(
            tenant_id=workflow.tenant_id,
            app_id=workflow.app_id,
            app_mode=AppMode.WORKFLOW,
            workflow_id=workflow.id,
        ),
        inputs={},
        files=[],
        user_id=user.id,
        stream=False,
        invoke_from=invoke_from,
        workflow_execution_id="run-id",
    )
    state = GraphRuntimeState(
        variable_pool=build_test_variable_pool(variables=build_system_variables(workflow_execution_id="run-id")),
        start_at=0,
    )
    queue_manager = WorkflowAppQueueManager(
        task_id=entity.task_id,
        user_id=user.id,
        invoke_from=invoke_from,
        app_mode=AppMode.WORKFLOW,
    )
    queue_manager.graph_runtime_state = state
    return WorkflowAppGenerateTaskPipeline(
        contexts=runtime.contexts,
        logs=runtime.logs,
        application_generate_entity=entity,
        workflow=workflow,
        queue_manager=queue_manager,
        user=user,
        stream=False,
        draft_var_saver_factory=lambda **_kwargs: NoopDraftVariableSaver(),
        tool_providers=tool_providers,
    )


@pytest.mark.parametrize(
    ("invoke_from", "created_from"),
    [
        (InvokeFrom.SERVICE_API, "service-api"),
        (InvokeFrom.OPENAPI, "openapi"),
        (InvokeFrom.EXPLORE, "installed-app"),
        (InvokeFrom.WEB_APP, "web-app"),
    ],
)
@pytest.mark.parametrize("account", [True, False])
def test_start_commits_log_to_injected_database_before_response(
    log_store, invoke_from, created_from, account, *, tool_providers
):
    sessions, runtime = log_store
    user = make_account(account_id="user-id") if account else make_end_user(end_user_id="user-id")
    pipeline = build_pipeline(runtime, invoke_from, user, tool_providers=tool_providers)
    responses = pipeline._handle_workflow_started_event(QueueWorkflowStartedEvent(reason=WorkflowStartReason.INITIAL))

    assert next(responses).workflow_run_id == "run-id"
    assert sessions.kw["bind"].pool.checkedout() == 0
    with sessions() as session:
        log = session.scalars(select(WorkflowAppLog)).one()
        assert (log.tenant_id, log.app_id, log.workflow_id, log.workflow_run_id) == (
            "tenant-id",
            "app-id",
            "workflow-id",
            "run-id",
        )
        assert log.created_from == created_from
        assert log.created_by == user.id
        assert log.created_by_role == (CreatorUserRole.ACCOUNT if account else CreatorUserRole.END_USER)
    assert list(responses) == []

    list(pipeline._handle_workflow_started_event(QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION)))
    with sessions() as session:
        assert session.scalars(select(WorkflowAppLog)).one().id == log.id


@pytest.mark.parametrize(
    "invoke_from", [InvokeFrom.DEBUGGER, InvokeFrom.TRIGGER, InvokeFrom.PUBLISHED_PIPELINE, InvokeFrom.VALIDATION]
)
def test_debug_and_pipeline_starts_do_not_create_application_logs(log_store, invoke_from, *, tool_providers):
    sessions, runtime = log_store
    pipeline = build_pipeline(runtime, invoke_from, make_account(account_id="user-id"), tool_providers=tool_providers)
    assert len(list(pipeline._handle_workflow_started_event(QueueWorkflowStartedEvent()))) == 1
    with sessions() as session:
        assert session.scalar(select(WorkflowAppLog)) is None


def test_log_failure_rolls_back_and_releases_connection_for_retry(log_store, *, tool_providers):
    sessions, runtime = log_store
    pipeline = build_pipeline(
        runtime, InvokeFrom.SERVICE_API, make_account(account_id="user-id"), tool_providers=tool_providers
    )

    def fail_after_insert(session, _flush_context):
        assert session.scalar(select(WorkflowAppLog)) is not None
        raise RuntimeError("commit failed")

    event.listen(sessions, "after_flush", fail_after_insert)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            list(pipeline._handle_workflow_started_event(QueueWorkflowStartedEvent()))
    finally:
        event.remove(sessions, "after_flush", fail_after_insert)

    assert sessions.kw["bind"].pool.checkedout() == 0
    with sessions() as session:
        assert session.scalar(select(WorkflowAppLog)) is None

    assert len(list(pipeline._handle_workflow_started_event(QueueWorkflowStartedEvent()))) == 1
    with sessions() as session:
        assert session.scalars(select(WorkflowAppLog)).one().workflow_run_id == "run-id"
