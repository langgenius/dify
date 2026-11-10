"""Trigger worker status transitions against real SQLite and graph events."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from contextvars import Context
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
from celery import Task
from flask import Flask
from redis import Redis
from sqlalchemy import Engine, delete, inspect, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.workflow.file_runtime import create_dify_workflow_file_runtime
from core.workflow.system_variables import build_system_variables
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from graphon.engine.command.builtin.in_memory import InMemoryChannel
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from graphon.file.runtime import use_workflow_file_runtime
from graphon.runtime import RuntimeState, VariablePool
from graphon.runtime.read_only_wrappers import ReadOnlyRuntimeStateWrapper
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole, EndUserType, WorkflowTriggerStatus
from models.model import App, AppMode, EndUser
from models.trigger import WorkflowTriggerLog
from models.workflow import Workflow
from repositories.sqlalchemy_workflow_trigger_log_repository import (
    SQLAlchemyWorkflowTriggerExecutionRepository,
)
from services.errors.app import WorkflowNotFoundError
from services.trigger.execution_gateway import WorkflowTriggerExecutionGateway
from services.trigger.execution_layer import TriggerPostLayer
from services.trigger.execution_service import TriggerExecutionService
from services.trigger.execution_store import TriggerExecution, TriggerExecutionRef
from services.workflow.entities import ScheduleTriggerData, TriggerActor
from tasks.async_workflow_tasks import execute_workflow_professional, execute_workflow_sandbox, execute_workflow_team
from tests.helpers.unit.model_factories import make_workflow
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client as oauth_tests
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness

application_redis = oauth_tests.application_redis
harness = oauth_tests.harness


@pytest.fixture
def logs(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyWorkflowTriggerExecutionRepository:
    return SQLAlchemyWorkflowTriggerExecutionRepository(session_factory=sqlite_session_factory)


@pytest.fixture
def execution(sqlite_session_factory: sessionmaker[Session]) -> TriggerExecution:
    tenant = Tenant(name="Trigger tenant")
    account = Account(name="Owner", email="trigger-owner@example.com")
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, account])
        session.flush()
        app = App(
            tenant_id=tenant.id,
            name="Trigger app",
            mode=AppMode.WORKFLOW,
            enable_site=True,
            enable_api=True,
            max_active_requests=0,
        )
        session.add(app)
        session.flush()
        workflow = make_workflow(
            workflow_id=str(uuid4()),
            tenant_id=tenant.id,
            app_id=app.id,
            version="1",
            graph='{"nodes": [], "edges": []}',
            created_by=account.id,
        )
        session.add(workflow)
        session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER))
        app.workflow_id = workflow.id
    data = ScheduleTriggerData(tenant_id=tenant.id, app_id=app.id, root_node_id="schedule", inputs={"text": "hello"})
    actor = TriggerActor(id=account.id, role=CreatorUserRole.ACCOUNT)
    log_id = SQLAlchemyWorkflowTriggerExecutionRepository(session_factory=sqlite_session_factory).create_pending(
        actor=actor, trigger_data=data, workflow_id=workflow.id, queue="workflow_sandbox"
    )
    return TriggerExecution(
        log=TriggerExecutionRef(id=log_id, tenant_id=tenant.id, app_id=app.id, queue_name="workflow_sandbox"),
        workflow_id=workflow.id,
        actor=actor,
        data=data,
    )


def _layer(logs: SQLAlchemyWorkflowTriggerExecutionRepository, execution: TriggerExecution) -> TriggerPostLayer:
    layer = TriggerPostLayer(logs=logs, log=execution.log, start_time=datetime.now(UTC) - timedelta(seconds=10))
    state = RuntimeState(
        workflow_id=execution.workflow_id,
        variable_pool=VariablePool.from_bootstrap(
            system_variables=build_system_variables(workflow_execution_id="run-1")
        ),
        start_at=0,
        outputs={"answer": "ok", "number": 0},
    )
    layer.initialize(ReadOnlyRuntimeStateWrapper(state), InMemoryChannel())
    return layer


@pytest.mark.parametrize("failure", [False, True])
def test_runtime_starts_after_status_commit_and_connection_release(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    failure: bool,
) -> None:
    invoked: list[TriggerExecution] = []

    def run(value: TriggerExecution, started_at: datetime) -> None:
        assert isinstance(sqlite_engine.pool, QueuePool)
        assert sqlite_engine.pool.checkedout() == 0
        with sqlite_session_factory() as session:
            row = session.get(WorkflowTriggerLog, value.log.id)
            assert row is not None
            assert row.status == WorkflowTriggerStatus.RUNNING
        assert started_at <= datetime.now(UTC)
        assert value.data.inputs == {"text": "hello"}
        invoked.append(value)
        if failure:
            raise RuntimeError("provider execution failed")
        _layer(logs, value).on_event(GraphRunSucceededEvent())

    TriggerExecutionService(logs=logs, run=run).execute(execution.log.id)
    assert len(invoked) == 1
    with sqlite_session_factory() as session:
        row = session.get(WorkflowTriggerLog, execution.log.id)
        assert row is not None
        assert row.status == (WorkflowTriggerStatus.FAILED if failure else WorkflowTriggerStatus.SUCCEEDED)
        assert row.error == ("provider execution failed" if failure else None)
        assert row.elapsed_time is not None
        assert row.elapsed_time >= 0
        assert row.finished_at is not None


def test_missing_log_does_not_invoke_runtime(logs: SQLAlchemyWorkflowTriggerExecutionRepository) -> None:
    invoked: list[str] = []
    TriggerExecutionService(logs=logs, run=lambda value, _at: invoked.append(value.log.id)).execute(str(uuid4()))
    assert invoked == []


@pytest.mark.parametrize(
    "event",
    [None, GraphRunSucceededEvent(), GraphRunFailedEvent(error="failed"), GraphRunPausedEvent(reasons=[])],
)
def test_late_publication_receipt_preserves_worker_progress(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
    event: EngineEvent | None,
) -> None:
    # A worker can consume the published task before the producer records its receipt.
    assert logs.start(execution.log.id) is not None
    if event is not None:
        _layer(logs, execution).on_event(event)
    with sqlite_session_factory() as session:
        before = session.get(WorkflowTriggerLog, execution.log.id)
        assert before is not None
    logs.mark_queued(
        tenant_id=execution.log.tenant_id,
        app_id=execution.log.app_id,
        log_id=execution.log.id,
        task_id="published-task",
    )
    with sqlite_session_factory() as session:
        after = session.get(WorkflowTriggerLog, execution.log.id)
        assert after is not None
        assert after.status == before.status
        assert after.workflow_run_id == before.workflow_run_id
        assert after.outputs == before.outputs
        assert after.elapsed_time == before.elapsed_time
        assert after.finished_at == before.finished_at
        assert after.celery_task_id == "published-task"
        assert after.triggered_at is not None


@pytest.mark.parametrize("queued", [False, True])
def test_concurrent_workers_claim_execution_only_once(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    queued: bool,
) -> None:
    if queued:
        logs.mark_queued(
            tenant_id=execution.log.tenant_id, app_id=execution.log.app_id, log_id=execution.log.id, task_id="task"
        )
    ready = Barrier(2)

    def start() -> TriggerExecution | None:
        ready.wait(timeout=5)
        return logs.start(execution.log.id)

    with ThreadPoolExecutor(max_workers=2) as workers:
        attempts = [workers.submit(start) for _ in range(2)]
        claims = [attempt.result(timeout=10) for attempt in attempts]
    assert sum(claim is not None for claim in claims) == 1
    claimed = next(claim for claim in claims if claim is not None)
    assert claimed.log == execution.log
    assert claimed.actor == execution.actor
    assert claimed.workflow_id == execution.workflow_id
    assert claimed.data.model_dump() == execution.data.model_dump()
    assert logs.start(execution.log.id) is None


@pytest.mark.parametrize(
    "status",
    [
        status
        for status in WorkflowTriggerStatus
        if status not in (WorkflowTriggerStatus.PENDING, WorkflowTriggerStatus.QUEUED)
    ],
)
def test_redelivery_of_claimed_or_finished_log_does_not_invoke_runtime(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
    status: WorkflowTriggerStatus,
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get(WorkflowTriggerLog, execution.log.id)
        assert row is not None
        row.status = status
    invoked: list[str] = []
    TriggerExecutionService(logs=logs, run=lambda value, _at: invoked.append(value.log.id)).execute(execution.log.id)
    assert invoked == []
    with sqlite_session_factory() as session:
        row = session.get(WorkflowTriggerLog, execution.log.id)
        assert row is not None
        assert row.status == status


@pytest.mark.parametrize("event", [GraphRunSucceededEvent(), GraphRunAbortedEvent(reason="original failure")])
def test_terminal_result_survives_late_failure_and_duplicate_completion(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
    event: EngineEvent,
) -> None:
    assert logs.start(execution.log.id) is not None
    layer = _layer(logs, execution)
    layer.on_event(event)
    with sqlite_session_factory() as session:
        before = session.get(WorkflowTriggerLog, execution.log.id)
        assert before is not None
    logs.fail(log=execution.log, error="late worker failure", finished_at=datetime.now(UTC), elapsed_time=999)
    logs.mark_failed(
        tenant_id=execution.log.tenant_id,
        app_id=execution.log.app_id,
        log_id=execution.log.id,
        status=WorkflowTriggerStatus.FAILED,
        error="late producer failure",
    )
    layer.on_event(GraphRunSucceededEvent())
    with sqlite_session_factory() as session:
        after = session.get(WorkflowTriggerLog, execution.log.id)
        assert after is not None
        assert after.status == before.status
        assert after.error == before.error
        assert after.finished_at == before.finished_at
        assert after.elapsed_time == before.elapsed_time


@pytest.mark.parametrize("queued", [False, True])
def test_worker_cannot_finish_or_fail_before_claiming_execution(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
    queued: bool,
) -> None:
    if queued:
        logs.mark_queued(
            tenant_id=execution.log.tenant_id, app_id=execution.log.app_id, log_id=execution.log.id, task_id="task"
        )
    _layer(logs, execution).on_event(GraphRunSucceededEvent())
    logs.fail(log=execution.log, error="unclaimed", finished_at=datetime.now(UTC), elapsed_time=1)
    with sqlite_session_factory() as session:
        row = session.get(WorkflowTriggerLog, execution.log.id)
        assert row is not None
        assert row.status == (WorkflowTriggerStatus.QUEUED if queued else WorkflowTriggerStatus.PENDING)
        assert row.error is None
        assert row.workflow_run_id is None
        assert row.finished_at is None


def test_late_producer_failure_does_not_stop_running_worker(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    assert logs.start(execution.log.id) is not None
    logs.mark_failed(
        tenant_id=execution.log.tenant_id,
        app_id=execution.log.app_id,
        log_id=execution.log.id,
        status=WorkflowTriggerStatus.FAILED,
        error="broker reply lost",
    )
    with sqlite_session_factory() as session:
        row = session.get(WorkflowTriggerLog, execution.log.id)
        assert row is not None
        assert row.status == WorkflowTriggerStatus.RUNNING
        assert row.error is None


@pytest.mark.parametrize(
    ("event", "status", "error"),
    [
        (GraphRunSucceededEvent(), WorkflowTriggerStatus.SUCCEEDED, None),
        (GraphRunFailedEvent(error="runtime failed"), WorkflowTriggerStatus.FAILED, None),
        (GraphRunPausedEvent(reasons=[]), WorkflowTriggerStatus.PAUSED, None),
        (GraphRunAbortedEvent(reason="timeout"), WorkflowTriggerStatus.FAILED, "timeout"),
        (GraphRunAbortedEvent(reason=""), WorkflowTriggerStatus.FAILED, "Workflow execution aborted"),
    ],
)
def test_terminal_event_preserves_output_status_and_accumulated_elapsed_time(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
    event: EngineEvent,
    status: WorkflowTriggerStatus,
    error: str | None,
) -> None:
    assert logs.start(execution.log.id) is not None
    with sqlite_session_factory.begin() as session:
        row = session.get(WorkflowTriggerLog, execution.log.id)
        assert row is not None
        row.elapsed_time = 5
    _layer(logs, execution).on_event(event)
    with sqlite_session_factory() as session:
        row = session.get(WorkflowTriggerLog, execution.log.id)
        assert row is not None
        assert row.status == status
        assert row.error == error
        assert row.workflow_run_id == "run-1"
        assert json.loads(row.outputs or "{}") == {"answer": "ok", "number": 0}
        assert row.total_tokens == 0
        assert row.elapsed_time is not None
        assert row.elapsed_time >= 15
        assert row.finished_at is not None


def test_pause_then_finish_only_adds_new_elapsed_time(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    assert logs.start(execution.log.id) is not None
    layer = _layer(logs, execution)
    layer.on_event(GraphRunPausedEvent(reasons=[]))
    with sqlite_session_factory() as session:
        first = session.scalar(select(WorkflowTriggerLog.elapsed_time).where(WorkflowTriggerLog.id == execution.log.id))
    resumed_at = datetime.now(UTC)
    layer.on_event(GraphRunSucceededEvent())
    with sqlite_session_factory() as session:
        second = session.scalar(
            select(WorkflowTriggerLog.elapsed_time).where(WorkflowTriggerLog.id == execution.log.id)
        )
    assert first is not None
    assert second is not None
    assert first <= second <= first + (datetime.now(UTC) - resumed_at).total_seconds() + 1


@pytest.mark.parametrize("scope", ["tenant_id", "app_id"])
def test_finish_fail_and_resume_query_are_owner_scoped(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
    scope: str,
) -> None:
    assert logs.start(execution.log.id) is not None
    foreign = replace(execution.log, **{scope: str(uuid4())})
    _layer(logs, replace(execution, log=foreign)).on_event(GraphRunSucceededEvent())
    logs.fail(log=foreign, error="foreign", finished_at=datetime.now(UTC), elapsed_time=1)
    with sqlite_session_factory.begin() as session:
        row = session.get(WorkflowTriggerLog, execution.log.id)
        assert row is not None
        assert row.status == WorkflowTriggerStatus.RUNNING
        row.workflow_run_id = "run-1"
    assert logs.find_for_run(tenant_id=foreign.tenant_id, app_id=foreign.app_id, workflow_run_id="run-1") is None
    assert (
        logs.find_for_run(tenant_id=execution.log.tenant_id, app_id=execution.log.app_id, workflow_run_id="run-1")
        == execution.log
    )


def test_nonterminal_events_do_not_write(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _layer(logs, execution).on_event(GraphRunStartedEvent())
    with sqlite_session_factory() as session:
        row = session.get(WorkflowTriggerLog, execution.log.id)
        assert row is not None
        assert row.status == WorkflowTriggerStatus.PENDING


@pytest.mark.parametrize("actor_role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
def test_legacy_models_are_loaded_and_detached_before_generator_entry(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    actor_role: CreatorUserRole,
) -> None:
    if actor_role == CreatorUserRole.END_USER:
        with sqlite_session_factory.begin() as session:
            actor = EndUser(
                tenant_id=execution.log.tenant_id,
                app_id=execution.log.app_id,
                session_id=str(uuid4()),
                type=EndUserType.TRIGGER,
            )
            session.add(actor)
            session.flush()
            execution = replace(execution, actor=TriggerActor(id=actor.id, role=actor_role))
    app, workflow, user = logs.get_execution_models(execution)
    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.pool.checkedout() == 0
    assert all(inspect(model).detached for model in (app, workflow, user))
    assert app.tenant_id == execution.log.tenant_id
    assert workflow.graph_dict == {"nodes": [], "edges": []}
    assert workflow.features_dict == {}
    assert user.id == execution.actor.id
    if isinstance(user, Account):
        assert user.current_tenant_id == execution.log.tenant_id
        assert user.role == TenantAccountRole.OWNER


@pytest.mark.parametrize("broken", ["app-tenant", "workflow-app", "workflow-tenant", "tenant", "membership", "account"])
def test_runtime_hydration_rejects_broken_owner_chain(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
    broken: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, execution.log.app_id)
        workflow = session.get(Workflow, execution.workflow_id)
        assert app is not None
        assert workflow is not None
        if broken == "app-tenant":
            app.tenant_id = str(uuid4())
        elif broken == "workflow-app":
            workflow.app_id = str(uuid4())
        elif broken == "workflow-tenant":
            workflow.tenant_id = str(uuid4())
        elif broken == "tenant":
            session.execute(delete(Tenant).where(Tenant.id == execution.log.tenant_id))
        elif broken == "membership":
            session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == execution.actor.id))
        else:
            session.execute(delete(Account).where(Account.id == execution.actor.id))
    with pytest.raises(WorkflowNotFoundError):
        logs.get_execution_models(execution)


@pytest.mark.parametrize("foreign", ["tenant", "app", "missing"])
def test_end_user_runtime_hydration_is_scoped(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
    foreign: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        user = EndUser(
            tenant_id=str(uuid4()) if foreign == "tenant" else execution.log.tenant_id,
            app_id=str(uuid4()) if foreign == "app" else execution.log.app_id,
            session_id=str(uuid4()),
            type=EndUserType.TRIGGER,
        )
        session.add(user)
        session.flush()
        actor = TriggerActor(id=str(uuid4()) if foreign == "missing" else user.id, role=CreatorUserRole.END_USER)
    with pytest.raises(WorkflowNotFoundError):
        logs.get_execution_models(replace(execution, actor=actor))


@pytest.mark.parametrize("task", [execute_workflow_professional, execute_workflow_team, execute_workflow_sandbox])
def test_each_worker_entrypoint_uses_injected_execution_service(
    app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    task: Task[[dict[str, object]], None],
) -> None:
    calls: list[TriggerExecution] = []
    service = TriggerExecutionService(logs=logs, run=lambda value, _at: calls.append(value))
    redis = RedisClientWrapper()
    client = Redis()
    redis.initialize(client)
    services = build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis,
    )
    previous = app.extensions.get("application_services")
    app.extensions["application_services"] = replace(services, triggers=replace(services.triggers, executions=service))
    try:
        task.run({"workflow_trigger_log_id": execution.log.id})
    finally:
        client.close()
        if previous is None:
            app.extensions.pop("application_services")
        else:
            app.extensions["application_services"] = previous
    assert len(calls) == 1
    assert calls[0].log == execution.log


@pytest.mark.parametrize("actor_role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
def test_real_generator_runs_with_detached_models(
    logs: SQLAlchemyWorkflowTriggerExecutionRepository,
    execution: TriggerExecution,
    sqlite_session_factory: sessionmaker[Session],
    harness: _Harness,
    actor_role: CreatorUserRole,
) -> None:
    with sqlite_session_factory.begin() as session:
        workflow = session.get(Workflow, execution.workflow_id)
        assert workflow is not None
        if actor_role == CreatorUserRole.END_USER:
            user = EndUser(
                tenant_id=execution.log.tenant_id,
                app_id=execution.log.app_id,
                type=EndUserType.TRIGGER,
                session_id=str(uuid4()),
            )
            session.add(user)
            session.flush()
            log = session.get(WorkflowTriggerLog, execution.log.id)
            assert log is not None
            log.created_by = user.id
            log.created_by_role = actor_role
            execution = replace(execution, actor=TriggerActor(id=user.id, role=actor_role))
        workflow.graph = json.dumps(
            {
                "nodes": [
                    {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
                    {"id": "end", "data": {"type": "end", "title": "End", "outputs": []}},
                ],
                "edges": [{"id": "start-end", "source": "start", "target": "end"}],
            }
        )
    execution = replace(execution, data=execution.data.model_copy(update={"root_node_id": "start", "inputs": {}}))
    assert logs.start(execution.log.id) is not None
    gateway = WorkflowTriggerExecutionGateway(models=logs, logs=logs, session_factory=sqlite_session_factory)

    def run() -> None:
        with harness.app.app_context(), use_workflow_file_runtime(create_dify_workflow_file_runtime()):
            gateway.run(execution, datetime.now(UTC))

    Context().run(run)
    with sqlite_session_factory() as session:
        log = session.get(WorkflowTriggerLog, execution.log.id)
        assert log is not None
        assert log.status == WorkflowTriggerStatus.SUCCEEDED
        assert log.workflow_run_id is not None
        assert log.outputs == "{}"
    assert all(not session.in_transaction() and not session.identity_map for session in harness.metadata.sessions)
