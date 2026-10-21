"""Inert declaration preparation; controlled metadata is not credential qualification."""

import importlib
import importlib.util
from typing import cast

import pytest

from core.tools.entities.tool_entities import ToolEntity
from models.agent_config_entities import AgentSoulToolsConfig
from tests.unit_tests.services.dify_builder import native_owner_fixtures

operations_service = native_owner_fixtures.operations_service
preparation_sql = native_owner_fixtures.preparation_sql


def service_module():
    assert importlib.util.find_spec("services.dify_builder.native_testing.agent_tool_declarations") is not None, (
        "Inert Agent declaration owner is missing"
    )
    return importlib.import_module("services.dify_builder.native_testing.agent_tool_declarations")


def entity():
    return ToolEntity.model_validate(
        {
            "identity": {"author": "test", "name": "write", "label": {"en_US": "Write"}, "provider": "provider"},
            "description": {"human": {"en_US": "Write"}, "llm": "Write"},
            "parameters": [
                {
                    "name": "enabled",
                    "type": "boolean",
                    "form": "llm",
                    "label": {"en_US": "Enabled"},
                    "human_description": {"en_US": "Enabled"},
                    "llm_description": "Enabled",
                    "required": True,
                    "default": True,
                }
            ],
        }
    )


@pytest.mark.parametrize("credential_id", [None, "credential"])
def test_schema_preparation_never_constructs_runtime_or_refreshes_expired_oauth(credential_id):
    module = service_module()
    calls = []

    def metadata(**kwargs):
        calls.append(kwargs)
        return module.AgentToolMetadata(
            entity=entity(), implementation_revision="plugin@revision", requires_credentials=True
        )

    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_type": "plugin",
                    "plugin_id": "test/plugin",
                    "provider": "provider",
                    "tool_name": "write",
                    "credential_type": "oauth2" if credential_id else "unauthorized",
                    **({"credential_ref": {"id": credential_id}} if credential_id else {}),
                }
            ]
        }
    )
    service = module.AgentToolDeclarationService(metadata=metadata)
    result = service.prepare(tenant_id="tenant", actor_id="actor", app_id="app", tools=tools)
    assert result.plugin_tools.tools[0].credentials == {}
    assert result.plugin_tools.tools[0].parameters_json_schema["properties"]["enabled"]["type"] == "boolean"
    assert result.references[0].credential_id == credential_id
    assert result.references[0].readiness == ("needs_setup" if credential_id is None else "unresolved")
    assert "token" not in result.plugin_tools.model_dump_json()
    assert len(calls) == 1


def test_default_plugin_metadata_path_does_not_call_dynamic_or_credential_runtime(monkeypatch):
    module = service_module()
    from core.plugin.impl.oauth import OAuthHandler
    from core.tools.tool_manager import ToolManager
    from core.tools.utils.configuration import ToolParameterConfigurationManager

    def forbidden(*_args, **_kwargs):
        pytest.fail("Inert declarations touched dynamic schema, decryption, or OAuth")

    from core.tools.entities.tool_entities import ToolProviderEntityWithPlugin
    from core.tools.plugin_tool.provider import PluginToolProviderController
    from core.tools.plugin_tool.tool import PluginTool

    provider = ToolProviderEntityWithPlugin.model_validate(
        {
            "identity": {
                "author": "test",
                "name": "provider",
                "description": {"en_US": "Provider"},
                "icon": "icon.svg",
                "label": {"en_US": "Provider"},
            },
            "credentials_schema": [{"name": "token", "type": "secret-input"}],
            "plugin_id": "test/plugin",
            "tools": [entity()],
        }
    )
    controller = PluginToolProviderController(provider, "test/plugin", "test/plugin@sha", "tenant")
    monkeypatch.setattr(PluginTool, "get_merged_runtime_parameters", forbidden)
    monkeypatch.setattr(PluginTool, "get_llm_parameters_json_schema", forbidden)
    monkeypatch.setattr(ToolManager, "get_plugin_provider", lambda *_args: controller)
    monkeypatch.setattr(ToolManager, "get_agent_tool_runtime", forbidden)
    monkeypatch.setattr(OAuthHandler, "refresh_credentials", forbidden)
    monkeypatch.setattr(ToolParameterConfigurationManager, "decrypt_tool_parameters", forbidden)
    tools = AgentSoulToolsConfig.model_validate(
        {
            "dify_tools": [
                {
                    "provider_type": "plugin",
                    "plugin_id": "test/plugin",
                    "provider": "provider",
                    "tool_name": "write",
                    "credential_type": "oauth2",
                    "credential_ref": {"id": "expired-credential"},
                }
            ]
        }
    )
    result = module.AgentToolDeclarationService().prepare(
        tenant_id="tenant", actor_id="actor", app_id="app", tools=tools
    )
    assert result.references[0].credential_id == "expired-credential"
    assert result.plugin_tools.tools[0].credentials == {}

    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.workflow.nodes.agent_v2.dify_tools_builder import WorkflowAgentDifyToolsBuilder

    layers = WorkflowAgentDifyToolsBuilder(
        native_declaration_preparer=module.AgentToolDeclarationService()
    ).build_layers(
        tenant_id="tenant",
        app_id="app",
        user_id="actor",
        tools=tools,
        invoke_from=InvokeFrom.DEBUGGER,
        native_test_required=True,
    )
    assert layers.plugin_tools == result.plugin_tools
    assert layers.core_tools == result.core_tools


@pytest.mark.parametrize(
    "change",
    [
        None,
        "owner",
        "intent",
        "key",
        "scope",
        "state",
        "expiry",
        "permit_expiry",
        "missing_invocation_state",
        "self_fence",
    ],
)
def test_same_permit_validation_does_not_claim_or_spend(change, monkeypatch, operations_service):
    from contextlib import contextmanager
    from copy import deepcopy
    from datetime import UTC, datetime, timedelta

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import (
        NativeEffectOperation,
        NativeInvocationState,
        NativeTestInvocation,
        NativeTestScope,
    )
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
    from runtime_contracts.builder.native.contracts import DispatchPermit, NativeTestContextRef, operation_digest
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService, _scope_digest
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import binding, intent

    now = datetime(2026, 10, 15, tzinfo=UTC)
    ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
    effect = intent()
    trusted = binding(effect)
    expiry = now + timedelta(minutes=1)
    permit = DispatchPermit(
        permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at=expiry.isoformat()
    )
    operation = NativeEffectOperation(
        id="operation",
        tenant_id="tenant",
        request_id=ref.request_id,
        invocation_id=ref.invocation_id,
        operation_digest=operation_digest(effect.key),
        intent_digest=canonical_digest(effect.model_dump(mode="json")),
        scope_digest=_scope_digest(effect, trusted),
        state="claimed",
    )
    from models.dify_builder_native_tests import NativeEffectAttempt

    attempt = NativeEffectAttempt(
        id="attempt",
        tenant_id="tenant",
        request_id=ref.request_id,
        invocation_id=ref.invocation_id,
        operation_id="operation",
        grant_id="grant",
        dispatch_index=1,
        permit_digest="a" * 64,
        expires_at=expiry,
        cost_units=1,
        budget_reservation_ref="reservation",
        execution_id="execution",
        invocation_digest="b" * 64,
        budget={},
        profile={},
    )
    if change == "intent":
        operation.intent_digest = "f" * 64
    if change == "key":
        operation.operation_digest = "f" * 64
    if change == "scope":
        operation.scope_digest = "f" * 64
    if change == "state":
        operation.state = "completed"
    if change == "expiry":
        attempt.expires_at = now
    if change == "permit_expiry":
        permit = permit.model_copy(update={"expires_at": (expiry + timedelta(seconds=1)).isoformat()})

    request = DifyBuilderExecutionRequest(
        id=ref.request_id,
        tenant_id="tenant",
        context_digest=ref.context_digest,
        app_id="app",
        workflow_id="workflow",
        actor_id="actor",
        session_id="session",
        test_input_id="input",
        context={},
    )
    scope = NativeTestScope(
        tenant_id="tenant",
        request_id=ref.request_id,
        expires_at=expiry,
        cancelled=False,
        max_calls=1,
        max_dispatches=1,
        max_cost_units=1,
        generation=0,
        task_approved=False,
        budget_limits={},
        budget_spent={},
        profile={},
    )
    state = NativeInvocationState(
        tenant_id="tenant",
        request_id=ref.request_id,
        invocation_id=ref.invocation_id,
        parent_invocation_id=None,
        app_id="app",
        workflow_id="workflow",
        context_object_id="context-object",
        generation=0,
        resolution=[],
        state="running",
        pending_ids=["pending"] if change == "self_fence" else [],
        wait_reason="approval" if change == "self_fence" else None,
    )
    invocation = NativeTestInvocation(
        tenant_id="tenant", request_id=ref.request_id, invocation_id=ref.invocation_id, active=True, bindings={}
    )
    scalar_rows = {
        NativeEffectOperation: operation,
        DifyBuilderExecutionRequest: request,
        NativeTestScope: scope,
    }
    collection_rows = {
        NativeInvocationState: [] if change == "missing_invocation_state" else [state],
        NativeTestInvocation: [invocation],
    }

    def selected_model(query):
        assert len(query.column_descriptions) == 1
        return query.column_descriptions[0]["entity"]

    def scalar(query):
        model = selected_model(query)
        assert model in scalar_rows, f"unexpected scalar query: {model}"
        return scalar_rows[model]

    def scalars(query):
        model = selected_model(query)
        assert model in collection_rows, f"unexpected collection query: {model}"
        expression = query.column_descriptions[0]["expr"]
        if expression is NativeTestInvocation.invocation_id:
            return iter(row.invocation_id for row in collection_rows[model] if row.active)
        assert expression is model, f"unexpected collection projection: {expression}"
        return iter(collection_rows[model])

    def forbidden_write(*_args, **_kwargs):
        pytest.fail("validation mutated the dispatch ledger")

    session = operations_service.loader.session_factory()
    monkeypatch.setattr(session, "scalar", scalar)
    monkeypatch.setattr(session, "scalars", scalars)
    for method in ("add", "add_all", "execute", "flush", "commit", "delete"):
        monkeypatch.setattr(session, method, forbidden_write)
    facts = (operation, attempt, request, scope, state, invocation)

    def snapshot_facts():
        return [{key: value for key, value in vars(fact).items() if key != "_sa_instance_state"} for fact in facts]

    before = deepcopy(snapshot_facts())
    permit_before = permit.model_dump(mode="json")

    from services.dify_builder.native_testing.repository import OwnedNativeTest

    owned = OwnedNativeTest(
        ref=ref,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        session_id="session",
        test_input_id="input",
        bindings={},
        generation=0,
        task_approved=False,
        expires_at=expiry,
        state="running",
    )

    @contextmanager
    def locked(**_kwargs):
        yield session, owned, scope

    loader = operations_service.loader
    monkeypatch.setattr(loader, "load", lambda **_kwargs: owned)
    monkeypatch.setattr(loader, "locked", locked)
    service = EffectAuthorizationService(loader, clock=lambda: now)
    monkeypatch.setattr(
        service,
        "_permit_ref",
        lambda _permit: ref.model_copy(update={"invocation_id": "foreign"}) if change == "owner" else ref,
    )
    monkeypatch.setattr(service, "_attempt", lambda *_args: attempt)
    monkeypatch.setattr(service, "_binding", lambda *_args: trusted)
    monkeypatch.setattr(service, "_claim", lambda *_args: pytest.fail("validation spent a second permit"))
    monkeypatch.setattr(
        service, "claim_dispatch", lambda **_kwargs: pytest.fail("validation consumed a physical dispatch claim")
    )
    assert hasattr(service, "validate_dispatch"), "Same-permit validator is missing"
    if change is None:
        assert service.validate_dispatch(ref=ref, intent=effect, permit=permit) is None
        assert service.validate_dispatch(ref=ref, intent=effect, permit=permit) is None
    elif change in {"missing_invocation_state", "self_fence"}:
        reason = "native_ancestor_quarantined" if change == "missing_invocation_state" else "native_dispatch_fenced"
        with pytest.raises(BuilderExecutionPolicyError) as error:
            service.validate_dispatch(ref=ref, intent=effect, permit=permit)
        assert error.value.reason_code == reason
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            service.validate_dispatch(ref=ref, intent=effect, permit=permit)
    assert snapshot_facts() == before
    session.close()
    assert permit.model_dump(mode="json") == permit_before


def test_marked_request_builder_stops_missing_ref_before_metadata():
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from core.workflow.nodes.agent_v2.runtime_request_builder import (
        WorkflowAgentRuntimeBuildContext,
        WorkflowAgentRuntimeRequestBuilder,
        WorkflowAgentRuntimeRequestBuildError,
    )
    from graphon.runtime import VariablePool
    from models.agent import Agent, AgentConfigSnapshot, WorkflowAgentNodeBinding
    from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig

    context = WorkflowAgentRuntimeBuildContext(
        dify_context=DifyRunContext(
            tenant_id="tenant",
            app_id="app",
            user_id="actor",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            native_test_required=True,
            native_test_ref=None,
        ),
        workflow_id="workflow",
        workflow_run_id="run",
        node_id="node",
        node_execution_id="execution",
        variable_pool=VariablePool(),
        binding=WorkflowAgentNodeBinding(
            id="binding",
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            node_id="node",
            agent_id="agent",
            current_snapshot_id="snapshot",
            node_job_config=WorkflowNodeJobConfig(),
        ),
        agent=Agent(id="agent", tenant_id="tenant", name="Agent"),
        snapshot=AgentConfigSnapshot(
            id="snapshot", tenant_id="tenant", agent_id="agent", version=1, config_snapshot=AgentSoulConfig()
        ),
        binding_id="binding",
        backend_binding_ref="binding-ref",
    )
    with pytest.raises(WorkflowAgentRuntimeRequestBuildError, match="authority"):
        WorkflowAgentRuntimeRequestBuilder().build(context)


@pytest.mark.parametrize("kind", ["waiting", "stop", "recorded", "dispatch"])
def test_private_bridge_maps_exact_decisions_without_losing_payload(kind, monkeypatch, operations_service):
    from dify_agent.protocol.native_testing import AgentEffectIntent, AgentNativeTestRef

    from runtime_contracts.builder.native.contracts import ApprovalWait, DispatchPermit, PolicyStop, RecordedResult
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    assert importlib.util.find_spec("services.dify_builder.native_testing.agent_bridge") is not None, (
        "Private bridge is missing"
    )
    module = importlib.import_module("services.dify_builder.native_testing.agent_bridge")
    effect = intent()
    ref = AgentNativeTestRef(
        policy_version="builder-native-test-v1", request_id="request", invocation_id="inv", context_digest="a" * 64
    )
    decisions = {
        "waiting": ApprovalWait(pending_operation_id="pending", wait_reason="configuration"),
        "stop": PolicyStop(reason_code="denied"),
        "recorded": RecordedResult(operation_id="operation", result_ref="result"),
        "dispatch": DispatchPermit(
            permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
        ),
    }
    seen = []

    def before_call(**kwargs):
        seen.append(kwargs)
        return decisions[kind]

    monkeypatch.setattr(operations_service.bridge.authorization, "before_call", before_call)
    bridge = module.AgentNativeTestingBridge(
        authorization=operations_service.bridge.authorization, readiness=None, materializer=None, fence=None
    )
    response = bridge.before_call(ref=ref, intent=AgentEffectIntent.model_validate(effect.model_dump(mode="json")))
    assert response.model_dump(mode="json") == decisions[kind].model_dump(mode="json")
    assert seen[0]["intent"] == effect


def test_materialization_rejects_phase_mismatch_and_missing_fence_before_io(monkeypatch, operations_service):
    from dify_agent.protocol.native_testing import AgentDispatchPermit, AgentEffectIntent, AgentNativeTestRef

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    assert importlib.util.find_spec("services.dify_builder.native_testing.agent_bridge") is not None, (
        "Private bridge is missing"
    )
    module = importlib.import_module("services.dify_builder.native_testing.agent_bridge")
    calls = []
    authorization = operations_service.bridge.authorization
    monkeypatch.setattr(authorization, "validate_dispatch", lambda **_kwargs: calls.append("validated"))
    materializer = module.NativeAgentCredentialMaterializer(
        authorization=authorization, resolve_binding=lambda **_kwargs: pytest.fail("materialized without durable fence")
    )
    monkeypatch.setattr(
        materializer, "materialize", lambda **_kwargs: pytest.fail("materialized without durable fence")
    )
    bridge = module.AgentNativeTestingBridge(
        authorization=authorization, readiness=None, materializer=materializer, fence=None
    )
    kwargs = {
        "ref": AgentNativeTestRef(
            policy_version="builder-native-test-v1", request_id="request", invocation_id="inv", context_digest="a" * 64
        ),
        "intent": AgentEffectIntent.model_validate(intent().model_dump(mode="json")),
        "permit": AgentDispatchPermit(
            permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
        ),
        "tool_ref": "mail.read",
    }
    with pytest.raises(BuilderExecutionPolicyError, match="phase"):
        bridge.materialize(**kwargs, phase="refresh")
    assert calls == []
    with pytest.raises(BuilderExecutionPolicyError, match="fence"):
        bridge.materialize(**kwargs, phase="business")


@pytest.mark.parametrize("path", ["before-call", "outcome", "materialize", "claim-dispatch"])
def test_private_native_routes_require_existing_service_auth(path):
    from flask import Flask

    from controllers.inner_api import bp
    from tests.unit_tests.controllers.inner_api.test_agent_tools import _agent_inner_auth

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with _agent_inner_auth():
        response = app.test_client().post(f"/inner/api/agent/native-testing/{path}", json={})
    assert response.status_code == 404


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_private_before_call_bridge_serialization_preserves_wait_reason(reason, monkeypatch, operations_service):
    from dify_agent.adapters.native_testing.client import AgentBeforeCallPayload

    from controllers.inner_api.agent.native_testing import AgentBeforeCallResponse
    from runtime_contracts.builder.native.contracts import ApprovalWait
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import (
        intent,
    )

    payload = AgentBeforeCallPayload.model_validate(
        {
            "ref": {
                "policy_version": "builder-native-test-v1",
                "request_id": "request",
                "invocation_id": "inv",
                "context_digest": "a" * 64,
            },
            "intent": intent().model_dump(mode="json"),
        }
    )
    calls = []

    def before_call(**kwargs):
        calls.append(kwargs)
        return ApprovalWait(pending_operation_id="pending", wait_reason=reason)

    monkeypatch.setattr(operations_service.bridge.authorization, "before_call", before_call)
    from services.dify_builder.native_testing.agent_bridge import AgentNativeTestingBridge

    bridge = AgentNativeTestingBridge(
        authorization=operations_service.bridge.authorization, readiness=None, materializer=None, fence=None
    )
    decision = bridge.before_call(ref=payload.ref, intent=payload.intent)
    assert AgentBeforeCallResponse(root=decision).model_dump(mode="json") == {
        "kind": "waiting",
        "pending_operation_id": "pending",
        "wait_reason": reason,
    }
    assert len(calls) == 1
    assert calls[0]["ref"].model_dump(mode="json") == payload.ref.model_dump(mode="json")
    assert calls[0]["intent"].model_dump(mode="json") == payload.intent.model_dump(mode="json")


def test_native_credential_phases_wait_refresh_then_business_without_double_spend(monkeypatch, operations_service):
    from runtime_contracts.builder.native.contracts import ApprovalWait, DispatchPermit, RecordedResult
    from services.dify_builder.native_testing import agent_bridge as module
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    assert hasattr(module, "NativeAgentCredentialPhases"), "Native credential phase owner is missing"
    business = intent()
    refresh = business.model_copy(
        update={"kind": "oauth", "key": business.key.model_copy(update={"occurrence_path": ("tool", "oauth_refresh")})}
    )
    permit = DispatchPermit(
        permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
    )
    calls = []
    decisions = [
        ApprovalWait(pending_operation_id="pending"),
        permit,
        RecordedResult(operation_id="operation", result_ref="receipt"),
    ]
    from dify_agent.adapters.native_testing.client import AgentMaterialization

    auth = operations_service.bridge.authorization
    monkeypatch.setattr(
        auth, "before_call", lambda **kw: calls.append(("authorize", kw["intent"].kind)) or decisions.pop(0)
    )
    monkeypatch.setattr(auth, "record_outcome", lambda **kw: calls.append(("outcome", kw["outcome"])))
    materializer = module.NativeAgentCredentialMaterializer(
        authorization=auth, resolve_binding=lambda **_kwargs: pytest.fail("unexpected credential resolution")
    )
    monkeypatch.setattr(
        materializer,
        "materialize",
        lambda **kw: (
            calls.append(("refresh", kw["phase"]))
            or AgentMaterialization(
                credential_type="oauth2", credentials={}, runtime_parameters={"credential_ref": "rotated"}
            )
        ),
    )
    monkeypatch.setattr(operations_service.state_store, "store_result", lambda **_kw: "receipt")
    monkeypatch.setattr(operations_service.state_store, "load_result", lambda **_kw: {"credential_ref": "rotated"})
    owner = module.NativeAgentCredentialPhases(
        authorization=auth, materializer=materializer, state_store=operations_service.state_store
    )
    assert owner.refresh(ref="ref", intent=refresh).kind == "waiting"
    assert calls == [("authorize", "oauth")]
    assert owner.refresh(ref="ref", intent=refresh) is None
    assert calls.count(("refresh", "refresh")) == 1
    assert ("authorize", "tool") not in calls
    assert owner.refresh(ref="ref", intent=refresh) is None
    assert calls.count(("refresh", "refresh")) == 1


def test_native_materializer_phase_rejected_before_credential_selection(operations_service):
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing import agent_bridge as module
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    assert hasattr(module, "NativeAgentCredentialMaterializer"), "Native credential materializer is missing"
    owner = module.NativeAgentCredentialMaterializer(
        authorization=operations_service.bridge.authorization,
        resolve_binding=lambda **_kw: pytest.fail("Phase mismatch reached credential selection"),
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_materialization_phase_mismatch"):
        owner.materialize(ref=None, intent=intent(), permit=None, tool_ref=intent().resource_ref, phase="refresh")


def test_actual_native_materializer_uses_existing_oauth_owner_then_cas_before_business(monkeypatch, operations_service):
    from core.dify_builder.models import Actor
    from core.dify_builder.real_call_consent import CredentialReference
    from core.plugin.impl.oauth import OAuthHandler
    from core.tools.tool_manager import ToolManager
    from runtime_contracts.builder.native.contracts import ApprovalWait, DispatchPermit, RecordedResult
    from services.dify_builder.native_testing import agent_bridge as module
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    actor = Actor(account_id="actor", tenant_id="tenant")
    reference = CredentialReference(
        credential_id="credential",
        provider_id="test/plugin/provider",
        alias="test",
        credential_type="oauth2",
        visibility="only_me",
        revision="a" * 64,
        oauth_client_revision="b" * 64,
        expires_at=1,
    )
    from dataclasses import replace

    from services.tools.builder_credential_reference import (
        BuilderCredentialSnapshot,
        CredentialAccessSnapshot,
        OAuthClientSnapshot,
    )
    from services.tools.builtin_tools_manage_service import BuilderCredentialRuntime

    snapshot = BuilderCredentialSnapshot(
        reference=reference,
        encrypted_credentials='{"token":"fixture"}',
        client=OAuthClientSnapshot(source="tenant", row_id="client", encrypted_params="{}", enabled=True),
        access=CredentialAccessSnapshot(basis="owner", account_id="actor", tenant_id="tenant", grants=()),
    )
    selection = BuilderCredentialRuntime(snapshot=snapshot, owner_user_id="owner")
    binding = module.AgentCredentialBinding(
        actor, "resource", "test/plugin/provider", "credential", True, "revision", "configuration-owner"
    )
    events = []
    from core.tools.plugin_tool.provider import PluginToolProviderController
    from tests.unit_tests.services.dify_builder.test_json_tool_metadata import _provider

    controller = PluginToolProviderController(
        entity=_provider().declaration,
        plugin_id="test/plugin",
        plugin_unique_identifier="revision",
        tenant_id="tenant",
    )
    monkeypatch.setattr(controller, "get_credentials_schema_by_type", lambda _: [])
    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_a: controller)
    monkeypatch.setattr(module.BuiltinToolManageService, "load_builder_credential", lambda **_kw: selection)
    monkeypatch.setattr(
        module.BuiltinToolManageService, "decrypt_builder_oauth_client", lambda **_kw: {"client": "fixture"}
    )
    monkeypatch.setattr("core.helper.credential_utils.runtime_check_credential_policy_compliance", lambda **_kw: None)
    from core.helper.provider_cache import NoOpProviderCredentialCache
    from core.helper.provider_encryption import ProviderConfigEncrypter

    encrypter = ProviderConfigEncrypter(
        tenant_id="tenant", config=[], provider_config_cache=NoOpProviderCredentialCache()
    )
    monkeypatch.setattr(encrypter, "decrypt", lambda value: events.append("decrypt") or value)
    monkeypatch.setattr(encrypter, "encrypt", lambda value: value)
    monkeypatch.setattr("core.tools.utils.encryption.create_provider_encrypter", lambda **_kw: (encrypter, None))
    monkeypatch.setattr(
        "core.helper.provider_cache.ToolProviderCredentialsCache.delete", lambda _self: events.append("cache")
    )

    def refresh(**_kwargs):
        assert events[-2:] == ["claim", "decrypt"]
        events.append("refresh")
        from core.plugin.entities.plugin_daemon import PluginOAuthCredentialsResponse

        return PluginOAuthCredentialsResponse(credentials={"token": "rotated-fixture"}, expires_at=4102444800)

    def persist(**kwargs):
        nonlocal selection
        assert events[-1] == "refresh"
        events.append("cas")
        updated = replace(
            snapshot,
            reference=reference.model_copy(update={"revision": "c" * 64, "expires_at": 4102444800}),
            encrypted_credentials=kwargs["encrypted_credentials"],
        )
        selection = replace(selection, snapshot=updated)
        return updated.reference

    monkeypatch.setattr(OAuthHandler, "refresh_credentials", lambda _self, **kw: refresh(**kw))
    monkeypatch.setattr(module.BuiltinToolManageService, "persist_native_agent_refresh", persist)
    permit = DispatchPermit(
        permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
    )
    decision = [
        ApprovalWait(pending_operation_id="pending"),
        permit,
        RecordedResult(operation_id="operation", result_ref="result"),
    ]
    auth = operations_service.bridge.authorization
    monkeypatch.setattr(auth.loader, "load", lambda **_kw: None)
    monkeypatch.setattr(auth, "validate_dispatch", lambda **_kw: None)
    monkeypatch.setattr(auth, "claim_dispatch", lambda **_kw: events.append("claim"))
    monkeypatch.setattr(auth, "before_call", lambda **_kw: decision.pop(0))
    monkeypatch.setattr(auth, "record_outcome", lambda **kw: events.append(kw["outcome"]))
    state_store = operations_service.state_store
    monkeypatch.setattr(state_store, "store_result", lambda **_kw: "result")
    monkeypatch.setattr(state_store, "load_result", lambda **_kw: {"credential_ref": "opaque"})
    materializer = module.NativeAgentCredentialMaterializer(authorization=auth, resolve_binding=lambda **_kw: binding)
    phases = module.NativeAgentCredentialPhases(authorization=auth, materializer=materializer, state_store=state_store)
    effect = intent().model_copy(
        update={
            "kind": "oauth",
            "resource_ref": "resource",
            "implementation_revision": "revision",
            "account_ref": materializer.account_ref(selection),
        }
    )
    assert phases.refresh(ref="ref", intent=effect).kind == "waiting"
    assert events == []
    assert phases.refresh(ref="ref", intent=effect) is None
    assert events == ["claim", "decrypt", "refresh", "cas", "cache", "completed"]
    assert phases.refresh(ref="ref", intent=effect) is None
    assert events.count("refresh") == 1
    business = effect.model_copy(update={"kind": "tool", "account_ref": materializer.account_ref(selection)})
    result = materializer.materialize(ref="ref", intent=business, permit=permit, tool_ref="resource", phase="business")
    assert result.credentials == {"token": "rotated-fixture"}
    assert events.count("refresh") == events.count("cas") == events.count("claim") == 1


def test_missing_credential_configuration_wait_precedes_business_intent(monkeypatch, operations_service):
    from runtime_contracts.builder.native.contracts import ApprovalWait
    from services.dify_builder.native_testing import agent_bridge as module
    from services.dify_builder.native_testing.pending_actions import NativePendingActionService
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    calls = []
    monkeypatch.setattr(
        NativePendingActionService,
        "configuration",
        lambda _self, **kw: (
            calls.append(kw) or ApprovalWait(pending_operation_id="configuration-id", wait_reason="configuration")
        ),
    )
    from datetime import UTC, datetime

    from runtime_contracts.builder.native.contracts import NativeTestContextRef
    from services.dify_builder.native_testing.repository import OwnedNativeTest

    auth = operations_service.bridge.authorization
    owned = OwnedNativeTest(
        ref=NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64),
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        session_id="session",
        test_input_id="input",
        bindings={},
        generation=3,
        task_approved=False,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        state="running",
    )
    monkeypatch.setattr(auth.loader, "load", lambda **_kw: owned)
    monkeypatch.setattr(auth, "before_call", lambda **_kw: pytest.fail("Configuration froze an account effect"))
    binding = module.AgentCredentialBinding(
        auth.loader.actor, "mail.read", "test/plugin/provider", None, True, "revision", "actual-config-owner"
    )
    materializer = module.NativeAgentCredentialMaterializer(authorization=auth, resolve_binding=lambda **_kw: binding)
    monkeypatch.setattr(materializer, "inspect", lambda **_kw: (binding, None))
    owner = module.NativeAgentCredentialPhases(
        authorization=auth, materializer=materializer, state_store=operations_service.state_store
    )
    assert hasattr(owner, "prepare_business"), "Readiness must precede business intent freeze"
    effect = intent()
    result = owner.prepare_business(
        ref="ref",
        key=effect.key,
        tool_ref=effect.resource_ref,
        target=effect.target,
        parameters=effect.parameters,
        input_digest=effect.input_digest,
        capability_digest=effect.capability_digest,
        refresh_intent=None,
    )
    assert result.wait_reason == "configuration"
    assert calls == [{"ref": "ref", "requirements_ref": "actual-config-owner", "expected_generation": 3}]


@pytest.mark.parametrize("case", ["omitted", "changed", "caller", "matching"])
def test_endpoint_lineage_requires_exact_envelope_before_physical_owner_refusal(case, monkeypatch):
    from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload
    from flask import Flask, g, request
    from werkzeug.local import LocalProxy

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing import agent_bridge as module
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import (
        intent,
    )
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner

    lineage, principal, selection, phase = owner()
    effect = intent()
    assert selection.parent_node is not None
    payload = AgentPhysicalDispatchPayload.model_validate(
        {
            "ref": selection.parent_node.ref.model_dump(mode="json"),
            "intent": effect.model_dump(mode="json"),
            "permit": {
                "permit_id": "permit",
                "attempt_id": "attempt",
                "operation_id": "operation",
                "expires_at": "2030-01-01T00:00:00Z",
            },
        }
    )
    calls = []
    monkeypatch.setattr(
        module,
        "agent_bridge_for_ref",
        lambda ref: calls.append(ref) or pytest.fail("Controller claimed"),
    )
    caller = {
        "tenant_id": "other" if case == "caller" else "tenant",
        "app_id": "app",
        "user_id": "actor",
        "user_from": "account",
    }
    reason = {
        "omitted": "native_endpoint_owner_mismatch",
        "changed": "native_endpoint_arguments_mismatch",
        "matching": "native_endpoint_dependency_unavailable",
        "caller": "native_endpoint_owner_mismatch",
    }[case]
    with Flask(__name__).test_request_context():
        g.agent_runtime_request = cast(LocalProxy, request)._get_current_object()

        def claim_endpoint() -> None:
            g.agent_runtime_context = lineage.resolve(
                principal=principal,
                selection=selection,
                boundary="model",
                caller=caller,
            )
            module.claim_agent_endpoint(
                boundary="model",
                caller=caller,
                envelope=None if case == "omitted" else payload,
                target=effect.target,
                parameters={"changed": True} if case == "changed" else effect.parameters,
                kind=effect.kind,
            )

        with pytest.raises(BuilderExecutionPolicyError, match=reason):
            claim_endpoint()
    assert calls == []
    assert phase == ["backend"]


def test_actual_llm_endpoint_rejects_known_native_omission_before_prepare(monkeypatch):
    from services.agent_llm_inner_service import AgentLLMInnerService
    from tests.unit_tests.config_override import config_overrides_context
    from tests.unit_tests.controllers.inner_api.test_agent_llm import _flask_app
    from tests.unit_tests.controllers.inner_api.test_agent_runtime_lineage import (
        encoded,
    )
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner

    app = _flask_app()
    lineage, _principal, selection, phase = owner()
    app.extensions["native_agent_endpoint_lineage"] = lineage
    preparations = []

    def prepare(*args, **kwargs):
        preparations.append((args, kwargs))
        raise AssertionError("Known native omission reached model preparation")

    monkeypatch.setattr(AgentLLMInnerService, "prepare", prepare)
    with config_overrides_context(
        AGENT_BACKEND_API_TOKEN="agent-token",
        INNER_API_KEY_FOR_PLUGIN="plugin-key",
        PLUGIN_DAEMON_KEY="daemon-key",
    ):
        response = app.test_client().post(
            "/inner/api/agent/runtime/llm/invoke",
            json={},
            headers={
                "Authorization": "Bearer agent-token",
                "X-Dify-Agent-Run": encoded(selection),
            },
        )
    assert response.status_code == 409
    assert phase == ["backend"]
    assert preparations == []


def test_private_claim_route_refuses_repeated_requests_without_consuming_permit(
    monkeypatch,
    operations_service,
):
    from flask import Flask

    from controllers.inner_api import bp
    from controllers.inner_api.agent import native_testing as controller
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from tests.unit_tests.config_override import config_overrides_context
    from tests.unit_tests.controllers.inner_api.test_agent_runtime_lineage import (
        encoded,
    )
    from tests.unit_tests.controllers.inner_api.test_agent_tools import (
        _agent_inner_auth,
        _headers,
    )
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import (
        intent,
    )
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner

    # Controllers cannot consume permits. Durable single-use remains covered
    # by the unchanged authoritative authorization owner's PostgreSQL CI inventory.
    claims = []

    def claim(**kw):
        if claims:
            raise BuilderExecutionPolicyError("native_dispatch_already_claimed")
        claims.append(kw)

    monkeypatch.setattr(operations_service.bridge.authorization, "claim_dispatch", claim)
    monkeypatch.setattr(controller, "agent_bridge_for_ref", lambda _ref: operations_service.bridge)
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    payload = {
        "ref": {
            "policy_version": "builder-native-test-v1",
            "request_id": "request",
            "invocation_id": "inv",
            "context_digest": "a" * 64,
        },
        "intent": intent().model_dump(mode="json"),
        "permit": {
            "permit_id": "permit",
            "attempt_id": "attempt",
            "operation_id": "operation",
            "expires_at": "2030-01-01T00:00:00Z",
        },
    }
    with _agent_inner_auth():
        first = app.test_client().post(
            "/inner/api/agent/native-testing/claim-dispatch",
            json=payload,
            headers=_headers(),
        )
        second = app.test_client().post(
            "/inner/api/agent/native-testing/claim-dispatch",
            json=payload,
            headers=_headers(),
        )
    assert first.status_code == second.status_code == 409
    assert claims == []

    # Strict Agent credentials and a positively resolved native identity do not
    # make this controller a physical dispatch owner either.
    lineage, _principal, selection, phase = owner()
    app.extensions["native_agent_endpoint_lineage"] = lineage
    assert selection.parent_node is not None
    payload["ref"] = selection.parent_node.ref.model_dump(mode="json")
    headers = {
        "Authorization": "Bearer agent-token",
        "X-Dify-Agent-Run": encoded(selection),
    }
    with config_overrides_context(
        AGENT_BACKEND_API_TOKEN="agent-token",
        INNER_API_KEY_FOR_PLUGIN="plugin-key",
        PLUGIN_DAEMON_KEY="daemon-key",
    ):
        for _ in range(2):
            response = app.test_client().post(
                "/inner/api/agent/runtime/native-testing/claim-dispatch",
                json=payload,
                headers=headers,
            )
            assert response.status_code == 409
    assert phase == ["backend", "backend"]
    assert claims == []


@pytest.mark.parametrize("drift", [None, "access", "client", "encrypted_credentials"])
def test_native_refresh_cas_rechecks_detached_snapshot_before_write(monkeypatch, drift, operations_service):
    from contextlib import contextmanager
    from dataclasses import replace

    from core.dify_builder.models import Actor
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.tools import builtin_tools_manage_service as module

    actor = Actor(account_id="actor", tenant_id="tenant")
    from core.dify_builder.real_call_consent import CredentialReference
    from models.tools import BuiltinToolProvider, ToolOAuthTenantClient
    from services.tools.builder_credential_reference import (
        BuilderCredentialSnapshot,
        CredentialAccessSnapshot,
        OAuthClientSnapshot,
    )
    from tests.unit_tests.config_override import apply_config_overrides

    snapshot = BuilderCredentialSnapshot(
        reference=CredentialReference(
            credential_id="credential",
            provider_id="test/plugin/provider",
            alias="test",
            credential_type="oauth2",
            visibility="only_me",
            revision="a" * 64,
            oauth_client_revision="b" * 64,
            expires_at=1,
        ),
        access=CredentialAccessSnapshot(basis="owner", account_id="actor", tenant_id="tenant", grants=()),
        client=OAuthClientSnapshot(source="tenant", row_id="client", encrypted_params="{}", enabled=True),
        encrypted_credentials="old-ciphertext",
    )
    selected = module.BuilderCredentialRuntime(snapshot=snapshot, owner_user_id="owner")
    current = replace(snapshot)
    if drift == "access":
        current = replace(current, access=replace(current.access, account_id="other"))
    elif drift == "client":
        current = replace(current, client=replace(current.client, row_id="other"))
    elif drift == "encrypted_credentials":
        current = replace(current, encrypted_credentials="changed")
    reads = []
    row = BuiltinToolProvider(name="test", tenant_id="tenant", user_id="owner", provider="test/plugin/provider")
    row.id = "credential"
    client = ToolOAuthTenantClient(tenant_id="tenant", plugin_id="test/plugin", provider="provider")
    client.id = "client"
    sessions = operations_service.loader.session_factory
    session = sessions()

    def scalar(statement):
        reads.append(statement)
        return [row, client, "credential"][len(reads) - 1]

    monkeypatch.setattr(session, "scalar", scalar)
    monkeypatch.setattr(session, "expire", lambda _row: None)

    @contextmanager
    def transaction():
        with session:
            yield session

    monkeypatch.setattr(sessions, "begin", transaction)
    monkeypatch.setattr(module.session_factory, "get_session_maker", lambda: sessions)
    apply_config_overrides(monkeypatch, SECRET_KEY="fixture-only")
    monkeypatch.setattr(module, "select_builder_credential", lambda *_args, **_kw: current)
    kwargs = {
        "actor": actor,
        "provider_id": "test/plugin/provider",
        "verified_plugin": True,
        "selection": selected,
        "encrypted_credentials": "new-ciphertext",
        "expires_at": 4102444800,
    }
    if drift:
        with pytest.raises(BuilderExecutionPolicyError, match="native_credential_drift"):
            module.BuiltinToolManageService.persist_native_agent_refresh(**kwargs)
        assert len(reads) == 2
    else:
        assert module.BuiltinToolManageService.persist_native_agent_refresh(**kwargs) == current.reference
        assert len(reads) == 3


@pytest.mark.parametrize("field", ["target", "parameters"])
@pytest.mark.parametrize(
    ("approved", "actual", "matches"),
    [
        pytest.param(
            {"nested": {"flag": True}},
            {"nested": {"flag": 1}},
            False,
            id="nested-true-integer",
        ),
        pytest.param(
            {"items": [{"flag": False}]},
            {"items": [{"flag": 0}]},
            False,
            id="array-false-integer",
        ),
        pytest.param({"items": [1]}, {"items": [1.0]}, False, id="integer-float"),
        pytest.param({"items": [-0.0]}, {"items": [0.0]}, False, id="signed-zero"),
        pytest.param(
            {"z": [True, 1.0], "a": {"b": 2, "a": 1}},
            {"a": {"a": 1, "b": 2}, "z": [True, 1.0]},
            True,
            id="key-order",
        ),
    ],
)
def test_endpoint_typed_json_guard_precedes_physical_owner_refusal(field, approved, actual, matches, monkeypatch):
    from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload
    from flask import Flask, g, request
    from werkzeug.local import LocalProxy

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing import agent_bridge as module
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import (
        intent,
    )
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner

    lineage, principal, selection, phase = owner()
    context = lineage.resolve(principal=principal, selection=selection, boundary="model", caller={})
    assert context is not None
    effect = intent().model_copy(update={field: approved})
    payload = AgentPhysicalDispatchPayload.model_validate(
        {
            "ref": context.ref.model_dump(mode="json"),
            "intent": effect.model_dump(mode="json"),
            "permit": {
                "permit_id": "permit",
                "attempt_id": "attempt",
                "operation_id": "operation",
                "expires_at": "2030-01-01T00:00:00Z",
            },
        }
    )
    claims = []
    app = Flask(__name__)
    monkeypatch.setattr(
        module,
        "agent_bridge_for_ref",
        lambda ref: claims.append(ref) or pytest.fail("Controller claimed"),
    )
    with app.test_request_context():
        g.agent_runtime_request = cast(LocalProxy, request)._get_current_object()
        g.agent_runtime_context = context
        kwargs = {
            "boundary": "model",
            "caller": {
                "tenant_id": "tenant",
                "app_id": "app",
                "user_id": "actor",
                "user_from": "account",
            },
            "envelope": payload,
            "target": effect.target,
            "parameters": effect.parameters,
            "kind": effect.kind,
            field: actual,
        }
        reason = "native_endpoint_dependency_unavailable" if matches else "native_endpoint_arguments_mismatch"
        with pytest.raises(BuilderExecutionPolicyError, match=reason):
            module.claim_agent_endpoint(**kwargs)
        assert claims == []
    assert phase == ["backend"]


def test_workflow_factory_injects_native_declaration_preparation(monkeypatch):
    from clients.agent_backend import factory as backend_factory
    from core.app.entities.app_invoke_entities import InvokeFrom
    from services.workflow_runtime.agent_node import DifyAgentNode
    from services.workflow_runtime.node_factory import DifyNodeFactory

    module = service_module()
    from core.app.entities.app_invoke_entities import UserFrom, build_dify_run_context
    from graphon.runtime import InitParams, RuntimeState, VariablePool

    client = backend_factory.create_agent_backend_run_client(base_url="http://agent.invalid")
    monkeypatch.setattr(backend_factory, "create_agent_backend_run_client", lambda **_: client)
    factory = DifyNodeFactory(
        init_params=InitParams(
            run_context=build_dify_run_context(
                tenant_id="tenant",
                app_id="app",
                user_id="actor",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
            ),
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            call_depth=0,
        ),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0),
    )

    kwargs = factory._build_agent_node_init_kwargs(node_class=DifyAgentNode)
    builder = kwargs["runtime_request_builder"]._dify_tools_builder

    assert isinstance(builder._native_declaration_preparer, module.AgentToolDeclarationService)
    layers = builder.build_layers(
        tenant_id="tenant",
        app_id="app",
        user_id="actor",
        tools=AgentSoulToolsConfig(),
        invoke_from=InvokeFrom.DEBUGGER,
        native_test_required=True,
    )
    assert layers.plugin_tools is None
    assert layers.core_tools is None
