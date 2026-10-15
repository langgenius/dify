"""Inert declaration preparation; controlled metadata is not credential qualification."""

import importlib
import importlib.util
from types import SimpleNamespace

import pytest

from core.tools.entities.tool_entities import ToolEntity
from models.agent_config_entities import AgentSoulToolsConfig


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

    tool = SimpleNamespace(
        entity=entity(), get_merged_runtime_parameters=forbidden, get_llm_parameters_json_schema=forbidden
    )
    controller = SimpleNamespace(
        need_credentials=True, plugin_unique_identifier="test/plugin@sha", get_tools=lambda: [tool]
    )
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


@pytest.mark.parametrize("change", [None, "owner", "intent", "key", "scope", "state", "expiry", "permit_expiry"])
def test_same_permit_validation_does_not_claim_or_spend(change):
    from contextlib import contextmanager
    from datetime import UTC, datetime, timedelta

    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService, _scope_digest
    from services.dify_builder.native_testing.contracts import DispatchPermit, NativeTestContextRef, operation_digest
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import binding, intent

    now = datetime(2026, 10, 15, tzinfo=UTC)
    ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
    effect = intent()
    trusted = binding(effect)
    expiry = now + timedelta(minutes=1)
    permit = DispatchPermit(
        permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at=expiry.isoformat()
    )
    operation = SimpleNamespace(
        id="operation",
        operation_digest=operation_digest(effect.key),
        intent_digest=canonical_digest(effect.model_dump(mode="json")),
        scope_digest=_scope_digest(effect, trusted),
        state="claimed",
    )
    attempt = SimpleNamespace(expires_at=expiry)
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

    @contextmanager
    def locked(**_kwargs):
        yield (
            SimpleNamespace(scalar=lambda _query: operation),
            SimpleNamespace(tenant_id="tenant", ref=ref),
            SimpleNamespace(expires_at=expiry),
        )

    loader = SimpleNamespace(load=lambda **_kwargs: None, locked=locked)

    class Service(EffectAuthorizationService):
        def _permit_ref(self, _permit):
            return ref.model_copy(update={"invocation_id": "foreign"}) if change == "owner" else ref

        def _attempt(self, *_args):
            return attempt

        def _binding(self, *_args):
            return trusted

        def _claim(self, *_args):
            pytest.fail("validation spent a second permit")

    service = Service(loader, clock=lambda: now)
    assert hasattr(service, "validate_dispatch"), "Same-permit validator is missing"
    if change is None:
        assert service.validate_dispatch(ref=ref, intent=effect, permit=permit) is None
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            service.validate_dispatch(ref=ref, intent=effect, permit=permit)


def test_marked_request_builder_stops_missing_ref_before_metadata():
    from core.workflow.nodes.agent_v2.runtime_request_builder import (
        WorkflowAgentRuntimeRequestBuilder,
        WorkflowAgentRuntimeRequestBuildError,
    )

    context = SimpleNamespace(dify_context=SimpleNamespace(native_test_required=True, native_test_ref=None))
    with pytest.raises(WorkflowAgentRuntimeRequestBuildError, match="authority"):
        WorkflowAgentRuntimeRequestBuilder().build(context)


@pytest.mark.parametrize("kind", ["waiting", "stop", "recorded", "dispatch"])
def test_private_bridge_maps_exact_decisions_without_losing_payload(kind):
    from dify_agent.protocol.native_testing import AgentEffectIntent, AgentNativeTestRef

    from services.dify_builder.native_testing.contracts import ApprovalWait, DispatchPermit, PolicyStop, RecordedResult
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

    bridge = module.AgentNativeTestingBridge(
        authorization=SimpleNamespace(before_call=before_call), readiness=None, materializer=None, fence=None
    )
    response = bridge.before_call(ref=ref, intent=AgentEffectIntent.model_validate(effect.model_dump(mode="json")))
    assert response.model_dump(mode="json") == decisions[kind].model_dump(mode="json")
    assert seen[0]["intent"] == effect


def test_materialization_rejects_phase_mismatch_and_missing_fence_before_io():
    from dify_agent.protocol.native_testing import AgentDispatchPermit, AgentEffectIntent, AgentNativeTestRef

    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    assert importlib.util.find_spec("services.dify_builder.native_testing.agent_bridge") is not None, (
        "Private bridge is missing"
    )
    module = importlib.import_module("services.dify_builder.native_testing.agent_bridge")
    calls = []
    bridge = module.AgentNativeTestingBridge(
        authorization=SimpleNamespace(validate_dispatch=lambda **_kwargs: calls.append("validated")),
        readiness=None,
        materializer=SimpleNamespace(materialize=lambda **_kwargs: pytest.fail("materialized without durable fence")),
        fence=None,
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
def test_private_before_call_http_preserves_wait_reason(monkeypatch, reason):
    from dify_agent.protocol.native_testing import AgentApprovalWait
    from flask import Flask

    from controllers.inner_api import bp
    from controllers.inner_api.agent import native_testing as controller
    from tests.unit_tests.controllers.inner_api.test_agent_tools import _agent_inner_auth, _headers
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    monkeypatch.setattr(
        controller,
        "agent_bridge_for_ref",
        lambda _ref: SimpleNamespace(
            before_call=lambda **_kwargs: AgentApprovalWait(pending_operation_id="pending", wait_reason=reason)
        ),
    )
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with _agent_inner_auth():
        response = app.test_client().post(
            "/inner/api/agent/native-testing/before-call",
            json={
                "ref": {
                    "policy_version": "builder-native-test-v1",
                    "request_id": "request",
                    "invocation_id": "inv",
                    "context_digest": "a" * 64,
                },
                "intent": intent().model_dump(mode="json"),
            },
            headers=_headers(),
        )
    assert response.status_code == 200
    assert response.get_json() == {"kind": "waiting", "pending_operation_id": "pending", "wait_reason": reason}


def test_native_credential_phases_wait_refresh_then_business_without_double_spend():
    from services.dify_builder.native_testing import agent_bridge as module
    from services.dify_builder.native_testing.contracts import ApprovalWait, DispatchPermit, RecordedResult
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
    auth = SimpleNamespace(
        before_call=lambda **kw: calls.append(("authorize", kw["intent"].kind)) or decisions.pop(0),
        record_outcome=lambda **kw: calls.append(("outcome", kw["outcome"])),
    )
    owner = module.NativeAgentCredentialPhases(
        authorization=auth,
        materializer=SimpleNamespace(
            materialize=lambda **kw: (
                calls.append(("refresh", kw["phase"]))
                or SimpleNamespace(runtime_parameters={"credential_ref": "rotated"})
            )
        ),
        state_store=SimpleNamespace(
            store_result=lambda **_kw: "receipt", load_result=lambda **_kw: {"credential_ref": "rotated"}
        ),
    )
    assert owner.refresh(ref="ref", intent=refresh).kind == "waiting"
    assert calls == [("authorize", "oauth")]
    assert owner.refresh(ref="ref", intent=refresh) is None
    assert calls.count(("refresh", "refresh")) == 1
    assert ("authorize", "tool") not in calls
    assert owner.refresh(ref="ref", intent=refresh) is None
    assert calls.count(("refresh", "refresh")) == 1


def test_native_materializer_phase_rejected_before_credential_selection():
    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
    from services.dify_builder.native_testing import agent_bridge as module
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    assert hasattr(module, "NativeAgentCredentialMaterializer"), "Native credential materializer is missing"
    owner = module.NativeAgentCredentialMaterializer(
        authorization=SimpleNamespace(),
        resolve_binding=lambda **_kw: pytest.fail("Phase mismatch reached credential selection"),
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_materialization_phase_mismatch"):
        owner.materialize(ref=None, intent=intent(), permit=None, tool_ref=intent().resource_ref, phase="refresh")


def test_actual_native_materializer_uses_existing_oauth_owner_then_cas_before_business(monkeypatch):
    from core.dify_builder.models import Actor
    from core.dify_builder.real_call_consent import CredentialReference
    from core.plugin.impl.oauth import OAuthHandler
    from core.tools.tool_manager import ToolManager
    from services.dify_builder.native_testing import agent_bridge as module
    from services.dify_builder.native_testing.contracts import ApprovalWait, DispatchPermit, RecordedResult
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
    snapshot = SimpleNamespace(reference=reference, encrypted_credentials='{"token":"fixture"}', client="client")
    selection = SimpleNamespace(snapshot=snapshot, owner_user_id="owner")
    binding = module.AgentCredentialBinding(
        actor, "resource", "test/plugin/provider", "credential", True, "revision", "configuration-owner"
    )
    events = []
    controller = SimpleNamespace(plugin_unique_identifier="revision", get_credentials_schema_by_type=lambda _: [])
    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_a: controller)
    monkeypatch.setattr(module.BuiltinToolManageService, "load_builder_credential", lambda **_kw: selection)
    monkeypatch.setattr(
        module.BuiltinToolManageService, "decrypt_builder_oauth_client", lambda **_kw: {"client": "fixture"}
    )
    monkeypatch.setattr("core.helper.credential_utils.runtime_check_credential_policy_compliance", lambda **_kw: None)
    monkeypatch.setattr(
        "core.tools.utils.encryption.create_provider_encrypter",
        lambda **_kw: (
            SimpleNamespace(decrypt=lambda value: events.append("decrypt") or value, encrypt=lambda value: value),
            None,
        ),
    )
    monkeypatch.setattr(
        "core.helper.provider_cache.ToolProviderCredentialsCache.delete", lambda _self: events.append("cache")
    )

    def refresh(**_kwargs):
        assert events[-2:] == ["claim", "decrypt"]
        events.append("refresh")
        return SimpleNamespace(credentials={"token": "rotated-fixture"}, expires_at=4102444800)

    def persist(**kwargs):
        assert events[-1] == "refresh"
        events.append("cas")
        snapshot.reference = reference.model_copy(update={"revision": "c" * 64, "expires_at": 4102444800})
        snapshot.encrypted_credentials = kwargs["encrypted_credentials"]
        return snapshot.reference

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
    auth = SimpleNamespace(
        loader=SimpleNamespace(actor=actor, load=lambda **_kw: None),
        validate_dispatch=lambda **_kw: None,
        claim_dispatch=lambda **_kw: events.append("claim"),
        before_call=lambda **_kw: decision.pop(0),
        record_outcome=lambda **kw: events.append(kw["outcome"]),
    )
    materializer = module.NativeAgentCredentialMaterializer(authorization=auth, resolve_binding=lambda **_kw: binding)
    phases = module.NativeAgentCredentialPhases(
        authorization=auth,
        materializer=materializer,
        state_store=SimpleNamespace(
            store_result=lambda **_kw: "result", load_result=lambda **_kw: {"credential_ref": "opaque"}
        ),
    )
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


def test_missing_credential_configuration_wait_precedes_business_intent(monkeypatch):
    from services.dify_builder.native_testing import agent_bridge as module
    from services.dify_builder.native_testing.contracts import ApprovalWait
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
    auth = SimpleNamespace(
        loader=SimpleNamespace(load=lambda **_kw: SimpleNamespace(generation=3)),
        before_call=lambda **_kw: pytest.fail("Configuration froze an account effect"),
    )
    owner = module.NativeAgentCredentialPhases(
        authorization=auth,
        materializer=SimpleNamespace(
            inspect=lambda **_kw: (SimpleNamespace(requirements_ref="actual-config-owner"), None)
        ),
        state_store=None,
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
def test_endpoint_lineage_requires_exact_envelope_before_claim(case, monkeypatch):
    from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload
    from flask import Flask

    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
    from services.dify_builder.native_testing import agent_bridge as module
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    assert hasattr(module, "claim_agent_endpoint"), "Actual endpoint lineage gate is missing"
    effect = intent()
    payload = AgentPhysicalDispatchPayload.model_validate(
        {
            "ref": {
                "policy_version": "builder-native-test-v1",
                "request_id": "request",
                "invocation_id": effect.key.invocation_id,
                "context_digest": "a" * 64,
            },
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
    app = Flask(__name__)
    app.extensions["native_agent_endpoint_lineage"] = SimpleNamespace(resolve=lambda **_kw: payload.ref)
    monkeypatch.setattr(
        module,
        "agent_bridge_for_ref",
        lambda _ref: SimpleNamespace(
            authorization=SimpleNamespace(
                loader=SimpleNamespace(
                    load=lambda **_kw: SimpleNamespace(tenant_id="tenant", app_id="app", actor_id="actor")
                ),
                claim_dispatch=lambda **kw: calls.append(kw),
            )
        ),
    )
    with app.app_context():
        kwargs = {
            "boundary": "model",
            "caller": {
                "tenant_id": "other" if case == "caller" else "tenant",
                "app_id": "app",
                "user_id": "actor",
                "user_from": "account",
            },
            "envelope": None if case == "omitted" else payload,
            "target": effect.target,
            "parameters": {"changed": True} if case == "changed" else effect.parameters,
            "kind": effect.kind,
        }
        if case == "matching":
            module.claim_agent_endpoint(**kwargs)
            assert len(calls) == 1
        else:
            with pytest.raises(BuilderExecutionPolicyError):
                module.claim_agent_endpoint(**kwargs)
            assert calls == []


def test_actual_llm_endpoint_rejects_known_native_omission_before_prepare(monkeypatch):
    from dify_agent.protocol.native_testing import AgentNativeTestRef

    from services.agent_llm_inner_service import AgentLLMInnerService
    from tests.unit_tests.controllers.inner_api.test_agent_llm import _agent_inner_auth, _flask_app, _payload

    app = _flask_app()
    ref = AgentNativeTestRef(
        policy_version="builder-native-test-v1",
        request_id="request",
        invocation_id="invocation",
        context_digest="a" * 64,
    )
    app.extensions["native_agent_endpoint_lineage"] = SimpleNamespace(resolve=lambda **_kw: ref)
    monkeypatch.setattr(
        AgentLLMInnerService, "prepare", lambda *_args: pytest.fail("Known native omission reached model preparation")
    )
    with _agent_inner_auth():
        response = app.test_client().post(
            "/inner/api/agent/llm/invoke", json=_payload(), headers={"X-Inner-Api-Key": "inner-key"}
        )
    assert response.status_code == 409


def test_private_claim_route_consumes_once_and_rejects_repeated_request(monkeypatch):
    from flask import Flask

    from controllers.inner_api import bp
    from controllers.inner_api.agent import native_testing as controller
    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
    from tests.unit_tests.controllers.inner_api.test_agent_tools import _agent_inner_auth, _headers
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    # Only the HTTP adapter is exercised here. Durable concurrent uniqueness
    # is covered by the shared authorization owner's PostgreSQL CI inventory.
    claims = []

    def claim(**kw):
        if claims:
            raise BuilderExecutionPolicyError("native_dispatch_already_claimed")
        claims.append(kw)

    monkeypatch.setattr(
        controller,
        "agent_bridge_for_ref",
        lambda _ref: SimpleNamespace(authorization=SimpleNamespace(claim_dispatch=claim)),
    )
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
            "/inner/api/agent/native-testing/claim-dispatch", json=payload, headers=_headers()
        )
        second = app.test_client().post(
            "/inner/api/agent/native-testing/claim-dispatch", json=payload, headers=_headers()
        )
    assert first.status_code == 200
    assert first.get_json() == {"claimed": True}
    assert second.status_code == 409
    assert len(claims) == 1


@pytest.mark.parametrize("drift", [None, "access", "client", "encrypted_credentials"])
def test_native_refresh_cas_rechecks_detached_snapshot_before_write(monkeypatch, drift):
    from contextlib import contextmanager
    from copy import copy

    from core.dify_builder.models import Actor
    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
    from services.tools import builtin_tools_manage_service as module

    actor = Actor(account_id="actor", tenant_id="tenant")
    snapshot = SimpleNamespace(
        reference=SimpleNamespace(credential_type="oauth2", credential_id="credential", expires_at=1),
        access=SimpleNamespace(grant_ids=()),
        client=SimpleNamespace(source="tenant", row_id="client"),
        encrypted_credentials="old-ciphertext",
    )
    selected = SimpleNamespace(snapshot=snapshot, owner_user_id="owner")
    current = copy(snapshot)
    if drift:
        setattr(current, drift, "changed")
    reads = []

    def scalar(statement):
        reads.append(statement)
        return [SimpleNamespace(id="credential", user_id="owner"), object(), "credential"][len(reads) - 1]

    @contextmanager
    def transaction():
        yield SimpleNamespace(scalar=scalar, expire=lambda _row: None)

    monkeypatch.setattr(module.session_factory, "get_session_maker", lambda: SimpleNamespace(begin=transaction))
    monkeypatch.setattr(module.dify_config, "SECRET_KEY", "fixture-only")
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
        pytest.param({"nested": {"flag": True}}, {"nested": {"flag": 1}}, False, id="nested-true-integer"),
        pytest.param({"items": [{"flag": False}]}, {"items": [{"flag": 0}]}, False, id="array-false-integer"),
        pytest.param({"items": [1]}, {"items": [1.0]}, False, id="integer-float"),
        pytest.param({"items": [-0.0]}, {"items": [0.0]}, False, id="signed-zero"),
        pytest.param(
            {"z": [True, 1.0], "a": {"b": 2, "a": 1}}, {"a": {"a": 1, "b": 2}, "z": [True, 1.0]}, True, id="key-order"
        ),
    ],
)
def test_endpoint_typed_json_guard_precedes_physical_claim(field, approved, actual, matches, monkeypatch):
    from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload
    from flask import Flask

    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
    from services.dify_builder.native_testing import agent_bridge as module
    from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent

    effect = intent().model_copy(update={field: approved})
    payload = AgentPhysicalDispatchPayload.model_validate(
        {
            "ref": {
                "policy_version": "builder-native-test-v1",
                "request_id": "request",
                "invocation_id": effect.key.invocation_id,
                "context_digest": "a" * 64,
            },
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
    app.extensions["native_agent_endpoint_lineage"] = SimpleNamespace(resolve=lambda **_kw: payload.ref)
    monkeypatch.setattr(
        module,
        "agent_bridge_for_ref",
        lambda _ref: SimpleNamespace(
            authorization=SimpleNamespace(
                loader=SimpleNamespace(
                    load=lambda **_kw: SimpleNamespace(tenant_id="tenant", app_id="app", actor_id="actor")
                ),
                claim_dispatch=lambda **kw: claims.append(kw),
            )
        ),
    )
    with app.app_context():
        kwargs = {
            "boundary": "model",
            "caller": {"tenant_id": "tenant", "app_id": "app", "user_id": "actor", "user_from": "account"},
            "envelope": payload,
            "target": effect.target,
            "parameters": effect.parameters,
            "kind": effect.kind,
            field: actual,
        }
        if matches:
            module.claim_agent_endpoint(**kwargs)
            assert len(claims) == 1
        else:
            with pytest.raises(BuilderExecutionPolicyError, match="native_endpoint_arguments_mismatch"):
                module.claim_agent_endpoint(**kwargs)
            assert claims == []
