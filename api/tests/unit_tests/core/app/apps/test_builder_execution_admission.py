"""Restricted native boundaries must refuse before bootstrap or payload effects."""

from unittest.mock import MagicMock

import pytest

from core.app.entities.app_invoke_entities import AppGenerateEntity, DifyRunContext, InvokeFrom, UserFrom
from core.dify_builder.execution_policy import BuilderExecutionContext, BuilderExecutionPolicyError
from models.model import Account, App
from models.workflow import Workflow
from tasks.app_generate.workflow_execute_task import AppExecutionParams, _Account


def context():
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


def test_serialized_native_markers_cannot_disappear():
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


def test_celery_refuses_marker_before_logging_or_initialization(monkeypatch):
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
    log = MagicMock()
    runner = MagicMock()
    monkeypatch.setattr(module.logger, "info", log)
    monkeypatch.setattr(module, "_AppRunner", runner)
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_execution_transport"):
        module.workflow_based_app_execution_task.run(params.model_dump_json())
    log.assert_not_called()
    runner.assert_not_called()


@pytest.mark.parametrize("entry", ["constructor", "classmethod", "runner"])
@pytest.mark.parametrize("has_recorder", [True, False])
def test_factory_refuses_restricted_before_live_adapters(monkeypatch, entry, has_recorder):
    import time

    import core.workflow.node_factory as module
    from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY
    from core.dify_builder.execution_policy import admitted_node_bindings
    from graphon.entities.graph_init_params import GraphInitParams
    from graphon.runtime import GraphRuntimeState, VariablePool
    from tests.unit_tests.core.dify_builder.test_execution_policy import graph, snapshot

    marker = context().model_copy(update={"admitted_nodes": admitted_node_bindings(snapshot())})
    live = MagicMock(side_effect=AssertionError("live construction forbidden"))
    monkeypatch.setattr(module, "build_dify_model_access", live)
    params = GraphInitParams(
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
    state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time.perf_counter())

    def construct():
        recorder = MagicMock(healthy=True) if has_recorder else None
        if entry == "constructor":
            module.DifyNodeFactory(params, state, execution_recorder=recorder)
        elif entry == "classmethod":
            module.DifyNodeFactory.from_graph_init_context(
                graph_init_context=module.DifyGraphInitContext(
                    workflow_id="workflow", graph_config=graph(), run_context=params.run_context, call_depth=0
                ),
                graph_runtime_state=state,
                execution_recorder=recorder,
            )
        else:
            from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner

            runner = WorkflowBasedAppRunner(queue_manager=MagicMock(), app_id="app")
            runner._init_graph(
                graph_config=graph(),
                graph_runtime_state=state,
                workflow_id="workflow",
                tenant_id="tenant",
                user_id="account",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                builder_execution=marker,
                execution_recorder=recorder,
            )

    reason = "restricted_capabilities_unavailable" if has_recorder else "missing_execution_recorder"
    with pytest.raises(BuilderExecutionPolicyError, match=reason):
        construct()
    live.assert_not_called()


from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414 - export the shared pytest fixture
from tests.unit_tests.services.dify_builder.test_execution_policy_service import prepare_inputs


@pytest.mark.parametrize(
    "change", ["code", "tool", "environment", "features", "tenant", "inputs", "fixture", "membership", "tracing"]
)
def test_worker_readmission_rejects_reload_races_inside_queue_lifecycle(owned, monkeypatch, change):
    import contextvars
    import json
    import threading
    from contextlib import contextmanager

    from flask import current_app
    from sqlalchemy import delete

    import core.app.apps.workflow.app_generator as module
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
    def worker_session():
        with factory() as session:
            original = session.scalar
            first = True

            def scalar(statement):
                nonlocal first
                if first:
                    first = False
                    entered.set()
                    assert proceed.wait(2)
                return original(statement)

            session.scalar = scalar
            yield session

    monkeypatch.setattr(module.session_factory, "create_session", worker_session)
    runner = MagicMock(side_effect=AssertionError("runner must not construct"))
    snippet = MagicMock(side_effect=AssertionError("snippet must not mutate"))
    trace = MagicMock(side_effect=AssertionError("trace must not construct"))
    monkeypatch.setattr(module, "WorkflowAppRunner", runner)
    monkeypatch.setattr(module.WorkflowAppGenerator, "_ensure_snippet_start_node_in_worker", snippet)
    monkeypatch.setattr(module, "TraceQueueManager", trace)
    from core.helper import encrypter

    secret = MagicMock(side_effect=AssertionError("secret resolution forbidden"))
    monkeypatch.setattr(encrypter, "decrypt_token", secret)
    import core.app.apps.base_app_queue_manager as queue_module
    from core.app.apps.execution_coordinator import AppExecutionCoordinator, AppExecutionState
    from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
    from core.app.entities.queue_entities import QueueErrorEvent

    monkeypatch.setattr(queue_module, "redis_client", MagicMock())
    monkeypatch.setattr(AppExecutionCoordinator, "start_watchdog", lambda _: None)
    queue = WorkflowAppQueueManager("task", actor.account_id, InvokeFrom.DEBUGGER, "workflow")
    monkeypatch.setattr(queue, "_is_stopped", lambda: False)
    queue.publish_error = MagicMock(wraps=queue.publish_error)
    launch = _BuilderExecutionLaunch(BuilderExecutionPolicyService(factory), marker)
    worker = threading.Thread(
        target=module.WorkflowAppGenerator()._generate_worker,
        kwargs={
            "flask_app": current_app._get_current_object(),
            "application_generate_entity": entity,
            "queue_manager": queue,
            "context": contextvars.copy_context(),
            "variable_loader": MagicMock(),
            "workflow_execution_repository": MagicMock(),
            "workflow_node_execution_repository": MagicMock(),
            "builder_execution_admit": launch,
        },
    )
    worker.start()
    assert entered.wait(2)
    try:
        with factory.begin() as db:
            row = db.get(Workflow, workflow.id)
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
                db.get(DifyBuilderTestInput, tid).http_fixtures = {"invalid": True}
            elif change == "membership":
                db.execute(delete(TenantAccountJoin))
            elif change == "tracing":
                db.get(App, app.id).tracing = '{"enabled":true}'
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


def test_worker_claims_once_and_shares_recorder_with_runner_and_completion(owned, monkeypatch):
    import contextvars
    from contextlib import nullcontext

    from flask import current_app

    import core.app.apps.workflow.app_generator as module
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
    runner = MagicMock()
    queue = MagicMock()
    monkeypatch.setattr(module, "WorkflowAppRunner", runner)
    module.WorkflowAppGenerator()._generate_worker(
        flask_app=current_app._get_current_object(),
        application_generate_entity=entity,
        queue_manager=queue,
        context=contextvars.copy_context(),
        variable_loader=MagicMock(),
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        builder_execution_admit=launch,
    )
    queue.publish_error.assert_not_called()
    assert runner.call_args.kwargs["execution_recorder"] is launch.recorder
    with factory() as db:
        row = db.get(DifyBuilderExecutionRequest, marker.request_id)
        assert (row.state, row.native_run_id, row.task_id) == ("running", "allocated-run", "task")
    with pytest.raises(BuilderExecutionPolicyError, match="execution_already_claimed"):
        launch(workflow, app, entity, "start", False)
    assert runner.call_args.kwargs["execution_recorder"] is launch.recorder
    # An append failure latches the very recorder that the port completion receives.
    from core.dify_builder.execution_policy import BuilderExecutionObservation

    monkeypatch.setattr(service, "record", MagicMock(side_effect=OSError("append failed")))
    observation = BuilderExecutionObservation(
        observation_id="observation",
        invocation_id="invocation",
        request_id=marker.request_id,
        node_id="start",
        kind="effect_blocked",
        implementation_version="1",
        reason_code="test",
    )
    with pytest.raises(BuilderExecutionPolicyError, match="execution_recorder_failed"):
        launch.recorder.record(observation)
    result = WorkflowServiceDifyPort()._bind_run(
        (Run(status="succeeded"), None), app.id, actor, "", "", execution_recorder=launch.recorder
    )
    assert result.execution_refusal.reason_code == "execution_recorder_unhealthy"


def test_resume_marker_refused_before_restore_trace_or_cancellation_reset(monkeypatch):
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
    monkeypatch.setattr(module, "db", MagicMock())
    repo = MagicMock()
    monkeypatch.setattr(
        module.DifyAPIRepositoryFactory, "create_api_workflow_run_repository", MagicMock(return_value=repo)
    )
    state = MagicMock()
    state.get_generate_entity.return_value = entity
    monkeypatch.setattr(module.WorkflowResumptionContext, "loads", MagicMock(return_value=state))
    restore = MagicMock(side_effect=AssertionError("restore forbidden"))
    reset = MagicMock(side_effect=AssertionError("reset forbidden"))
    monkeypatch.setattr(module.GraphRuntimeState, "from_snapshot", restore)
    monkeypatch.setattr(module, "clear_app_task_cancellation_signals", reset)
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_execution_transport"):
        module._resume_app_execution({"workflow_run_id": "run"})
    restore.assert_not_called()
    reset.assert_not_called()
    repo.resume_workflow_pause.assert_not_called()
