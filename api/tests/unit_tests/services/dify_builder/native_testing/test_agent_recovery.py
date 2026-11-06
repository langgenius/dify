"""Recovery admission and write fences use real validated owner records."""

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.native_testing import agent_recovery
from services.dify_builder.native_testing.agent_recovery_state import RECOVERY_RECORD_KEY, AgentRecoveryRecord
from tests.unit_tests.services.dify_builder.native_testing.test_agent_recovery_state import record_payload


@pytest.mark.parametrize("generation", [0, 9])
def test_ordinary_mutation_without_recovery_preserves_existing_generation(generation: int) -> None:
    agent_recovery.require_recovery_mutation(bindings={}, binding_id="old-b", workspace_generation=generation)


@pytest.mark.parametrize("phase", ["reserved", "creating", "unknown", "allocated", "blocked", "ready"])
def test_every_partial_recovery_blocks_mutation(phase: str) -> None:
    value = record_payload()
    value["phase"] = phase
    if phase in {"allocated", "blocked", "ready"}:
        value["allocation_receipt_ref"] = "allocation"
    if phase == "ready":
        value.update(successor_object_ref="relation", successor_digest="f" * 64)
    record = AgentRecoveryRecord.model_validate(value)
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_unready"):
        agent_recovery.require_recovery_mutation(
            bindings={RECOVERY_RECORD_KEY: record.model_dump(mode="json")},
            binding_id="old-b",
            workspace_generation=0,
        )


def test_fresh_wait_ack_is_required_and_predecessor_never_becomes_current() -> None:
    value = {
        **record_payload(),
        "phase": "ready",
        "allocation_receipt_ref": "allocation",
        "successor_object_ref": "relation",
        "successor_digest": "f" * 64,
        "sdk_receipt_ref": "sdk-ack",
        "successor_wait_ref": None,
    }
    record = AgentRecoveryRecord.model_validate(value)
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_unready"):
        agent_recovery.require_recovery_mutation(
            bindings={RECOVERY_RECORD_KEY: record.model_dump(mode="json")},
            binding_id="new-b",
            workspace_generation=1,
        )
    record = AgentRecoveryRecord.model_validate({**value, "successor_wait_ref": "fresh-wait"})
    bindings = {RECOVERY_RECORD_KEY: record.model_dump(mode="json")}
    agent_recovery.require_recovery_mutation(bindings=bindings, binding_id="new-b", workspace_generation=1)
    for binding_id, generation in (("old-b", 0), ("new-b", 0), ("foreign", 1)):
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_identity_mismatch"):
            agent_recovery.require_recovery_mutation(
                bindings=bindings, binding_id=binding_id, workspace_generation=generation
            )


def test_corrupt_present_record_fails_closed() -> None:
    with pytest.raises(BuilderExecutionPolicyError):
        agent_recovery.require_recovery_mutation(
            bindings={RECOVERY_RECORD_KEY: {"phase": "ready"}}, binding_id="new-b", workspace_generation=1
        )


def test_reservation_coalesces_keys_and_creating_has_one_winner(sqlite_session: Session) -> None:
    from sqlalchemy import Table

    from models.dify_builder_native_tests import NativeTestInvocation
    from runtime_contracts.builder.native.contracts import NativeTestContextRef

    table = NativeTestInvocation.__table__
    assert isinstance(table, Table)
    table.create(sqlite_session.connection(), checkfirst=True)
    ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
    invocation = NativeTestInvocation(
        tenant_id="tenant", request_id=ref.request_id, invocation_id=ref.invocation_id, active=True, bindings={}
    )
    sqlite_session.add(invocation)
    sqlite_session.flush()
    proposed = AgentRecoveryRecord.model_validate(record_payload())
    first, inserted = agent_recovery.reserve_recovery_attempt(
        session=sqlite_session, tenant_id="tenant", ref=ref, proposed=proposed
    )
    assert inserted
    second, inserted = agent_recovery.reserve_recovery_attempt(
        session=sqlite_session,
        tenant_id="tenant",
        ref=ref,
        proposed=AgentRecoveryRecord.model_validate(
            {
                **proposed.model_dump(),
                "interaction_idempotency_digest": "f" * 64,
                "reserved_binding_id": "other-reservation-b",
                "reserved_workspace_id": "other-reservation-w",
            }
        ),
    )
    assert not inserted
    assert second == first
    creating = agent_recovery.claim_recovery_allocation(
        session=sqlite_session, tenant_id="tenant", ref=ref, expected=first
    )
    assert creating is not None
    assert creating.phase == "creating"
    assert (
        agent_recovery.claim_recovery_allocation(session=sqlite_session, tenant_id="tenant", ref=ref, expected=first)
        is None
    )
    assert (
        agent_recovery.claim_recovery_allocation(session=sqlite_session, tenant_id="tenant", ref=ref, expected=creating)
        is None
    )
    assert invocation.bindings[RECOVERY_RECORD_KEY] == creating.model_dump(mode="json")


def test_coalescing_never_accepts_changed_immutable_reconstruction(sqlite_session: Session) -> None:
    from sqlalchemy import Table

    from models.dify_builder_native_tests import NativeTestInvocation
    from runtime_contracts.builder.native.contracts import NativeTestContextRef

    table = NativeTestInvocation.__table__
    assert isinstance(table, Table)
    table.create(sqlite_session.connection(), checkfirst=True)
    ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
    original = AgentRecoveryRecord.model_validate(record_payload())
    invocation = NativeTestInvocation(
        tenant_id="tenant",
        request_id=ref.request_id,
        invocation_id=ref.invocation_id,
        active=True,
        bindings={RECOVERY_RECORD_KEY: original.model_dump(mode="json")},
    )
    sqlite_session.add(invocation)
    sqlite_session.flush()
    for field, changed in (("input_digest", "f" * 64), ("definition_digest", "f" * 64), ("agent_generation", 4)):
        proposed = AgentRecoveryRecord.model_validate({**original.model_dump(), field: changed})
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_conflict"):
            agent_recovery.reserve_recovery_attempt(
                session=sqlite_session, tenant_id="tenant", ref=ref, proposed=proposed
            )
    assert invocation.bindings[RECOVERY_RECORD_KEY] == original.model_dump(mode="json")


def test_operation_owner_rejects_reserved_predecessor_before_resolving_resources(sqlite_session: Session) -> None:
    from dataclasses import replace

    from runtime_contracts.builder.native.contracts import OperationKey
    from services.dify_builder.native_testing.agent_operations import AgentOperationBindingResolver
    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import preparation_owner

    owned = preparation_owner()
    owned = replace(
        owned,
        bindings={RECOVERY_RECORD_KEY: AgentRecoveryRecord.model_validate(record_payload()).model_dump(mode="json")},
    )
    key = OperationKey(invocation_id=owned.ref.invocation_id, occurrence_path=("exec", "core_tool", "call"), cursor=0)
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_unready"):
        AgentOperationBindingResolver().resolve_binding(session=sqlite_session, owned=owned, key=key)


def test_checkpoint_writer_rejects_reserved_identity_before_mutation(sqlite_session: Session) -> None:
    from dataclasses import replace

    from sqlalchemy.orm import sessionmaker

    from core.dify_builder.models import Actor
    from services.dify_builder.native_testing.agent_operations import AgentOperationBindingResolver
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
    from tests.unit_tests.services.dify_builder.native_testing.test_confirmed_agent_commands import _scope
    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import preparation_owner, prepared_state

    prepared = prepared_state()
    owned = replace(preparation_owner(), bindings={RECOVERY_RECORD_KEY: record_payload()})
    loader = OwnedNativeTestLoader(
        sessionmaker(), actor=Actor(account_id="actor", tenant_id="tenant"), resolver=AgentOperationBindingResolver()
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_unready"):
        NativeExecutionStateStore(loader)._agent_recheck(sqlite_session, owned, _scope(), prepared, writing=True)


@pytest.mark.parametrize("phase", ["creating", "unknown", "allocated", "blocked", "ready"])
def test_reconnect_coalesces_advanced_attempt_without_reallocating(phase: str, sqlite_session: Session) -> None:
    from sqlalchemy import Table

    from models.dify_builder_native_tests import NativeTestInvocation
    from runtime_contracts.builder.native.contracts import NativeTestContextRef

    table = NativeTestInvocation.__table__
    assert isinstance(table, Table)
    table.create(sqlite_session.connection(), checkfirst=True)
    ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
    value = {**record_payload(), "phase": phase}
    if phase in {"allocated", "blocked", "ready"}:
        value["allocation_receipt_ref"] = "ack"
    if phase == "ready":
        value.update(successor_object_ref="relation", successor_digest="f" * 64)
    current = AgentRecoveryRecord.model_validate(value)
    sqlite_session.add(
        NativeTestInvocation(
            tenant_id="tenant",
            request_id=ref.request_id,
            invocation_id=ref.invocation_id,
            active=True,
            bindings={RECOVERY_RECORD_KEY: current.model_dump(mode="json")},
        )
    )
    sqlite_session.flush()
    coalesced, inserted = agent_recovery.reserve_recovery_attempt(
        session=sqlite_session,
        tenant_id="tenant",
        ref=ref,
        proposed=AgentRecoveryRecord.model_validate({**record_payload(), "interaction_idempotency_digest": "f" * 64}),
    )
    assert not inserted
    assert coalesced == current
    assert (
        agent_recovery.claim_recovery_allocation(
            session=sqlite_session, tenant_id="tenant", ref=ref, expected=coalesced
        )
        is None
    )


@pytest.mark.parametrize("owner", ["inactive", "tenant", "request", "invocation"])
def test_reservation_and_claim_require_exact_active_sql_owner(owner: str, sqlite_session: Session) -> None:
    from sqlalchemy import Table

    from models.dify_builder_native_tests import NativeTestInvocation
    from runtime_contracts.builder.native.contracts import NativeTestContextRef

    table = NativeTestInvocation.__table__
    assert isinstance(table, Table)
    table.create(sqlite_session.connection(), checkfirst=True)
    ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
    original = AgentRecoveryRecord.model_validate(record_payload())
    row = NativeTestInvocation(
        tenant_id="other" if owner == "tenant" else "tenant",
        request_id="other" if owner == "request" else ref.request_id,
        invocation_id="other" if owner == "invocation" else ref.invocation_id,
        active=owner != "inactive",
        bindings={},
    )
    sqlite_session.add(row)
    sqlite_session.flush()
    with pytest.raises(BuilderExecutionPolicyError, match="native_invocation_mismatch"):
        agent_recovery.reserve_recovery_attempt(session=sqlite_session, tenant_id="tenant", ref=ref, proposed=original)
    with pytest.raises(BuilderExecutionPolicyError, match="native_invocation_mismatch"):
        agent_recovery.claim_recovery_allocation(session=sqlite_session, tenant_id="tenant", ref=ref, expected=original)
    assert row.bindings == {}


def test_confirmed_sql_finalization_retires_exact_participant_and_keeps_snapshot(sqlite_session: Session) -> None:
    from dify_agent.protocol.confirmed_recovery import AgentRecoveryBinding

    from models.agent import AgentWorkingResourceStatus, AgentWorkspace, AgentWorkspaceBinding
    from services.agent.workspace_service import AgentWorkspaceService
    from tests.unit_tests.core.workflow.nodes.agent_v2.test_session_store import _scope
    from tests.unit_tests.services.agent.test_workspace_service import _binding, _workspace

    scope = _scope().workspace_owner
    old_w = _workspace(
        workspace_id="old-w",
        owner_type=scope.owner_type,
        owner_id=scope.owner_id,
        owner_scope_key=scope.owner_scope_key,
    )
    old_b = _binding(binding_id="old-b", workspace_id="old-w")
    old_b.session_snapshot = "preserved"
    sqlite_session.add_all([old_w, old_b])
    sqlite_session.flush()
    predecessor = AgentRecoveryBinding(
        binding_id=old_b.id,
        workspace_id=old_w.id,
        binding_ref=old_b.backend_binding_ref,
        workspace_ref=old_w.backend_workspace_ref,
        workspace_generation=0,
        association_object_ref="association",
        config_ref="config",
        config_digest="a" * 64,
    )
    successor = AgentRecoveryBinding(
        binding_id="new-b",
        workspace_id="new-w",
        binding_ref="fresh-binding-ref",
        workspace_ref="fresh-workspace-ref",
        workspace_generation=1,
        association_object_ref="new-association",
        config_ref="new-config",
        config_digest="b" * 64,
    )
    AgentWorkspaceService.finalize_confirmed_recovery_binding(
        session=sqlite_session,
        scope=scope,
        predecessor=predecessor,
        successor=successor,
        agent_id="agent-1",
        pinned_snapshot_id="config-1",
        home_snapshot_id="home-1",
    )
    sqlite_session.flush()
    assert old_w.status == AgentWorkingResourceStatus.RETIRED
    assert old_w.active_guard is None
    assert old_b.status == AgentWorkingResourceStatus.RETIRED
    assert old_b.session_snapshot == "preserved"
    new_w = sqlite_session.get(AgentWorkspace, "new-w")
    new_b = sqlite_session.get(AgentWorkspaceBinding, "new-b")
    assert new_w is not None
    assert new_b is not None
    assert new_w.owner_scope_key == scope.owner_scope_key
    assert new_w.backend_workspace_ref == "fresh-workspace-ref"
    assert new_b.backend_binding_ref == "fresh-binding-ref"
    assert new_b.session_snapshot is None


def test_confirmed_execution_rebind_requires_exact_caller_and_old_binding(sqlite_session: Session) -> None:
    from core.workflow.nodes.agent_v2.session_store import WorkflowAgentWorkspaceStore
    from models.workflow import WorkflowNodeExecutionModel
    from services.agent.workspace_service import AgentWorkspaceNotFoundError
    from tests.unit_tests.core.workflow.nodes.agent_v2.test_session_store import _execution_row, _scope

    row = _execution_row(binding_id="old-b", process_data={"workflow_agent_binding_id": "workflow-binding-1"})
    sqlite_session.add(row)
    sqlite_session.flush()
    with pytest.raises(AgentWorkspaceNotFoundError):
        WorkflowAgentWorkspaceStore.rebind_confirmed_node_execution(
            session=sqlite_session, scope=_scope(), predecessor_binding_id="foreign", successor_binding_id="new-b"
        )
    assert row.agent_workspace_binding_id == "old-b"
    WorkflowAgentWorkspaceStore.rebind_confirmed_node_execution(
        session=sqlite_session, scope=_scope(), predecessor_binding_id="old-b", successor_binding_id="new-b"
    )
    sqlite_session.flush()
    stored = sqlite_session.get(WorkflowNodeExecutionModel, row.id)
    assert stored is not None
    assert stored.agent_workspace_binding_id == "new-b"


@pytest.mark.parametrize(
    "suffix",
    [
        ("exec", "recovery", "1", "shell", "call"),
        ("exec", "shell", "call"),
        ("foreign", "recovery", "1", "shell", "call"),
        ("exec", "recovery", "2", "shell", "call"),
    ],
)
def test_completed_handshake_requires_exact_operation_prefix(suffix: tuple[str, ...]) -> None:
    from runtime_contracts.builder.native.contracts import OperationKey

    value = {
        **record_payload(),
        "phase": "ready",
        "allocation_receipt_ref": "ack",
        "successor_object_ref": "relation",
        "successor_digest": "f" * 64,
        "sdk_receipt_ref": "sdk",
        "successor_wait_ref": "wait",
    }
    bindings = {RECOVERY_RECORD_KEY: AgentRecoveryRecord.model_validate(value).model_dump(mode="json")}
    key = OperationKey(invocation_id="inv", occurrence_path=suffix, cursor=0)
    if suffix[:3] == ("exec", "recovery", "1"):
        agent_recovery.require_recovery_operation(bindings=bindings, key=key)
    else:
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_identity_mismatch"):
            agent_recovery.require_recovery_operation(bindings=bindings, key=key)


def test_allocation_ack_is_strict_and_rejects_reused_physical_refs() -> None:
    from dify_agent.protocol import CreateExecutionBindingRequest, CreateExecutionBindingResponse

    creating = AgentRecoveryRecord.model_validate({**record_payload(), "phase": "creating"})
    request = CreateExecutionBindingRequest(
        tenant_id="tenant", agent_id="agent", binding_id="new-b", workspace_id="new-w", existing_workspace_ref=None
    )
    receipt = agent_recovery.RecoveryAllocationReceipt(
        attempt_id=creating.attempt_id,
        request=request,
        response=CreateExecutionBindingResponse(binding_ref="new-binding-ref", workspace_ref="new-workspace-ref"),
    )
    agent_recovery.validate_allocation_receipt(
        expected=creating, receipt=receipt, tenant_id="tenant", agent_id="agent", home_snapshot_ref=None
    )
    for changed in (
        {
            **receipt.model_dump(),
            "response": {"binding_ref": creating.predecessor.binding_ref, "workspace_ref": "fresh"},
        },
        {**receipt.model_dump(), "request": {**request.model_dump(), "existing_workspace_ref": "existing"}},
    ):
        with pytest.raises(BuilderExecutionPolicyError):
            agent_recovery.validate_allocation_receipt(
                expected=creating,
                receipt=agent_recovery.RecoveryAllocationReceipt.model_validate(changed),
                tenant_id="tenant",
                agent_id="agent",
                home_snapshot_ref=None,
            )


def test_allocation_settlement_retains_ack_after_revocation_and_rejects_rewrite(sqlite_session: Session) -> None:
    from sqlalchemy import Table

    from models.dify_builder_native_tests import NativeTestInvocation
    from runtime_contracts.builder.native.contracts import NativeTestContextRef

    table = NativeTestInvocation.__table__
    assert isinstance(table, Table)
    table.create(sqlite_session.connection(), checkfirst=True)
    ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
    creating = AgentRecoveryRecord.model_validate({**record_payload(), "phase": "creating"})
    row = NativeTestInvocation(
        tenant_id="tenant",
        request_id=ref.request_id,
        invocation_id=ref.invocation_id,
        active=False,
        bindings={RECOVERY_RECORD_KEY: creating.model_dump(mode="json")},
    )
    sqlite_session.add(row)
    sqlite_session.flush()
    allocated = agent_recovery.settle_recovery_allocation(
        session=sqlite_session, tenant_id="tenant", ref=ref, expected=creating, allocation_receipt_ref="ack"
    )
    assert allocated.phase == "allocated"
    assert not row.active
    assert (
        agent_recovery.settle_recovery_allocation(
            session=sqlite_session, tenant_id="tenant", ref=ref, expected=creating, allocation_receipt_ref="ack"
        )
        == allocated
    )
    with pytest.raises(BuilderExecutionPolicyError):
        agent_recovery.settle_recovery_allocation(
            session=sqlite_session, tenant_id="tenant", ref=ref, expected=creating, allocation_receipt_ref="other-ack"
        )


def test_snapshot_write_uses_complete_original_identity_and_recovery_gate(sqlite_session: Session) -> None:
    from dataclasses import replace

    from models.agent import AgentWorkspaceBinding
    from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef
    from runtime_contracts.builder.native.contracts import NativeTestContextRef
    from tests.unit_tests.services.agent.test_workspace_service import _binding

    ref = NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64)
    parent = AgentParentNodeRef(
        ref=ref, execution_id="00000000-0000-4000-8000-000000000001", input_result_ref="input", input_digest="c" * 64
    )
    identity = agent_recovery.ConfirmedSnapshotIdentity(
        parent, 1, "run", 2, AgentRecoveryRecord.model_validate(record_payload()).predecessor
    )
    from sqlalchemy import Table

    from models.dify_builder_native_tests import NativeTestInvocation

    table = NativeTestInvocation.__table__
    assert isinstance(table, Table)
    table.create(sqlite_session.connection(), checkfirst=True)
    sqlite_session.add(
        NativeTestInvocation(
            tenant_id="tenant-1", request_id=ref.request_id, invocation_id=ref.invocation_id, active=True, bindings={}
        )
    )
    row = _binding(binding_id="old-b", workspace_id="old-w")
    row.backend_binding_ref = identity.binding.binding_ref
    sqlite_session.add(row)
    sqlite_session.flush()
    agent_recovery.write_confirmed_snapshot(
        session=sqlite_session,
        tenant_id="tenant-1",
        bindings={},
        identity=identity,
        current=identity,
        serialized_snapshot="original",
    )
    assert row.session_snapshot == "original"
    for changed in (
        replace(identity, parent_generation=2),
        replace(identity, agent_generation=3),
        replace(identity, agent_run_id="foreign"),
        replace(identity, binding=identity.binding.model_copy(update={"config_digest": "f" * 64})),
    ):
        with pytest.raises(BuilderExecutionPolicyError):
            agent_recovery.write_confirmed_snapshot(
                session=sqlite_session,
                tenant_id="tenant-1",
                bindings={},
                identity=identity,
                current=changed,
                serialized_snapshot="stale",
            )
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_unready"):
        agent_recovery.write_confirmed_snapshot(
            session=sqlite_session,
            tenant_id="tenant-1",
            bindings={RECOVERY_RECORD_KEY: record_payload()},
            identity=identity,
            current=identity,
            serialized_snapshot="stale",
        )
    stored = sqlite_session.get(AgentWorkspaceBinding, "old-b")
    assert stored is not None
    assert stored.session_snapshot == "original"


def test_snapshot_store_refuses_missing_authenticated_root(sqlite_session_factory: sessionmaker[Session]) -> None:
    from core.dify_builder.models import Actor
    from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef
    from runtime_contracts.builder.native.contracts import NativeTestContextRef
    from services.dify_builder.native_testing.agent_operations import AgentOperationBindingResolver
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

    store = NativeExecutionStateStore(
        OwnedNativeTestLoader(
            sqlite_session_factory,
            actor=Actor(account_id="actor", tenant_id="tenant"),
            resolver=AgentOperationBindingResolver(),
        )
    )
    ref = NativeTestContextRef(request_id="missing", invocation_id="inv", context_digest="a" * 64)
    parent = AgentParentNodeRef(
        ref=ref, execution_id="00000000-0000-4000-8000-000000000001", input_result_ref="input", input_digest="c" * 64
    )
    with pytest.raises(BuilderExecutionPolicyError):
        store.capture_confirmed_snapshot_identity(
            parent_node=parent,
            parent_generation=1,
            agent_run_id="child",
            agent_generation=2,
            binding=AgentRecoveryRecord.model_validate(record_payload()).predecessor,
        )


def test_confirmed_snapshot_refusal_is_nonfatal_and_never_uses_generic_saver() -> None:
    from dify_agent.protocol.snapshot import SessionSnapshot

    from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
    from graphon.runtime import InitParams
    from tests.unit_tests.core.workflow.nodes.agent_v2.test_session_store import _scope
    from tests.unit_tests.services.dify_builder.native_testing.test_agent_context import marker
    from tests.unit_tests.services.workflow_runtime.test_agent_node import FakeSessionStore, _node

    session_store = FakeSessionStore()
    node = _node(
        session_store=session_store,
        graph_init_params=InitParams(
            workflow_id="workflow-1",
            graph_config={"nodes": [], "edges": []},
            call_depth=0,
            run_context={
                DIFY_RUN_CONTEXT_KEY: DifyRunContext(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    user_id="user-1",
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                    builder_agent_execution=marker(),
                )
            },
        ),
    )
    metadata: dict[str, object] = {}
    node._save_session_snapshot(
        session_scope=_scope(), binding_id="old-b", snapshot=SessionSnapshot(layers={}), metadata=metadata
    )
    assert session_store.saved == []
    assert metadata["agent_backend"] == {
        "session_snapshot_persisted": False,
        "session_snapshot_persist_error": "workflow_agent_workspace_store_error",
    }


def test_confirmed_snapshot_capture_failure_is_nonfatal_and_logs_no_private_values(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from dify_agent.client import Client
    from dify_agent.protocol import CreateRunResponse

    from core.workflow.nodes.agent_v2.session_store import StoredWorkflowAgentSession
    from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef
    from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
    from services.agent.workflow_run_recovery import WorkflowAgentRunRecovery
    from services.dify_builder.native_testing.agent_preparation import AgentPreparationService
    from services.dify_builder.native_testing.confirmed_agent_commands import ConfirmedAgentCommands
    from tests.unit_tests.core.workflow.nodes.agent_v2.test_session_store import _scope
    from tests.unit_tests.services.dify_builder.native_testing.test_agent_context import marker
    from tests.unit_tests.services.dify_builder.native_testing.test_confirmed_agent_commands import _api
    from tests.unit_tests.services.workflow_runtime.test_agent_node import _node

    api = _api(sqlite_session_factory)
    preparation = AgentPreparationService(
        state_store=api.store, backend=Client(base_url="http://127.0.0.1:1"), workspace=None, config_builder=None
    )
    commands = ConfirmedAgentCommands(api=api, continuation=None, backend=None, publish=None)
    node = _node(confirmed_owners=(preparation, commands, WorkflowAgentRunRecovery(sqlite_session_factory)))
    parent = AgentParentNodeRef(
        ref=marker().ref, execution_id=node.execution_id, input_result_ref="owned-input", input_digest="a" * 64
    )

    def unavailable(*, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        assert ref == parent.ref
        raise RuntimeError("snapshot-private-secret-marker")

    monkeypatch.setattr(api.store, "load_context", unavailable)
    stored = StoredWorkflowAgentSession(
        scope=_scope(),
        binding_id="owned-binding",
        workspace_id="owned-workspace",
        backend_binding_ref="owned-physical",
        session_snapshot=None,
    )
    result = node._capture_confirmed_snapshot(
        parent=parent,
        response=CreateRunResponse(run_id="owned-child", status="running"),
        stored_session=stored,
        agent_generation=0,
    )
    assert result is None
    assert "snapshot-private-secret-marker" not in caplog.text
    assert "Traceback" not in caplog.text
    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.exc_info is None
    assert "RuntimeError" in record.getMessage()
    assert parent.ref.request_id in record.getMessage()
    assert parent.execution_id in record.getMessage()
    assert "owned-child" in record.getMessage()


def recovery_sql_selection(
    session: Session, *, tenant_id: str, ref: NativeTestContextRef
) -> tuple[WorkflowAgentSessionScope, agent_recovery.PreparedRecoverySelection]:
    """Prepare real SQL rows and acknowledged pointers for transaction-boundary tests."""
    from dataclasses import asdict, replace
    from uuid import uuid4

    from dify_agent.protocol.confirmed_recovery import (
        AgentRecoveryBinding,
        AgentRecoverySuccessor,
        recovery_successor_digest,
    )
    from sqlalchemy import Table

    from models.agent import AgentWorkspace, AgentWorkspaceBinding
    from models.dify_builder_native_tests import NativePayloadObject, NativeTestInvocation
    from models.workflow import WorkflowNodeExecutionModel
    from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef, AgentTestWorkspaceRef
    from services.dify_builder.native_testing.agent_confirmed_workspace import ALLOCATION
    from services.dify_builder.native_testing.agent_recovery_state import (
        AgentRecoveryAttemptIdentity,
        recovery_attempt_id,
    )
    from services.dify_builder.native_testing.state_store import ObjectReceipt
    from tests.unit_tests.core.workflow.nodes.agent_v2.test_session_store import _execution_row, _scope
    from tests.unit_tests.services.agent.test_workspace_service import _binding, _workspace

    for model in (
        NativeTestInvocation,
        NativePayloadObject,
        AgentWorkspace,
        AgentWorkspaceBinding,
        WorkflowNodeExecutionModel,
    ):
        table = model.__table__
        assert isinstance(table, Table)
        table.create(session.connection(), checkfirst=True)
    scope = replace(
        _scope(),
        tenant_id=tenant_id,
        app_id=str(uuid4()),
        workflow_id=str(uuid4()),
        workflow_run_id=str(uuid4()),
        node_execution_id=str(uuid4()),
        workflow_agent_binding_id=str(uuid4()),
        agent_id=str(uuid4()),
        agent_config_snapshot_id=str(uuid4()),
    )
    home_id, old_b_id, old_w_id = (str(uuid4()) for _ in range(3))
    old_w = _workspace(
        workspace_id=old_w_id,
        tenant_id=tenant_id,
        app_id=scope.app_id,
        owner_type=scope.workspace_owner.owner_type,
        owner_id=scope.workspace_owner.owner_id,
        owner_scope_key=scope.workspace_owner.owner_scope_key,
    )
    old_b = _binding(
        binding_id=old_b_id, workspace_id=old_w_id, tenant_id=tenant_id, app_id=scope.app_id, agent_id=scope.agent_id
    )
    old_b.base_home_snapshot_id, old_b.agent_config_version_id = home_id, scope.agent_config_snapshot_id
    old_b.session_snapshot = "preserved predecessor snapshot"
    assert scope.workflow_run_id is not None
    execution = _execution_row(
        execution_id=scope.node_execution_id,
        workflow_run_id=scope.workflow_run_id,
        binding_id=old_b_id,
        process_data={"workflow_agent_binding_id": scope.workflow_agent_binding_id},
    )
    execution.tenant_id, execution.app_id, execution.workflow_id = tenant_id, scope.app_id, scope.workflow_id
    execution.created_by = str(uuid4())
    input_receipt = ObjectReceipt(
        str(uuid4()),
        tenant_id,
        ref.request_id,
        ref.invocation_id,
        "result",
        "node-input:" + scope.node_execution_id,
        "storage-input",
        "e" * 64,
        "c" * 64,
    )
    parent = AgentParentNodeRef(
        ref=ref, execution_id=scope.node_execution_id, input_result_ref=input_receipt.id, input_digest="c" * 64
    )
    predecessor = AgentRecoveryBinding(
        binding_id=old_b_id,
        workspace_id=old_w_id,
        binding_ref=old_b.backend_binding_ref,
        workspace_ref=old_w.backend_workspace_ref,
        workspace_generation=0,
        association_object_ref="old-association",
        config_ref="old-config",
        config_digest="b" * 64,
    )
    identity = AgentRecoveryAttemptIdentity(
        invocation_id=ref.invocation_id,
        parent_execution_id=scope.node_execution_id,
        predecessor_binding_id=old_b_id,
        predecessor_checkpoint_digest="a" * 64,
        predecessor_workspace_generation=0,
    )
    expected = AgentRecoveryRecord.model_validate(
        {
            **record_payload(),
            "identity": identity.model_dump(),
            "attempt_id": recovery_attempt_id(identity),
            "predecessor": predecessor.model_dump(),
            "reserved_binding_id": str(uuid4()),
            "reserved_workspace_id": str(uuid4()),
            "phase": "allocated",
            "allocation_receipt_ref": "allocation",
            "home_snapshot_id": home_id,
            "home_snapshot_digest": "d" * 64,
        }
    )
    receipts = {
        role: ObjectReceipt(
            str(uuid4()),
            tenant_id,
            ref.request_id,
            ref.invocation_id,
            "result",
            "agent-recovery:" + expected.attempt_id + ":" + role,
            "storage-" + role,
            "e" * 64,
            "f" * 64,
        )
        for role in ("relation", "config", "association", "checkpoint", "reconstruction")
    }
    successor = AgentRecoveryBinding(
        binding_id=expected.reserved_binding_id,
        workspace_id=expected.reserved_workspace_id,
        binding_ref="new-physical-binding",
        workspace_ref="new-physical-workspace",
        workspace_generation=1,
        association_object_ref=receipts["association"].id,
        config_ref=receipts["config"].id,
        config_digest="f" * 64,
    )
    relation = AgentRecoverySuccessor.model_validate(
        {
            "attempt_id": expected.attempt_id,
            "parent_node": parent.model_dump(mode="json"),
            "agent_run_id": "child",
            "expected_parent_generation": 1,
            "expected_agent_generation": 2,
            "predecessor": predecessor.model_dump(),
            "successor": successor.model_dump(),
            "predecessor_checkpoint": expected.predecessor_checkpoint.model_dump(),
            "successor_checkpoint": {"checkpoint_id": receipts["checkpoint"].id, "payload_digest": "f" * 64},
            "predecessor_waiting_event_id": "100-0",
            "reconstruction_object_ref": receipts["reconstruction"].id,
            "reconstruction_digest": "f" * 64,
            "pending_operation_substitutions": [
                {"predecessor_operation_id": "old-pending", "successor_operation_id": "fresh-pending"}
            ],
        }
    )
    workspace = AgentTestWorkspaceRef(
        binding_id=old_b_id,
        workspace_id=old_w_id,
        backend_binding_ref=predecessor.binding_ref,
        backend_workspace_ref=predecessor.workspace_ref,
        pinned_snapshot_id=scope.agent_config_snapshot_id,
        home_snapshot_id=home_id,
        workspace_generation=0,
    )
    receipts["relation"] = replace(receipts["relation"], value_digest=recovery_successor_digest(relation))
    session.add_all(
        [
            old_w,
            old_b,
            execution,
            NativeTestInvocation(
                tenant_id=tenant_id,
                request_id=ref.request_id,
                invocation_id=ref.invocation_id,
                active=True,
                bindings={
                    RECOVERY_RECORD_KEY: expected.model_dump(mode="json"),
                    ALLOCATION: {"scope": asdict(scope), "workspace": workspace.model_dump(mode="json")},
                },
            ),
        ]
    )
    session.add_all(NativePayloadObject(**vars(receipt)) for receipt in receipts.values())
    session.add(NativePayloadObject(**vars(input_receipt)))
    session.flush()
    selection = agent_recovery.PreparedRecoverySelection(
        expected,
        relation,
        receipts["relation"],
        receipts["config"],
        receipts["association"],
        receipts["checkpoint"],
        receipts["reconstruction"],
    )
    return scope, selection


def test_finalize_selection_atomically_rebinds_and_selects_acknowledged_bundle(sqlite_session: Session) -> None:
    from uuid import uuid4

    from models.workflow import WorkflowNodeExecutionModel
    from runtime_contracts.builder.native.contracts import NativeTestContextRef

    ref = NativeTestContextRef(request_id=str(uuid4()), invocation_id="inv", context_digest="a" * 64)
    scope, selection = recovery_sql_selection(sqlite_session, tenant_id=str(uuid4()), ref=ref)
    ready = agent_recovery.finalize_recovery_selection(
        session=sqlite_session, tenant_id=scope.tenant_id, ref=ref, selection=selection, session_scope=scope
    )
    sqlite_session.flush()
    assert ready.phase == "ready"
    assert ready.sdk_receipt_ref is None
    assert ready.successor_wait_ref is None
    execution = sqlite_session.get(WorkflowNodeExecutionModel, scope.node_execution_id)
    assert execution is not None
    assert execution.agent_workspace_binding_id == ready.reserved_binding_id
    assert (
        agent_recovery.finalize_recovery_selection(
            session=sqlite_session, tenant_id=scope.tenant_id, ref=ref, selection=selection, session_scope=scope
        )
        == ready
    )


def test_pending_state_alone_never_proves_zero_dispatch(sqlite_session: Session) -> None:
    from datetime import UTC, datetime
    from uuid import uuid4

    from sqlalchemy import Table

    from models.dify_builder_native_tests import (
        NativeEffectAttempt,
        NativeEffectDispatchClaim,
        NativeEffectOperation,
        NativePendingAction,
    )
    from runtime_contracts.builder.native.contracts import NativeTestContextRef

    ref = NativeTestContextRef(request_id=str(uuid4()), invocation_id="inv", context_digest="a" * 64)
    tenant = str(uuid4())
    for model in (NativeEffectAttempt, NativeEffectDispatchClaim, NativeEffectOperation, NativePendingAction):
        table = model.__table__
        assert isinstance(table, Table)
        table.create(sqlite_session.connection(), checkfirst=True)
    operation = NativeEffectOperation(
        tenant_id=tenant,
        request_id=ref.request_id,
        invocation_id="inv",
        operation_digest="a" * 64,
        intent_digest="b" * 64,
        scope_digest="c" * 64,
        state="pending",
    )
    sqlite_session.add(operation)
    sqlite_session.flush()
    pending = NativePendingAction(
        tenant_id=tenant,
        request_id=ref.request_id,
        invocation_id="inv",
        generation=1,
        category="approval",
        reference_digest="d" * 64,
        reference="call",
        owner_ref="app",
        owner_version="c" * 64,
        operation_id=operation.id,
    )
    sqlite_session.add_all([operation, pending])
    sqlite_session.flush()
    agent_recovery.require_never_dispatched_pending(
        session=sqlite_session, tenant_id=tenant, ref=ref, pending_ids=(pending.id,), generation=1
    )
    sqlite_session.add(
        NativeEffectAttempt(
            tenant_id=tenant,
            request_id=ref.request_id,
            invocation_id="inv",
            operation_id=operation.id,
            grant_id=str(uuid4()),
            dispatch_index=1,
            permit_digest="e" * 64,
            expires_at=datetime.now(UTC),
            cost_units=1,
            budget_reservation_ref=str(uuid4()),
            execution_id="exec",
            invocation_digest="f" * 64,
            budget={},
            profile={},
        )
    )
    sqlite_session.flush()
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_dispatched"):
        agent_recovery.require_never_dispatched_pending(
            session=sqlite_session, tenant_id=tenant, ref=ref, pending_ids=(pending.id,), generation=1
        )


def test_snapshot_write_reloads_reservation_from_sql(sqlite_session: Session) -> None:
    from uuid import uuid4

    from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef
    from runtime_contracts.builder.native.contracts import NativeTestContextRef

    ref = NativeTestContextRef(request_id=str(uuid4()), invocation_id="inv", context_digest="a" * 64)
    scope, selection = recovery_sql_selection(sqlite_session, tenant_id=str(uuid4()), ref=ref)
    identity = agent_recovery.ConfirmedSnapshotIdentity(
        AgentParentNodeRef.model_validate(selection.relation.parent_node.model_dump(mode="json")),
        1,
        "child",
        2,
        selection.expected.predecessor,
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_unready"):
        agent_recovery.write_confirmed_snapshot(
            session=sqlite_session,
            tenant_id=scope.tenant_id,
            bindings={},
            identity=identity,
            current=identity,
            serialized_snapshot="stale bypass",
        )


def test_finalization_requires_exact_successor_checkpoint_object(sqlite_session: Session) -> None:
    from uuid import uuid4

    ref = NativeTestContextRef(request_id=str(uuid4()), invocation_id="inv", context_digest="a" * 64)
    scope, selection = recovery_sql_selection(sqlite_session, tenant_id=str(uuid4()), ref=ref)
    from dataclasses import replace

    from dify_agent.protocol.confirmed_recovery import AgentRecoverySuccessor, recovery_successor_digest

    from models.dify_builder_native_tests import NativePayloadObject

    relation = AgentRecoverySuccessor.model_validate(
        {
            **selection.relation.model_dump(mode="json"),
            "successor_checkpoint": {"checkpoint_id": "foreign-checkpoint", "payload_digest": "f" * 64},
        }
    )
    relation_receipt = replace(selection.relation_receipt, value_digest=recovery_successor_digest(relation))
    acknowledged = sqlite_session.get(NativePayloadObject, relation_receipt.id)
    assert acknowledged is not None
    acknowledged.value_digest = relation_receipt.value_digest
    sqlite_session.flush()
    selection = replace(selection, relation=relation, relation_receipt=relation_receipt)
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_conflict"):
        agent_recovery.finalize_recovery_selection(
            session=sqlite_session, tenant_id=scope.tenant_id, ref=ref, selection=selection, session_scope=scope
        )


def test_blocked_settlement_retains_ack_after_revocation_and_never_rewrites_ready(sqlite_session: Session) -> None:
    from uuid import uuid4

    from sqlalchemy import select

    from models.dify_builder_native_tests import NativeTestInvocation

    ref = NativeTestContextRef(request_id=str(uuid4()), invocation_id="inv", context_digest="a" * 64)
    scope, selection = recovery_sql_selection(sqlite_session, tenant_id=str(uuid4()), ref=ref)
    invocation = sqlite_session.scalar(
        select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
    )
    assert invocation is not None
    invocation.active = False
    sqlite_session.flush()
    blocked = agent_recovery.block_recovery_allocation_record(
        session=sqlite_session, tenant_id=scope.tenant_id, ref=ref, expected=selection.expected
    )
    assert blocked.phase == "blocked"
    assert blocked.allocation_receipt_ref == selection.expected.allocation_receipt_ref
    assert not invocation.active
    assert (
        agent_recovery.block_recovery_allocation_record(
            session=sqlite_session, tenant_id=scope.tenant_id, ref=ref, expected=selection.expected
        )
        == blocked
    )
    ready = AgentRecoveryRecord.model_validate(
        {
            **selection.expected.model_dump(),
            "phase": "ready",
            "successor_object_ref": selection.relation_receipt.id,
            "successor_digest": selection.relation_receipt.value_digest,
        }
    )
    invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: ready.model_dump(mode="json")}
    sqlite_session.flush()
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_conflict"):
        agent_recovery.block_recovery_allocation_record(
            session=sqlite_session, tenant_id=scope.tenant_id, ref=ref, expected=selection.expected
        )
    assert invocation.bindings[RECOVERY_RECORD_KEY] == ready.model_dump(mode="json")


def test_sql_selection_rejects_matching_digest_foreign_input_result_ref(sqlite_session: Session) -> None:
    from dataclasses import replace
    from uuid import uuid4

    from dify_agent.protocol.confirmed_recovery import AgentRecoverySuccessor, recovery_successor_digest

    from models.dify_builder_native_tests import NativePayloadObject

    ref = NativeTestContextRef(request_id=str(uuid4()), invocation_id="inv", context_digest="a" * 64)
    scope, selection = recovery_sql_selection(sqlite_session, tenant_id=str(uuid4()), ref=ref)
    relation = AgentRecoverySuccessor.model_validate(
        {
            **selection.relation.model_dump(mode="json"),
            "parent_node": {**selection.relation.parent_node.model_dump(mode="json"), "input_result_ref": str(uuid4())},
        }
    )
    receipt = replace(selection.relation_receipt, value_digest=recovery_successor_digest(relation))
    row = sqlite_session.get(NativePayloadObject, receipt.id)
    assert row is not None
    row.value_digest = receipt.value_digest
    sqlite_session.flush()
    selection = replace(selection, relation=relation, relation_receipt=receipt)
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_conflict"):
        agent_recovery.finalize_recovery_selection(
            session=sqlite_session, tenant_id=scope.tenant_id, ref=ref, selection=selection, session_scope=scope
        )


def test_recovery_config_validation_requires_original_confirmed_create_key() -> None:
    from pydantic import JsonValue

    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import PARENT

    config: dict[str, JsonValue] = {"composition": {"schema_version": 2, "layers": []}, "session_snapshot": None}
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_checkpoint_unsupported"):
        NativeExecutionStateStore.recovery_config_request(config=config, parent=PARENT, create_idempotency_key=None)
    actual = NativeExecutionStateStore.recovery_config_request(
        config=config, parent=PARENT, create_idempotency_key="original-confirmed-create"
    )
    assert actual.execution_mode == "builder_test"
    assert actual.native_test_profile == "confirmed"
    assert actual.idempotency_key == "original-confirmed-create"
    assert actual.native_parent_node is not None
    assert actual.native_parent_node.model_dump(mode="json") == PARENT.model_dump(mode="json")
