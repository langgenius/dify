"""Normal CI only: real PG/encrypted C03 structural Agent associations.

The workspace service/SQL owners are real; backend allocation and checkpoint
material are explicit no-network fixture boundaries, never Redis ACK, physical
cleanup, actual Agent execution or whole-chain qualification.
"""

from __future__ import annotations

from collections.abc import Generator
from typing import TYPE_CHECKING

from pydantic import JsonValue
from typing_extensions import TypedDict

from models.workflow import Workflow
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import require_instance
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import NativeOwner

if TYPE_CHECKING:
    from dify_agent.protocol.execution_binding import CreateExecutionBindingRequest

    from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload, ResolvedNativeTestContext


from typing import TYPE_CHECKING, NotRequired, Unpack

if TYPE_CHECKING:
    import services.dify_builder.native_testing.repository as _forward_types_0


import json
from contextlib import contextmanager
from uuid import uuid4

import pytest
import pytest_mock
from dify_agent.client import Client
from dify_agent.protocol.execution_binding import CreateExecutionBindingResponse
from shellctl.shared.schemas import NativeScopeLimits
from sqlalchemy import select

from clients.agent_backend import DifyAgentBackendRunClient
from libs.key_providers import generate_key_pair
from models.account import Tenant
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspaceBinding,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.dify_builder_native_tests import NativePayloadObject
from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
    canonical_digest,
)
from runtime_contracts.builder.native.agent_contracts import (
    AgentNodeAssociation,
    AgentParentNodeRef,
    AgentWaitAssociation,
)
from runtime_contracts.builder.native.runtime_contracts import (
    NativeCheckpointPayload,
    NodeJournalState,
    ResolvedNativeTestContext,
)
from services.agent.workspace_service import AgentWorkspaceService
from services.dify_builder.native_testing.agent_binding import native_node_data
from services.dify_builder.native_testing.agent_workspace import (
    AgentTestWorkspaceService,
)
from services.dify_builder.native_testing.repository import (
    OwnedNativeTestLoader,
    native_workflow_revision,
)
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
    AgentAssociationCase,
    NormalAgentParent,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_agent_workspace import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    raw_ledger_case,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    native_owner as base_native_owner,  # noqa: F401 - shared pytest fixture dependency
)
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    no_live as no_live,  # noqa: PLC0414
)

CANARY = "PRIVATE_A5_PROTECTED_BYTES_CANARY_81ac"


@pytest.fixture
def association_case(
    mocker: pytest_mock.MockerFixture,
    native_owner: NativeOwner,
    no_live: None,
    migrated_continuation_tables: None,
    monkeypatch: pytest.MonkeyPatch,
    request: pytest.FixtureRequest,
) -> AgentAssociationCase:
    from extensions.ext_database import db

    assert migrated_continuation_tables is None
    legacy_confirmed = hasattr(request, "param") and request.param == "legacy_confirmed"
    # The workspace fixture supplies only allocation identities. S1 resource
    # checks require real roster publication and complete native node data.
    # Establish these rows before raw_ledger_case stamps graph/owner revisions.
    _, actor, app, workflow, _, _ = native_owner
    graph = json.loads(workflow.graph)
    node = graph["nodes"][-1]
    snapshot_id = node["data"]["agent_binding"]["current_snapshot_id"]
    snapshot = db.session.get(AgentConfigSnapshot, snapshot_id)
    agent_id = require_instance(snapshot, AgentConfigSnapshot).agent_id
    soul = AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "openai",
                "model": "ci-inert-model",
            }
        }
    )
    require_instance(snapshot, AgentConfigSnapshot).config_snapshot = soul
    db.session.add(
        Agent(
            id=agent_id,
            tenant_id=actor.tenant_id,
            name="S1 fixture " + agent_id,
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id=snapshot_id,
            active_config_has_model=True,
            created_by=actor.account_id,
            updated_by=actor.account_id,
        )
    )
    job = WorkflowNodeJobConfig(workflow_prompt="Review typed fixture inputs")
    node["data"] = native_node_data(agent_id=agent_id, snapshot_id=snapshot_id, node_job=job)
    workflow.graph = json.dumps(graph)
    db.session.add(
        WorkflowAgentNodeBinding(
            tenant_id=actor.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_version=workflow.version,
            node_id=node["id"],
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id=agent_id,
            current_snapshot_id=snapshot_id,
            node_job_config=job,
            created_by=actor.account_id,
            updated_by=actor.account_id,
        )
    )
    db.session.commit()
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
        require_instance(session.get(Tenant, ledger.actor.tenant_id), Tenant).encrypt_public_key = key
        saved_request = session.get(DifyBuilderExecutionRequest, ledger.ref.request_id)
        workflow = session.get(Workflow, require_instance(saved_request, DifyBuilderExecutionRequest).workflow_id)
        selected_input = session.get(
            DifyBuilderTestInput, require_instance(saved_request, DifyBuilderExecutionRequest).test_input_id
        )
        graph = json.loads(require_instance(workflow, Workflow).graph)
        inputs = require_instance(selected_input, DifyBuilderTestInput).inputs
        revision = native_workflow_revision(require_instance(workflow, Workflow))
        require_instance(saved_request, DifyBuilderExecutionRequest).context = {
            **require_instance(saved_request, DifyBuilderExecutionRequest).context,
            "mode": "native",
            "native_run_id": native_run_id,
            "input_revision": canonical_digest(inputs),
            "start_schema_hash": require_instance(selected_input, DifyBuilderTestInput).start_schema_hash,
        }
        if legacy_confirmed:
            require_instance(saved_request, DifyBuilderExecutionRequest).context = {
                **require_instance(saved_request, DifyBuilderExecutionRequest).context,
                "profile": {"profile_id": "builder-agent-confirmed-v1"},
            }
        require_instance(saved_request, DifyBuilderExecutionRequest).context_digest = canonical_digest(
            require_instance(saved_request, DifyBuilderExecutionRequest).context
        )
        ref = ledger.ref.model_copy(
            update={"context_digest": require_instance(saved_request, DifyBuilderExecutionRequest).context_digest}
        )
        app_id, workflow_id = (
            require_instance(saved_request, DifyBuilderExecutionRequest).app_id,
            require_instance(saved_request, DifyBuilderExecutionRequest).workflow_id,
        )
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

    def create(request: CreateExecutionBindingRequest) -> CreateExecutionBindingResponse:
        calls.append(request.binding_id)
        assert request.native_test_scope is not None
        backend_ref = f"native:{request.binding_id}:{request.native_test_scope.generation}"
        return CreateExecutionBindingResponse(binding_ref=backend_ref, workspace_ref=backend_ref)

    @contextmanager
    def backend() -> Generator[Client]:
        client = Client(base_url="http://127.0.0.1:1")
        mocker.patch.object(client, "create_execution_binding_sync", side_effect=create)
        yield client

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
    typed_inputs: dict[str, JsonValue] = {"typed": [True, 1, "1"]}
    input_ref = store.store_node_inputs(ref=ref, generation=0, native_execution_id=execution_id, inputs=typed_inputs)
    parent = AgentParentNodeRef(
        ref=ref, execution_id=execution_id, input_result_ref=input_ref, input_digest=canonical_digest(typed_inputs)
    )
    return AgentAssociationCase(
        factory=ledger.factory,
        loader=loader,
        store=store,
        ref=ref,
        context=context,
        workspace=workspace,
        parent=parent,
        allocation_calls=calls,
    )


def bound(c: AgentAssociationCase) -> tuple[AgentNodeAssociation, str]:
    config: dict[str, JsonValue] = {"protected-config": CANARY, "typed": [True, 1, "1"]}
    config_ref = c.store.store_agent_config(
        ref=c.ref, parent_node=c.parent, expected_invocation_generation=0, config=config
    )
    association = AgentNodeAssociation(
        parent_node=c.parent,
        workflow_native_run_id=require_instance(c.context.native_run_id, str),
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


def waiting(c: AgentAssociationCase) -> tuple[AgentNodeAssociation, AgentWaitArguments]:
    association, ref = bound(c)
    # Opaque backend-selected material fixture; no actual Redis/SDK parse qualification.
    material: dict[str, JsonValue] = {
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
    args: AgentWaitArguments = {
        "ref": c.ref,
        "parent_node": c.parent,
        "association_object_ref": ref,
        "agent_generation": 7,
        "checkpoint": material,
        "backend_wait_event_id": "1234-0",
    }
    return association, args


def payload(c: NormalAgentParent | AgentAssociationCase, wait: AgentWaitAssociation) -> NativeCheckpointPayload:
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
        native_run_id=require_instance(c.context.native_run_id, str),
        generation=0,
        generate_entity_json="{}",
        graph_runtime_state_json="{}",
        response_stream_filter_json="{}",
        node_journals=(journal,),
        child_refs=(),
        input_result_refs=(parent.input_result_ref,),
        agent_associations=(wait,),
    )


def test_real_encrypted_association_checkpoint_roundtrip_preserves_nonempty_private_relations(
    association_case: AgentAssociationCase,
) -> None:
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
def test_real_immutable_agent_selection_refuses_without_new_private_write(
    mocker: pytest_mock.MockerFixture, association_case: AgentAssociationCase, fault: str
) -> None:
    from extensions.ext_storage import storage

    c = association_case
    association, args = waiting(c)
    wait = c.store.store_agent_wait(**args)
    save = mocker.patch.object(storage, "save", side_effect=AssertionError("unexpected new encrypted write"))

    def refuse() -> None:
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


def test_real_current_workspace_retirement_blocks_selected_checkpoint_read(
    association_case: AgentAssociationCase,
) -> None:
    c = association_case
    _, args = waiting(c)
    wait = c.store.store_agent_wait(**args)
    cp = c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload(c, wait))
    with c.factory.begin() as session:
        require_instance(
            session.get(AgentWorkspaceBinding, c.workspace.binding_id), AgentWorkspaceBinding
        ).status = AgentWorkingResourceStatus.RETIRED
    with pytest.raises(BuilderExecutionPolicyError, match="native_workspace_owner_mismatch"):
        c.store.read_checkpoint(ref=c.ref, checkpoint=cp)


def test_real_post_commit_ack_loss_reuses_private_object_without_rewrite(
    mocker: pytest_mock.MockerFixture, association_case: AgentAssociationCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from extensions.ext_storage import storage

    c = association_case
    _, args = waiting(c)
    original = c.loader.locked
    lost = [True]

    @contextmanager
    def commit_then_lose(
        **kwargs: Unpack[_ForwardArguments425],
    ) -> _forward_types_0.Generator[
        tuple[_forward_types_0.Session, _forward_types_0.OwnedNativeTest, _forward_types_0.NativeTestScope]
    ]:
        with original(**kwargs) as selected:
            yield selected
        if lost[0]:
            lost[0] = False
            raise TimeoutError("fixture-lost-after-real-SQL-commit")

    monkeypatch.setattr(c.loader, "locked", commit_then_lose)
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_state_unavailable"):
        c.store.store_agent_wait(**args)
    save = mocker.spy(storage, "save")
    recovered = c.store.store_agent_wait(**args)
    save.assert_not_called()
    assert (
        c.store.load_agent_association(ref=c.ref, parent_node=c.parent, wait=recovered).checkpoint == args["checkpoint"]
    )


def test_real_second_node_occurrence_cannot_share_temporary_single_workspace(
    mocker: pytest_mock.MockerFixture, association_case: AgentAssociationCase
) -> None:
    from extensions.ext_storage import storage

    c = association_case
    bound(c)
    second = str(uuid4())
    inputs: dict[str, JsonValue] = {"typed": [True, 1, "1"]}
    input_ref = c.store.store_node_inputs(ref=c.ref, generation=0, native_execution_id=second, inputs=inputs)
    parent = AgentParentNodeRef(
        ref=c.ref, execution_id=second, input_result_ref=input_ref, input_digest=canonical_digest(inputs)
    )
    save = mocker.patch.object(
        storage, "save", side_effect=AssertionError("second occurrence wrote new private Agent state")
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_single_workspace_limit"):
        c.store.store_agent_config(
            ref=c.ref, parent_node=parent, expected_invocation_generation=0, config={"second": True}
        )
    save.assert_not_called()
    assert len(c.allocation_calls) == 1


def test_real_queued_agent_checkpoint_is_readable_before_single_dispatch_claim(
    association_case: AgentAssociationCase,
) -> None:
    from models.dify_builder_native_tests import NativePendingAction
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
    from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import ResolutionOwner

    c = association_case
    _, args = waiting(c)
    wait = c.store.store_agent_wait(**args)
    checkpoint = c.store.commit_checkpoint(ref=c.ref, generation=0, payload=payload(c, wait))
    pending_id = str(uuid4())
    # The configuration resolver is an explicit no-I/O fixture; checkpoint, pause,
    # resume, generation, outbox and both dispatch claim phases are actual owners.
    with c.factory.begin() as session:
        session.add(
            NativePendingAction(
                id=pending_id,
                tenant_id=c.context.tenant_id,
                request_id=c.ref.request_id,
                invocation_id=c.ref.invocation_id,
                generation=0,
                category="configuration",
                reference_digest="7" * 64,
                reference="fixture-config",
                owner_ref="fixture-owner",
                owner_version="fixture-version",
                operation_id=None,
            )
        )
    resolution = ResolutionOwner()
    resolution.resolved = True
    lifecycle = NativeTestLifecycleService(c.loader, state_store=c.store, resolution=resolution)
    lifecycle.pause(ref=c.ref, checkpoint=checkpoint, pending_operation_ids=(pending_id,), expected_generation=0)
    resumed = lifecycle.resume(
        actor=c.loader.actor, request_id=c.ref.request_id, expected_generation=0, idempotency_key="queued-agent-test"
    )
    selected = c.store.read_checkpoint(ref=c.ref, checkpoint=checkpoint)
    assert selected.agent_associations == (wait,)
    assert c.store.load_agent_association(ref=c.ref, parent_node=c.parent, wait=wait).checkpoint == args["checkpoint"]
    # The added read authority must not permit writes while queued.
    with pytest.raises(BuilderExecutionPolicyError, match="native_invocation_mismatch"):
        c.store.store_agent_config(
            ref=c.ref, parent_node=c.parent, expected_invocation_generation=1, config={"new": True}
        )
    prepared = lifecycle.prepare_dispatch_claim(
        ref=c.ref, generation=resumed.generation, dispatch_id=resumed.dispatch_id
    )
    assert prepared is not None
    assert prepared.payload == selected
    assert lifecycle.claim_dispatch(ref=c.ref, generation=resumed.generation, dispatch_id=resumed.dispatch_id)
    assert not lifecycle.claim_dispatch(ref=c.ref, generation=resumed.generation, dispatch_id=resumed.dispatch_id)


@pytest.mark.parametrize("guard_change", ["none", "canvas", "execution", "input", "actor", "target"])
def test_real_normal_blank_home_prepare_and_generation_one_checkpoint_read(
    mocker: pytest_mock.MockerFixture,
    association_case: AgentAssociationCase,
    native_owner: NativeOwner,
    monkeypatch: pytest.MonkeyPatch,
    guard_change: str,
) -> None:
    """Actual normal SQL/crypto owners; only backend allocation is a no-I/O fixture."""
    from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope, WorkflowAgentWorkspaceStore
    from models.dify_builder import DifyBuilderSession
    from models.dify_builder_native_tests import NativeEffectAttempt, NativeInvocationState, NativeTestScope
    from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
    from services.dify_builder.native_testing.agent_confirmed_workspace import (
        build_confirmed_agent_preparation,
        prepare_confirmed_agent_request,
    )
    from services.dify_builder.native_testing.agent_operations import admit_confirmed_agent_execution

    c = association_case
    factory, actor, _app, _workflow, session_id, test_input_id = native_owner
    snapshot_id = c.workspace.pinned_snapshot_id
    with factory.begin() as session:
        snapshot = session.get(AgentConfigSnapshot, snapshot_id)
        require_instance(snapshot, AgentConfigSnapshot).home_snapshot_id = None
        agent_id = require_instance(snapshot, AgentConfigSnapshot).agent_id
        assert session is not None
        version = require_instance(session.get(DifyBuilderSession, session_id), DifyBuilderSession).version
    run_id, execution_id = str(uuid4()), str(uuid4())
    context = admit_confirmed_agent_execution(
        actor=actor,
        session_id=session_id,
        test_input_id=test_input_id,
        expected_version=version,
        native_run_id=run_id,
        idempotency_key="normal-blank-home",
        limits={"calls": 4, "dispatches": 4, "cost_units": 4},
    )
    graph_nodes = context.graph["nodes"]
    assert isinstance(graph_nodes, list)
    agent_node = graph_nodes[-1]
    assert isinstance(agent_node, dict)
    node_id = agent_node["id"]
    assert isinstance(node_id, str)
    with factory.begin() as session:
        node_binding = session.scalar(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.workflow_id == context.workflow_id,
                WorkflowAgentNodeBinding.node_id == node_id,
            )
        )
        workflow_binding_id = require_instance(node_binding, WorkflowAgentNodeBinding).id
        session.add(
            WorkflowRun(
                id=run_id,
                tenant_id=actor.tenant_id,
                app_id=context.app_id,
                workflow_id=context.workflow_id,
                type="workflow",
                triggered_from="debugging",
                version="draft",
                graph=json.dumps(context.graph),
                inputs=json.dumps(context.inputs),
                status="running",
                created_by_role="account",
                created_by=actor.account_id,
            )
        )
        session.add(
            WorkflowNodeExecutionModel(
                id=execution_id,
                tenant_id=actor.tenant_id,
                app_id=context.app_id,
                workflow_id=context.workflow_id,
                workflow_run_id=run_id,
                node_id=node_id,
                node_type="agent",
                node_execution_id=execution_id,
                triggered_from="workflow-run",
                index=1,
                title="blank-home fixture",
                status="running",
                process_data=json.dumps({"workflow_agent_binding_id": workflow_binding_id}),
                created_by_role="account",
                created_by=actor.account_id,
            )
        )
    allocations = []

    @contextmanager
    def normal_backend() -> Generator[Client]:
        def create(request: CreateExecutionBindingRequest) -> CreateExecutionBindingResponse:
            assert request.home_snapshot_ref is None
            assert request.native_test_scope is None
            allocations.append(request.binding_id)
            return CreateExecutionBindingResponse(
                binding_ref="ordinary:" + request.binding_id, workspace_ref="ordinary:" + request.workspace_id
            )

        client = Client(base_url="http://127.0.0.1:1")
        mocker.patch.object(client, "create_execution_binding_sync", side_effect=create)
        yield client

    monkeypatch.setattr(AgentWorkspaceService, "_client", normal_backend)
    scope = WorkflowAgentSessionScope(
        tenant_id=actor.tenant_id,
        app_id=context.app_id,
        workflow_id=context.workflow_id,
        workflow_run_id=run_id,
        node_id=node_id,
        node_execution_id=execution_id,
        workflow_agent_binding_id=workflow_binding_id,
        agent_id=agent_id,
        agent_config_snapshot_id=snapshot_id,
    )
    stored = WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(scope, home_snapshot_id=None)
    service = build_confirmed_agent_preparation(
        actor=actor, backend=DifyAgentBackendRunClient(Client(base_url="http://127.0.0.1:1"))
    )
    store, ref = service.state_store, context.ref
    inputs: dict[str, JsonValue] = {"typed": [True, 1, "1"]}
    input_ref = store.store_node_inputs(ref=ref, generation=0, native_execution_id=execution_id, inputs=inputs)
    parent = AgentParentNodeRef(
        ref=ref, execution_id=execution_id, input_result_ref=input_ref, input_digest=canonical_digest(inputs)
    )
    prepared = prepare_confirmed_agent_request(
        service=service,
        ref=ref,
        parent_node=parent,
        node_id=node_id,
        stored_session=stored,
        inputs=inputs,
    )
    config = store.load_prepared_config(ref=ref, parent_node=parent, config_ref=prepared.claim.config_ref)
    assert config.workspace.home_snapshot_id is None
    assert config.workspace.workspace_generation == 0
    assert prepared.request.native_test_profile == "confirmed"
    # Structural backend selection is fixture-owned; no child create/ACK is claimed.
    association = AgentNodeAssociation(
        parent_node=parent,
        workflow_native_run_id=run_id,
        agent_run_id=str(uuid4()),
        config_ref=config.config_ref,
        config_digest=config.config_digest,
        pinned_snapshot_id=snapshot_id,
        home_snapshot_id=None,
        workspace=config.workspace,
    )
    association_ref = store.bind_agent_run(
        ref=ref, parent_node=parent, expected_invocation_generation=0, association=association
    )
    checkpoint: dict[str, JsonValue] = {
        "run_id": association.agent_run_id,
        "generation": 7,
        "ref": ref.model_dump(mode="json"),
        "config_ref": association.config_ref,
        "config_digest": association.config_digest,
        "history": [],
        "pending_calls": [],
        "operation_cursor": 0,
        "result_refs": {},
        "job_refs": [],
        "session_snapshot": {"layers": {}},
    }
    wait = store.store_agent_wait(
        ref=ref,
        parent_node=parent,
        association_object_ref=association_ref,
        agent_generation=7,
        checkpoint=checkpoint,
        backend_wait_event_id="1234-0",
    )
    normal = NormalAgentParent(ref=ref, context=context, parent=parent)
    saved = store.commit_checkpoint(ref=ref, generation=0, payload=payload(normal, wait))
    with factory.begin() as session:
        state = session.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == ref.request_id))
        require_instance(state, NativeInvocationState).generation = 1
        assert session is not None
        require_instance(session.get(NativeTestScope, ref.request_id), NativeTestScope).generation = 1
        if guard_change in {"canvas", "execution"}:
            workflow = session.get(Workflow, context.workflow_id)
            graph = json.loads(require_instance(workflow, Workflow).graph)
            graph["viewport"] = {"x": 41, "y": 12, "zoom": 0.8}
            for node in graph["nodes"]:
                node["positionAbsolute"] = {"x": 41, "y": 12}
                node["width"], node["selected"] = 244, True
            if guard_change == "execution":
                graph["nodes"][-1]["data"]["new_execution_input"] = "changed"
            require_instance(workflow, Workflow).graph = json.dumps(graph, separators=(",", ":"))
        elif guard_change == "input":
            assert session is not None
            require_instance(session.get(DifyBuilderTestInput, test_input_id), DifyBuilderTestInput).inputs = {
                "changed": True
            }
        elif guard_change == "actor":
            from models.dify_builder import DifyBuilderSession

            assert session is not None
            require_instance(session.get(DifyBuilderSession, session_id), DifyBuilderSession).owner_account_id = str(
                uuid4()
            )
        elif guard_change == "target":
            snapshot = session.get(AgentConfigSnapshot, snapshot_id)
            soul = require_instance(snapshot, AgentConfigSnapshot).config_snapshot_dict
            soul["model"]["model"] = "changed-model"
            require_instance(snapshot, AgentConfigSnapshot).config_snapshot = AgentSoulConfig.model_validate(soul)
    if guard_change not in {"none", "canvas"}:
        with pytest.raises(BuilderExecutionPolicyError):
            store.read_checkpoint(ref=ref, checkpoint=saved)
        with factory() as session:
            assert (
                session.scalar(select(NativeEffectAttempt).where(NativeEffectAttempt.request_id == ref.request_id))
                is None
            )
        return
    selected = store.read_checkpoint(ref=ref, checkpoint=saved)
    protected = store.load_agent_association(ref=ref, parent_node=parent, wait=selected.agent_associations[0])
    assert protected.association.home_snapshot_id is None
    assert protected.association.workspace.workspace_generation == 0
    assert (
        store.load_prepared_config(
            ref=ref, parent_node=parent, config_ref=prepared.claim.config_ref
        ).workspace.home_snapshot_id
        is None
    )
    assert len(allocations) == 1
    with factory() as session:
        assert (
            session.scalar(select(NativeEffectAttempt).where(NativeEffectAttempt.request_id == ref.request_id)) is None
        )
    # Current SQL drift still invalidates the original protected null pin.
    with factory.begin() as session:
        assert session is not None
        require_instance(
            session.get(AgentWorkspaceBinding, stored.binding_id), AgentWorkspaceBinding
        ).base_home_snapshot_id = c.workspace.home_snapshot_id
    with pytest.raises(BuilderExecutionPolicyError, match="native_agent_pin_mismatch"):
        store.read_checkpoint(ref=ref, checkpoint=saved)


@pytest.mark.parametrize("association_case", ["legacy_confirmed", "isolated"], indirect=True)
def test_real_unmarked_profiles_keep_raw_revision_and_immutable_private_scope(
    association_case: AgentAssociationCase,
) -> None:
    from models.dify_builder_native_tests import NativeEffectAttempt, NativeEffectGrant

    c = association_case
    assert c.store.load_context(ref=c.ref).ref == c.ref
    with c.factory.begin() as session:
        request = session.get(DifyBuilderExecutionRequest, c.ref.request_id)
        original_context, original_digest = (
            json.loads(json.dumps(require_instance(request, DifyBuilderExecutionRequest).context)),
            require_instance(request, DifyBuilderExecutionRequest).context_digest,
        )
        assert "revision_basis" not in original_context
        workflow = session.get(Workflow, require_instance(request, DifyBuilderExecutionRequest).workflow_id)
        graph = json.loads(require_instance(workflow, Workflow).graph)
        graph["viewport"] = {"x": 28, "y": 13, "zoom": 1}
        require_instance(workflow, Workflow).graph = json.dumps(graph, separators=(",", ":"))
    with pytest.raises(BuilderExecutionPolicyError, match="native_revision_drift"):
        c.loader.load(ref=c.ref)
    with pytest.raises(BuilderExecutionPolicyError, match="native_revision_drift"):
        c.store.load_context(ref=c.ref)
    with c.factory() as session:
        request = session.get(DifyBuilderExecutionRequest, c.ref.request_id)
        assert (
            require_instance(request, DifyBuilderExecutionRequest).context,
            require_instance(request, DifyBuilderExecutionRequest).context_digest,
        ) == (
            original_context,
            original_digest,
        )
        assert (
            session.scalar(select(NativeEffectAttempt).where(NativeEffectAttempt.request_id == c.ref.request_id))
            is None
        )
        assert session.scalar(select(NativeEffectGrant).where(NativeEffectGrant.request_id == c.ref.request_id)) is None


class _ForwardArguments425(TypedDict, closed=True):
    ref: _forward_types_0.NativeTestContextRef
    settlement: NotRequired[bool]


class AgentWaitArguments(TypedDict, closed=True):
    ref: NativeTestContextRef
    parent_node: AgentParentNodeRef
    association_object_ref: str
    agent_generation: int
    checkpoint: JsonValue
    backend_wait_event_id: str
