"""The actual API dispatcher spends only a current, exact operation permit."""

from types import SimpleNamespace

import pytest
from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload
from dify_agent.protocol.native_testing import AgentDispatchPermit, AgentEffectIntent, AgentNativeTestRef

from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent


def envelope():
    effect = intent().model_copy(update={"kind": "tool"})
    return AgentPhysicalDispatchPayload(
        ref=AgentNativeTestRef(
            policy_version="builder-native-test-v1", request_id="request", invocation_id="inv", context_digest="a" * 64
        ),
        intent=AgentEffectIntent.model_validate(effect.model_dump(mode="json")),
        permit=AgentDispatchPermit(
            permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
        ),
    )


def owner(events, *, drift=False):
    from services.dify_builder.native_testing.agent_operations import AgentToolDispatchOwner

    def revalidate(**_kwargs):
        events.append("revalidate")
        if drift:
            raise BuilderExecutionPolicyError("native_credential_drift")

    return AgentToolDispatchOwner(
        authorization=SimpleNamespace(
            validate_dispatch=lambda **_kwargs: events.append("validate"),
            claim_dispatch=lambda **_kwargs: events.append("claim"),
            record_outcome=lambda **kwargs: events.append(("outcome", kwargs["outcome"], kwargs["result_ref"])),
        ),
        state_store=SimpleNamespace(
            store_result=lambda **kwargs: events.append(("stored", kwargs["result"])) or "result"
        ),
        revalidate=revalidate,
    )


def test_physical_claim_is_adjacent_to_dispatch_and_real_result_is_saved():
    events = []
    operation = owner(events)
    result = operation.invoke(envelope=envelope(), invoke=lambda: events.append("business") or {"observation": "real"})
    assert result == {"observation": "real"}
    assert events == [
        "validate",
        "revalidate",
        "claim",
        "business",
        ("stored", {"observation": "real"}),
        ("outcome", "completed", "result"),
    ]


def test_current_resource_drift_stops_before_physical_claim_or_business():
    events = []
    with pytest.raises(BuilderExecutionPolicyError, match="native_credential_drift"):
        owner(events, drift=True).invoke(envelope=envelope(), invoke=lambda: events.append("business"))
    assert events == ["validate", "revalidate"]


def test_lost_business_response_closes_unknown_and_never_retries():
    events = []

    def invoke():
        events.append("business")
        raise TimeoutError

    with pytest.raises(TimeoutError):
        owner(events).invoke(envelope=envelope(), invoke=invoke)
    assert events == ["validate", "revalidate", "claim", "business", ("outcome", "unknown", None)]


def test_confirmed_plugin_declaration_uses_api_owned_core_without_credentials():
    from models.agent_config_entities import AgentSoulToolsConfig
    from services.dify_builder.native_testing.agent_tool_declarations import (
        AgentToolDeclarationService,
        AgentToolMetadata,
    )
    from tests.unit_tests.services.dify_builder.test_agent_tool_declarations import entity

    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_type": "plugin",
                    "plugin_id": "test/plugin",
                    "provider": "provider",
                    "tool_name": "write",
                    "credential_type": "oauth2",
                    "credential_ref": {"id": "credential"},
                }
            ]
        }
    )
    declarations = AgentToolDeclarationService(
        metadata=lambda **_kwargs: AgentToolMetadata(entity(), "plugin@rev", True)
    ).prepare(tenant_id="tenant", actor_id="actor", app_id="app", tools=tools, profile="confirmed")
    assert declarations.plugin_tools is None
    config = declarations.core_tools.tools[0]
    assert config.provider_id == "test/plugin/provider"
    assert config.credential_id == "credential"
    assert "credentials" not in config.model_dump()


def test_reasoning_assessment_cannot_grant_or_hide_opaque_tool_scope():
    from pydantic import ValidationError

    from services.dify_builder.native_testing.agent_operations import AgentCallAssessment

    assessment = AgentCallAssessment(
        action="Send invoice",
        account_label="Test account",
        target_summary={"recipient": "test"},
        parameters_summary={"amount": 1},
        risk_notice="Sends one invoice; provider internals remain opaque.",
        destructive=False,
    )
    assert assessment.destructive is False
    with pytest.raises(ValidationError):
        AgentCallAssessment.model_validate({**assessment.model_dump(), "approved": True})


@pytest.mark.parametrize("boundary", ["core_tool", "model", "shell_run", "bootstrap", "config_pull"])
def test_prepare_actual_call_freezes_builder_reasoning_without_business_or_oauth(monkeypatch, boundary):
    from contextlib import contextmanager
    from datetime import UTC, datetime

    from models.agent_config_entities import AgentSoulConfig
    from runtime_contracts.builder.native.contracts import NativeTestContextRef, OperationKey, operation_digest
    from services.dify_builder.native_testing import agent_operations as module
    from services.dify_builder.native_testing.agent_tool_declarations import AgentToolMetadata
    from tests.unit_tests.services.dify_builder.test_agent_tool_declarations import entity

    ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
    execution = "a46d79e6-0ae1-4e19-90af-5b58e9a496f3"
    key = OperationKey(invocation_id="inv", occurrence_path=(execution, boundary, "call-1"), cursor=0)
    invocation = SimpleNamespace(bindings={})
    owned = SimpleNamespace(
        tenant_id="tenant", bindings=invocation.bindings, expires_at=datetime(2030, 1, 1, tzinfo=UTC)
    )

    @contextmanager
    def locked(**_kwargs):
        yield SimpleNamespace(scalar=lambda _query: invocation), owned, object()

    loader = SimpleNamespace(load=lambda **_kwargs: owned, locked=locked)
    stored = []
    store = SimpleNamespace(
        prepare_object=lambda **kwargs: stored.append(kwargs) or object(),
        acknowledge_object=lambda _session, _receipt: None,
    )
    reasoning = []
    assessment = {
        "action": "Write declared value",
        "account_label": None,
        "target_summary": {"tool": "write"},
        "parameters_summary": {"enabled": True},
        "risk_notice": "Creates one test value.",
        "destructive": False,
    }
    service = module.AgentOperationService(
        loader=loader, state_store=store, assessor=lambda **kwargs: reasoning.append(kwargs) or assessment
    )
    parent = SimpleNamespace(execution_id=execution, input_digest="b" * 64, model_dump=lambda **_kwargs: {})
    monkeypatch.setattr(service, "_endpoint", lambda _ref: SimpleNamespace(config=SimpleNamespace(parent_node=parent)))
    soul = AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "langgenius/openai/openai",
                "model": "test-model",
            }
        }
    )
    definition = SimpleNamespace(node_id="node", agent_id="agent", snapshot_id="snapshot", soul=soul, stamp="c" * 64)
    tool = module.AgentResolvedTool(
        "plugin",
        "test/plugin/provider",
        "write",
        None,
        AgentToolMetadata(entity(), "plugin@revision", False),
        {},
        None,
        None,
        False,
    )
    monkeypatch.setattr(
        service, "_tool", lambda **_kwargs: (SimpleNamespace(graph_revision="d" * 64), definition, tool, None)
    )
    monkeypatch.setattr(module, "_sql_resource", lambda **_kwargs: None)
    monkeypatch.setattr(
        service, "_definition", lambda **_kwargs: (SimpleNamespace(graph_revision="d" * 64), definition)
    )
    if boundary in {"shell_run", "bootstrap", "config_pull"}:
        monkeypatch.setattr(
            service,
            "_shell",
            lambda **_kwargs: (
                SimpleNamespace(
                    graph_revision="d" * 64, native_run_id="workflow-run", graph={"nodes": [{"id": "node"}]}
                ),
                definition,
                SimpleNamespace(
                    config=SimpleNamespace(
                        config_digest="e" * 64,
                        config_ref="config",
                        workspace=SimpleNamespace(
                            binding_id="binding", model_dump=lambda **_kwargs: {"binding_id": "binding"}
                        ),
                    )
                ),
                {"shell": {"runtime": "runtime"}},
            ),
            raising=False,
        )
    target = (
        {"provider_type": "plugin", "provider_id": "test/plugin/provider", "tool_name": "write"}
        if boundary == "core_tool"
        else service._model_target(definition)
    )
    if boundary in {"shell_run", "bootstrap", "config_pull"}:
        target = {"shell": "shell"}
    result = service.prepare_intent(
        ref=AgentNativeTestRef.model_validate(ref.model_dump(mode="json")),
        key=key,
        boundary=boundary,
        target=target,
        parameters={"enabled": True},
    )
    assert result.parameters == {"enabled": True}
    if boundary != "model":
        assert reasoning[0]["parameters"] == result.parameters
        assert stored[0]["payload"]["assessment"] == assessment
    else:
        assert reasoning == []
        assert stored[0]["payload"]["assessment"]["action"] == "Invoke selected Agent model"
    assert stored[0]["payload"]["proposal"]["terms"]["max_calls"] == 1
    binding = invocation.bindings[operation_digest(key)]
    assert binding["approval_scope"] == "operation"
    assert binding["isolated"] is False
    assert "parameters" not in binding
    assert result.key.occurrence_path == key.occurrence_path


def test_only_the_selected_confirmed_model_can_use_the_outer_task_grant():
    from services.dify_builder.native_testing.authorization import task_grant_allowed
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import binding

    model = binding(intent()).model_copy(update={"kind": "model", "isolated": False, "egress": True})
    assert task_grant_allowed(model, task_approved=True) is False
    assert task_grant_allowed(model, task_approved=False, confirmed_model=True) is False
    assert task_grant_allowed(model, task_approved=True, confirmed_model=True) is True
    assert (
        task_grant_allowed(model.model_copy(update={"kind": "tool"}), task_approved=True, confirmed_model=True) is False
    )


def test_model_target_keeps_the_published_provider_and_model():
    from models.agent_config_entities import AgentSoulConfig
    from services.dify_builder.native_testing.agent_operations import AgentOperationService

    definition = SimpleNamespace(
        soul=AgentSoulConfig.model_validate(
            {
                "model": {
                    "plugin_id": "langgenius/openai",
                    "model_provider": "langgenius/openai/openai",
                    "model": "gpt-4o-mini",
                }
            }
        )
    )
    assert AgentOperationService._model_target(definition) == {
        "plugin_id": "langgenius/openai",
        "provider": "langgenius/openai/openai",
        "model": "gpt-4o-mini",
    }


@pytest.mark.parametrize("report", ["unknown", "completed"])
def test_backend_lost_response_preserves_real_api_completed_result(report):
    from contextlib import contextmanager

    from services.dify_builder.native_testing.agent_bridge import api_ref
    from services.dify_builder.native_testing.agent_operations import AgentOperationService

    pending = envelope()
    persisted = SimpleNamespace(
        operation_id="operation", attempt_id="attempt", outcome="completed", result_ref="real-result"
    )

    @contextmanager
    def sessions():
        yield SimpleNamespace(scalar=lambda _query: persisted)

    loader = SimpleNamespace(actor=SimpleNamespace(tenant_id="tenant"), session_factory=sessions)
    service = AgentOperationService(loader=loader, state_store=object(), assessor=object())
    service.bridge.authorization = SimpleNamespace(_permit_ref=lambda _permit: api_ref(pending.ref))
    receipt = service.settle(
        ref=pending.ref,
        permit=pending.permit,
        outcome=report,
        result_ref="real-result" if report == "completed" else None,
    )
    assert receipt.outcome == "completed"
    assert receipt.result_ref == "real-result"
    with pytest.raises(BuilderExecutionPolicyError, match="outcome_conflict"):
        service.settle(ref=pending.ref, permit=pending.permit, outcome="completed", result_ref="fabricated-result")


def test_result_upload_cannot_create_or_replace_a_physical_result(monkeypatch):
    from contextlib import contextmanager

    from dify_agent.protocol.native_testing import AgentOperationKey

    from services.dify_builder.native_testing.agent_operations import AgentOperationService

    pending = envelope()
    operation = SimpleNamespace(result_ref="real-result")

    @contextmanager
    def sessions():
        yield SimpleNamespace(scalar=lambda _query: operation)

    loader = SimpleNamespace(load=lambda **_kwargs: SimpleNamespace(tenant_id="tenant"), session_factory=sessions)
    service = AgentOperationService(
        loader=loader, state_store=SimpleNamespace(load_result=lambda **_kwargs: "real"), assessor=object()
    )
    monkeypatch.setattr(service, "_endpoint", lambda _ref: object())
    kwargs = {"ref": pending.ref, "key": AgentOperationKey.model_validate(pending.intent.key.model_dump(mode="json"))}
    assert service.store_result(**kwargs, result="real") == "real-result"
    with pytest.raises(BuilderExecutionPolicyError, match="native_result_conflict"):
        service.store_result(**kwargs, result="fabricated")


@pytest.mark.parametrize("approved", [False, True])
@pytest.mark.parametrize("sqlite_session", [("models.model.App",)], indirect=True)
def test_actual_inner_tool_service_never_prepares_or_dispatches_before_permission(
    sqlite_session, monkeypatch, approved
):
    from core.plugin.impl.oauth import OAuthHandler
    from core.tools.tool_engine import ToolEngine
    from core.tools.tool_manager import ToolManager
    from core.tools.utils.message_transformer import ToolFileMessageTransformer
    from services.agent_tool_inner_service import AgentToolInnerService
    from services.dify_builder.native_testing import agent_operations as module
    from services.dify_builder.native_testing.agent_tool_declarations import AgentToolMetadata
    from tests.unit_tests.services.dify_builder.test_agent_tool_declarations import entity
    from tests.unit_tests.services.test_agent_tool_inner_service import _messages, _persist_app, _request

    _persist_app(sqlite_session)
    request = _request()
    request.tool.credential_id = None
    request.tool.runtime_parameters = {}
    pending = envelope()
    target = {
        "provider_type": request.tool.provider_type,
        "provider_id": request.tool.provider_id,
        "tool_name": request.tool.tool_name,
    }
    pending = pending.model_copy(
        update={
            "intent": pending.intent.model_copy(update={"target": target, "parameters": request.tool.tool_parameters})
        }
    )
    request.native_dispatch = pending
    calls = []

    def validate(**_kwargs):
        if not approved:
            raise BuilderExecutionPolicyError("invalid_dispatch_permit")

    authorization = SimpleNamespace(
        validate_dispatch=validate,
        claim_dispatch=lambda **_kwargs: calls.append("claim"),
        record_outcome=lambda **_kwargs: calls.append("settled"),
    )
    loader = SimpleNamespace(
        actor=SimpleNamespace(account_id=request.caller.user_id, tenant_id=request.caller.tenant_id)
    )
    service = module.AgentOperationService(
        loader=loader,
        state_store=SimpleNamespace(store_result=lambda **kwargs: calls.append(kwargs["result"]) or "real-result"),
        assessor=object(),
    )
    service.bridge.authorization = authorization
    tool = module.AgentResolvedTool(
        "plugin",
        request.tool.provider_id,
        request.tool.tool_name,
        None,
        AgentToolMetadata(entity(), "test/plugin@revision", False),
        {},
        None,
        None,
        False,
    )
    monkeypatch.setattr(service, "revalidate", lambda **_kwargs: tool)
    monkeypatch.setattr(service, "validate_caller", lambda **_kwargs: None)
    monkeypatch.setattr(module, "agent_operations_for_ref", lambda _ref: service)

    def forbidden(*_args, **_kwargs):
        pytest.fail("Ordinary runtime/OAuth owner used for a confirmed tool")

    monkeypatch.setattr(ToolManager, "get_agent_tool_runtime", forbidden)
    monkeypatch.setattr(OAuthHandler, "refresh_credentials", forbidden)
    monkeypatch.setattr(ToolEngine, "generic_invoke", lambda **_kwargs: calls.append("business") or _messages())
    monkeypatch.setattr(
        ToolFileMessageTransformer, "transform_tool_invoke_messages", lambda messages, **_kwargs: messages
    )
    if approved:
        assert AgentToolInnerService().invoke(request, session=sqlite_session).observation == "ok"
        assert calls == ["claim", "business", "ok", "settled"]
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            AgentToolInnerService().invoke(request, session=sqlite_session)
        assert calls == []


def test_direct_service_cannot_lose_a_known_native_envelope_before_runtime():
    from typing import cast

    from flask import Flask, g, request
    from werkzeug.local import LocalProxy

    from services.agent_tool_inner_service import AgentToolInnerService
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner
    from tests.unit_tests.services.test_agent_tool_inner_service import _request

    lineage, principal, selection, _phase = owner()
    context = lineage.resolve(principal=principal, selection=selection, boundary="core_tool", caller={})
    app = Flask(__name__)
    with app.test_request_context():
        g.agent_runtime_context = context
        g.agent_runtime_request = cast(LocalProxy, request)._get_current_object()
        with pytest.raises(BuilderExecutionPolicyError, match="native_endpoint_owner_mismatch"):
            AgentToolInnerService().invoke(_request(), session=object())


def test_confirmed_tool_error_never_returns_private_provider_text(monkeypatch):
    from services.agent_tool_inner_service import AgentToolInnerService
    from services.dify_builder.native_testing import agent_operations as module
    from tests.unit_tests.services.test_agent_tool_inner_service import _request

    def failed(**_kwargs):
        raise ValueError("PRIVATE_PROVIDER_TOKEN_CANARY")

    monkeypatch.setattr(module, "agent_operations_for_ref", lambda _ref: SimpleNamespace(invoke_tool=failed))
    request = _request()
    request.native_dispatch = envelope()
    with pytest.raises(BuilderExecutionPolicyError) as error:
        AgentToolInnerService().invoke(request, session=object())
    assert "PRIVATE_PROVIDER_TOKEN_CANARY" not in str(error.value)
    assert error.value.reason_code == "native_agent_tool_dispatch_failed"


@pytest.mark.parametrize("phase", ["prepare", "invoke"])
def test_confirmed_model_exception_never_returns_private_provider_text(monkeypatch, phase):
    from services.agent_llm_inner_service import AgentLLMInnerService
    from services.dify_builder.native_testing import agent_operations as module

    def failed(*_args, **_kwargs):
        raise ValueError("PRIVATE_MODEL_TOKEN_CANARY")

    owner = SimpleNamespace(validate_model_request=lambda **_kwargs: None, invoke_model=failed)
    monkeypatch.setattr(module, "agent_operations_for_ref", lambda _ref: owner)
    service = AgentLLMInnerService()
    monkeypatch.setattr(service, "_validate_app_tenant", failed)
    request = SimpleNamespace(
        native_dispatch=envelope(), caller=SimpleNamespace(app_id="app", tenant_id="tenant"), target=object()
    )
    invoke = (
        (lambda: service.prepare(request))
        if phase == "prepare"
        else (lambda: list(service.invoke(SimpleNamespace(request=request))))
    )
    with pytest.raises(BuilderExecutionPolicyError) as error:
        invoke()
    assert "PRIVATE_MODEL_TOKEN_CANARY" not in str(error.value)
    assert error.value.reason_code == f"native_agent_model_{phase if phase == 'prepare' else 'dispatch'}_failed"
