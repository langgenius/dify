"""Restricted native boundaries must refuse before bootstrap or payload effects."""

from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from typing import cast

import pytest
from flask import Flask
from sqlalchemy import Engine, Select
from sqlalchemy.orm import Session
from werkzeug.local import LocalProxy

from core.app.entities.app_invoke_entities import (
    AppGenerateEntity,
    DifyRunContext,
    InvokeFrom,
    UserFrom,
    WorkflowAppGenerateEntity,
)
from graphon.graph.graph import Graph
from graphon.runtime import RuntimeState, VariablePool
from graphon.variable_loader import DUMMY_VARIABLE_LOADER
from models.model import Account, App
from models.workflow import Workflow
from runtime_contracts.builder.execution import JsonToolExecutionContext
from services.dify_builder.application.execution_policy import BuilderExecutionContext, BuilderExecutionPolicyError
from services.workflow_runtime.node_factory import DifyNodeFactory
from tasks.app_generate.workflow_execute_task import AppExecutionParams, _Account
from tests.unit_tests.services.dify_builder.test_execution_policy_service import Owned, prepare_inputs
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414


@dataclass(frozen=True)
class _AdmissionDatabase:
    engine: Engine


def _forbidden_driver(*_args, **_kwargs):
    raise AssertionError("execution driver must not run before admission")


@pytest.fixture
def admission(owned, mocker):
    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService

    launch = _BuilderExecutionLaunch(BuilderExecutionPolicyService(owned[0]), context())
    mocker.spy(launch, "on_refusal")
    mocker.spy(launch, "admit_raw")
    return launch


@pytest.fixture
def recorder(owned):
    from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService, ServiceExecutionRecorder

    return ServiceExecutionRecorder(BuilderExecutionPolicyService(owned[0]), context(), "run", "task")


@pytest.fixture
def workflow_repositories(owned):
    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )

    factory, actor, app, _workflow, *_ = owned
    with factory() as session:
        user = session.get(Account, actor.account_id)
        assert user is not None
    args = {
        "session_factory": factory,
        "tenant_id": actor.tenant_id,
        "user": user,
        "app_id": app.id,
        "triggered_from": None,
    }
    return SQLAlchemyWorkflowExecutionRepository(**args), SQLAlchemyWorkflowNodeExecutionRepository(**args)


@pytest.fixture
def workflow_queue(mocker):
    import core.app.apps.base_app_queue_manager as queue_module
    from core.app.apps.execution_coordinator import AppExecutionCoordinator
    from services.workflow_runtime.workflow_queue import WorkflowAppQueueManager

    mocker.patch.object(queue_module.redis_client, "setex", return_value=True)
    mocker.patch.object(queue_module.redis_client, "delete", return_value=1)
    mocker.patch.object(queue_module.redis_client, "get", return_value=None)
    mocker.patch.object(AppExecutionCoordinator, "start_watchdog", return_value=None)
    queue = WorkflowAppQueueManager("task", "account", InvokeFrom.DEBUGGER, "workflow")
    mocker.spy(queue, "publish_error")
    return queue


def _install_paused_marker(module, owned, entity, mocker, monkeypatch):
    from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
    from models.workflow import WorkflowPause
    from repositories.sqlalchemy_api_workflow_run_repository import (
        DifyAPISQLAlchemyWorkflowRunRepository,
        _PrivateWorkflowPauseEntity,
    )

    factory = owned[0]
    with factory() as db_session:
        engine = db_session.get_bind()
    monkeypatch.setattr(module, "db", _AdmissionDatabase(engine))
    repository = DifyAPISQLAlchemyWorkflowRunRepository(factory)
    pause = _PrivateWorkflowPauseEntity(
        pause_model=WorkflowPause(workflow_id="workflow", workflow_run_id="run", state_object_key="state"),
        reason_models=[],
    )
    mocker.patch.object(pause, "get_state", return_value=b"state")
    mocker.patch.object(repository, "get_workflow_pause", return_value=pause)
    mocker.spy(repository, "resume_workflow_pause")
    mocker.patch.object(module.DifyAPIRepositoryFactory, "create_api_workflow_run_repository", return_value=repository)
    state = WorkflowResumptionContext.model_construct(
        generate_entity=_WorkflowGenerateEntityWrapper.model_construct(entity=entity),
        serialized_graph_runtime_state="{}",
    )
    mocker.patch.object(module.WorkflowResumptionContext, "loads", return_value=state)
    return repository


def context() -> BuilderExecutionContext:
    return BuilderExecutionContext(
        request_id="request",
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        actor_id="account",
        session_id="session",
        test_input_id="input",
        execution_revision="a" * 64,
        graph_revision="b" * 64,
        submitted_inputs_digest="c" * 64,
        effective_inputs_digest="d" * 64,
        fixture_digest="e" * 64,
        context_digest="f" * 64,
        mode="restricted",
        sandbox_profile="disabled",
        admitted_nodes=(),
        http_fixtures=(),
    )


def test_serialized_native_markers_cannot_disappear() -> None:
    marker = context()
    entity = AppGenerateEntity(
        task_id="task",
        inputs={},
        files=[],
        user_id="account",
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        builder_execution=marker,
    )
    restored = AppGenerateEntity.model_validate_json(entity.model_dump_json())
    assert restored.builder_execution == marker
    run = DifyRunContext(
        tenant_id="tenant",
        app_id="app",
        user_id="account",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        builder_execution=marker,
    )
    assert DifyRunContext.model_validate_json(run.model_dump_json()).builder_execution == marker
    account = Account(name="Owner", email="owner@example.invalid")
    account.id = "account"
    params = AppExecutionParams.new(
        App(id="app", tenant_id="tenant", mode="workflow"),
        Workflow(id="workflow"),
        account,
        {},
        InvokeFrom.DEBUGGER,
        builder_execution=marker,
    )
    assert AppExecutionParams.model_validate_json(params.model_dump_json()).builder_execution == marker


@pytest.mark.parametrize("carrier", ["entity", "run_context", "celery_params"])
def test_json_marker_round_trips_existing_native_carriers(carrier: str) -> None:
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import _json_context

    marker = _json_context()
    if carrier == "entity":
        original = AppGenerateEntity(
            task_id="task",
            inputs={"payload": "{}", "json_path": "$.x"},
            files=[],
            user_id=marker.actor_id,
            stream=True,
            invoke_from=InvokeFrom.DEBUGGER,
            builder_execution=marker,
        )
    elif carrier == "run_context":
        original = DifyRunContext(
            tenant_id=marker.tenant_id,
            app_id=marker.app_id,
            user_id=marker.actor_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            builder_execution=marker,
        )
    else:
        original = AppExecutionParams(
            app_id=marker.app_id,
            workflow_id=marker.workflow_id,
            tenant_id=marker.tenant_id,
            user=_Account(user_id=marker.actor_id),
            args={},
            invoke_from=InvokeFrom.DEBUGGER,
            builder_execution=marker,
        )
    restored = type(original).model_validate_json(original.model_dump_json())
    assert restored.builder_execution == marker
    assert isinstance(restored.builder_execution, JsonToolExecutionContext)
    assert restored.builder_execution.qualified_tool == marker.qualified_tool


def test_json_celery_refuses_before_logging_or_runner(
    mocker,
) -> None:
    import tasks.app_generate.workflow_execute_task as module
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import _json_context

    marker = _json_context()
    params = AppExecutionParams(
        app_id=marker.app_id,
        workflow_id=marker.workflow_id,
        tenant_id=marker.tenant_id,
        user=_Account(user_id=marker.actor_id),
        args={},
        invoke_from=InvokeFrom.DEBUGGER,
        builder_execution=marker,
    )
    log = mocker.patch.object(module.logger, "info")
    runner = mocker.patch.object(module._AppRunner, "__init__", side_effect=AssertionError("runner forbidden"))
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_execution_transport"):
        module.workflow_based_app_execution_task.run(params.model_dump_json())
    log.assert_not_called()
    runner.assert_not_called()


@pytest.mark.parametrize("transport", ["celery", "files"])
def test_json_generate_refuses_unsupported_transport_before_workflow_read(admission, mocker, transport: str) -> None:
    from services.app_generate_service import AppGenerateService
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import _json_context

    marker = _json_context()
    account = Account(name="Owner", email="owner@example.invalid")
    account.id = marker.actor_id
    read = mocker.patch.object(
        AppGenerateService, "_get_workflow", side_effect=AssertionError("workflow read forbidden")
    )
    admit = admission
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_execution_transport"):
        AppGenerateService.generate(
            app_model=App(id=marker.app_id, tenant_id=marker.tenant_id, mode="workflow"),
            user=account,
            args={"inputs": {}, "files": [{"id": "file"}]} if transport == "files" else {"inputs": {}},
            invoke_from=InvokeFrom.DEBUGGER,
            session=Session(),
            workflow_execution_mode="celery" if transport == "celery" else "in_process",
            builder_execution=marker,
            builder_execution_admit=admit,
        )
    read.assert_not_called()
    admit.on_refusal.assert_called_once()


@pytest.mark.parametrize("transport", ["missing_issuer", "files", "depth"])
def test_json_workflow_generator_refuses_before_file_or_graph_effect(admission, mocker, transport: str) -> None:
    from services.workflow_runtime.workflow_generator import WorkflowAppGenerator
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import _json_context

    marker = _json_context()
    account = Account(name="Owner", email="owner@example.invalid")
    account.id = marker.actor_id
    admit = admission
    file_scope = mocker.patch.object(
        WorkflowAppGenerator, "_bind_file_access_scope", side_effect=AssertionError("file scope forbidden")
    )
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_execution_transport"):
        WorkflowAppGenerator(execution_driver=_forbidden_driver).generate(
            app_model=App(id=marker.app_id, tenant_id=marker.tenant_id, mode="workflow"),
            workflow=Workflow(id=marker.workflow_id),
            user=account,
            args={"inputs": {}, "files": [{"id": "file"}]} if transport == "files" else {"inputs": {}},
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=True,
            call_depth=1 if transport == "depth" else 0,
            builder_execution=marker,
            builder_execution_admit=None if transport == "missing_issuer" else admit,
        )
    file_scope.assert_not_called()
    admit.admit_raw.assert_not_called()
    if transport != "missing_issuer":
        admit.on_refusal.assert_called_once()


def test_json_resume_refuses_before_trace_or_graph_restore(
    workflow_repositories,
) -> None:
    from services.workflow_runtime.workflow_generator import WorkflowAppGenerator
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import _json_context

    marker = _json_context()
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_execution_transport"):
        WorkflowAppGenerator(execution_driver=_forbidden_driver).resume(
            app_model=App(id=marker.app_id, tenant_id=marker.tenant_id, mode="workflow"),
            workflow=Workflow(id=marker.workflow_id),
            user=Account(name="Owner", email="owner@example.invalid"),
            application_generate_entity=WorkflowAppGenerateEntity.model_construct(builder_execution=marker),
            graph_runtime_state=RuntimeState(workflow_id=marker.workflow_id, variable_pool=VariablePool(), start_at=0),
            workflow_execution_repository=workflow_repositories[0],
            workflow_node_execution_repository=workflow_repositories[1],
        )


def test_json_factory_refuses_nonissued_recorder_before_ordinary_setup(
    mocker,
    recorder,
) -> None:
    import time

    from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY
    from graphon.runtime import InitParams, RuntimeState, VariablePool
    from services.workflow_runtime import node_factory
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import _json_context

    marker = _json_context()
    ordinary = mocker.patch.object(
        node_factory, "build_dify_model_access", side_effect=AssertionError("ordinary setup forbidden")
    )
    params = InitParams(
        workflow_id=marker.workflow_id,
        graph_config={"nodes": [], "edges": []},
        call_depth=0,
        run_context={
            DIFY_RUN_CONTEXT_KEY: DifyRunContext(
                tenant_id=marker.tenant_id,
                app_id=marker.app_id,
                user_id=marker.actor_id,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                builder_execution=marker,
            )
        },
    )
    state = RuntimeState(workflow_id=params.workflow_id, variable_pool=VariablePool(), start_at=time.perf_counter())
    with pytest.raises(BuilderExecutionPolicyError, match="missing_json_tool_issuer"):
        node_factory.DifyNodeFactory(params, state, execution_recorder=recorder)
    ordinary.assert_not_called()


def test_json_task_resume_refuses_before_snapshot_restore(mocker, owned, monkeypatch: pytest.MonkeyPatch) -> None:
    import tasks.app_generate.workflow_execute_task as module
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import _json_context

    marker = _json_context()
    entity = AppGenerateEntity(
        task_id="task",
        inputs={},
        files=[],
        user_id=marker.actor_id,
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        builder_execution=marker,
    )
    repository = _install_paused_marker(module, owned, entity, mocker, monkeypatch)
    restore = mocker.patch.object(module.RuntimeState, "from_snapshot", side_effect=AssertionError("restore forbidden"))
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_execution_transport"):
        module._resume_app_execution({"workflow_run_id": "run"})
    restore.assert_not_called()
    repository.resume_workflow_pause.assert_not_called()


def test_celery_refuses_marker_before_logging_or_initialization(
    mocker,
) -> None:
    import tasks.app_generate.workflow_execute_task as module

    params = AppExecutionParams(
        app_id="app",
        workflow_id="workflow",
        tenant_id="tenant",
        user=_Account(user_id="account"),
        args={},
        invoke_from=InvokeFrom.DEBUGGER,
        builder_execution=context(),
    )
    log = mocker.patch.object(module.logger, "info")
    runner = mocker.patch.object(module._AppRunner, "__init__", side_effect=AssertionError("runner forbidden"))
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_execution_transport"):
        module.workflow_based_app_execution_task.run(params.model_dump_json())
    log.assert_not_called()
    runner.assert_not_called()


@pytest.mark.parametrize("entry", ["constructor", "classmethod", "runner"])
@pytest.mark.parametrize("has_recorder", [True, False])
def test_factory_composes_restricted_without_live_adapters(
    mocker, recorder, workflow_queue, entry: str, has_recorder: bool
) -> None:
    import time

    import services.workflow_runtime.node_factory as module
    from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY
    from graphon.runtime import InitParams, RuntimeState, VariablePool
    from services.dify_builder.application.execution_policy import (
        admitted_node_bindings,
        context_digest,
        fixture_digest,
    )
    from tests.unit_tests.core.dify_builder.test_execution_policy import graph, snapshot

    marker = context().model_copy(
        update={"admitted_nodes": admitted_node_bindings(snapshot()), "fixture_digest": fixture_digest("a" * 64, ())}
    )
    marker = marker.model_copy(update={"context_digest": context_digest(marker)})
    live = mocker.patch.object(
        module, "build_dify_model_access", side_effect=AssertionError("live construction forbidden")
    )
    params = InitParams(
        workflow_id="workflow",
        graph_config=graph(),
        call_depth=0,
        run_context={
            DIFY_RUN_CONTEXT_KEY: DifyRunContext(
                tenant_id="tenant",
                app_id="app",
                user_id="account",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                builder_execution=marker,
            )
        },
    )
    state = RuntimeState(workflow_id=params.workflow_id, variable_pool=VariablePool(), start_at=time.perf_counter())

    def construct() -> DifyNodeFactory | Graph:
        selected_recorder = recorder if has_recorder else None
        if entry == "constructor":
            return module.DifyNodeFactory(params, state, execution_recorder=selected_recorder)
        elif entry == "classmethod":
            return module.DifyNodeFactory.from_graph_init_context(
                graph_init_context=module.DifyGraphInitContext(
                    workflow_id="workflow", graph_config=graph(), run_context=params.run_context, call_depth=0
                ),
                runtime_state=state,
                execution_recorder=selected_recorder,
            )
        else:
            from services.workflow_runtime.base_runner import WorkflowBasedAppRunner

            runner = WorkflowBasedAppRunner(queue_manager=workflow_queue, app_id="app")
            return runner._init_graph(
                graph_config=graph(),
                graph_runtime_state=state,
                workflow_id="workflow",
                tenant_id="tenant",
                user_id="account",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                builder_execution=marker,
                execution_recorder=selected_recorder,
                call_depth=0,
            )

    if has_recorder:
        result = construct()
        assert result is not None
    else:
        with pytest.raises(BuilderExecutionPolicyError, match="missing_execution_recorder"):
            construct()
    live.assert_not_called()


@pytest.mark.parametrize(
    "change", ["code", "tool", "environment", "features", "tenant", "inputs", "fixture", "membership", "tracing"]
)
def test_worker_readmission_rejects_reload_races_inside_queue_lifecycle(
    mocker, workflow_repositories, owned: Owned, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    import contextvars
    import json
    import threading
    from contextlib import contextmanager

    from flask import current_app
    from sqlalchemy import delete

    import services.workflow_runtime.workflow_generator as module
    from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
    from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
    from models.account import TenantAccountJoin
    from models.dify_builder import DifyBuilderTestInput
    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService

    factory, actor, app, workflow, sid, tid = owned
    marker = prepare_inputs(owned)
    entity = WorkflowAppGenerateEntity(
        task_id="task",
        app_config=WorkflowAppConfigManager.get_app_config(app, workflow),
        inputs={"n": 41},
        files=[],
        user_id=actor.account_id,
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_execution_id="allocated-run",
        builder_execution=marker,
    )
    entered = threading.Event()
    proceed = threading.Event()

    @contextmanager
    def worker_session() -> Generator[Session]:
        with factory() as session:
            original = session.scalar
            first = True

            def scalar[T](statement: Select[tuple[T]]) -> T | None:
                nonlocal first
                if first:
                    first = False
                    entered.set()
                    assert proceed.wait(2)
                return original(statement)

            monkeypatch.setattr(session, "scalar", scalar)
            yield session

    monkeypatch.setattr(module.session_factory, "create_session", worker_session)
    runner = mocker.patch.object(
        module.WorkflowAppRunner, "__init__", side_effect=AssertionError("runner must not construct")
    )
    snippet = mocker.patch.object(
        module.WorkflowAppGenerator,
        "_ensure_snippet_start_node_in_worker",
        side_effect=AssertionError("snippet must not mutate"),
    )
    trace = mocker.patch.object(
        module.TraceQueueManager, "__init__", side_effect=AssertionError("trace must not construct")
    )
    from core.helper import encrypter

    secret = mocker.patch.object(encrypter, "decrypt_token", side_effect=AssertionError("secret resolution forbidden"))
    import core.app.apps.base_app_queue_manager as queue_module
    from core.app.apps.execution_coordinator import AppExecutionCoordinator, AppExecutionState
    from core.app.entities.queue_entities import QueueErrorEvent
    from services.workflow_runtime.workflow_queue import WorkflowAppQueueManager

    mocker.patch.object(queue_module.redis_client, "setex", return_value=True)
    mocker.patch.object(queue_module.redis_client, "get", return_value=None)
    mocker.patch.object(queue_module.redis_client, "delete", return_value=1)
    monkeypatch.setattr(AppExecutionCoordinator, "start_watchdog", lambda _: None)
    queue = WorkflowAppQueueManager("task", actor.account_id, InvokeFrom.DEBUGGER, "workflow")
    monkeypatch.setattr(queue, "_is_stopped", lambda: False)
    mocker.spy(queue, "publish_error")
    launch = _BuilderExecutionLaunch(BuilderExecutionPolicyService(factory), marker)
    worker = threading.Thread(
        target=module.WorkflowAppGenerator(execution_driver=_forbidden_driver)._generate_worker,
        kwargs={
            "flask_app": cast(LocalProxy[Flask], current_app)._get_current_object(),
            "application_generate_entity": entity,
            "queue_manager": queue,
            "context": contextvars.copy_context(),
            "variable_loader": DUMMY_VARIABLE_LOADER,
            "workflow_execution_repository": workflow_repositories[0],
            "workflow_node_execution_repository": workflow_repositories[1],
            "builder_execution_admit": launch,
        },
    )
    worker.start()
    assert entered.wait(2)
    try:
        with factory.begin() as db:
            row = db.get(Workflow, workflow.id)
            assert row is not None
            if change in {"code", "tool"}:
                value = row.graph_dict
                value["nodes"][1]["data"]["type"] = change
                row.graph = json.dumps(value)
            elif change == "environment":
                row._environment_variables = '{"secret":{}}'
            elif change == "features":
                row.features = '{"unknown":{"enabled":true}}'
            elif change == "tenant":
                row.tenant_id = "foreign-tenant"
            elif change == "inputs":
                entity.inputs = {"n": 42}
            elif change == "fixture":
                test_input = db.get(DifyBuilderTestInput, tid)
                assert test_input is not None
                test_input.http_fixtures = {"invalid": True}
            elif change == "membership":
                db.execute(delete(TenantAccountJoin))
            elif change == "tracing":
                stored_app = db.get(App, app.id)
                assert stored_app is not None
                stored_app.tracing = '{"enabled":true}'
    finally:
        proceed.set()
        worker.join(timeout=2)
    assert not worker.is_alive()
    queue.publish_error.assert_called_once()
    assert isinstance(queue.publish_error.call_args.args[0], BuilderExecutionPolicyError)
    assert queue.execution_state == AppExecutionState.TERMINAL
    messages = list(queue.listen())
    assert len(messages) == 1
    assert isinstance(messages[0].event, QueueErrorEvent)
    runner.assert_not_called()
    snippet.assert_not_called()
    trace.assert_not_called()
    secret.assert_not_called()
    assert launch.recorder is None
    assert launch.refusal is queue.publish_error.call_args.args[0]
    completion = launch.finish(response_completed=True)
    assert completion.worker_finished
    assert completion.worker_exit == "policy_refused"
    assert not completion.preworker_refusal
    assert completion.native_run_id is None


def test_worker_claims_once_and_shares_recorder_with_runner_and_completion(
    mocker, workflow_queue, workflow_repositories, owned: Owned, monkeypatch: pytest.MonkeyPatch
) -> None:
    import contextvars
    from contextlib import nullcontext

    from flask import current_app

    import services.workflow_runtime.workflow_generator as module
    from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
    from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
    from core.dify_builder.models import Run
    from models.dify_builder import DifyBuilderExecutionRequest
    from services.dify_builder.dify_port import WorkflowServiceDifyPort, _BuilderExecutionLaunch
    from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService

    factory, actor, app, workflow, sid, tid = owned
    marker = prepare_inputs(owned)
    entity = WorkflowAppGenerateEntity(
        task_id="task",
        app_config=WorkflowAppConfigManager.get_app_config(app, workflow),
        inputs={"n": 41},
        files=[],
        user_id=actor.account_id,
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_execution_id="allocated-run",
        builder_execution=marker,
    )
    monkeypatch.setattr(module.session_factory, "create_session", factory)
    monkeypatch.setattr(module, "active_workflow_task", lambda _: nullcontext())
    service = BuilderExecutionPolicyService(factory)
    launch = _BuilderExecutionLaunch(service, marker)
    runners = []

    def record_driver(runner, *_args):
        runners.append(runner)

    queue = workflow_queue
    module.WorkflowAppGenerator(execution_driver=record_driver)._generate_worker(
        flask_app=cast(LocalProxy[Flask], current_app)._get_current_object(),
        application_generate_entity=entity,
        queue_manager=queue,
        context=contextvars.copy_context(),
        variable_loader=DUMMY_VARIABLE_LOADER,
        workflow_execution_repository=workflow_repositories[0],
        workflow_node_execution_repository=workflow_repositories[1],
        builder_execution_admit=launch,
    )
    queue.publish_error.assert_not_called()
    assert runners[0]._execution_recorder is launch.recorder
    with factory() as db:
        row = db.get(DifyBuilderExecutionRequest, marker.request_id)
        assert row is not None
        assert (row.state, row.native_run_id, row.task_id) == ("running", "allocated-run", "task")
    with pytest.raises(BuilderExecutionPolicyError, match="execution_already_claimed"):
        launch(workflow, app, entity, "start", False)
    assert runners[0]._execution_recorder is launch.recorder
    # An append failure latches the very recorder that the port completion receives.
    from services.dify_builder.application.execution_policy import BuilderExecutionObservation

    mocker.patch.object(service, "record", side_effect=OSError("append failed"))
    observation = BuilderExecutionObservation(
        observation_id="observation",
        invocation_id="invocation",
        request_id=marker.request_id,
        node_id="start",
        kind="effect_blocked",
        implementation_version="1",
        reason_code="test",
    )
    assert launch.recorder is not None
    with pytest.raises(BuilderExecutionPolicyError, match="execution_recorder_failed"):
        launch.recorder.record(observation)
    result = WorkflowServiceDifyPort()._bind_run(
        (Run(status="succeeded"), None), app.id, actor, "", "", execution_recorder=launch.recorder
    )
    assert result.execution_refusal is not None
    assert result.execution_refusal.reason_code == "execution_recorder_unhealthy"


def test_resume_marker_refused_before_restore_trace_or_cancellation_reset(
    mocker, owned, monkeypatch: pytest.MonkeyPatch
) -> None:
    import tasks.app_generate.workflow_execute_task as module

    entity = AppGenerateEntity(
        task_id="task",
        inputs={},
        files=[],
        user_id="account",
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        builder_execution=context(),
    )
    repo = _install_paused_marker(module, owned, entity, mocker, monkeypatch)
    restore = mocker.patch.object(module.RuntimeState, "from_snapshot", side_effect=AssertionError("restore forbidden"))
    reset = mocker.patch.object(
        module, "clear_app_task_cancellation_signals", side_effect=AssertionError("reset forbidden")
    )
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_execution_transport"):
        module._resume_app_execution({"workflow_run_id": "run"})
    restore.assert_not_called()
    reset.assert_not_called()
    repo.resume_workflow_pause.assert_not_called()


def test_native_worker_outer_finally_acknowledges_context_entry_failure(
    workflow_queue, workflow_repositories, owned: Owned, monkeypatch: pytest.MonkeyPatch
) -> None:
    import contextvars
    import threading
    from contextlib import contextmanager
    from typing import cast

    from flask import current_app
    from werkzeug.local import LocalProxy

    import services.workflow_runtime.workflow_generator as module
    from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import prepare_inputs, service_module

    marker = prepare_inputs(owned)
    launch = _BuilderExecutionLaunch(service_module().BuilderExecutionPolicyService(owned[0]), marker)

    @contextmanager
    def broken_context(*_args: object, **_kwargs: object) -> Generator[None]:
        raise RuntimeError("context entry failed")
        yield

    monkeypatch.setattr(module, "preserve_flask_contexts", broken_context)
    entity = WorkflowAppGenerateEntity.model_construct(
        builder_execution=marker, workflow_execution_id="allocated", task_id="task"
    )
    app = cast(LocalProxy[Flask], current_app)._get_current_object()
    errors: list[str] = []

    def target() -> None:
        try:
            module.WorkflowAppGenerator(execution_driver=_forbidden_driver)._generate_worker(
                flask_app=app,
                application_generate_entity=entity,
                queue_manager=workflow_queue,
                context=contextvars.copy_context(),
                variable_loader=DUMMY_VARIABLE_LOADER,
                workflow_execution_repository=workflow_repositories[0],
                workflow_node_execution_repository=workflow_repositories[1],
                builder_execution_admit=launch,
            )
        except RuntimeError as error:
            errors.append(str(error))

    thread = threading.Thread(target=target)
    thread.start()
    thread.join(5)
    assert not thread.is_alive()
    assert errors == ["context entry failed"]
    completion = launch.finish(response_completed=False)
    assert completion.worker_finished
    assert completion.worker_exit == "failed"
    assert not completion.recorder_healthy
    assert completion.native_run_id is None
