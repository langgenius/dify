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
            builder_execution_admit=launch,
        )
    with pytest.raises(BuilderExecutionPolicyError, match="effective_input_binding_mismatch"):
        generator.generate(
            app_model=app,
            workflow=workflow,
            user=account,
            args={"inputs": {"n": 42}},
            invoke_from=InvokeFrom.DEBUGGER,
            builder_execution=marker,
            builder_execution_admit=launch,
        )


def test_port_preserves_worker_policy_refusal_without_allocating_native_result(owned, monkeypatch):
    import services.dify_builder.dify_port as module
    from core.dify_builder.execution_policy import BuilderExecutionPolicyError

    factory, actor, app, workflow, sid, tid = owned
    monkeypatch.setattr(module, "_session_factory", lambda: factory)
    monkeypatch.setattr(module, "set_login_user", lambda _: None)
    monkeypatch.setattr(module, "_load_draft_workflow_or_raise", lambda *_, **__: workflow)

    def generate(**kwargs):
        kwargs["builder_execution_admit"].on_refusal(BuilderExecutionPolicyError("restricted_capabilities_unavailable"))
        return iter([{"event": "error", "code": "invalid_param", "message": "policy error"}])

    monkeypatch.setattr(module.AppGenerateService, "generate", generate)
    result = module.WorkflowServiceDifyPort().run_draft(
        app.id, actor, {"n": "41"}, lambda _: None, session_id=sid, test_input_id=tid
    )
    assert result.dify_run_id == ""
    assert result.execution_refusal.reason_code == "restricted_capabilities_unavailable"
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
