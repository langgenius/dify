"""Normal CI only: real PG/encrypted C03 structural Agent associations.

The workspace service/SQL owners are real; backend allocation and checkpoint
material are explicit no-network fixture boundaries, never Redis ACK, physical
cleanup, actual Agent execution or whole-chain qualification.
"""

import json
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from dify_agent.protocol.execution_binding import CreateExecutionBindingResponse
from shellctl.shared.schemas import NativeScopeLimits
from sqlalchemy import select

from libs.key_providers import generate_key_pair
from models.account import Tenant
from models.agent import AgentWorkingResourceStatus, AgentWorkspaceBinding
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.dify_builder_native_tests import NativePayloadObject
from models.workflow import Workflow
from services.agent.workspace_service import AgentWorkspaceService
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.agent_contracts import AgentNodeAssociation, AgentParentNodeRef
from services.dify_builder.native_testing.agent_workspace import AgentTestWorkspaceService
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader, native_workflow_revision
from services.dify_builder.native_testing.runtime_contracts import (
    NativeCheckpointPayload,
    NodeJournalState,
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.test_containers_integration_tests.core.workflow.test_builder_agent_workspace import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import raw_ledger_case
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import no_live as no_live  # noqa: PLC0414

CANARY = "PRIVATE_A5_PROTECTED_BYTES_CANARY_81ac"


@pytest.fixture
def association_case(native_owner, no_live, migrated_continuation_tables, monkeypatch):
    from extensions.ext_database import db

    assert migrated_continuation_tables is None
    ledger = raw_ledger_case(native_owner, no_live)
    _, _, app, workflow, _, _ = native_owner
    assert app.id
    assert workflow.id
    db.session.expunge(app)
    db.session.expunge(workflow)
    db.session.close()
    key = generate_key_pair(ledger.actor.tenant_id)
    native_run_id = str(uuid4())
    with ledger.factory.begin() as session:
        session.get(Tenant, ledger.actor.tenant_id).encrypt_public_key = key
        request = session.get(DifyBuilderExecutionRequest, ledger.ref.request_id)
        workflow = session.get(Workflow, request.workflow_id)
        selected_input = session.get(DifyBuilderTestInput, request.test_input_id)
        graph = json.loads(workflow.graph)
        inputs = selected_input.inputs
        revision = native_workflow_revision(workflow)
        request.context = {
            **request.context,
            "mode": "native",
            "native_run_id": native_run_id,
            "input_revision": canonical_digest(inputs),
            "start_schema_hash": selected_input.start_schema_hash,
        }
        request.context_digest = canonical_digest(request.context)
        ref = ledger.ref.model_copy(update={"context_digest": request.context_digest})
        app_id, workflow_id = request.app_id, request.workflow_id
        snapshot_id = graph["nodes"][-1]["data"]["agent_binding"]["current_snapshot_id"]
    loader = OwnedNativeTestLoader(ledger.factory, actor=ledger.actor, resolver=ledger.metadata)
    store = NativeExecutionStateStore(loader)
    context = ResolvedNativeTestContext(
        ref=ref,
        tenant_id=ledger.actor.tenant_id,
        actor_id=ledger.actor.account_id,
        app_id=app_id,
        workflow_id=workflow_id,
        graph=graph,
        inputs=inputs,
        graph_revision=revision,
        input_revision=canonical_digest(inputs),
        resource_manifest=(),
        generation=0,
        root_native_run_id=native_run_id,
        native_run_id=native_run_id,
        parent_invocation_id=None,
        call_depth=0,
        budget_ref=ref.request_id,
        cancellation_ref=ref.request_id,
        execution_mode="native",
    )
    store.initialize_context(context=context)  # Exactly one real immutable admission.
    calls = []

    def create(request):
        calls.append(request.binding_id)
        backend_ref = f"native:{request.binding_id}:{request.native_test_scope.generation}"
        return CreateExecutionBindingResponse(binding_ref=backend_ref, workspace_ref=backend_ref)

    @contextmanager
    def backend():
        yield SimpleNamespace(create_execution_binding_sync=create)

    monkeypatch.setattr(AgentWorkspaceService, "_client", backend)
    service = AgentTestWorkspaceService(
        loader,
        state_store=store,
        limits=NativeScopeLimits(
            cpu_quota=1000,
            memory_bytes=64 << 20,
            pids=8,
            fds=32,
            wall_seconds=60,
            input_bytes=1024,
            output_bytes=4096,
            disk_bytes=1 << 20,
        ),
    )
    workspace = service.prepare(ref=ref, pinned_snapshot_id=snapshot_id, input_file_refs=())
    execution_id = str(uuid4())  # Actual canonical UUID fixture; runtime node composition is later.
    typed_inputs = {"typed": [True, 1, "1"]}
    input_ref = store.store_node_inputs(ref=ref, generation=0, native_execution_id=execution_id, inputs=typed_inputs)
    parent = AgentParentNodeRef(
        ref=ref, execution_id=execution_id, input_result_ref=input_ref, input_digest=canonical_digest(typed_inputs)
    )
    return SimpleNamespace(
        factory=ledger.factory,
        loader=loader,
        store=store,
        ref=ref,
        context=context,
        workspace=workspace,
        parent=parent,
        allocation_calls=calls,
    )


def bound(c):
    config = {"protected-config": CANARY, "typed": [True, 1, "1"]}
    config_ref = c.store.store_agent_config(
        ref=c.ref, parent_node=c.parent, expected_invocation_generation=0, config=config
    )
    association = AgentNodeAssociation(
        parent_node=c.parent,
        workflow_native_run_id=c.context.native_run_id,
        agent_run_id=str(uuid4()),
        config_ref=config_ref,
        config_digest=canonical_digest(config),
        pinned_snapshot_id=c.workspace.pinned_snapshot_id,
        home_snapshot_id=c.workspace.home_snapshot_id,
        workspace=c.workspace,
    )
    ref = c.store.bind_agent_run(
        ref=c.ref, parent_node=c.parent, expected_invocation_generation=0, association=association
    )
    return association, ref


def waiting(c):
    association, ref = bound(c)
    # Opaque backend-selected material fixture; no actual Redis/SDK parse qualification.
    material = {
        "run_id": association.agent_run_id,
        "generation": 7,
        "ref": c.ref.model_dump(mode="json"),
        "config_ref": association.config_ref,
        "config_digest": association.config_digest,
        "history": [{"private": CANARY}],
        "pending_calls": [{"call_id": "backend-fixture-call"}],
        "operation_cursor": 0,
        "result_refs": {},
        "job_refs": [],
        "session_snapshot": {"layers": {}},
    }
    args = {
        "ref": c.ref,
        "parent_node": c.parent,
        "association_object_ref": ref,
        "agent_generation": 7,
        "checkpoint": material,
        "backend_wait_event_id": "1234-0",
    }
    return association, args


def payload(c, wait):
    parent = c.parent
    journal = NodeJournalState(
        invocation_id=c.ref.invocation_id,
        occurrence_path=(parent.execution_id,),
        input_result_ref=parent.input_result_ref,
        input_digest=parent.input_digest,
        cursor=0,
        operation_keys=(),
        result_refs=(),
    )
    return NativeCheckpointPayload(
        schema_version="1",
        native_run_id=c.context.native_run_id,
        generation=0,
        generate_entity_json="{}",
        graph_runtime_state_json="{}",
        response_stream_filter_json="{}",
        node_journals=(journal,),
        child_refs=(),
        input_result_refs=(parent.input_result_ref,),
        agent_associations=(wait,),
    )


def test_real_encrypted_association_checkpoint_roundtrip_preserves_nonempty_private_relations(association_case):
    from extensions.ext_storage import storage

    c = association_case
    association, args = waiting(c)
    wait = c.store.store_agent_wait(**args)
    cp = c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload(c, wait))
    fresh = NativeExecutionStateStore(c.loader)
    selected = fresh.read_checkpoint(ref=c.ref, checkpoint=cp)
    protected = fresh.load_agent_association(ref=c.ref, parent_node=c.parent, wait=selected.agent_associations[0])
    assert protected.association == association
    assert protected.checkpoint == args["checkpoint"]
    assert association.agent_run_id != selected.native_run_id == c.context.native_run_id
    assert selected.node_journals[0].cursor == 0
    assert selected.node_journals[0].operation_keys == selected.node_journals[0].result_refs == ()
    assert selected.child_refs == ()
    with c.factory() as session:
        rows = session.scalars(
            select(NativePayloadObject).where(NativePayloadObject.request_id == c.ref.request_id)
        ).all()
        assert all(len(row.logical_key) <= 128 for row in rows)
        keys = [row.storage_key for row in rows]
    assert all(CANARY.encode() not in storage.load(key) for key in keys)
    assert len(c.allocation_calls) == 1


@pytest.mark.parametrize("fault", ["changed-run", "foreign-checkpoint"])
def test_real_immutable_agent_selection_refuses_without_new_private_write(association_case, monkeypatch, fault):
    from extensions.ext_storage import storage

    c = association_case
    association, args = waiting(c)
    wait = c.store.store_agent_wait(**args)
    save = Mock(side_effect=AssertionError("unexpected new encrypted write"))
    monkeypatch.setattr(storage, "save", save)

    def refuse():
        if fault == "changed-run":
            c.store.bind_agent_run(
                ref=c.ref,
                parent_node=c.parent,
                expected_invocation_generation=0,
                association=association.model_copy(update={"agent_run_id": str(uuid4())}),
            )
        else:
            c.store.commit_checkpoint(
                ref=c.ref,
                generation=0,
                payload=payload(c, wait.model_copy(update={"checkpoint_object_ref": str(uuid4())})),
            )

    with pytest.raises(BuilderExecutionPolicyError):
        refuse()
    save.assert_not_called()


def test_real_current_workspace_retirement_blocks_selected_checkpoint_read(association_case):
    c = association_case
    _, args = waiting(c)
    wait = c.store.store_agent_wait(**args)
    cp = c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload(c, wait))
    with c.factory.begin() as session:
        session.get(AgentWorkspaceBinding, c.workspace.binding_id).status = AgentWorkingResourceStatus.RETIRED
    with pytest.raises(BuilderExecutionPolicyError, match="native_workspace_owner_mismatch"):
        c.store.read_checkpoint(ref=c.ref, checkpoint=cp)


def test_real_post_commit_ack_loss_reuses_private_object_without_rewrite(association_case, monkeypatch):
    from extensions.ext_storage import storage

    c = association_case
    _, args = waiting(c)
    original = c.loader.locked
    lost = [True]

    @contextmanager
    def commit_then_lose(**kwargs):
        with original(**kwargs) as selected:
            yield selected
        if lost[0]:
            lost[0] = False
            raise TimeoutError("fixture-lost-after-real-SQL-commit")

    monkeypatch.setattr(c.loader, "locked", commit_then_lose)
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_state_unavailable"):
        c.store.store_agent_wait(**args)
    save = Mock(wraps=storage.save)
    monkeypatch.setattr(storage, "save", save)
    recovered = c.store.store_agent_wait(**args)
    save.assert_not_called()
    assert (
        c.store.load_agent_association(ref=c.ref, parent_node=c.parent, wait=recovered).checkpoint == args["checkpoint"]
    )


def test_real_second_node_occurrence_cannot_share_temporary_single_workspace(association_case, monkeypatch):
    from extensions.ext_storage import storage

    c = association_case
    bound(c)
    second = str(uuid4())
    inputs = {"typed": [True, 1, "1"]}
    input_ref = c.store.store_node_inputs(ref=c.ref, generation=0, native_execution_id=second, inputs=inputs)
    parent = AgentParentNodeRef(
        ref=c.ref, execution_id=second, input_result_ref=input_ref, input_digest=canonical_digest(inputs)
    )
    save = Mock(side_effect=AssertionError("second occurrence wrote new private Agent state"))
    monkeypatch.setattr(storage, "save", save)
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_single_workspace_limit"):
        c.store.store_agent_config(
            ref=c.ref, parent_node=parent, expected_invocation_generation=0, config={"second": True}
        )
    save.assert_not_called()
    assert len(c.allocation_calls) == 1
