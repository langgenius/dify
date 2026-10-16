"""Actual lineage policy; backend and protected state I/O are explicit doubles."""

from types import SimpleNamespace

import pytest
from dify_agent.protocol.native_testing import AgentRuntimeIdentity
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
from services.dify_builder.native_testing.agent_contracts import (
    AgentNodeAssociation,
    AgentPreparedConfig,
)

from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import (
    CONFIG,
    PARENT,
    WORKSPACE,
)


def owner(parent=True, mutation=None, unbound=False):
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
    phase = []

    class Store:
        def load_context(self, **kwargs):
            return SimpleNamespace(
                tenant_id="foreign"
                if phase and mutation == "tenant-owner"
                else "tenant",
                actor_id="foreign" if phase and mutation == "actor-owner" else "actor",
                app_id="app",
                native_run_id="workflow",
                generation=5 if phase and mutation == "owner" else 4,
            )

        def load_prepared_config(self, **kwargs):
            return (
                config.model_copy(update={"config_digest": "f" * 64})
                if phase and mutation == "config"
                else config
            )

        def discover_agent_run(self, **kwargs):
            if unbound:
                return None
            return (
                association.model_copy(update={"agent_run_id": "foreign"})
                if mutation == "association"
                else association
            )

    class Backend:
        def read_run_identity_sync(self, run_id, query):
            assert run_id == "run"
            assert (
                query.request_digest == "a" * 64
                and query.parent_node == selection.parent_node
            )
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
                raw["parent_node"] = PARENT.model_dump(mode="json") | {
                    "input_result_ref": "other"
                }
            return AgentRuntimeIdentity.model_validate(raw)

    store = Store()
    lineage = NativeAgentEndpointLineage(
        backend=Backend(),
        preparation_for_ref=lambda ref: SimpleNamespace(state_store=store),
    )
    return lineage, AgentServicePrincipal(), selection, phase


def test_only_positive_actual_ordinary_identity_returns_none():
    lineage, principal, selection, phase = owner(parent=False)
    assert (
        lineage.resolve(
            principal=principal, selection=selection, boundary="model", caller={}
        )
        is None
    )
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
def test_mismatched_private_or_current_protected_state_refuses(mutation):
    lineage, principal, selection, _phase = owner(mutation=mutation)
    with pytest.raises(BuilderExecutionPolicyError):
        lineage.resolve(
            principal=principal, selection=selection, boundary="model", caller={}
        )


def test_unknown_native_association_never_returns_ordinary():
    lineage, principal, selection, _phase = owner(unbound=True)
    with pytest.raises(BuilderExecutionPolicyError):
        lineage.resolve(
            principal=principal, selection=selection, boundary="model", caller={}
        )


def test_native_binding_control_does_not_require_existing_association_or_effect_envelope():
    lineage, principal, selection, phase = owner(unbound=True)
    result = lineage.resolve(
        principal=principal, selection=selection, boundary="prepare-run", caller={}
    )
    assert result.ref.model_dump(mode="json") == PARENT.ref.model_dump(mode="json")
    assert phase == ["backend"]


def test_bound_native_effect_resolves_owned_context_without_claiming_permit():
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
    assert result.association.agent_run_id == "run"
    assert result.physical_owner_ready is False


@pytest.mark.parametrize(
    "caller",
    [{"agent_run_id": "foreign"}, {"tenant_id": "foreign"}, {"user_id": "foreign"}],
)
def test_caller_cannot_override_owned_run_or_parent(caller):
    lineage, principal, selection, _phase = owner()
    with pytest.raises(BuilderExecutionPolicyError):
        lineage.resolve(
            principal=principal, selection=selection, boundary="model", caller=caller
        )


def test_resolver_requires_authenticated_principal():
    lineage, _principal, selection, phase = owner(parent=False)
    with pytest.raises(BuilderExecutionPolicyError):
        lineage.resolve(
            principal=None, selection=selection, boundary="model", caller={}
        )
    assert phase == []


@pytest.mark.parametrize(
    "change,reason",
    [
        ("none", "native_endpoint_dependency_unavailable"),
        ("target", "native_endpoint_arguments_mismatch"),
        ("parameters", "native_endpoint_arguments_mismatch"),
        ("kind", "native_endpoint_arguments_mismatch"),
        ("ref", "native_endpoint_owner_mismatch"),
    ],
)
def test_validated_native_context_checks_exact_effect_but_never_spends_permit(
    change, reason
):
    from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload
    from flask import Flask, g, request
    from services.dify_builder.native_testing.agent_bridge import claim_agent_endpoint

    lineage, principal, selection, _phase = owner()
    context = lineage.resolve(
        principal=principal, selection=selection, boundary="model", caller={}
    )
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
        envelope = envelope.model_copy(
            update={"ref": envelope.ref.model_copy(update={"request_id": "foreign"})}
        )
    with Flask(__name__).test_request_context():
        g.agent_runtime_request = request._get_current_object()
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
def test_real_s1_config_and_final_resource_recheck_composes_with_lineage(
    monkeypatch, mutation
):
    """Real protected read/recheck; SQL/access/storage/backend are explicit doubles."""
    from contextlib import contextmanager

    from dify_agent.protocol.native_testing import AgentRunTransportSelection
    from services.dify_builder.execution_contracts import canonical_digest
    from services.dify_builder.native_testing import state_store as state
    from services.dify_builder.native_testing.agent_lineage import (
        AgentServicePrincipal,
        NativeAgentEndpointLineage,
    )

    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import (
        SQLDouble,
    )

    sql = SQLDouble()

    @contextmanager
    def sessions():
        yield sql

    store = state.NativeExecutionStateStore(
        SimpleNamespace(locked=sql.locked_root, session_factory=sessions)
    )
    context = SimpleNamespace(
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        native_run_id="workflow",
        generation=4,
    )
    prepared = SimpleNamespace(
        parent=PARENT,
        context=context,
        workspace=WORKSPACE,
        resource_digest="e" * 64,
        authority=SimpleNamespace(),
        objects=[],
    )
    value = {
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
    sql.rows = [SimpleNamespace(**vars(receipt))]
    resource = {"stamp": "e" * 64}
    monkeypatch.setattr(store, "_agent_prepare", lambda **kwargs: prepared)
    monkeypatch.setattr(store, "load_context", lambda **kwargs: context)
    monkeypatch.setattr(store, "_agent_refresh_access", lambda *args: None)
    monkeypatch.setattr(
        store, "_validate_node_inputs_owner", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(store, "_agent_single_parent", lambda *args: None)
    monkeypatch.setattr(
        store,
        "_agent_resources",
        lambda *args, **kwargs: (WORKSPACE, resource["stamp"]),
    )
    reads = []

    def read(*args, **kwargs):
        assert not sql.locked
        reads.append("object")
        if mutation == "object-io" and len(reads) > 1:
            resource["stamp"] = "f" * 64
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
    monkeypatch.setattr(store, "discover_agent_run", lambda **kwargs: association)

    class Backend:
        def read_run_identity_sync(self, run_id, selection):
            assert not sql.locked
            if mutation == "identity-io":
                resource["stamp"] = "f" * 64
            return AgentRuntimeIdentity(
                run_id="run",
                parent_node=PARENT.model_dump(mode="json"),
                request_digest=canonical_digest(CONFIG),
                execution_mode="builder_test",
                agent_generation=0,
            )

    lineage = NativeAgentEndpointLineage(
        backend=Backend(),
        preparation_for_ref=lambda ref: SimpleNamespace(state_store=store),
    )
    selection = AgentRunTransportSelection(
        agent_run_id="run",
        parent_node=PARENT.model_dump(mode="json"),
        request_digest=canonical_digest(CONFIG),
        agent_generation=0,
    )
    if mutation == "none":
        assert (
            lineage.resolve(
                principal=AgentServicePrincipal(),
                selection=selection,
                boundary="model",
                caller={},
            ).association
            == association
        )
    else:
        with pytest.raises(
            BuilderExecutionPolicyError, match="native_agent_owner_mismatch"
        ):
            lineage.resolve(
                principal=AgentServicePrincipal(),
                selection=selection,
                boundary="model",
                caller={},
            )
    assert not sql.locked


def test_expired_request_native_context_cannot_taint_later_ordinary_preflight():
    from flask import Flask, g
    from services.dify_builder.native_testing.agent_bridge import claim_agent_endpoint

    lineage, principal, selection, _phase = owner()
    context = lineage.resolve(
        principal=principal, selection=selection, boundary="model", caller={}
    )
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
