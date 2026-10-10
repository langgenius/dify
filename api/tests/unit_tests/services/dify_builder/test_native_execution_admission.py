"""Real owner rows, native normalization, and fail-before-effect port admission."""

import json
from unittest.mock import MagicMock

import pytest

from core.dify_builder.execution_policy import scalar_inputs_digest
from models.dify_builder import DifyBuilderTestInput
from models.workflow import Workflow
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414 - export the shared pytest fixture


@pytest.fixture
def effects(monkeypatch):
    import core.app.apps.workflow.app_generator as generator
    from core.helper import encrypter
    from core.helper.code_executor.code_executor import CodeExecutor
    from core.model_manager import ModelManager
    from core.ops.ops_trace_manager import OpsTraceManager
    from core.plugin.impl.oauth import OAuthHandler
    from core.tools.tool_manager import ToolManager
    from factories import file_factory

    spies = []
    for owner, name in (
        (file_factory, "build_from_mappings"),
        (file_factory, "build_from_mapping"),
        (generator, "TraceQueueManager"),
        (ToolManager, "get_workflow_tool_runtime"),
        (OAuthHandler, "refresh_credentials"),
        (encrypter, "decrypt_token"),
        (OpsTraceManager, "get_decrypted_tracing_config"),
        (ModelManager, "get_model_instance"),
        (CodeExecutor, "execute_code"),
    ):
        spy = MagicMock(side_effect=AssertionError(f"forbidden effect: {name}"))
        monkeypatch.setattr(owner, name, spy)
        spies.append(spy)
    yield spies
    for spy in spies:
        spy.assert_not_called()


@pytest.mark.parametrize(
    "change", ["chatflow", "agent", "files", "environment", "tracing", "feature", "nested", "nonfinite"]
)
@pytest.mark.usefixtures("effects")
def test_port_refuses_unsupported_before_native_generation_or_secrets(owned, monkeypatch, change):
    import services.dify_builder.dify_port as module

    factory, actor, app, workflow, sid, tid = owned
    inputs = {"n": "41"}
    if change == "chatflow":
        app.mode = "advanced-chat"
    elif change == "agent":
        app.mode = "agent"
    elif change == "files":
        graph = workflow.graph_dict
        graph["nodes"][0]["data"]["variables"] = [{"variable": "file", "type": "file", "required": False}]
        workflow.graph = json.dumps(graph)
    elif change == "environment":
        workflow._environment_variables = '{"secret":{}}'
    elif change == "tracing":
        app.tracing = '{"enabled":true}'
    elif change == "feature":
        workflow.features = '{"unknown":{"enabled":true}}'
    elif change == "nested":
        inputs["extra"] = {"secret": "nested"}
    elif change == "nonfinite":
        inputs["extra"] = float("inf")
    monkeypatch.setattr(module, "_session_factory", lambda: factory)
    monkeypatch.setattr(module, "load_app", lambda *_: app)
    monkeypatch.setattr(module, "resolve_account", lambda *_: MagicMock())
    monkeypatch.setattr(module, "_load_draft_workflow_or_raise", lambda *_, **__: workflow)
    native = MagicMock(side_effect=AssertionError("native generator forbidden"))
    secret = MagicMock(side_effect=AssertionError("revision may resolve environment secrets"))
    monkeypatch.setattr(module.AppGenerateService, "generate", native)
    monkeypatch.setattr(module, "execution_revision", secret)
    result = module.WorkflowServiceDifyPort().run_draft(
        "ignored", actor, inputs, lambda _: None, session_id=sid, test_input_id=tid
    )
    assert result.dify_run_id == ""
    assert result.execution_refusal.safety_outcome == "unsupported_safe_execution"
    native.assert_not_called()
    secret.assert_not_called()


@pytest.mark.parametrize(
    ("submitted", "expected"), [({"n": "41", "drop": "x"}, {"n": 41, "text": "ab"}), ({}, {"n": 7, "text": "ab"})]
)
def test_port_uses_native_defaults_numbers_and_sanitization(owned, monkeypatch, submitted, expected):
    import services.dify_builder.dify_port as module

    factory, actor, app, workflow, sid, tid = owned
    graph = workflow.graph_dict
    graph["nodes"][0]["data"]["variables"] = [
        {"variable": "n", "label": "Number", "type": "number", "required": False, "default": "7"},
        {"variable": "text", "label": "Text", "type": "text-input", "required": False, "default": "a\u0000b"},
    ]
    workflow.graph = json.dumps(graph)
    with factory.begin() as db:
        db.get(Workflow, workflow.id).graph = workflow.graph
        db.get(DifyBuilderTestInput, tid).inputs = submitted
    monkeypatch.setattr(module, "_session_factory", lambda: factory)
    monkeypatch.setattr(module, "set_login_user", lambda _: None)
    monkeypatch.setattr(module, "_load_draft_workflow_or_raise", lambda *_, **__: workflow)
    native = MagicMock(return_value={})
    monkeypatch.setattr(module.AppGenerateService, "generate", native)
    result = module.WorkflowServiceDifyPort().run_draft(
        app.id, actor, submitted, lambda _: None, session_id=sid, test_input_id=tid
    )
    assert result.dify_run_id == ""
    assert native.call_args.kwargs["args"]["inputs"] == expected
    marker = native.call_args.kwargs["builder_execution"]
    assert marker.effective_inputs_digest == scalar_inputs_digest(expected)
    assert marker.submitted_inputs_digest == scalar_inputs_digest(submitted)


@pytest.mark.parametrize(("inputs", "expected"), [({"n": "41"}, {"n": 41}), ({}, {"n": 7})])
def test_native_generator_revalidates_its_normalized_effective_inputs(owned, monkeypatch, inputs, expected):
    from types import SimpleNamespace

    import core.app.apps.workflow.app_generator as module
    from core.app.app_config.workflow_ui_based_app.variables.manager import WorkflowVariablesConfigManager
    from core.app.apps.base_app_generator import BaseAppGenerator
    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.dify_builder.execution_policy import BuilderExecutionPolicyError
    from models.account import Account
    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService

    factory, actor, app, workflow, sid, tid = owned
    graph = workflow.graph_dict
    graph["nodes"][0]["data"]["variables"] = [
        {"variable": "n", "label": "Number", "type": "number", "required": False, "default": "7"},
    ]
    workflow.graph = json.dumps(graph)
    with factory.begin() as db:
        db.get(Workflow, workflow.id).graph = workflow.graph
        db.get(DifyBuilderTestInput, tid).inputs = inputs
        account = db.get(Account, actor.account_id)
    effective = dict(
        BaseAppGenerator()._prepare_user_inputs(
            user_inputs=inputs,
            variables=WorkflowVariablesConfigManager.convert(workflow),
            tenant_id=actor.tenant_id,
        )
    )
    service = BuilderExecutionPolicyService(factory)
    marker = service.prepare(
        session_id=sid,
        test_input_id=tid,
        app_id=app.id,
        actor=actor,
        workflow=workflow,
        submitted_inputs=inputs,
        effective_inputs=effective,
    )
    launch = _BuilderExecutionLaunch(service, marker)
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=factory.kw["bind"]))
    monkeypatch.setattr(module, "TraceQueueManager", MagicMock())
    monkeypatch.setattr(module, "DifyCoreRepositoryFactory", MagicMock())
    generator = module.WorkflowAppGenerator()
    monkeypatch.setattr(generator, "_generate", lambda **kwargs: kwargs)
    result = generator.generate(
        app_model=app,
        workflow=workflow,
        user=account,
        args={"inputs": effective},
        invoke_from=InvokeFrom.DEBUGGER,
        builder_execution=marker,
        builder_execution_admit=launch,
    )
    assert result["application_generate_entity"].inputs == expected
    launch(workflow, app, result["application_generate_entity"], "start", False)
    assert launch.recorder is not None
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_input_value"):
        generator.generate(
            app_model=app,
            workflow=workflow,
            user=account,
            args={"inputs": {**effective, "discarded": {}}},
            invoke_from=InvokeFrom.DEBUGGER,
            builder_execution=marker,
            builder_execution_admit=_BuilderExecutionLaunch(service, marker),
        )
    with pytest.raises(BuilderExecutionPolicyError, match="effective_input_binding_mismatch"):
        generator.generate(
            app_model=app,
            workflow=workflow,
            user=account,
            args={"inputs": {"n": 42}},
            invoke_from=InvokeFrom.DEBUGGER,
            builder_execution=marker,
            builder_execution_admit=_BuilderExecutionLaunch(service, marker),
        )


def test_port_preserves_worker_policy_refusal_without_allocating_native_result(owned, monkeypatch):
    import services.dify_builder.dify_port as module
    from core.dify_builder.execution_policy import BuilderExecutionPolicyError

    factory, actor, app, workflow, sid, tid = owned
    monkeypatch.setattr(module, "_session_factory", lambda: factory)
    monkeypatch.setattr(module, "set_login_user", lambda _: None)
    monkeypatch.setattr(module, "_load_draft_workflow_or_raise", lambda *_, **__: workflow)

    def generate(**kwargs):
        kwargs["builder_execution_admit"].on_refusal(BuilderExecutionPolicyError("unsupported_node_implementation"))
        return iter([{"event": "error", "code": "invalid_param", "message": "policy error"}])

    monkeypatch.setattr(module.AppGenerateService, "generate", generate)
    result = module.WorkflowServiceDifyPort().run_draft(
        app.id, actor, {"n": "41"}, lambda _: None, session_id=sid, test_input_id=tid
    )
    assert result.dify_run_id == ""
    assert result.execution_refusal.reason_code == "unsupported_node_implementation"
    assert result.error == ""


@pytest.mark.parametrize("metadata", ["environment", "conversation", "tracing"])
def test_postflight_rejects_raw_changes_before_secret_revision(owned, monkeypatch, metadata):
    from types import SimpleNamespace

    import services.dify_builder.dify_port as module
    from core.dify_builder.models import Run, RunVerification
    from models.model import App

    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as db:
        if metadata == "tracing":
            db.get(App, app.id).tracing = '{"enabled":true}'
        else:
            setattr(db.get(Workflow, workflow.id), f"_{metadata}_variables", '{"secret":{}}')
    monkeypatch.setattr(module, "_session_factory", lambda: factory)
    monkeypatch.setattr(module, "_load_draft_workflow_or_raise", lambda _, session: session.get(Workflow, workflow.id))
    revision = MagicMock(side_effect=AssertionError("raw changes must be denied before revision resolves secrets"))
    monkeypatch.setattr(module, "execution_revision", revision)
    run = Run(
        status="succeeded",
        verification=RunVerification(
            execution_revision="",
            executed_graph_revision="",
            terminal_outputs={},
            output_findings=[],
            executed_node_ids=[],
            no_output_dead_branch=False,
        ),
    )
    result = module.WorkflowServiceDifyPort()._bind_run(
        (run, SimpleNamespace(graph_dict=workflow.graph_dict)), app.id, actor, "a" * 64, "b" * 64
    )
    assert result.execution_refusal is not None
    assert result.verification.execution_revision == ""
    revision.assert_not_called()


@pytest.mark.parametrize("change", ["environment", "file_default", "tracing"])
def test_direct_restricted_generator_admits_raw_before_config_and_normalization(owned, monkeypatch, change):
    import core.app.apps.workflow.app_generator as module
    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.dify_builder.execution_policy import BuilderExecutionPolicyError
    from models.account import Account
    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import prepare_inputs

    factory, actor, app, workflow, sid, tid = owned
    marker = prepare_inputs(owned)
    with factory() as db:
        account = db.get(Account, actor.account_id)
    if change == "environment":
        workflow._environment_variables = '{"secret":{}}'
    elif change == "tracing":
        app.tracing = '{"enabled":true}'
    else:
        graph = workflow.graph_dict
        graph["nodes"][0]["data"]["variables"] = [
            {
                "variable": "file",
                "label": "File",
                "type": "file",
                "required": False,
                "default": {"upload_file_id": "foreign"},
            }
        ]
        workflow.graph = json.dumps(graph)
    config = MagicMock(side_effect=AssertionError("config forbidden before raw admission"))
    monkeypatch.setattr(module.WorkflowAppConfigManager, "get_app_config", config)
    launch = _BuilderExecutionLaunch(BuilderExecutionPolicyService(factory), marker)
    with pytest.raises(BuilderExecutionPolicyError):
        module.WorkflowAppGenerator().generate(
            app_model=app,
            workflow=workflow,
            user=account,
            args={"inputs": {"n": 41}},
            invoke_from=InvokeFrom.DEBUGGER,
            builder_execution=marker,
            builder_execution_admit=launch,
        )
    config.assert_not_called()


@pytest.mark.parametrize("alive_at_snapshot", [False, True])
def test_completion_snapshots_actual_thread_once(owned, alive_at_snapshot):
    import threading

    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import prepare_inputs, service_module

    context = prepare_inputs(owned)
    launch = _BuilderExecutionLaunch(service_module().BuilderExecutionPolicyService(owned[0]), context)
    entered, release = threading.Event(), threading.Event()
    failures = []

    def worker():
        try:
            launch.on_worker_finished(
                context=context,
                native_run_id="allocated",
                task_id="task",
                recorder=None,
                worker_thread=threading.current_thread(),
                exit_kind="policy_refused",
            )
        except Exception as exc:
            failures.append(exc)
        finally:
            entered.set()
        release.wait(5)

    thread = threading.Thread(target=worker)
    thread.start()
    assert entered.wait(5)
    if not alive_at_snapshot:
        release.set()
        thread.join(5)
    try:
        assert not failures
        done = launch.finish(response_completed=True)
        assert done.worker_finished is (not alive_at_snapshot)
        assert done.native_run_id is None
        assert "Thread" not in done.model_dump_json()
    finally:
        release.set()
        thread.join(5)
    assert launch.finish(response_completed=True) is done
    assert done.worker_finished is (not alive_at_snapshot)


@pytest.mark.parametrize("failure", ["none", "setup", "iterator", "callback", "close"])
def test_port_always_closes_prepared_request_unknown_without_actual_worker(owned, monkeypatch, failure):
    from sqlalchemy import select

    import services.dify_builder.dify_port as module
    from models.dify_builder import DifyBuilderExecutionRequest

    factory, actor, app, workflow, sid, tid = owned
    monkeypatch.setattr(module, "_session_factory", lambda: factory)
    monkeypatch.setattr(module, "set_login_user", lambda _: None)
    monkeypatch.setattr(module, "_load_draft_workflow_or_raise", lambda *_, **__: workflow)

    class Response:
        closed = False

        def __iter__(self):
            if failure == "iterator":
                raise RuntimeError("primary")
            yield 'data: {"event":"workflow_started"}\n\n'

        def close(self):
            self.closed = True
            if failure == "close":
                raise RuntimeError("primary")

    response = Response()

    def generate(**_kwargs):
        if failure == "setup":
            raise RuntimeError("primary")
        return response

    def callback(_):
        if failure == "callback":
            raise RuntimeError("primary")

    monkeypatch.setattr(module.AppGenerateService, "generate", generate)
    if failure == "none":
        result = module.WorkflowServiceDifyPort().run_draft(
            app.id, actor, {"n": "41"}, lambda _: None, session_id=sid, test_input_id=tid, on_workflow_event=callback
        )
        assert result.verification is not None
        assert result.verification.execution_evidence is not None
        assert result.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"
    else:
        with pytest.raises(RuntimeError, match="primary"):
            module.WorkflowServiceDifyPort().run_draft(
                app.id,
                actor,
                {"n": "41"},
                lambda _: None,
                session_id=sid,
                test_input_id=tid,
                on_workflow_event=callback,
            )
    if failure != "setup":
        assert response.closed
    with factory() as db:
        row = db.scalars(select(DifyBuilderExecutionRequest)).one()
        assert row.state == "sealed"
        assert row.completion_summary["safety_outcome"] == "execution_evidence_unknown"


@pytest.mark.parametrize("preworker", [False, True])
def test_refusal_origin_requires_explicit_preworker_fact(owned, preworker):
    from core.dify_builder.execution_policy import BuilderExecutionPolicyError
    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import prepare_inputs, service_module

    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    launch = _BuilderExecutionLaunch(service, context)
    error = BuilderExecutionPolicyError("unsupported_execution_transport")
    launch.on_refusal(error, preworker=preworker)
    done = launch.finish(response_completed=True)
    assert done.preworker_refusal is preworker
    assert not done.worker_finished
    summary = service.seal(request_id=context.request_id, completion=done)
    assert summary.safety_outcome == ("unsupported_safe_execution" if preworker else "execution_evidence_unknown")


def test_real_service_transport_guard_marks_preworker_origin(owned):
    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.dify_builder.execution_policy import BuilderExecutionPolicyError
    from models.account import Account
    from services.app_generate_service import AppGenerateService
    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import prepare_inputs, service_module

    factory, actor, app, _, _, _ = owned
    context = prepare_inputs(owned)
    launch = _BuilderExecutionLaunch(service_module().BuilderExecutionPolicyService(factory), context)
    with factory() as session:
        account = session.get(Account, actor.account_id)
        with pytest.raises(BuilderExecutionPolicyError):
            AppGenerateService.generate(
                app,
                account,
                {"inputs": {}},
                InvokeFrom.DEBUGGER,
                session=session,
                streaming=True,
                workflow_execution_mode="celery",
                builder_execution=context,
                builder_execution_admit=launch,
            )
    assert launch.finish(response_completed=True).preworker_refusal


def test_poststart_setup_policy_error_cannot_claim_preworker_origin(owned, monkeypatch):
    import threading

    import services.dify_builder.dify_port as module
    from core.dify_builder.execution_policy import BuilderExecutionPolicyError

    factory, actor, app, workflow, sid, tid = owned
    monkeypatch.setattr(module, "_session_factory", lambda: factory)
    monkeypatch.setattr(module, "set_login_user", lambda _: None)
    monkeypatch.setattr(module, "_load_draft_workflow_or_raise", lambda *_a, **_kw: workflow)
    entered, release = threading.Event(), threading.Event()
    threads = []

    def generate(**_kwargs):
        def delayed_worker():
            entered.set()
            release.wait(5)

        thread = threading.Thread(target=delayed_worker)
        threads.append(thread)
        thread.start()
        assert entered.wait(5)
        raise BuilderExecutionPolicyError("unsupported_execution_transport")

    monkeypatch.setattr(module.AppGenerateService, "generate", generate)
    try:
        result = module.WorkflowServiceDifyPort().run_draft(
            app.id, actor, {"n": "41"}, lambda _: None, session_id=sid, test_input_id=tid
        )
        assert result.verification is not None
        assert result.verification.execution_evidence is not None
        assert result.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"
        assert result.dify_run_id == ""
    finally:
        release.set()
        for thread in threads:
            thread.join(5)


@pytest.mark.parametrize("conflict", ["claimed", "foreign_thread", "different_error"])
def test_preworker_origin_rejects_conflicts(owned, conflict):
    import threading

    from core.dify_builder.execution_policy import BuilderExecutionPolicyError
    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import prepare_inputs, service_module

    marker = prepare_inputs(owned)
    launch = _BuilderExecutionLaunch(service_module().BuilderExecutionPolicyService(owned[0]), marker)
    error = BuilderExecutionPolicyError("unsupported_workflow")
    if conflict == "claimed":
        launch._claim = ("allocated", "task")
    elif conflict == "different_error":
        launch.on_refusal(BuilderExecutionPolicyError("unsupported_input_value"), preworker=True)
    errors = []

    def deliver():
        try:
            launch.on_refusal(error, preworker=True)
        except BuilderExecutionPolicyError as exc:
            errors.append(exc)

    if conflict == "foreign_thread":
        thread = threading.Thread(target=deliver)
        thread.start()
        thread.join(5)
    else:
        deliver()
    assert len(errors) == 1
    assert not launch.finish(response_completed=True).preworker_refusal


def test_final_seal_failure_returns_unsealed_unknown_without_allocation_identity(owned, monkeypatch):
    import services.dify_builder.dify_port as module
    from core.dify_builder.verification import is_execution_policy_blocker, publication_decision

    factory, actor, app, workflow, sid, tid = owned
    monkeypatch.setattr(module, "_session_factory", lambda: factory)
    monkeypatch.setattr(module, "set_login_user", lambda _: None)
    monkeypatch.setattr(module, "_load_draft_workflow_or_raise", lambda *_, **__: workflow)
    monkeypatch.setattr(module.AppGenerateService, "generate", lambda **_: {})
    monkeypatch.setattr(module.BuilderExecutionPolicyService, "seal", MagicMock(side_effect=RuntimeError("storage")))
    run = module.WorkflowServiceDifyPort().run_draft(
        app.id, actor, {"n": "41"}, lambda _: None, session_id=sid, test_input_id=tid
    )
    assert run.dify_run_id == ""
    assert run.verification is not None
    assert run.verification.execution_evidence is not None
    assert not run.verification.execution_evidence.sealed
    assert run.verification is not None
    assert run.verification.execution_evidence is not None
    assert run.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"
    assert is_execution_policy_blocker(run)
    assert not publication_decision(run, session_id=sid, current_revision="r", current_graph_revision="g").allowed


@pytest.mark.parametrize("invalid", ["thread", "context", "recorder", "conflicting_exit"])
def test_invalid_worker_candidate_latches_unknown(owned, invalid):
    import threading

    from core.dify_builder.execution_policy import BuilderExecutionPolicyError
    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import prepare_inputs, service_module

    context = prepare_inputs(owned)
    launch = _BuilderExecutionLaunch(service_module().BuilderExecutionPolicyService(owned[0]), context)
    errors = []

    def worker():
        launch.on_worker_finished(
            context=context,
            native_run_id="allocated",
            task_id="task",
            recorder=None,
            worker_thread=threading.current_thread(),
            exit_kind="returned",
        )
        try:
            launch.on_worker_finished(
                context=context.model_copy(update={"request_id": "foreign"}) if invalid == "context" else context,
                native_run_id="allocated",
                task_id="task",
                recorder=MagicMock() if invalid == "recorder" else None,
                worker_thread=threading.main_thread() if invalid == "thread" else threading.current_thread(),
                exit_kind="failed" if invalid == "conflicting_exit" else "returned",
            )
        except BuilderExecutionPolicyError as error:
            errors.append(error.reason_code)

    thread = threading.Thread(target=worker)
    thread.start()
    thread.join(5)
    assert not thread.is_alive()
    assert len(errors) == 1
    frozen = launch.finish(response_completed=True)
    assert not frozen.worker_finished
    assert not frozen.recorder_healthy
    assert launch.finish(response_completed=True) is frozen


@pytest.mark.parametrize("preworker", [False, True])
def test_setup_refusal_is_completed_only_with_positive_preworker_origin(owned, monkeypatch, preworker):
    """Lifecycle contract with a real returned thread; not composed native SQL proof."""
    import threading

    import services.dify_builder.dify_port as module
    from core.dify_builder.execution_policy import BuilderExecutionPolicyError

    factory, actor, app, workflow, sid, tid = owned
    monkeypatch.setattr(module, "_session_factory", lambda: factory)
    monkeypatch.setattr(module, "set_login_user", lambda _: None)
    monkeypatch.setattr(module, "_load_draft_workflow_or_raise", lambda *_, **__: workflow)
    completions = []
    seal = module.BuilderExecutionPolicyService.seal

    def capture(service, *, request_id, completion):
        completions.append(completion)
        return seal(service, request_id=request_id, completion=completion)

    def generate(**kwargs):
        launch = kwargs["builder_execution_admit"]
        error = BuilderExecutionPolicyError("unsupported_workflow")
        if preworker:
            launch.on_refusal(error, preworker=True)
        else:

            def returned_worker():
                launch.on_worker_finished(
                    context=launch.context,
                    native_run_id="allocated",
                    task_id="task",
                    recorder=None,
                    worker_thread=threading.current_thread(),
                    exit_kind="returned",
                )

            thread = threading.Thread(target=returned_worker)
            thread.start()
            thread.join(5)
            assert not thread.is_alive()
        raise error

    monkeypatch.setattr(module.BuilderExecutionPolicyService, "seal", capture)
    monkeypatch.setattr(module.AppGenerateService, "generate", generate)
    result = module.WorkflowServiceDifyPort().run_draft(
        app.id, actor, {"n": "41"}, lambda _: None, session_id=sid, test_input_id=tid
    )
    assert len(completions) == 1
    assert completions[0].response_completed is preworker
    assert completions[0].worker_finished is (not preworker)
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == (
        "unsupported_safe_execution" if preworker else "execution_evidence_unknown"
    )
