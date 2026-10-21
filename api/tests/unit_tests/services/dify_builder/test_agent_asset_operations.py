"""Confirmed published assets retain config and one durable shell authority."""

import pytest
from dify_agent.protocol.native_testing import AgentNativeTestRef

from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from runtime_contracts.builder.native.agent_contracts import AgentPreparedConfig
from services.dify_builder.native_testing.agent_lineage import NativeAgentEndpointContext
from services.dify_builder.native_testing.agent_runtime_config import (
    NativeAgentDefinition,
    NativeAgentRuntimeConfigBuilder,
)
from services.dify_builder.native_testing.agent_tool_declarations import PreparedAgentToolDeclarations
from tests.unit_tests.services.dify_builder import native_owner_fixtures
from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import (
    PARENT,
    WORKSPACE,
    preparation_owner,
    preparation_session,
    resolved_context,
)

operations_service = native_owner_fixtures.operations_service
preparation_sql = native_owner_fixtures.preparation_sql


def protected_config(config=None):
    return AgentPreparedConfig(
        parent_node=PARENT,
        workflow_native_run_id="workflow",
        workspace=WORKSPACE,
        config_ref="config",
        config_digest="a" * 64,
        config={} if config is None else config,
    )


def endpoint_context(config):
    return NativeAgentEndpointContext(
        ref=AgentNativeTestRef.model_validate(PARENT.ref.model_dump(mode="json")),
        config=config,
        association=None,
        native_test_profile="confirmed",
    )


def definition():
    return NativeAgentDefinition("node", "agent", "snapshot", AgentSoulConfig(), WorkflowNodeJobConfig(), "s")


@pytest.mark.parametrize(
    "assets",
    [
        {"config_note": "Follow the configured review instructions."},
        {"config_skills": [{"name": "review", "file_id": "skill-file"}]},
        {"config_files": [{"name": "reference.txt", "file_kind": "upload_file", "file_id": "file"}]},
        {"tools": {"cli_tools": [{"name": "jq", "install_commands": ["command -v jq"]}]}},
    ],
)
def test_confirmed_composer_keeps_published_config_and_shell(assets, monkeypatch, operations_service):
    soul = AgentSoulConfig.model_validate(
        {"model": {"plugin_id": "langgenius/openai", "model_provider": "openai", "model": "test"}, **assets}
    )
    from services.dify_builder.native_testing.agent_tool_declarations import AgentToolDeclarationService

    declarations = AgentToolDeclarationService()
    monkeypatch.setattr(declarations, "prepare", lambda **_kwargs: PreparedAgentToolDeclarations(None, None, ()))
    builder = NativeAgentRuntimeConfigBuilder(
        loader=operations_service.loader, profile="confirmed", declarations=declarations
    )
    request = builder.compose(
        context=resolved_context(),
        definition=NativeAgentDefinition("node", "agent", "pin", soul, WorkflowNodeJobConfig(), "s"),
        parent_node=PARENT,
        workspace=WORKSPACE,
        inputs={},
    )
    layers = {item.name: item.config for item in request.composition.layers}
    assert layers["runtime"]["backend_binding_ref"] == WORKSPACE.backend_binding_ref
    assert layers["shell"]["runtime"] == "runtime"
    assert layers["config"]["config_version"] == {"id": "pin", "kind": "snapshot", "writable": False}
    if "config_note" in assets:
        assert layers["config"]["note"] == "Follow the configured review instructions."
    if "config_skills" in assets:
        assert layers["config"]["skills"][0]["name"] == "review"
    if "config_files" in assets:
        assert layers["config"]["files"][0]["name"] == "reference.txt"
    if "tools" in assets:
        assert layers["shell"]["cli_tools"][0]["install_commands"] == ["command -v jq"]


@pytest.mark.parametrize(
    "mutation", ["none", "binding", "shell", "runtime", "kind", "asset", "composition", "prepared"]
)
def test_shell_intent_uses_exact_protected_composition_and_current_workspace(
    monkeypatch, mutation, operations_service, preparation_sql
):
    from contextlib import contextmanager

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing import agent_confirmed_workspace

    layers = [
        {"name": "shell", "config": {"runtime": "runtime"}},
        {"name": "runtime", "config": {"backend_binding_ref": "scope"}},
        {"name": "config", "config": {"mentioned_file_names": ["reference.txt"]}},
    ]
    prepared = protected_config({"composition": {"layers": layers}})
    # The protected DTO detaches nested JSON; mutate its actual protected composition.
    layers = prepared.config["composition"]["layers"]
    endpoint = endpoint_context(prepared)
    if mutation == "binding":
        layers[1]["config"]["backend_binding_ref"] = "foreign"
    if mutation == "composition":
        layers.append(layers[0])
    boundary = "bootstrap" if mutation == "runtime" else "config_pull"
    target = (
        {"shell": "shell", "kind": "file"} if boundary == "config_pull" else {"shell": "shell", "runtime": "foreign"}
    )
    if mutation == "shell":
        target["shell"] = "foreign"
    if mutation == "kind":
        target["kind"] = "foreign"
    if mutation == "asset":
        layers[2]["config"]["mentioned_file_names"] = []

    from dataclasses import replace

    sql, owned, scope = preparation_session(monkeypatch, operations_service, preparation_sql)
    owned = replace(owned, bindings={agent_confirmed_workspace.ALLOCATION: {}})

    @contextmanager
    def locked(**_kwargs):
        yield sql, owned, scope

    service = operations_service
    monkeypatch.setattr(service.loader, "locked", locked)
    monkeypatch.setattr(
        service.state_store,
        "load_prepared_config",
        lambda **_kwargs: prepared.model_copy(update={"config_ref": "other"}) if mutation == "prepared" else prepared,
    )
    monkeypatch.setattr(service, "_endpoint", lambda _ref: endpoint)
    monkeypatch.setattr(service, "_definition", lambda **_kwargs: (resolved_context(), definition()))
    monkeypatch.setattr(
        agent_confirmed_workspace, "current_confirmed_workspace", lambda **_kwargs: (WORKSPACE, "stamp")
    )
    if mutation == "none":
        result = service._shell(
            ref=PARENT.ref, boundary=boundary, target=target, parameters={"script": "pull reference.txt"}
        )
        assert result[3]["workspace_stamp"] == "stamp"
    else:
        with pytest.raises(BuilderExecutionPolicyError):
            service._shell(
                ref=PARENT.ref, boundary=boundary, target=target, parameters={"script": "pull reference.txt"}
            )


@pytest.mark.parametrize(
    ("claimed", "outcome", "allowed"),
    [(False, None, False), (True, "unknown", False), (True, "completed", False), (True, None, True)],
)
def test_stub_read_requires_claimed_unsettled_shell_operation(
    monkeypatch, claimed, outcome, allowed, operations_service
):

    from models.dify_builder_native_tests import NativeEffectDispatchClaim
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope

    wire = envelope()
    wire = wire.model_copy(update={"intent": wire.intent.model_copy(update={"kind": "shell"})})

    from dataclasses import replace
    from datetime import UTC, datetime

    from models.dify_builder_native_tests import NativeEffectOutcome
    from services.dify_builder.native_testing.agent_bridge import api_ref

    service = operations_service
    owned = replace(preparation_owner(), ref=api_ref(wire.ref))
    monkeypatch.setattr(service.loader, "load", lambda **_kwargs: owned)
    with service.loader.session_factory.begin() as session:
        if claimed:
            session.add(
                NativeEffectDispatchClaim(
                    tenant_id="tenant",
                    request_id=wire.ref.request_id,
                    invocation_id=wire.ref.invocation_id,
                    operation_id=wire.permit.operation_id,
                    attempt_id=wire.permit.attempt_id,
                    claimed_at=datetime.now(UTC),
                )
            )
        if outcome:
            session.add(
                NativeEffectOutcome(
                    tenant_id="tenant",
                    request_id=wire.ref.request_id,
                    invocation_id=wire.ref.invocation_id,
                    operation_id=wire.permit.operation_id,
                    attempt_id=wire.permit.attempt_id,
                    outcome=outcome,
                    result_ref="result" if outcome == "completed" else None,
                )
            )
    endpoint = endpoint_context(protected_config())
    monkeypatch.setattr(service, "_endpoint", lambda _ref: endpoint)
    monkeypatch.setattr(service, "revalidate", lambda **_kwargs: None)
    monkeypatch.setattr(service.bridge.authorization, "validate_dispatch", lambda **_kwargs: None)
    if allowed:
        assert service.validate_claimed_shell(envelope=wire) is endpoint
    else:
        with pytest.raises(BuilderExecutionPolicyError, match="invalid_dispatch_permit"):
            service.validate_claimed_shell(envelope=wire)


@pytest.mark.parametrize(("destructive", "changed"), [(False, False), (True, False), (False, True)])
def test_shell_revalidation_refuses_destructive_or_changed_intent_before_claim(
    monkeypatch, destructive, changed, operations_service
):
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.contracts import operation_digest
    from services.dify_builder.native_testing.agent_bridge import api_intent, api_ref
    from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope

    wire = envelope()
    effect = api_intent(wire.intent).model_copy(
        update={
            "kind": "shell",
            "implementation_revision": "snapshot",
            "key": wire.intent.key.model_copy(update={"occurrence_path": ("execution", "shell_run", "call")}),
        }
    )
    descriptor = {
        "shell_boundary": "shell_run",
        "composition_digest": "a" * 64,
        "workspace": WORKSPACE.model_dump(mode="json"),
    }
    from dataclasses import replace

    from services.dify_builder.native_testing.agent_operations import AgentCallAssessment

    owned = replace(preparation_owner(), bindings={"_agent_operations_v1": {operation_digest(effect.key): descriptor}})
    service = operations_service
    monkeypatch.setattr(service.loader, "load", lambda **_kwargs: owned)
    assessment = AgentCallAssessment(
        action="Run configured shell",
        account_label=None,
        target_summary={},
        parameters_summary={},
        risk_notice="Runs one configured command",
        destructive=destructive,
    )
    monkeypatch.setattr(
        service,
        "snapshot",
        lambda **_kwargs: (
            effect.model_copy(update={"parameters": {"changed": True}}) if changed else effect,
            None,
            assessment,
        ),
    )
    monkeypatch.setattr(
        service,
        "_shell",
        lambda **_kwargs: (resolved_context(), definition(), endpoint_context(protected_config()), {}),
    )
    if destructive or changed:
        with pytest.raises(BuilderExecutionPolicyError):
            service.revalidate(ref=api_ref(wire.ref), intent=effect)
    else:
        assert service.revalidate(ref=api_ref(wire.ref), intent=effect) is None


def test_runtime_shell_result_commits_before_return_and_preserves_exact_key(monkeypatch, operations_service):
    from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope

    wire = envelope()
    wire = wire.model_copy(update={"intent": wire.intent.model_copy(update={"kind": "shell"})})
    events = []
    service = operations_service
    monkeypatch.setattr(
        service.state_store,
        "store_result",
        lambda **_kwargs: events.append(("store", _kwargs["result"])) or "saved-result",
    )
    monkeypatch.setattr(service, "validate_claimed_shell", lambda **_kwargs: events.append("validated"))
    monkeypatch.setattr(
        service.bridge.authorization,
        "record_outcome",
        lambda **_kwargs: events.append(("outcome", _kwargs["outcome"], _kwargs["result_ref"])),
    )
    result = service.store_result(
        ref=wire.ref, key=wire.intent.key, result={"exit_code": 0}, native_dispatch=wire.model_dump(mode="json")
    )
    assert result == "saved-result"
    assert events == ["validated", ("store", {"exit_code": 0}), ("outcome", "completed", "saved-result")]


def test_saved_shell_operation_revalidates_for_public_approval_without_runtime_request(
    monkeypatch, operations_service, preparation_sql
):
    from contextlib import contextmanager

    from runtime_contracts.builder.native.agent_contracts import AgentPreparedConfig
    from services.dify_builder.native_testing import agent_confirmed_workspace

    config = AgentPreparedConfig(
        parent_node=PARENT,
        workflow_native_run_id="workflow",
        workspace=WORKSPACE,
        config_ref="config",
        config_digest="a" * 64,
        config={
            "composition": {
                "layers": [
                    {"name": "shell", "config": {"runtime": "runtime"}},
                    {"name": "runtime", "config": {"backend_binding_ref": "scope"}},
                    {"name": "config", "config": {}},
                ]
            }
        },
    )

    from dataclasses import replace

    sql, owned, scope = preparation_session(monkeypatch, operations_service, preparation_sql)
    owned = replace(owned, bindings={agent_confirmed_workspace.ALLOCATION: {}})

    @contextmanager
    def locked(**_kwargs):
        yield sql, owned, scope

    service = operations_service
    monkeypatch.setattr(service.loader, "locked", locked)
    monkeypatch.setattr(service.state_store, "load_prepared_config", lambda **_kwargs: config)
    monkeypatch.setattr(service, "_definition", lambda **_kwargs: (resolved_context(), definition()))
    monkeypatch.setattr(
        agent_confirmed_workspace, "current_confirmed_workspace", lambda **_kwargs: (WORKSPACE, "stamp")
    )
    result = service._shell(
        ref=PARENT.ref,
        boundary="shell_run",
        target={"shell": "shell"},
        parameters={"script": "pwd"},
        descriptor={"parent_node": PARENT.model_dump(mode="json"), "config_ref": "config"},
    )
    assert result[2].config == config
