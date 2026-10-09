"""Runtime adaptation releases read transactions before external execution preparation."""

import json
from collections.abc import Callable, Generator, Iterable
from typing import NoReturn, Self, cast, override
from unittest.mock import Mock, create_autospec

import pytest
from flask import Flask
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.app.file_access import DatabaseFileAccessController
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.trigger.debug.event_selectors import TriggerDebugEvent
from extensions.application_services.workflow import build_workflow_execution_dependencies
from extensions.ext_storage import storage
from fields.workflow_run_fields import WorkflowRunNodeExecutionResponse
from graphon.entities import WorkflowNodeExecution
from graphon.file import File
from graphon.graph_engine.manager import GraphEngineManager
from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole, ExecutionOffLoadType
from models.model import AppMode
from models.workflow import (
    Workflow,
    WorkflowDraftVariable,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionStatus,
)
from repositories.agent.retirement_repository import WorkflowAgentRetirementRepository
from repositories.factory import DifyAPIRepositoryFactory
from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
from repositories.workflow.definition_repository import WorkflowDefinitionRepository
from repositories.workflow.draft_variable_repository import WorkflowDraftVariableRepository
from repositories.workflow.node_execution_repository import WorkflowNodeExecutionRepository
from services import workflow_service as workflow_module
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.app_generate_service import AppGenerateService
from services.file_service import FileService
from services.tools.provider_queries import ToolProviderIcons
from services.workflow import runtime_gateway as module
from services.workflow.console_service import (
    ConsoleWorkflowService,
    WorkflowAccess,
    WorkflowAppLookup,
    WorkflowConversion,
    WorkflowDefinitionLifecycle,
    WorkflowDefinitions,
    WorkflowPresence,
)
from services.workflow.draft_service import WorkflowDraftService
from services.workflow.runtime_gateway import WorkflowRuntimeGateway
from services.workflow.variable_contracts import WorkflowExecutionVariables
from services.workflow.variable_service import WorkflowVariableService
from services.workflow_service import WorkflowService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_app, make_tenant, make_workflow
from tests.unit_tests.workflow_execution import debug_lease, set_debug_deadline

CONTEXT = RequestContext("request", None, "account-1", "tenant-1")


class RecordingSession(Session):
    closed = False

    @override
    def close(self) -> None:
        self.closed = True
        super().close()


@pytest.fixture(name="runtime")
def runtime_gateway(
    sqlite_session_factory: sessionmaker[Session], *, workflow_variables: WorkflowExecutionVariables
) -> tuple[WorkflowRuntimeGateway, list[RecordingSession]]:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_app(mode=AppMode.WORKFLOW),
                make_account(),
                make_tenant(),
                make_workflow(),
                TenantAccountJoin(tenant_id="tenant-1", account_id="account-1", role=TenantAccountRole.OWNER),
            ]
        )
    sessions: list[RecordingSession] = []
    factory = cast(
        sessionmaker[Session],
        sessionmaker(bind=sqlite_session_factory.kw["bind"], class_=RecordingSession, expire_on_commit=False),
    )

    def opened(session: Session, _transaction: object, _connection: object) -> None:
        assert isinstance(session, RecordingSession)
        sessions.append(session)

    event.listen(factory, "after_begin", opened)
    workflows = WorkflowService(session_maker=factory, runtime=build_workflow_execution_dependencies(factory))

    def generate(**_kwargs: object) -> Generator[str, None, None]:
        assert sessions
        assert all(session.closed for session in sessions)

        def events() -> Generator[str, None, None]:
            assert all(session.closed for session in sessions)
            yield "data: ready\n\n"

        return events()

    generator = create_autospec(AppGenerateService, spec_set=True)
    generator.generate_workflow_stream.side_effect = generate
    gateway = WorkflowRuntimeGateway(
        runtime=build_workflow_execution_dependencies(factory),
        session_factory=factory,
        workflows=workflows,
        definitions=WorkflowDefinitionRepository(session_factory=factory),
        reservations=WorkflowDebugReservationRepository(factory),
        executions=WorkflowNodeExecutionRepository(factory),
        generator=generator,
        graph_engine=create_autospec(GraphEngineManager, instance=True, spec_set=True),
        file_access=DatabaseFileAccessController(),
        variables=workflow_variables,
    )
    return gateway, sessions


def test_generate_closes_session_before_stream_is_consumed(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
) -> None:
    gateway, sessions = runtime
    stream = gateway.generate(CONTEXT, "app-1", {}, root_node_id=None, workflow=None)
    assert all(session.closed for session in sessions)
    assert list(stream) == ["data: ready\n\n"]


@pytest.mark.parametrize("rejection", ["expired", "claimed", "paused", "tenant", "app", "workflow", "mode"])
def test_rejected_debug_handoff_only_notifies_owned_expired_stream(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    rejection: str,
) -> None:
    from datetime import timedelta

    from core.app.entities.app_invoke_entities import InvokeFrom
    from graphon.enums import WorkflowExecutionStatus
    from libs.datetime_utils import naive_utc_now
    from models.workflow import WorkflowRun
    from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
    from services.agent.retirement_service import WorkflowAgentRetirementService
    from tasks.app_generate import workflow_execute_task as task_module

    gateway, sessions = agent_runtime
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    assert snapshot.execution_id is not None
    app, actor, workflow = gateway._definitions.debug_context(CONTEXT, "app-1", workflow_id=None, snapshot=snapshot)
    params = task_module.AppExecutionParams.new(
        app_model=app,
        workflow=workflow,
        user=actor,
        args={},
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_run_id=snapshot.execution_id,
        workflow_snapshot=snapshot,
    )
    with sqlite_session_factory.begin() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        reservation = debug_lease(session, snapshot.execution_id)
        assert run is not None
        assert reservation is not None
        if rejection in ("claimed", "paused"):
            WorkflowDebugReservationRepository.claim(session, run, naive_utc_now())
            if rejection == "paused":
                run.status = WorkflowExecutionStatus.PAUSED
        set_debug_deadline(session, snapshot.execution_id, naive_utc_now() - timedelta(seconds=30))
    if rejection in ("tenant", "app", "workflow"):
        params = params.model_copy(update={f"{rejection}_id": "wrong-owner"})
    elif rejection == "mode":
        params = params.model_copy(update={"invoke_from": InvokeFrom.SERVICE_API})
    topic = Mock()

    def publish(_payload: bytes) -> None:
        assert all(session.closed and not session.in_transaction() for session in sessions)

    topic.publish.side_effect = publish
    get_topic = Mock(return_value=topic)
    monkeypatch.setattr(task_module.WorkflowEventStream, "get_response_topic", get_topic)
    finish = Mock(wraps=WorkflowAgentRetirementService.finish_execution)
    monkeypatch.setattr(WorkflowAgentRetirementService, "finish_execution", finish)
    runner = task_module._AppRunner(gateway._sessions, params, variables=gateway._variables)
    engine = Mock()
    monkeypatch.setattr(runner, "_run_app", engine)
    with pytest.raises(ValueError):
        runner.run()
    engine.assert_not_called()
    finish.assert_not_called()
    if rejection == "expired":
        payloads = [json.loads(call.args[0]) for call in topic.publish.call_args_list]
        assert [payload["event"] for payload in payloads] == ["workflow_started", "workflow_finished"]
        assert payloads[-1]["data"]["status"] == "failed"
        assert payloads[-1]["workflow_run_id"] == snapshot.execution_id
        assert "expired before worker startup" in payloads[-1]["data"]["error"]
    else:
        get_topic.assert_not_called()
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        assert run is not None
        assert run.status == (
            WorkflowExecutionStatus.PAUSED if rejection == "paused" else WorkflowExecutionStatus.RUNNING
        )


def test_claimed_worker_is_not_cancelled_by_stream_cleanup(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from datetime import timedelta

    from graphon.enums import WorkflowExecutionStatus
    from libs.datetime_utils import naive_utc_now
    from models.agent import Agent, AgentStatus, WorkflowAgentNodeBinding
    from models.workflow import WorkflowRun
    from repositories.agent.runtime_repository import WorkflowAgentExecutionRepository
    from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
    from services.agent.retirement_service import WorkflowAgentRetirementService

    gateway, _ = agent_runtime
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    assert snapshot.execution_id is not None
    with sqlite_session_factory.begin() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        assert run is not None
        WorkflowDebugReservationRepository.claim(session, run, naive_utc_now())
    gateway._cancel_trigger_debug(snapshot, CONTEXT.account_id)
    # Even an expiry candidate selected before the claim must be rechecked
    # under the run lock; a healthy running lease must remain owned.
    assert (
        WorkflowDebugReservationRepository(sqlite_session_factory).expire(
            snapshot.execution_id, naive_utc_now() + timedelta(seconds=1)
        )
        is None
    )
    with sqlite_session_factory() as session:
        assert session.get(WorkflowRun, snapshot.execution_id) is not None
        assert WorkflowAgentExecutionRepository.retained_execution_agent_ids(session, "tenant-1", ["agent-1"]) == {
            "agent-1"
        }
    with sqlite_session_factory.begin() as session:
        binding = session.get(WorkflowAgentNodeBinding, "binding")
        assert binding is not None
        session.delete(binding)
    monkeypatch.setattr("core.db.session_factory._session_maker", sessionmaker())
    collector = Mock()
    monkeypatch.setattr("tasks.collect_agent_resources_task.collect_agent_resources.delay", collector)
    WorkflowAgentRetirementService.finish_execution(
        sessions=sqlite_session_factory,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id=snapshot.id,
        execution_id=snapshot.execution_id,
        account_id=CONTEXT.account_id,
        status=WorkflowExecutionStatus.STOPPED,
    )
    with sqlite_session_factory() as session:
        agent = session.get(Agent, "agent-1")
        assert agent is not None
        assert agent.status == AgentStatus.ARCHIVED
    collector.assert_called_once()


@pytest.mark.parametrize("storage_backend", ["sqlalchemy", "celery"])
@pytest.mark.parametrize("stream_raises", [False, True])
@pytest.mark.parametrize("publish_fails", [False, True])
def test_paused_trigger_finalizes_once_despite_delayed_start_write(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    storage_backend: str,
    stream_raises: bool,
    publish_fails: bool,
) -> None:
    from contextlib import contextmanager

    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.repositories.celery_workflow_execution_repository import CeleryWorkflowExecutionRepository
    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from graphon.entities import WorkflowExecution
    from graphon.enums import WorkflowExecutionStatus, WorkflowType
    from models.agent import Agent, AgentStatus, WorkflowAgentNodeBinding
    from models.enums import WorkflowRunTriggeredFrom
    from models.workflow import WorkflowRun
    from repositories.agent.runtime_repository import WorkflowAgentExecutionRepository
    from services.workflow.execution.adapters.response_stream import WorkflowEventStream
    from tasks import workflow_execution_tasks as storage_module
    from tasks.app_generate import workflow_execute_task as task_module

    gateway, _ = agent_runtime
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    assert snapshot.execution_id is not None
    app, actor, workflow = gateway._definitions.debug_context(CONTEXT, "app-1", workflow_id=None, snapshot=snapshot)
    params = task_module.AppExecutionParams.new(
        app_model=app,
        workflow=workflow,
        user=actor,
        args={},
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_run_id=snapshot.execution_id,
        workflow_snapshot=snapshot,
    )
    started = WorkflowExecution(
        id_=snapshot.execution_id,
        workflow_id=snapshot.id,
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="draft",
        graph=snapshot.graph_dict,
        inputs={},
        outputs={},
        status=WorkflowExecutionStatus.RUNNING,
        error_message="",
        total_tokens=0,
        total_steps=0,
        exceptions_count=0,
        started_at=snapshot.created_at,
        finished_at=None,
    )
    paused = started.model_copy(update={"status": WorkflowExecutionStatus.PAUSED})
    repository_type = (
        CeleryWorkflowExecutionRepository if storage_backend == "celery" else SQLAlchemyWorkflowExecutionRepository
    )
    writer = repository_type(
        session_factory=sqlite_session_factory,
        tenant_id="tenant-1",
        app_id="app-1",
        user=actor,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
    )
    monkeypatch.setattr("core.db.session_factory.session_factory.create_session", gateway._sessions)
    queued = Mock()
    monkeypatch.setattr(storage_module.save_workflow_execution_task, "delay", queued)
    if storage_backend == "celery":
        writer.save(started)
        writer.save(paused)
        assert queued.call_count == 2

    def deliver(index: int) -> None:
        if storage_backend == "celery":
            storage_module.save_workflow_execution_task(**queued.call_args_list[index].kwargs)
        else:
            writer.save((started, paused)[index])

    with sqlite_session_factory.begin() as session:
        binding = session.get(WorkflowAgentNodeBinding, "binding")
        assert binding is not None
        session.delete(binding)
    collector = Mock()
    monkeypatch.setattr("tasks.collect_agent_resources_task.collect_agent_resources.delay", collector)
    from repositories.workflow.execution_write_repository import WorkflowExecutionWriteRepository

    statuses: list[WorkflowExecutionStatus | None] = []
    original_finish = WorkflowExecutionWriteRepository.finish

    def record_finish(
        self: WorkflowExecutionWriteRepository,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        execution_id: str,
        status: WorkflowExecutionStatus | None = None,
        cancel: bool = False,
    ) -> WorkflowExecutionStatus | None:
        statuses.append(status)
        return original_finish(
            self,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            execution_id=execution_id,
            status=status,
            cancel=cancel,
        )

    monkeypatch.setattr(WorkflowExecutionWriteRepository, "finish", record_finish)
    topic = Mock()
    if publish_fails:
        topic.publish.side_effect = RuntimeError("pause publish failed")
    monkeypatch.setattr(WorkflowEventStream, "get_response_topic", lambda *_args: topic)

    def events(**_kwargs: object) -> Generator[dict[str, object], None, None]:
        yield {"event": "workflow_paused", "data": {"status": "paused"}}
        if stream_raises:
            raise RuntimeError("stream failed after pause")

    @contextmanager
    def execution_context(_user: object) -> Generator[None, None, None]:
        try:
            yield
        finally:
            # The publisher has finalized PAUSED, but the outer run() has not
            # exited yet. Deliver the older asynchronous start write here.
            with sqlite_session_factory() as session:
                run = session.get(WorkflowRun, snapshot.execution_id)
                assert run is not None
                assert run.status == WorkflowExecutionStatus.PAUSED
            deliver(0)

    runner = task_module._AppRunner(gateway._sessions, params, variables=gateway._variables)
    monkeypatch.setattr(runner, "_run_app", events)
    monkeypatch.setattr(runner, "_setup_flask_context", execution_context)
    if publish_fails:
        with pytest.raises(RuntimeError, match="pause publish failed"):
            runner.run()
        assert [json.loads(call.args[0])["event"] for call in topic.publish.call_args_list] == [
            "workflow_paused",
            "workflow_paused",
        ]
    elif stream_raises:
        with pytest.raises(RuntimeError, match="stream failed after pause"):
            runner.run()
    else:
        runner.run()

    assert statuses == [WorkflowExecutionStatus.PAUSED]
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        assert run is not None
        assert run.status == WorkflowExecutionStatus.PAUSED
        assert WorkflowAgentExecutionRepository.retained_execution_agent_ids(session, "tenant-1", ["agent-1"]) == {
            "agent-1"
        }

    # Finally deliver the asynchronous pause write. The outer runner must not
    # have poisoned the execution with FAILED or retired its removed Agent.
    deliver(1)
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        agent = session.get(Agent, "agent-1")
        assert run is not None
        assert run.status == WorkflowExecutionStatus.PAUSED
        assert agent is not None
        assert agent.status == AgentStatus.ACTIVE
        assert WorkflowAgentExecutionRepository.retained_execution_agent_ids(session, "tenant-1", ["agent-1"]) == {
            "agent-1"
        }
    collector.assert_not_called()


@pytest.mark.parametrize("stream_raises", [False, True])
def test_pause_publication_can_resume_before_old_worker_exits(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    stream_raises: bool,
) -> None:
    from contextlib import nullcontext

    from core.app.entities.app_invoke_entities import InvokeFrom
    from graphon.enums import WorkflowExecutionStatus
    from libs.datetime_utils import naive_utc_now
    from models.agent import Agent, AgentStatus, WorkflowAgentNodeBinding
    from models.workflow import WorkflowPause, WorkflowRun
    from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
    from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
    from repositories.workflow.execution_write_repository import save_workflow_run
    from services.workflow.execution.adapters.response_stream import WorkflowEventStream
    from tasks.app_generate import workflow_execute_task as task_module

    gateway, _ = agent_runtime
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    assert snapshot.execution_id is not None
    app, actor, workflow = gateway._definitions.debug_context(CONTEXT, "app-1", workflow_id=None, snapshot=snapshot)
    params = task_module.AppExecutionParams.new(
        app_model=app,
        workflow=workflow,
        user=actor,
        args={},
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_run_id=snapshot.execution_id,
        workflow_snapshot=snapshot,
    )
    with sqlite_session_factory.begin() as session:
        binding = session.get(WorkflowAgentNodeBinding, "binding")
        assert binding is not None
        session.delete(binding)
    collector = Mock()
    monkeypatch.setattr("tasks.collect_agent_resources_task.collect_agent_resources.delay", collector)
    runs = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)

    def events(**_kwargs: object) -> Generator[dict[str, object], None, None]:
        # Pause-state persistence precedes the outgoing engine event.
        with sqlite_session_factory.begin() as session:
            run = session.get(WorkflowRun, snapshot.execution_id)
            assert run is not None
            run.status = WorkflowExecutionStatus.PAUSED
            session.add(WorkflowPause(workflow_id=workflow.id, workflow_run_id=run.id, state_object_key="pause"))
        yield {"event": "workflow_paused", "data": {"status": "paused"}}
        if stream_raises:
            raise RuntimeError("old stream failed after resume")

    def resume_on_publication(_payload: bytes) -> None:
        pause = runs.get_workflow_pause(snapshot.execution_id)
        assert pause is not None
        runs.resume_workflow_pause(snapshot.execution_id, pause)

    topic = Mock()
    topic.publish.side_effect = resume_on_publication
    monkeypatch.setattr(WorkflowEventStream, "get_response_topic", lambda *_args: topic)
    runner = task_module._AppRunner(gateway._sessions, params, variables=gateway._variables)
    monkeypatch.setattr(runner, "_run_app", events)
    monkeypatch.setattr(runner, "_setup_flask_context", lambda _user: nullcontext())
    if stream_raises:
        with pytest.raises(RuntimeError, match="old stream failed after resume"):
            runner.run()
    else:
        runner.run()
    topic.publish.assert_called_once()
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        agent = session.get(Agent, "agent-1")
        assert run is not None
        assert run.status == WorkflowExecutionStatus.RUNNING
        assert agent is not None
        assert agent.status == AgentStatus.ACTIVE
        session.expunge(run)
    with sqlite_session_factory.begin() as session:
        assert save_workflow_run(session, run)
    collector.assert_not_called()
    # A subsequently lost resumed worker must still be discoverable by expiry.
    from datetime import timedelta

    assert snapshot.execution_id in [
        item.execution_id
        for item in WorkflowDebugReservationRepository(sqlite_session_factory).pending_batch(
            naive_utc_now() + timedelta(days=1), limit=100
        )
    ]


@pytest.mark.parametrize("failure_stage", ["prepare", "publish-setup"])
def test_trigger_runner_finalizes_failure_before_stream_cleanup(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    failure_stage: str,
) -> None:
    from core.app.entities.app_invoke_entities import InvokeFrom
    from graphon.enums import WorkflowExecutionStatus
    from models.agent import Agent, AgentStatus, WorkflowAgentNodeBinding
    from models.workflow import WorkflowRun
    from services.agent.retirement_service import WorkflowAgentRetirementService
    from services.workflow.execution.adapters.response_stream import WorkflowEventStream
    from tasks.app_generate import workflow_execute_task as task_module

    gateway, _ = agent_runtime
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    app, actor, workflow = gateway._definitions.debug_context(CONTEXT, "app-1", workflow_id=None, snapshot=snapshot)
    params = task_module.AppExecutionParams.new(
        app_model=app,
        workflow=workflow,
        user=actor,
        args={},
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_run_id=snapshot.execution_id,
        workflow_snapshot=snapshot,
    )
    with sqlite_session_factory.begin() as session:
        binding = session.get(WorkflowAgentNodeBinding, "binding")
        assert binding is not None
        session.delete(binding)
    monkeypatch.setattr("core.db.session_factory.session_factory.create_session", gateway._sessions)
    collector = Mock()
    monkeypatch.setattr("tasks.collect_agent_resources_task.collect_agent_resources.delay", collector)
    finish = Mock(wraps=WorkflowAgentRetirementService.finish_execution)
    monkeypatch.setattr(WorkflowAgentRetirementService, "finish_execution", finish)
    topic = Mock()
    if failure_stage == "publish-setup":
        topic.side_effect = RuntimeError("stream setup failed")
    monkeypatch.setattr(WorkflowEventStream, "get_response_topic", topic)
    generate = Mock(return_value=(event for event in []))
    if failure_stage == "prepare":
        generate.side_effect = RuntimeError("stream setup failed")
    runner = task_module._AppRunner(gateway._sessions, params, variables=gateway._variables)
    monkeypatch.setattr(runner, "_run_app", generate)

    with Flask(__name__).app_context(), pytest.raises(RuntimeError, match="stream setup failed"):
        runner.run()

    finish.assert_called_once()
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        agent = session.get(Agent, "agent-1")
        assert run is not None
        assert agent is not None
        assert run.status == WorkflowExecutionStatus.FAILED
        assert agent.status == AgentStatus.ARCHIVED
    collector.assert_called_once()


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
@pytest.mark.parametrize("failure", [None, "redis"])
def test_real_stream_preparation_releases_reads_before_external_io(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode,
    failure: str | None,
) -> None:
    from core.app.features.rate_limiting import rate_limit as limiter_module
    from enums import DeploymentEdition
    from models.model import App
    from services.quota_service import QuotaCharge, QuotaService, unlimited
    from services.workflow.execution.adapters.response_stream import WorkflowEventStream
    from tasks.app_generate import workflow_execute_task as task_module

    gateway, sessions = runtime
    gateway._generator = AppGenerateService
    with sqlite_session_factory.begin() as session:
        app = session.get(App, "app-1")
        assert app is not None
        app.mode = mode
        app.max_active_requests = 2
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        PUBSUB_REDIS_CHANNEL_TYPE="streams",
    )
    monkeypatch.setattr(limiter_module.RateLimit, "_instance_dict", {})
    observed: list[str] = []

    def external(stage: str) -> None:
        assert sessions
        assert all(session.closed and not session.in_transaction() for session in sessions)
        observed.append(stage)
        if failure == stage:
            raise RuntimeError("external failure")

    def reserve(*_args: object) -> QuotaCharge:
        external("quota")
        return unlimited()

    def redis_write(*_args: object) -> None:
        external("redis")

    monkeypatch.setattr(QuotaService, "reserve", reserve)
    monkeypatch.setattr(limiter_module.redis_client, "setex", redis_write)
    monkeypatch.setattr(limiter_module.redis_client, "exists", lambda _key: False)
    monkeypatch.setattr(limiter_module.redis_client, "hlen", lambda _key: 0)
    monkeypatch.setattr(limiter_module.redis_client, "hset", redis_write)
    monkeypatch.setattr(limiter_module.redis_client, "hdel", redis_write)
    queued: list[str] = []

    def enqueue(payload: str) -> None:
        external("enqueue")
        queued.append(payload)

    def retrieve_events(*_args: object, on_subscribe: Callable[[], None]) -> Generator[str, None, None]:
        # This assertion runs during preparation, before the returned stream is consumed.
        external("subscription-prepare")

        def events() -> Generator[str, None, None]:
            on_subscribe()
            yield from ()

        return events()

    monkeypatch.setattr(task_module.workflow_based_app_execution_task, "delay", enqueue)
    monkeypatch.setattr(WorkflowEventStream, "retrieve_events", retrieve_events)
    if failure:
        with Flask(__name__).app_context(), pytest.raises(RuntimeError, match="external failure"):
            gateway.generate(CONTEXT, "app-1", {}, root_node_id=None, workflow=None)
        assert queued == []
        assert observed == ["quota", "redis"]
    else:
        with Flask(__name__).app_context():
            stream = gateway.generate(CONTEXT, "app-1", {}, root_node_id=None, workflow=None)
            assert observed[0] == "quota"
            assert "redis" in observed
            assert observed[-1] == "subscription-prepare"
            assert not queued
            assert list(stream) == []
        assert len(queued) == 1
        payload = task_module.AppExecutionParams.model_validate_json(queued[0])
        assert (payload.tenant_id, payload.app_id, payload.app_mode) == ("tenant-1", "app-1", mode)
    assert all(session.closed and not session.in_transaction() for session in sessions)


def test_trigger_poll_runs_outside_database_session(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]], monkeypatch: pytest.MonkeyPatch
) -> None:
    gateway, sessions = runtime

    class Poller:
        def poll(self) -> TriggerDebugEvent:
            assert sessions
            assert all(session.closed for session in sessions)
            return TriggerDebugEvent(node_id="node", workflow_args={"inputs": {}})

    monkeypatch.setattr(module, "create_event_poller", lambda **_kwargs: Poller())
    result = gateway.poll_trigger(CONTEXT, "app-1", ["node"], single_node=False, select_all=False)
    assert result is not None
    assert result.node_id == "node"


def test_schedule_single_node_does_not_poll(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway, _ = runtime
    with sqlite_session_factory.begin() as session:
        workflow = session.scalar(select(Workflow).where(Workflow.version == "draft"))
        assert workflow is not None
        workflow.graph = json.dumps({"nodes": [{"id": "timer", "data": {"type": "trigger-schedule"}}], "edges": []})

    def unexpected(**_kwargs: object) -> None:
        pytest.fail("schedule single-step must not wait for an event")

    monkeypatch.setattr(module, "create_event_poller", unexpected)
    result = gateway.poll_trigger(CONTEXT, "app-1", ["timer"], single_node=True, select_all=False)
    assert result is not None
    assert result.workflow_args == {}


def test_node_response_materializes_actor_extras_and_offload_flags(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]], monkeypatch: pytest.MonkeyPatch
) -> None:
    gateway, sessions = runtime
    execution = WorkflowNodeExecutionModel(
        id="execution",
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node",
        node_type="start",
        created_by="account-1",
        created_by_role=CreatorUserRole.ACCOUNT,
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        inputs='{"query":"value"}',
        outputs="{}",
        execution_metadata=None,
        offload_data=[],
    )
    monkeypatch.setattr(gateway._workflows, "run_draft_workflow_node", lambda **_kwargs: execution)

    def extras(_execution: WorkflowNodeExecutionModel, *, tool_providers: ToolProviderIcons) -> dict[str, object]:
        assert tool_providers is gateway._runtime.tool_providers
        assert all(session.closed for session in sessions)
        return {}

    monkeypatch.setattr("services.workflow.runtime_gateway.node_execution_extras", extras)
    result = gateway.run_node(CONTEXT, "app-1", "node", {"inputs": {}}, include_details=True, workflow=None)
    assert all(session.closed for session in sessions)
    response = WorkflowRunNodeExecutionResponse.model_validate(result).model_dump(mode="json")
    assert response["inputs"] == {"query": "value"}
    assert response["created_by_account"]["id"] == "account-1"
    assert response["extras"] == {}
    assert response["inputs_truncated"] is False
    raw = gateway.run_node(CONTEXT, "app-1", "node", {"inputs": {}}, include_details=False, workflow=None)
    assert raw["inputs"] == '{"query":"value"}'
    assert raw["offload_data"] == []
    assert "created_by_account" not in raw


def test_trigger_response_preserves_all_offload_types(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway, sessions = runtime
    records = [
        WorkflowNodeExecutionOffload(
            tenant_id="tenant-1",
            app_id="app-1",
            node_execution_id="execution",
            type_=kind,
            file_id=f"file-{kind.value}",
        )
        for kind in ExecutionOffLoadType
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all(records)
    # Query and detach actual ORM rows so column names and attribute names differ
    # exactly as in the runtime, without resolving file relationships.
    with sqlite_session_factory() as session:
        offloads = list(session.scalars(select(WorkflowNodeExecutionOffload)))
    execution = WorkflowNodeExecutionModel(id="execution", offload_data=offloads)
    raw = gateway._execution(execution, include_details=False)
    assert {item["type_"] for item in raw["offload_data"]} == {"inputs", "outputs", "process_data"}
    assert raw["offload_data"] == [
        {
            "id": item.id,
            "tenant_id": "tenant-1",
            "app_id": "app-1",
            "node_execution_id": "execution",
            "type_": item.type_.value,
            "file_id": item.file_id,
            "created_at": item.created_at,
        }
        for item in offloads
    ]
    assert all(session.closed for session in sessions)


def test_file_config_and_access_controller_are_reused(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]], monkeypatch: pytest.MonkeyPatch
) -> None:
    gateway, _ = runtime
    workflow = make_workflow()
    monkeypatch.setattr(module.FileUploadConfigManager, "convert", lambda *_args, **_kwargs: None)
    assert gateway._files(workflow, [{"id": "file"}]) == []
    config = object()
    monkeypatch.setattr(module.FileUploadConfigManager, "convert", lambda *_args, **_kwargs: config)
    received = []

    def build(**kwargs: object) -> list[File]:
        received.append(kwargs)
        return []

    monkeypatch.setattr(module.file_factory, "build_from_mappings", build)
    gateway._files(workflow, [{"id": "file"}])
    assert received == [
        {
            "mappings": [{"id": "file"}],
            "tenant_id": "tenant-1",
            "config": config,
            "access_controller": gateway._file_access,
            "sessions": gateway._sessions,
        }
    ]


@pytest.mark.parametrize("concurrent_change", ["configuration", "delete-node"])
def test_trigger_consumption_and_real_execution_share_detached_revision(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    concurrent_change: str,
) -> None:
    gateway, sessions = runtime

    graph: dict[str, object] = {
        "nodes": [
            {
                "id": "trigger",
                "data": {
                    "type": "trigger-plugin",
                    "title": "Subscription A",
                    "plugin_id": "test/trigger",
                    "provider_id": "test/trigger/provider",
                    "subscription_id": "subscription-A",
                    "event_name": "event-A",
                    "plugin_unique_identifier": "test/trigger:1",
                },
            }
        ],
        "edges": [],
    }
    with sqlite_session_factory.begin() as session:
        draft = session.scalar(select(Workflow).where(Workflow.version == "draft"))
        assert draft is not None
        draft.graph = json.dumps(graph)

    class ForbiddenDatabase:
        @property
        def engine(self) -> None:
            pytest.fail("single-step execution must use the injected session factory")

    monkeypatch.setattr(workflow_module, "db", ForbiddenDatabase())

    class Poller:
        def poll(self) -> TriggerDebugEvent:
            assert sessions
            assert all(session.closed for session in sessions)
            with sqlite_session_factory.begin() as session:
                draft = session.scalar(select(Workflow).where(Workflow.version == "draft"))
                assert draft is not None
                changed = json.loads(draft.graph)
                if concurrent_change == "delete-node":
                    changed["nodes"] = []
                else:
                    changed["nodes"][0]["data"].update(
                        subscription_id="subscription-B", event_name="event-B", title="Subscription B"
                    )
                draft.graph = json.dumps(changed)
            return TriggerDebugEvent(node_id="trigger", workflow_args={"inputs": {"payload": "from-A"}})

    def poller(*, draft_workflow: Workflow, **_kwargs: object) -> Poller:
        assert draft_workflow.graph_dict["nodes"][0]["data"]["subscription_id"] == "subscription-A"
        return Poller()

    monkeypatch.setattr(module, "create_event_poller", poller)
    service = ConsoleWorkflowService(
        conversion=create_autospec(WorkflowConversion, instance=True, spec_set=True),
        agent_services=WorkflowAgentPublishService,
        drafts=create_autospec(WorkflowDraftService, instance=True, spec_set=True),
        definitions=create_autospec(WorkflowDefinitions, instance=True, spec_set=True),
        lifecycle=create_autospec(WorkflowDefinitionLifecycle, instance=True, spec_set=True),
        runtime=gateway,
        apps=create_autospec(WorkflowAppLookup, instance=True, spec_set=True),
        presence=create_autospec(WorkflowPresence, instance=True, spec_set=True),
        access=create_autospec(WorkflowAccess, instance=True, spec_set=True),
    )
    result = service.trigger(CONTEXT, "app-1", ["trigger"], single_node=True, select_all=False)
    assert isinstance(result, dict)
    assert result["status"] == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result["title"] == "Subscription A"
    assert json.loads(result["outputs"])["payload"] == "from-A"
    assert json.loads(result["execution_metadata"])["trigger_info"]["event_name"] == "event-A"
    assert all(session.closed for session in sessions)
    with sqlite_session_factory() as session:
        execution = session.get(WorkflowNodeExecutionModel, result["id"])
        assert execution is not None
        assert execution.title == "Subscription A"
        variables = session.scalars(
            select(WorkflowDraftVariable).where(WorkflowDraftVariable.node_id == "trigger")
        ).all()
        assert any(variable.name == "payload" and variable.get_value().value == "from-A" for variable in variables)


def test_single_node_reads_offloaded_outputs_after_repository_session_closes(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway, sessions = runtime
    content = "complete output " * 1000
    objects: dict[str, bytes] = {}
    reads: list[str] = []
    apply_config_overrides(
        monkeypatch,
        WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=256,
        WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH=128,
    )
    monkeypatch.setattr(storage, "save", lambda key, data: objects.__setitem__(key, data))

    def load(key: str) -> bytes:
        assert sessions
        assert all(session.closed and not session.in_transaction() for session in sessions)
        reads.append(key)
        return objects[key]

    class IsolatedStorage:
        def load(self, filename: str) -> bytes:
            return load(filename)

        def delete(self, filename: str) -> None:
            objects.pop(filename, None)

    def unexpected_global_read(_key: str) -> bytes:
        pytest.fail("single-node execution must use the injected output reader")

    monkeypatch.setattr(storage, "load", unexpected_global_read)
    gateway._variables = WorkflowVariableService(
        repository=WorkflowDraftVariableRepository(sessions=sqlite_session_factory),
        files=FileService(sqlite_session_factory),
        executions=DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(sqlite_session_factory),
        storage=IsolatedStorage(),
        defer_file_cleanup=lambda _ids: None,
    )

    class OffloadedExecutionRepository(SQLAlchemyWorkflowNodeExecutionRepository):
        @override
        def save(self, execution: WorkflowNodeExecution) -> None:
            super().save(execution)
            # Keep the real persistence and offload implementation. The reader must
            # support a writer that stores the execution payload out of line.
            self.save_execution_data(execution)

    monkeypatch.setattr(
        workflow_module.DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        lambda **kwargs: OffloadedExecutionRepository(**kwargs),
    )
    with sqlite_session_factory.begin() as session:
        draft = session.scalar(select(Workflow).where(Workflow.version == "draft"))
        assert draft is not None
        draft.graph = json.dumps(
            {
                "nodes": [
                    {
                        "id": "start",
                        "data": {
                            "type": "start",
                            "title": "Start",
                            "variables": [
                                {
                                    "variable": "payload",
                                    "label": "Payload",
                                    "type": "text-input",
                                    "max_length": 40000,
                                }
                            ],
                        },
                    }
                ],
                "edges": [],
            }
        )
    response = gateway.run_node(
        CONTEXT, "app-1", "start", {"inputs": {"payload": content}}, include_details=True, workflow=None
    )
    assert response["status"] == "succeeded"
    assert response["outputs_truncated"] is True
    assert reads
    with sqlite_session_factory() as session:
        variable = session.scalar(
            select(WorkflowDraftVariable).where(
                WorkflowDraftVariable.node_id == "start",
                WorkflowDraftVariable.name == "payload",
            )
        )
        assert variable is not None
        assert variable.get_value().value == content


def test_real_start_and_branch_execution_share_injected_variable_and_execution_storage(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway, sessions = runtime
    with sqlite_session_factory.begin() as session:
        draft = session.scalar(select(Workflow).where(Workflow.version == "draft"))
        assert draft is not None
        draft.graph = json.dumps(
            {
                "nodes": [
                    {
                        "id": "start",
                        "data": {
                            "type": "start",
                            "title": "Start",
                            "variables": [
                                {
                                    "variable": "payload",
                                    "label": "Payload",
                                    "type": "text-input",
                                    "required": True,
                                    "max_length": 100,
                                }
                            ],
                        },
                    },
                    {
                        "id": "branch",
                        "data": {
                            "type": "if-else",
                            "title": "Branch",
                            "cases": [
                                {
                                    "case_id": "matches",
                                    "logical_operator": "and",
                                    "conditions": [
                                        {
                                            "id": "condition",
                                            "varType": "string",
                                            "variable_selector": ["start", "payload"],
                                            "comparison_operator": "is",
                                            "value": "stored value",
                                        }
                                    ],
                                }
                            ],
                        },
                    },
                ],
                "edges": [],
            }
        )

    class ForbiddenDatabase:
        @property
        def engine(self) -> None:
            pytest.fail("execution must not fall back to global db.engine")

    monkeypatch.setattr(workflow_module, "db", ForbiddenDatabase())
    start = gateway.run_node(
        CONTEXT, "app-1", "start", {"inputs": {"payload": "stored value"}}, include_details=False, workflow=None
    )
    assert start["status"] == "succeeded"
    branch = gateway.run_node(CONTEXT, "app-1", "branch", {}, include_details=False, workflow=None)
    assert branch["status"] == "succeeded"
    assert json.loads(branch["outputs"]) == {"result": True, "selected_case_id": "matches"}
    last_run = gateway.last_run(CONTEXT, "app-1", "branch")
    assert last_run is not None
    assert last_run["id"] == branch["id"]
    assert all(session.closed for session in sessions)


@pytest.mark.parametrize("select_all", [False, True], ids=["full-execution", "run-all"])
@pytest.mark.parametrize("concurrent_change", ["configuration", "delete-node"])
def test_full_trigger_execution_preserves_revision_through_task_and_worker(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    select_all: bool,
    concurrent_change: str,
    *,
    workflow_variables: WorkflowExecutionVariables,
) -> None:
    from core.app.apps import base_app_queue_manager
    from core.app.features.rate_limiting.rate_limit import RateLimit
    from core.ops.ops_trace_manager import TraceQueueManager
    from services.workflow.execution.adapters.response_stream import WorkflowEventStream
    from services.workflow.execution.adapters.workflow import app_generator as generator_module
    from services.workflow.execution.adapters.workflow.app_generator import WorkflowAppGenerator
    from tasks.app_generate import workflow_execute_task as task_module

    gateway, sessions = runtime
    gateway._generator = AppGenerateService
    original_graph: dict[str, object] = {
        "nodes": [
            {
                "id": "trigger",
                "data": {
                    "type": "trigger-plugin",
                    "title": "Subscription A",
                    "subscription_id": "subscription-A",
                },
            }
        ],
        "edges": [],
    }
    with sqlite_session_factory.begin() as session:
        draft = session.scalar(select(Workflow).where(Workflow.version == "draft"))
        assert draft is not None
        draft.graph = json.dumps(original_graph)

    class Poller:
        def poll(self) -> TriggerDebugEvent:
            assert all(session.closed for session in sessions)
            with sqlite_session_factory.begin() as session:
                draft = session.scalar(select(Workflow).where(Workflow.version == "draft"))
                assert draft is not None
                changed = json.loads(draft.graph)
                if concurrent_change == "delete-node":
                    changed["nodes"] = []
                else:
                    changed["nodes"][0]["data"]["subscription_id"] = "subscription-B"
                draft.graph = json.dumps(changed)
            return TriggerDebugEvent(node_id="trigger", workflow_args={"inputs": {"payload": "from-A"}})

    def poller(*, draft_workflow: Workflow, **_kwargs: object) -> Poller:
        assert draft_workflow.graph_dict == original_graph
        return Poller()

    def select_events(*, draft_workflow: Workflow, **kwargs: object) -> TriggerDebugEvent:
        return poller(draft_workflow=draft_workflow, **kwargs).poll()

    monkeypatch.setattr(module, "create_event_poller", poller)
    monkeypatch.setattr(module, "select_trigger_debug_events", select_events)
    apply_config_overrides(monkeypatch, PUBSUB_REDIS_CHANNEL_TYPE="streams")
    limiter = create_autospec(RateLimit, instance=True, spec_set=True)
    limiter.generate.side_effect = lambda response, *_args: response

    def guardrails(*, action: Callable[[RateLimit, str], object], **_kwargs: object) -> object:
        return action(limiter, "request")

    monkeypatch.setattr(AppGenerateService, "_run_with_guardrails", guardrails)
    queued: list[str] = []
    monkeypatch.setattr(task_module.workflow_based_app_execution_task, "delay", queued.append)

    def retrieve_events(*_args: object, on_subscribe: Callable[[], None]) -> Generator[str, None, None]:
        assert all(session.closed for session in sessions)
        on_subscribe()
        yield from ()

    monkeypatch.setattr(WorkflowEventStream, "retrieve_events", retrieve_events)
    service = ConsoleWorkflowService(
        conversion=create_autospec(WorkflowConversion, instance=True, spec_set=True),
        agent_services=WorkflowAgentPublishService,
        drafts=create_autospec(WorkflowDraftService, instance=True, spec_set=True),
        definitions=create_autospec(WorkflowDefinitions, instance=True, spec_set=True),
        lifecycle=create_autospec(WorkflowDefinitionLifecycle, instance=True, spec_set=True),
        runtime=gateway,
        apps=create_autospec(WorkflowAppLookup, instance=True, spec_set=True),
        presence=create_autospec(WorkflowPresence, instance=True, spec_set=True),
        access=create_autospec(WorkflowAccess, instance=True, spec_set=True),
    )
    with Flask(__name__).app_context():
        response = service.trigger(CONTEXT, "app-1", ["trigger"], single_node=False, select_all=select_all)
        assert isinstance(response, Generator)
        assert list(response) == []
    assert len(queued) == 1
    params = task_module.AppExecutionParams.model_validate_json(queued[0])
    assert params.workflow_snapshot is not None
    assert json.loads(params.workflow_snapshot.graph) == original_graph

    # Leave the real task runner and generator/thread boundary intact. Only external
    # transport, tracing and graph execution are replaced with local observers.
    observed: list[tuple[dict[str, object], dict[str, object], str | None]] = []

    class GraphRunner:
        def __init__(
            self,
            *,
            workflow: Workflow,
            application_generate_entity: WorkflowAppGenerateEntity,
            root_node_id: str | None,
            **_kwargs: object,
        ) -> None:
            observed.append((dict(workflow.graph_dict), dict(application_generate_entity.inputs), root_node_id))

        def run(self) -> None:
            pass

    def empty_response(*_args: object, **_kwargs: object) -> Generator[str, None, None]:
        yield from ()

    monkeypatch.setattr(base_app_queue_manager.redis_client, "setex", lambda *_args, **_kwargs: None)
    trace_manager = create_autospec(TraceQueueManager, instance=True, spec_set=True)
    monkeypatch.setattr(generator_module, "TraceQueueManager", lambda **_kwargs: trace_manager)
    monkeypatch.setattr(generator_module, "WorkflowAppRunner", GraphRunner)
    monkeypatch.setattr(WorkflowAppGenerator, "_handle_response", empty_response)
    monkeypatch.setattr(task_module, "_publish_streaming_response", lambda response, *_args, **_kwargs: list(response))
    with Flask(__name__).app_context():
        task_module._AppRunner(gateway._sessions, params, variables=workflow_variables).run()
    assert observed == [(original_graph, {"payload": "from-A"}, "trigger")]
    assert all(session.closed for session in sessions)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("workflow_snapshot.tenant_id", "other-tenant"),
        ("workflow_snapshot.app_id", "other-app"),
        ("workflow_snapshot.id", "other-workflow"),
        ("tenant_id", "other-tenant"),
        ("app_id", "other-app"),
        ("app_mode", "advanced-chat"),
        ("invoke_from", "service-api"),
    ],
)
def test_task_rejects_snapshot_outside_its_debugger_owner(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    field: str,
    value: str,
    *,
    workflow_variables: WorkflowExecutionVariables,
) -> None:
    from core.app.entities.app_invoke_entities import InvokeFrom
    from tasks.app_generate.workflow_execute_task import AppExecutionParams, _AppRunner

    gateway, sessions = runtime
    app, actor, draft = gateway._draft(CONTEXT, "app-1", "Workflow not found")
    params = AppExecutionParams.new(
        app_model=app,
        workflow=draft,
        user=actor,
        args={"inputs": {}},
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_snapshot=module.workflow_snapshot(draft),
    )
    payload = json.loads(params.model_dump_json())
    if field.startswith("workflow_snapshot."):
        payload["workflow_snapshot"][field.split(".")[1]] = value
    else:
        payload[field] = value
    decoded = AppExecutionParams.model_validate_json(json.dumps(payload))
    with pytest.raises(ValueError, match="snapshot does not belong"):
        _AppRunner(gateway._sessions, decoded, variables=workflow_variables).run()
    assert all(session.closed for session in sessions)


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
@pytest.mark.parametrize("entry", ["iteration", "loop"])
def test_container_debug_prepares_database_records_before_redis(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode,
    entry: str,
) -> None:
    import threading

    from core.app.apps import base_app_queue_manager
    from models.model import App, Conversation, Message
    from services.workflow.execution.adapters.chatflow.app_generator import AdvancedChatAppGenerator
    from services.workflow.execution.adapters.workflow.app_generator import WorkflowAppGenerator

    gateway, sessions = runtime
    gateway._generator = AppGenerateService
    with sqlite_session_factory.begin() as session:
        app = session.get(App, "app-1")
        assert app is not None
        app.mode = mode
    writes: list[str] = []

    def setex(key: str, *_args: object) -> None:
        assert sessions
        assert all(session.closed and not session.in_transaction() for session in sessions)
        if mode == AppMode.ADVANCED_CHAT:
            with sqlite_session_factory() as session:
                assert session.scalar(select(Conversation.id)) is not None
                assert session.scalar(select(Message.id)) is not None
        writes.append(key)

    def response(*_args: object, **_kwargs: object) -> Generator[str, None, None]:
        yield from ()

    def unexpected_gateway_session() -> NoReturn:
        raise AssertionError("Single-node generation must use the repositories' sessions")

    monkeypatch.setattr(gateway, "_sessions", unexpected_gateway_session)

    # Leave actual generator initialization, record creation and queue initialization intact.
    monkeypatch.setattr(base_app_queue_manager.redis_client, "setex", setex)
    monkeypatch.setattr(threading.Thread, "start", lambda _thread: None)
    monkeypatch.setattr(threading.Thread, "join", lambda _thread, **_kwargs: None)
    monkeypatch.setattr(WorkflowAppGenerator, "_handle_response", response)
    monkeypatch.setattr(AdvancedChatAppGenerator, "_handle_advanced_chat_response", response)
    with Flask(__name__).app_context():
        result = getattr(gateway, entry)(CONTEXT, "app-1", "container", {"item": "value"})
        list(result)
    assert writes
    assert all(session.closed and not session.in_transaction() for session in sessions)


@pytest.fixture
def agent_runtime(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
) -> tuple[WorkflowRuntimeGateway, list[RecordingSession]]:
    from enums.agent import WorkflowAgentBindingType
    from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource, AgentStatus, WorkflowAgentNodeBinding
    from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig

    with sqlite_session_factory.begin() as session:
        draft = session.scalar(select(Workflow).where(Workflow.version == "draft"))
        assert draft is not None
        draft.graph = json.dumps(
            {
                "nodes": [
                    {"id": "trigger", "data": {"type": "trigger-plugin"}},
                    {"id": "agent-node", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}},
                ],
                "edges": [],
            }
        )
        session.add(
            Agent(
                id="agent-1",
                tenant_id="tenant-1",
                name="Inline",
                scope=AgentScope.WORKFLOW_ONLY,
                source=AgentSource.WORKFLOW,
                status=AgentStatus.ACTIVE,
            )
        )
        for number in (1, 2):
            session.add(
                AgentConfigSnapshot(
                    id=f"soul-{number}",
                    tenant_id="tenant-1",
                    agent_id="agent-1",
                    version=number,
                    config_snapshot=AgentSoulConfig(prompt={"system_prompt": f"Soul {number}"}),
                )
            )
        session.add(
            WorkflowAgentNodeBinding(
                id="binding",
                tenant_id="tenant-1",
                app_id="app-1",
                workflow_id=draft.id,
                workflow_version="draft",
                node_id="agent-node",
                agent_id="agent-1",
                binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                current_snapshot_id="soul-1",
                node_job_config=WorkflowNodeJobConfig(workflow_prompt="Job A"),
            )
        )

    return runtime


@pytest.mark.parametrize("change", ["delete", "replace"])
@pytest.mark.parametrize("select_all", [False, True])
def test_trigger_pins_agent_job_and_soul_until_worker_finishes(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    change: str,
    select_all: bool,
) -> None:
    from core.app.features.rate_limiting.rate_limit import RateLimit
    from graphon.enums import WorkflowExecutionStatus
    from models.agent import Agent, AgentStatus, WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from models.workflow import WorkflowRun
    from services.workflow.execution.adapters.response_stream import WorkflowEventStream
    from tasks.app_generate import workflow_execute_task as task_module

    gateway, sessions = agent_runtime
    gateway._generator = AppGenerateService

    class Poller:
        def poll(self) -> TriggerDebugEvent:
            assert sessions
            assert all(session.closed for session in sessions)
            with sqlite_session_factory.begin() as session:
                binding = session.get(WorkflowAgentNodeBinding, "binding")
                assert binding is not None
                if change == "delete":
                    session.delete(binding)
                    draft = session.get(Workflow, binding.workflow_id)
                    assert draft is not None
                    draft.graph = '{"nodes": [], "edges": []}'
                else:
                    binding.current_snapshot_id = "soul-2"
                    binding.node_job_config = WorkflowNodeJobConfig(workflow_prompt="Job B")
                session.flush()
                assert (
                    WorkflowAgentRetirementRepository.archive_unowned(
                        session=session, tenant_id="tenant-1", agent_ids=["agent-1"], account_id="account-1"
                    )
                    == []
                )
            return TriggerDebugEvent(node_id="trigger", workflow_args={"inputs": {"payload": "A"}})

    monkeypatch.setattr(module, "create_event_poller", lambda **_kwargs: Poller())
    monkeypatch.setattr(module, "select_trigger_debug_events", lambda **_kwargs: Poller().poll())
    apply_config_overrides(monkeypatch, PUBSUB_REDIS_CHANNEL_TYPE="streams")
    limiter = create_autospec(RateLimit, instance=True, spec_set=True)
    limiter.generate.side_effect = lambda response, *_args: response
    monkeypatch.setattr(
        AppGenerateService, "_run_with_guardrails", lambda *, action, **_kwargs: action(limiter, "request")
    )
    queued: list[str] = []
    monkeypatch.setattr(task_module.workflow_based_app_execution_task, "delay", queued.append)

    def events(*_args: object, on_subscribe: Callable[[], None]) -> Generator[str, None, None]:
        on_subscribe()
        yield from ()

    monkeypatch.setattr(WorkflowEventStream, "retrieve_events", events)
    with Flask(__name__).app_context():
        event_data = gateway.poll_trigger(CONTEXT, "app-1", ["trigger"], single_node=False, select_all=select_all)
        assert event_data is not None
        assert event_data.workflow.execution_id is not None
        list(
            gateway.generate(
                CONTEXT, "app-1", event_data.workflow_args, root_node_id="trigger", workflow=event_data.workflow
            )
        )
    params = task_module.AppExecutionParams.model_validate_json(queued[0])
    assert params.workflow_run_id == event_data.workflow.execution_id
    monkeypatch.setattr("services.agent.retirement_service.enqueue_agent_resource_collection", lambda **_kwargs: None)

    def run_app(_runner, *, workflow: Workflow, **_kwargs: object) -> Generator[str, None, None]:
        assert workflow.graph_dict["nodes"][1]["id"] == "agent-node"
        resolved = _runner._runtime.agent_bindings.resolve(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id=workflow.id,
            node_id="agent-node",
            workflow_run_id=params.workflow_run_id,
        )
        assert resolved.binding.node_job_config_dict["workflow_prompt"] == "Job A"
        assert resolved.snapshot.id == "soul-1"
        assert resolved.snapshot.config_snapshot_dict["prompt"]["system_prompt"] == "Soul 1"
        with sqlite_session_factory.begin() as session:
            run = session.get(WorkflowRun, params.workflow_run_id)
            assert run is not None
            run.status = WorkflowExecutionStatus.SUCCEEDED
        yield from ()

    monkeypatch.setattr(task_module._AppRunner, "_run_app", run_app)
    monkeypatch.setattr(task_module, "_publish_streaming_response", lambda response, *_args, **_kwargs: list(response))
    with Flask(__name__).app_context():
        task_module._AppRunner(gateway._sessions, params, variables=gateway._variables).run()
    with sqlite_session_factory() as session:
        agent = session.get(Agent, "agent-1")
        assert agent is not None
        assert agent.status == (AgentStatus.ARCHIVED if change == "delete" else AgentStatus.ACTIVE)
    assert all(session.closed and not session.in_transaction() for session in sessions)


@pytest.mark.parametrize("outcome", ["empty", "poll-error", "prepare-error"])
def test_trigger_cancels_reserved_agent_references_without_starting_execution(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    outcome: str,
) -> None:
    from models.agent import Agent, AgentStatus, WorkflowAgentNodeBinding
    from models.workflow import WorkflowRun

    gateway, sessions = agent_runtime
    gateway._generator = AppGenerateService
    monkeypatch.setattr("services.agent.retirement_service.enqueue_agent_resource_collection", lambda **_kwargs: None)

    class Poller:
        def poll(self) -> TriggerDebugEvent | None:
            assert sessions
            assert all(session.closed for session in sessions)
            with sqlite_session_factory.begin() as session:
                assert session.scalar(select(WorkflowRun.id)) is not None
                binding = session.get(WorkflowAgentNodeBinding, "binding")
                assert binding is not None
                session.delete(binding)
            if outcome == "poll-error":
                raise ValueError("poll failed")
            if outcome == "empty":
                return None
            return TriggerDebugEvent(node_id="trigger", workflow_args={"inputs": {}})

    def denied(**_kwargs: object) -> None:
        raise ValueError("prepare failed")

    monkeypatch.setattr(module, "create_event_poller", lambda **_kwargs: Poller())
    monkeypatch.setattr(AppGenerateService, "_run_with_guardrails", denied)
    if outcome == "empty":
        assert gateway.poll_trigger(CONTEXT, "app-1", ["trigger"], single_node=False, select_all=False) is None
    elif outcome == "poll-error":
        with pytest.raises(ValueError, match="poll failed"):
            gateway.poll_trigger(CONTEXT, "app-1", ["trigger"], single_node=False, select_all=False)
    else:
        event_data = gateway.poll_trigger(CONTEXT, "app-1", ["trigger"], single_node=False, select_all=False)
        assert event_data is not None
        with Flask(__name__).app_context(), pytest.raises(ValueError, match="prepare failed"):
            gateway.generate(CONTEXT, "app-1", {}, root_node_id="trigger", workflow=event_data.workflow)
    with sqlite_session_factory() as session:
        assert session.scalar(select(WorkflowRun.id)) is None
        agent = session.get(Agent, "agent-1")
        assert agent is not None
        assert agent.status == AgentStatus.ARCHIVED


def test_paused_trigger_keeps_agent_references_until_resumed_stream_finishes(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from graphon.entities import WorkflowStartReason
    from graphon.enums import WorkflowExecutionStatus
    from models.agent import Agent, AgentStatus, WorkflowAgentNodeBinding
    from models.workflow import WorkflowRun
    from services.workflow.execution.adapters.response_stream import WorkflowEventStream
    from tasks.app_generate.workflow_execute_task import _publish_streaming_response

    gateway, _ = agent_runtime
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    assert snapshot.execution_id is not None
    with sqlite_session_factory.begin() as session:
        binding = session.get(WorkflowAgentNodeBinding, "binding")
        assert binding is not None
        session.delete(binding)
    monkeypatch.setattr("services.agent.retirement_service.enqueue_agent_resource_collection", lambda **_kwargs: None)

    class Topic:
        def publish(self, _payload: bytes) -> None:
            pass

    monkeypatch.setattr(WorkflowEventStream, "get_response_topic", lambda *_args: Topic())
    for event_name, status in [
        ("workflow_paused", WorkflowExecutionStatus.PAUSED),
        ("workflow_finished", WorkflowExecutionStatus.SUCCEEDED),
    ]:
        _publish_streaming_response(
            (item for item in [{"event": event_name, "data": {"status": status.value}}]),
            snapshot.execution_id,
            AppMode.WORKFLOW,
            snapshot.id,
            {},
            WorkflowStartReason.RESUMPTION,
            sessions=gateway._sessions,
            tenant_id="tenant-1",
            app_id="app-1",
            agent_snapshot=True,
        )
        with sqlite_session_factory() as session:
            agent = session.get(Agent, "agent-1")
            run = session.get(WorkflowRun, snapshot.execution_id)
            assert agent is not None
            assert run is not None
            assert run.status == status
            assert agent.status == (
                AgentStatus.ACTIVE if status == WorkflowExecutionStatus.PAUSED else AgentStatus.ARCHIVED
            )


@pytest.mark.parametrize("channel_type", ["streams", "pubsub", "sharded"])
@pytest.mark.parametrize(
    "outcome",
    [
        "broker-error",
        "subscribe-error",
        "unopened",
        "response-unopened",
        "close-before-subscribe",
        "disconnect-after-enqueue",
        "error-after-enqueue",
        "complete",
    ],
)
def test_reserved_trigger_stream_owns_cleanup_until_enqueue(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    channel_type: str,
    outcome: str,
) -> None:
    from core.app.features.rate_limiting.rate_limit import RateLimit
    from graphon.enums import WorkflowExecutionStatus
    from libs.helper import compact_generate_response
    from models.agent import Agent, AgentStatus, WorkflowAgentNodeBinding
    from models.workflow import WorkflowRun
    from services.workflow.execution.adapters.response_stream import WorkflowEventStream
    from tasks.app_generate import workflow_execute_task as task_module

    gateway, sessions = agent_runtime
    gateway._generator = AppGenerateService
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    with sqlite_session_factory.begin() as session:
        binding = session.get(WorkflowAgentNodeBinding, "binding")
        assert binding is not None
        session.delete(binding)
        session.flush()
        assert (
            WorkflowAgentRetirementRepository.archive_unowned(
                session=session, tenant_id="tenant-1", agent_ids=["agent-1"], account_id="account-1"
            )
            == []
        )
    monkeypatch.setattr("services.agent.retirement_service.enqueue_agent_resource_collection", lambda **_kwargs: None)
    apply_config_overrides(monkeypatch, PUBSUB_REDIS_CHANNEL_TYPE=channel_type)

    def unexpected_timer(*_args: object, **_kwargs: object) -> None:
        pytest.fail("a reservation must not enqueue after the stream releases its references")

    monkeypatch.setattr("services.app_generate_service.threading.Timer", unexpected_timer)
    limiter = RateLimit("app-1", -1)
    monkeypatch.setattr(
        AppGenerateService,
        "_run_with_guardrails",
        lambda *, action, **_kwargs: action(limiter, RateLimit._UNLIMITED_REQUEST_ID),
    )
    queued: list[str] = []

    def enqueue(payload: str) -> None:
        assert all(session.closed for session in sessions)
        if outcome == "broker-error":
            raise RuntimeError("broker unavailable")
        queued.append(payload)

    monkeypatch.setattr(task_module.workflow_based_app_execution_task, "delay", enqueue)

    class Subscription:
        def __enter__(self) -> Self:
            if outcome == "subscribe-error":
                raise RuntimeError("subscription unavailable")
            return self

        def __exit__(self, *_args: object) -> None:
            pass

        def receive(self, **_kwargs: object) -> bytes:
            if outcome == "error-after-enqueue":
                raise RuntimeError("connection lost")
            if outcome == "complete":
                return b'{"event": "workflow_finished"}'
            return b'{"event": "workflow_started"}'

    class Topic:
        def as_subscriber(self) -> Self:
            return self

        def subscribe(self) -> Subscription:
            return Subscription()

    monkeypatch.setattr(WorkflowEventStream, "get_response_topic", lambda *_args: Topic())
    with Flask(__name__).test_request_context():
        stream = gateway.generate(CONTEXT, "app-1", {}, root_node_id="trigger", workflow=snapshot)
        assert isinstance(stream, Generator)
        assert not queued
        if outcome == "response-unopened":
            response = compact_generate_response(stream)
            response.close()
        elif outcome == "unopened":
            stream.close()
        elif outcome == "close-before-subscribe":
            assert next(stream) == "event: ping\n\n"
            stream.close()
        elif outcome == "disconnect-after-enqueue":
            next(stream)  # Initial ping precedes subscribing and dispatch.
            next(stream)
            stream.close()
        elif outcome == "complete":
            list(stream)
        else:
            with pytest.raises(RuntimeError, match="unavailable|connection lost"):
                list(stream)
        stream.close()  # Repeated closure must be harmless.

    enqueued = outcome in {"disconnect-after-enqueue", "error-after-enqueue", "complete"}
    assert len(queued) == int(enqueued)
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        agent = session.get(Agent, "agent-1")
        assert agent is not None
        if enqueued:
            assert run is not None
            assert run.status == WorkflowExecutionStatus.RUNNING
            assert agent.status == AgentStatus.ACTIVE
        else:
            assert run is None
            assert agent.status == AgentStatus.ARCHIVED
    assert all(session.closed for session in sessions)


@pytest.mark.parametrize("other_execution", [None, "running", "paused"])
def test_global_timeout_retires_paused_trigger_agent_after_last_execution(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    other_execution: str | None,
) -> None:
    from datetime import timedelta
    from types import SimpleNamespace

    from enums.human_input import HumanInputFormKind, HumanInputFormStatus
    from graphon.enums import WorkflowExecutionStatus
    from libs.datetime_utils import naive_utc_now
    from models.agent import (
        Agent,
        AgentHomeSnapshot,
        AgentStatus,
        AgentWorkingResourceStatus,
        WorkflowAgentNodeBinding,
    )
    from models.human_input import HumanInputForm
    from models.workflow import WorkflowRun
    from tasks import human_input_timeout_tasks as timeout_module

    gateway, sessions = agent_runtime
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    if other_execution is not None:
        _, other = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
        with sqlite_session_factory.begin() as session:
            other_run = session.get(WorkflowRun, other.execution_id)
            assert other_run is not None
            other_run.status = WorkflowExecutionStatus(other_execution)
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        binding = session.get(WorkflowAgentNodeBinding, "binding")
        assert run is not None
        assert binding is not None
        run.status = WorkflowExecutionStatus.PAUSED
        session.delete(binding)
        session.add(
            AgentHomeSnapshot(
                id="home-1",
                tenant_id="tenant-1",
                agent_id="agent-1",
                snapshot_ref="home-ref",
                status=AgentWorkingResourceStatus.ACTIVE,
            )
        )
        session.add(
            HumanInputForm(
                id="timeout-form",
                tenant_id="tenant-1",
                app_id="app-1",
                workflow_run_id=run.id,
                node_id="agent-node",
                form_kind=HumanInputFormKind.RUNTIME,
                form_definition='{"form_content": "", "rendered_content": ""}',
                rendered_content="",
                status=HumanInputFormStatus.WAITING,
                created_at=now - timedelta(hours=2),
                expiration_time=now + timedelta(hours=1),
            )
        )
        assert session.scalar(select(WorkflowAgentNodeBinding.agent_id)) == "agent-1"
    monkeypatch.setattr(timeout_module, "db", SimpleNamespace(engine=sqlite_session_factory.kw["bind"]))
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=3600)
    collector = Mock()
    monkeypatch.setattr("tasks.collect_agent_resources_task.collect_agent_resources.delay", collector)

    timeout_module.check_and_handle_human_input_timeouts()

    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        agent = session.get(Agent, "agent-1")
        home = session.get(AgentHomeSnapshot, "home-1")
        form = session.get(HumanInputForm, "timeout-form")
        assert run is not None
        assert agent is not None
        assert home is not None
        assert form is not None
        assert run.status == WorkflowExecutionStatus.STOPPED
        assert form.status == HumanInputFormStatus.EXPIRED
        assert run.finished_at is not None
        if other_execution is None:
            assert agent.status == AgentStatus.ARCHIVED
            assert home.status == AgentWorkingResourceStatus.RETIRED
            collector.assert_called_once()
            assert collector.call_args.kwargs["purge_agent_ids"] == ["agent-1"]
            assert collector.call_args.kwargs["home_snapshot_ids"] == ["home-1"]
        else:
            assert agent.status == AgentStatus.ACTIVE
            assert home.status == AgentWorkingResourceStatus.ACTIVE
            collector.assert_not_called()
    assert all(session.closed for session in sessions)


def test_running_lease_renews_and_fences_dead_workers(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from datetime import timedelta

    from libs.datetime_utils import naive_utc_now
    from models.workflow import WorkflowRun
    from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
    from repositories.workflow.execution_write_repository import save_workflow_run

    gateway, _ = agent_runtime
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    assert snapshot.execution_id is not None
    now = naive_utc_now()
    timeout = timedelta(seconds=dify_config.WORKFLOW_DEBUG_RESERVATION_TIMEOUT)
    repository = WorkflowDebugReservationRepository(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        assert run is not None
        WorkflowDebugReservationRepository.claim(session, run, now)
    # A run can outlive its original startup deadline while its worker renews.
    for _ in range(4):
        now += timeout / 2
        assert repository.renew(
            tenant_id=snapshot.tenant_id,
            app_id=snapshot.app_id,
            workflow_id=snapshot.id,
            execution_id=snapshot.execution_id,
            now=now,
        )
        assert repository.pending_batch(now, limit=100) == []
        assert repository.expire(snapshot.execution_id, now) is None
    with sqlite_session_factory() as session:
        stale_start = session.get(WorkflowRun, snapshot.execution_id)
        assert stale_start is not None
        session.expunge(stale_start)
    # Simulate process death: no more heartbeats, even if no Celery terminal task arrives.
    now += timedelta(days=365)
    assert [item.execution_id for item in repository.pending_batch(now, limit=100)] == [snapshot.execution_id]
    assert (
        repository.renew(
            tenant_id=snapshot.tenant_id,
            app_id=snapshot.app_id,
            workflow_id=snapshot.id,
            execution_id=snapshot.execution_id,
            now=now,
        )
        is False
    )
    assert repository.expire(snapshot.execution_id, now) is not None
    with sqlite_session_factory.begin() as session:
        assert save_workflow_run(session, stale_start) is False
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        reservation = debug_lease(session, snapshot.execution_id)
        assert run is not None
        assert run.status.value == "failed"
        assert run.error == "Trigger debug worker lease expired"
        # Cleanup retry evidence survives the terminal transition.
        assert reservation is not None


def test_paused_debug_lease_is_protected_and_refreshed_atomically_on_resume(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from datetime import timedelta

    from graphon.enums import WorkflowExecutionStatus
    from libs.datetime_utils import naive_utc_now
    from models.workflow import WorkflowPause, WorkflowRun
    from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
    from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository

    gateway, _ = agent_runtime
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    assert snapshot.execution_id is not None
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        lease = debug_lease(session, snapshot.execution_id)
        assert run is not None
        assert lease is not None
        WorkflowDebugReservationRepository.claim(session, run, now)
        run.status = WorkflowExecutionStatus.PAUSED
        set_debug_deadline(session, snapshot.execution_id, now - timedelta(days=365))
        session.add(WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="pause"))
    reservations = WorkflowDebugReservationRepository(sqlite_session_factory)
    assert reservations.pending_batch(now + timedelta(days=365), limit=100) == []
    assert reservations.expire(snapshot.execution_id, now) is None
    runs = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    pause = runs.get_workflow_pause(snapshot.execution_id)
    assert pause is not None
    runs.resume_workflow_pause(snapshot.execution_id, pause)
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        lease = debug_lease(session, snapshot.execution_id)
        assert run is not None
        assert lease is not None
        assert run.status == WorkflowExecutionStatus.RUNNING
        assert lease.expires_at is not None
        assert lease.expires_at > now
    assert reservations.expire(snapshot.execution_id, now) is None


@pytest.mark.parametrize("failed_row", ["reservation", "reference"])
def test_reservation_and_execution_owners_roll_back_together(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    failed_row: str,
) -> None:
    from models.workflow import WorkflowRun

    gateway, _ = agent_runtime
    from models.agent import WorkflowAgentNodeBinding

    row_type = WorkflowRun if failed_row == "reservation" else WorkflowAgentNodeBinding

    def fail(session: Session, _context: object, _instances: object) -> None:
        if any(isinstance(row, row_type) for row in session.new):
            raise RuntimeError("reservation persistence failed")

    event.listen(gateway._reservations._sessions, "before_flush", fail)
    try:
        with pytest.raises(RuntimeError, match="reservation persistence failed"):
            gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    finally:
        event.remove(gateway._reservations._sessions, "before_flush", fail)
    with sqlite_session_factory() as session:
        assert session.scalar(select(WorkflowRun)) is None
        assert (
            session.scalar(
                select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_version == "execution")
            )
            is None
        )


@pytest.mark.parametrize("cleanup_fails", [True, False])
def test_terminal_notification_survives_cleanup_dispatch_failure(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    cleanup_fails: bool,
) -> None:
    from graphon.entities import WorkflowStartReason
    from graphon.enums import WorkflowExecutionStatus
    from models.agent import Agent, AgentStatus, WorkflowAgentNodeBinding
    from models.workflow import WorkflowRun
    from services.agent.retirement_service import WorkflowAgentRetirementService
    from services.workflow.execution.adapters.response_stream import WorkflowEventStream
    from tasks.app_generate.workflow_execute_task import _publish_streaming_response

    gateway, _ = agent_runtime
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    assert snapshot.execution_id is not None
    with sqlite_session_factory.begin() as session:
        binding = session.get(WorkflowAgentNodeBinding, "binding")
        assert binding is not None
        session.delete(binding)
    received: list[dict[str, object]] = []
    attempted: list[set[str]] = []

    class Topic:
        def publish(self, payload: bytes) -> None:
            with sqlite_session_factory() as session:
                run = session.get(WorkflowRun, snapshot.execution_id)
                assert run is not None
                assert run.status == WorkflowExecutionStatus.SUCCEEDED
            received.append(json.loads(payload))

    def dispatch(*, purge_agent_ids: Iterable[str], **_kwargs: object) -> None:
        assert received == [{"event": "workflow_finished", "data": {"status": "succeeded"}}]
        attempted.append(set(purge_agent_ids))
        if cleanup_fails and len(attempted) == 1:
            raise RuntimeError("resource broker unavailable")

    monkeypatch.setattr(WorkflowEventStream, "get_response_topic", lambda *_args: Topic())
    monkeypatch.setattr("services.agent.retirement_service.enqueue_agent_resource_collection", dispatch)
    _publish_streaming_response(
        (item for item in [{"event": "workflow_finished", "data": {"status": "succeeded"}}]),
        snapshot.execution_id,
        AppMode.WORKFLOW,
        snapshot.id,
        {},
        WorkflowStartReason.RESUMPTION,
        sessions=gateway._sessions,
        tenant_id="tenant-1",
        app_id="app-1",
        agent_snapshot=True,
    )
    assert len(received) == 1
    assert attempted == [{"agent-1"}]
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        agent = session.get(Agent, "agent-1")
        assert run is not None
        assert run.status == WorkflowExecutionStatus.SUCCEEDED
        assert agent is not None
        assert agent.status == AgentStatus.ARCHIVED
        assert (debug_lease(session, snapshot.execution_id) is not None) == cleanup_fails
    if cleanup_fails:
        # The real entry point must recover candidates without callers retaining Agent IDs.
        WorkflowAgentRetirementService.finish_execution(
            sessions=gateway._sessions,
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id=snapshot.id,
            execution_id=snapshot.execution_id,
            account_id=None,
        )
        assert attempted == [{"agent-1"}, {"agent-1"}]
        with sqlite_session_factory() as session:
            assert debug_lease(session, snapshot.execution_id) is None
        assert len(received) == 1


@pytest.mark.parametrize("outcome", ["succeeded", "failed", "stopped", "partial-succeeded"])
@pytest.mark.parametrize("cleanup_fails", [False, True])
def test_completed_debug_redelivery_replays_persisted_outcome_without_execution_or_cleanup(
    agent_runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    outcome: str,
    cleanup_fails: bool,
) -> None:
    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.app.entities.task_entities import WorkflowFinishStreamResponse
    from graphon.enums import WorkflowExecutionStatus
    from models.agent import Agent, AgentStatus, WorkflowAgentNodeBinding
    from models.workflow import WorkflowRun
    from tasks.app_generate import workflow_execute_task as task_module

    status = WorkflowExecutionStatus(outcome)
    gateway, sessions = agent_runtime
    _, snapshot = gateway._reservations.reserve_trigger_debug(CONTEXT, "app-1")
    assert snapshot.execution_id is not None
    app, actor, workflow = gateway._definitions.debug_context(CONTEXT, "app-1", workflow_id=None, snapshot=snapshot)
    params = task_module.AppExecutionParams.new(
        app_model=app,
        workflow=workflow,
        user=actor,
        args={},
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_run_id=snapshot.execution_id,
        workflow_snapshot=snapshot,
    )
    with sqlite_session_factory.begin() as session:
        binding = session.get(WorkflowAgentNodeBinding, "binding")
        assert binding is not None
        session.delete(binding)

    engine_calls: list[str] = []
    cleanup_calls: list[set[str]] = []
    received: list[bytes] = []
    execution_error = None if status == WorkflowExecutionStatus.SUCCEEDED else "Actual engine outcome"

    def execute(_runner: task_module._AppRunner, **_kwargs: object) -> Generator[dict[str, object], None, None]:
        engine_calls.append(params.workflow_run_id)
        yield {"event": "workflow_started"}
        with sqlite_session_factory.begin() as session:
            run = session.get(WorkflowRun, params.workflow_run_id)
            assert run is not None
            run.outputs = json.dumps({"answer": "stored output"})
            run.error = execution_error
            run.elapsed_time = 1.5
            run.total_tokens = 42
            run.total_steps = 3
        yield {"event": "workflow_finished", "data": {"status": status.value}}

    def collect(*, purge_agent_ids: Iterable[str], **_kwargs: object) -> None:
        cleanup_calls.append(set(purge_agent_ids))
        if cleanup_fails:
            raise RuntimeError("Cleanup broker unavailable")

    class Topic:
        def publish(self, payload: bytes) -> None:
            assert all(session.closed and not session.in_transaction() for session in sessions)
            received.append(payload)

    monkeypatch.setattr(task_module._AppRunner, "_run_app", execute)
    monkeypatch.setattr(task_module.WorkflowEventStream, "get_response_topic", lambda *_args: Topic())
    monkeypatch.setattr("services.agent.retirement_service.enqueue_agent_resource_collection", collect)
    with Flask(__name__).app_context():
        assert task_module._AppRunner(gateway._sessions, params, variables=gateway._variables).run() is None
    assert [json.loads(payload)["event"] for payload in received] == ["workflow_started", "workflow_finished"]
    assert engine_calls == [snapshot.execution_id]
    assert cleanup_calls == [{"agent-1"}]
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        agent = session.get(Agent, "agent-1")
        assert run is not None
        assert run.status == status
        assert agent is not None
        assert agent.status == AgentStatus.ARCHIVED
        assert (debug_lease(session, snapshot.execution_id) is not None) == cleanup_fails
        persisted = run.to_dict()

    received.clear()
    # The delivery boundary deserializes a fresh copy of the original task payload.
    for _ in range(2):
        redelivery = task_module.AppExecutionParams.model_validate_json(params.model_dump_json())
        assert task_module._AppRunner(gateway._sessions, redelivery, variables=gateway._variables).run() is None
    assert [json.loads(payload)["event"] for payload in received] == ["workflow_finished", "workflow_finished"]
    for payload in received:
        replay = WorkflowFinishStreamResponse.model_validate_json(payload)
        assert replay.workflow_run_id == snapshot.execution_id
        assert replay.data.status == status
        assert replay.data.error == execution_error
        assert replay.data.outputs == {"answer": "stored output"}
        assert replay.data.elapsed_time == 1.5
        assert replay.data.total_steps == 3
        assert replay.data.total_tokens == 42

    # Blocking redeliveries have no stream to replay and also exit without work.
    blocking = params.model_copy(update={"streaming": False})
    assert task_module._AppRunner(gateway._sessions, blocking, variables=gateway._variables).run() is None
    assert len(received) == 2
    assert engine_calls == [snapshot.execution_id]
    assert cleanup_calls == [{"agent-1"}]
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, snapshot.execution_id)
        assert run is not None
        assert run.to_dict() == persisted
        assert (debug_lease(session, snapshot.execution_id) is not None) == cleanup_fails
