"""Actual lineage policy; backend and protected state I/O are explicit doubles."""

from typing import cast
from unittest.mock import patch

import pytest
from dify_agent.protocol.native_testing import (
    AgentRuntimeIdentity,
    AgentRunTransportSelection,
    ReadAgentRuntimeIdentity,
)
from pydantic import JsonValue
from sqlalchemy.orm import Session

from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.agent_contracts import (
    AgentNodeAssociation,
    AgentPreparedConfig,
)
from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.native_testing.agent_lineage import AgentServicePrincipal, NativeAgentEndpointLineage
from services.dify_builder.native_testing.agent_operations import AgentOperationService
from tests.unit_tests.services.dify_builder import native_owner_fixtures
from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import (
    CONFIG,
    PARENT,
    WORKSPACE,
    resolved_context,
)

operations_service = native_owner_fixtures.operations_service
preparation_sql = native_owner_fixtures.preparation_sql


def owner(
    parent: bool = True, mutation: str | None = None, unbound: bool = False
) -> tuple[NativeAgentEndpointLineage, AgentServicePrincipal, AgentRunTransportSelection, list[str]]:
    from dify_agent.protocol.native_testing import AgentRunTransportSelection

    from services.dify_builder.native_testing.agent_lineage import (
        AgentServicePrincipal,
        NativeAgentEndpointLineage,
    )

    wire_parent = PARENT.model_dump(mode="json") if parent else None
    selection = AgentRunTransportSelection(
        agent_run_id="run",
        parent_node=wire_parent,
        request_digest="a" * 64,
        agent_generation=0,
    )
    config = AgentPreparedConfig(
        parent_node=PARENT,
        workflow_native_run_id="workflow",
        workspace=WORKSPACE,
        config_ref="cfg",
        config_digest="a" * 64,
        config=CONFIG,
    )
    association = AgentNodeAssociation(
        parent_node=PARENT,
        workflow_native_run_id="workflow",
        workspace=WORKSPACE,
        agent_run_id="run",
        config_ref="cfg",
        config_digest="a" * 64,
        pinned_snapshot_id="pin",
        home_snapshot_id="home",
    )
    phase: list[str] = []

    def load_context(**kwargs: object) -> ResolvedNativeTestContext:
        del kwargs
        return resolved_context(
            tenant_id="foreign" if phase and mutation == "tenant-owner" else "tenant",
            actor_id="foreign" if phase and mutation == "actor-owner" else "actor",
            app_id="app",
            native_run_id="workflow",
            generation=5 if phase and mutation == "owner" else 4,
        )

    def load_prepared_config(**kwargs: object) -> AgentPreparedConfig:
        del kwargs
        return config.model_copy(update={"config_digest": "f" * 64}) if phase and mutation == "config" else config

    def discover_agent_run(**kwargs: object) -> AgentNodeAssociation | None:
        del kwargs
        if unbound:
            return None
        return association.model_copy(update={"agent_run_id": "foreign"}) if mutation == "association" else association

    def read_run_identity_sync(run_id: str, query: ReadAgentRuntimeIdentity) -> AgentRuntimeIdentity | None:
        assert run_id == "run"
        assert query.request_digest == "a" * 64
        assert query.parent_node == selection.parent_node
        phase.append("backend")
        if mutation == "unavailable":
            raise TimeoutError("private read unavailable")
        if mutation == "missing":
            return None
        raw = {
            "run_id": "run",
            "parent_node": wire_parent,
            "execution_mode": "builder_test" if parent else "ordinary",
            "request_digest": "a" * 64,
            "agent_generation": 0,
        }
        if mutation == "run":
            raw["run_id"] = "foreign"
        if mutation == "digest":
            raw["request_digest"] = "b" * 64
        if mutation == "generation":
            raw["agent_generation"] = 1
        if mutation == "parent":
            raw["parent_node"] = PARENT.model_dump(mode="json") | {"input_result_ref": "other"}
        return AgentRuntimeIdentity.model_validate(raw)

    from dify_agent.client import Client
    from sqlalchemy.orm import sessionmaker

    from core.dify_builder.models import Actor
    from services.dify_builder.native_testing.agent_operations import AgentOperationBindingResolver
    from services.dify_builder.native_testing.agent_preparation import AgentPreparationService
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

    loader = OwnedNativeTestLoader(
        sessionmaker(), actor=Actor(account_id="actor", tenant_id="tenant"), resolver=AgentOperationBindingResolver()
    )
    store = NativeExecutionStateStore(loader)
    store.load_context = load_context
    store.load_prepared_config = load_prepared_config
    store.discover_agent_run = discover_agent_run

    def settlement_identity(
        **kwargs: object,
    ) -> tuple[ResolvedNativeTestContext, AgentPreparedConfig, AgentNodeAssociation]:
        saved = discover_agent_run(**kwargs)
        if saved is None:
            raise BuilderExecutionPolicyError("native_agent_identity_mismatch")
        return load_context(**kwargs), load_prepared_config(**kwargs), saved

    store.load_agent_settlement_identity = settlement_identity
    backend = Client(base_url="http://agent.invalid")
    patch.object(backend, "read_run_identity_sync", side_effect=read_run_identity_sync).start()
    preparation = AgentPreparationService(state_store=store, backend=backend, workspace=None, config_builder=None)
    lineage = NativeAgentEndpointLineage(backend=backend, preparation_for_ref=lambda _ref: preparation)
    return lineage, AgentServicePrincipal(), selection, phase


def test_only_positive_actual_ordinary_identity_returns_none() -> None:
    lineage, principal, selection, phase = owner(parent=False)
    assert lineage.resolve(principal=principal, selection=selection, boundary="model", caller={}) is None
    assert phase == ["backend"]


@pytest.mark.parametrize(
    "mutation",
    [
        "unavailable",
        "missing",
        "run",
        "digest",
        "generation",
        "parent",
        "owner",
        "config",
        "association",
        "tenant-owner",
        "actor-owner",
    ],
)
def test_mismatched_private_or_current_protected_state_refuses(mutation: str) -> None:
    lineage, principal, selection, _phase = owner(mutation=mutation)
    with pytest.raises(BuilderExecutionPolicyError):
        lineage.resolve(principal=principal, selection=selection, boundary="model", caller={})


def test_unknown_native_association_never_returns_ordinary() -> None:
    lineage, principal, selection, _phase = owner(unbound=True)
    with pytest.raises(BuilderExecutionPolicyError):
        lineage.resolve(principal=principal, selection=selection, boundary="model", caller={})


def test_native_binding_control_does_not_require_existing_association_or_effect_envelope() -> None:
    lineage, principal, selection, phase = owner(unbound=True)
    result = lineage.resolve(principal=principal, selection=selection, boundary="prepare-run", caller={})
    assert PARENT is not None
    assert result is not None
    assert result.ref.model_dump(mode="json") == PARENT.ref.model_dump(mode="json")
    assert phase == ["backend"]


def test_bound_native_effect_resolves_owned_context_without_claiming_permit() -> None:
    lineage, principal, selection, _phase = owner()
    result = lineage.resolve(
        principal=principal,
        selection=selection,
        boundary="model",
        caller={
            "tenant_id": "tenant",
            "user_id": "actor",
            "app_id": "app",
            "user_from": "account",
        },
    )
    assert result is not None
    assert result.association is not None
    assert result.association.agent_run_id == "run"
    assert result is not None
    assert result.physical_owner_ready is False


@pytest.mark.parametrize(
    "caller",
    [{"agent_run_id": "foreign"}, {"tenant_id": "foreign"}, {"user_id": "foreign"}],
)
def test_caller_cannot_override_owned_run_or_parent(caller: dict[str, JsonValue]) -> None:
    lineage, principal, selection, _phase = owner()
    with pytest.raises(BuilderExecutionPolicyError):
        lineage.resolve(principal=principal, selection=selection, boundary="model", caller=caller)


def test_resolver_requires_authenticated_principal() -> None:
    lineage, _principal, selection, phase = owner(parent=False)
    # Deliberately violate the typed internal contract to test the runtime authentication guard.
    with pytest.raises(BuilderExecutionPolicyError):
        lineage.resolve(principal=cast(AgentServicePrincipal, None), selection=selection, boundary="model", caller={})
    assert phase == []


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ("none", "native_endpoint_dependency_unavailable"),
        ("target", "native_endpoint_arguments_mismatch"),
        ("parameters", "native_endpoint_arguments_mismatch"),
        ("kind", "native_endpoint_arguments_mismatch"),
        ("ref", "native_endpoint_owner_mismatch"),
    ],
)
def test_validated_native_context_checks_exact_effect_but_never_spends_permit(change: str, reason: str) -> None:
    from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload
    from flask import Flask, g, request

    from services.dify_builder.native_testing.agent_bridge import claim_agent_endpoint

    lineage, principal, selection, _phase = owner()
    context = lineage.resolve(principal=principal, selection=selection, boundary="model", caller={})
    assert context is not None
    envelope = AgentPhysicalDispatchPayload.model_validate(
        {
            "ref": context.ref.model_dump(mode="json"),
            "intent": {
                "key": {
                    "invocation_id": "inv",
                    "occurrence_path": ["node"],
                    "cursor": 0,
                },
                "kind": "model",
                "resource_ref": "model",
                "implementation_revision": "revision",
                "account_ref": None,
                "target": {"model": "m"},
                "parameters": {"query": "hello"},
                "input_digest": "a" * 64,
                "capability_digest": "b" * 64,
            },
            "permit": {
                "permit_id": "p",
                "attempt_id": "a",
                "operation_id": "o",
                "expires_at": "2099-01-01T00:00:00Z",
            },
        }
    )
    if change == "ref":
        envelope = envelope.model_copy(update={"ref": envelope.ref.model_copy(update={"request_id": "foreign"})})
    with Flask(__name__).test_request_context():
        from flask import Request
        from werkzeug.local import LocalProxy

        g.agent_runtime_request = cast("LocalProxy[Request]", request)._get_current_object()
        g.agent_runtime_context = context
        with pytest.raises(BuilderExecutionPolicyError, match=reason):
            claim_agent_endpoint(
                boundary="model",
                caller={},
                envelope=envelope,
                target={"model": "other" if change == "target" else "m"},
                parameters={"query": "other" if change == "parameters" else "hello"},
                kind="tool" if change == "kind" else "model",
            )


@pytest.mark.parametrize("mutation", ["none", "identity-io", "object-io"])
@pytest.mark.parametrize("boundary", ["model", "native-settlement"])
def test_real_s1_config_and_final_resource_recheck_composes_with_lineage(
    monkeypatch: pytest.MonkeyPatch,
    mutation: str,
    operations_service: AgentOperationService,
    preparation_sql: Session,
    boundary: str,
) -> None:
    """Real protected read/recheck; SQL/access/storage/backend are explicit doubles."""
    from dify_agent.protocol.native_testing import AgentRunTransportSelection

    from runtime_contracts.builder.execution import canonical_digest
    from services.dify_builder.native_testing import state_store as state
    from services.dify_builder.native_testing.agent_lineage import AgentServicePrincipal, NativeAgentEndpointLineage
    from services.dify_builder.native_testing.agent_preparation import AgentPreparationService
    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import (
        preparation_session,
        prepared_state,
    )

    sql, owned, scope = preparation_session(monkeypatch, operations_service, preparation_sql)
    store = operations_service.state_store
    monkeypatch.setattr(store.loader, "session_factory", lambda: sql)
    monkeypatch.setattr(store.loader, "_load", lambda *_args, **_kwargs: (owned, scope))
    prepared = prepared_state()
    prepared.settlement = boundary == "native-settlement"
    context = prepared.context
    value: dict[str, JsonValue] = {
        "schema": "agent-config-v2",
        "parent_node": PARENT.model_dump(mode="json"),
        "workflow_native_run_id": "workflow",
        "workspace": WORKSPACE.model_dump(mode="json"),
        "resource_digest": "e" * 64,
        "config": CONFIG,
    }
    receipt = state.ObjectReceipt(
        "cfg",
        "tenant",
        "req",
        "inv",
        "result",
        store._agent_key("agent-config", PARENT),
        "key",
        "a" * 64,
        canonical_digest(value),
    )
    sql.add(state.NativePayloadObject(**vars(receipt)))
    sql.commit()
    resource = {"stamp": "e" * 64}
    monkeypatch.setattr(store, "_agent_prepare", lambda **_kwargs: prepared)
    monkeypatch.setattr(store, "load_context", lambda **_kwargs: context)
    monkeypatch.setattr(store, "_agent_refresh_access", lambda *_args: None)
    monkeypatch.setattr(store, "_validate_node_inputs_owner", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(store, "_agent_single_parent", lambda *_args: None)
    monkeypatch.setattr(
        store,
        "_agent_resources",
        lambda *_args, **_kwargs: (WORKSPACE, resource["stamp"]),
    )
    reads = []

    def read(*args: object, **kwargs: object) -> dict[str, JsonValue]:
        del kwargs
        assert not sql.info["locked"]
        reads.append("object")
        if mutation == "object-io" and len(reads) > 1:
            resource["stamp"] = "f" * 64
        receipt = args[0]
        if isinstance(receipt, state.ObjectReceipt) and receipt.logical_key.startswith("agent-bind:"):
            return association.model_dump(mode="json")
        return value

    monkeypatch.setattr(store, "_read_object", read)
    association = AgentNodeAssociation(
        parent_node=PARENT,
        workflow_native_run_id="workflow",
        workspace=WORKSPACE,
        agent_run_id="run",
        config_ref="cfg",
        config_digest=canonical_digest(CONFIG),
        pinned_snapshot_id="pin",
        home_snapshot_id="home",
    )
    monkeypatch.setattr(store, "discover_agent_run", lambda **_kwargs: association)
    sql.add(
        state.NativePayloadObject(
            id="association",
            tenant_id="tenant",
            request_id="req",
            invocation_id="inv",
            kind="result",
            logical_key=store._agent_key("agent-bind", PARENT),
            storage_key="association-key",
            payload_digest="b" * 64,
            value_digest=canonical_digest(association.model_dump(mode="json")),
        )
    )
    sql.commit()

    def read_run_identity_sync(run_id: object, selection: object) -> AgentRuntimeIdentity:
        del run_id, selection
        assert not sql.info["locked"]
        if mutation == "identity-io":
            resource["stamp"] = "f" * 64
        return AgentRuntimeIdentity(
            run_id="run",
            parent_node=PARENT.model_dump(mode="json"),
            request_digest=canonical_digest(CONFIG),
            execution_mode="builder_test",
            agent_generation=0,
        )

    from dify_agent.client import Client

    backend = Client(base_url="http://agent.invalid")
    monkeypatch.setattr(backend, "read_run_identity_sync", read_run_identity_sync)
    preparation = AgentPreparationService(state_store=store, backend=backend, workspace=None, config_builder=None)
    lineage = NativeAgentEndpointLineage(backend=backend, preparation_for_ref=lambda _ref: preparation)
    selection = AgentRunTransportSelection(
        agent_run_id="run",
        parent_node=PARENT.model_dump(mode="json"),
        request_digest=canonical_digest(CONFIG),
        agent_generation=0,
    )
    if mutation == "none":
        resolved = lineage.resolve(principal=AgentServicePrincipal(), selection=selection, boundary=boundary, caller={})
        assert resolved is not None
        assert resolved.association == association
    else:
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_owner_mismatch"):
            lineage.resolve(
                principal=AgentServicePrincipal(),
                selection=selection,
                boundary=boundary,
                caller={},
            )
    assert not sql.info["locked"]


def test_expired_request_native_context_cannot_taint_later_ordinary_preflight() -> None:
    from flask import Flask, g

    from services.dify_builder.native_testing.agent_bridge import claim_agent_endpoint

    lineage, principal, selection, _phase = owner()
    context = lineage.resolve(principal=principal, selection=selection, boundary="model", caller={})
    with Flask(__name__).test_request_context():
        g.agent_runtime_context = context
        g.agent_runtime_request = object()
        claim_agent_endpoint(
            boundary="model",
            caller={},
            envelope=None,
            target={},
            parameters={},
            kind="model",
        )
