"""Actual protected read owners; existing SQL/crypto/storage boundary fixtures only."""

import json
from collections import Counter
from contextlib import suppress
from contextvars import copy_context
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from dify_agent.client import Client
from dify_agent.protocol.native_testing import AgentRuntimeIdentity, AgentRunTransportSelection
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.account import Account, AccountStatus
from models.agent import Agent, AgentConfigSnapshot, AgentWorkspace, WorkflowAgentNodeBinding
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeEffectGrant,
    NativeEffectOperation,
    NativeInvocationState,
    NativePayloadObject,
    NativePendingAction,
    NativeTestInvocation,
    NativeTestScope,
)
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.agent_contracts import (
    AgentNodeAssociation,
    AgentParentNodeRef,
    AgentTestWorkspaceRef,
    AgentWaitAssociation,
)
from runtime_contracts.builder.native.approval_contracts import NativeApprovalProposal, NativeApprovalTerms
from runtime_contracts.builder.native.contracts import (
    EffectIntent,
    JsonValue,
    NativeTestContextRef,
    OperationKey,
    operation_digest,
)
from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload, NodeJournalState
from services.dify_builder.native_testing import private_reads
from services.dify_builder.native_testing import state_store as store_module
from services.dify_builder.native_testing.agent_confirmed_workspace import ALLOCATION, current_confirmed_workspace
from services.dify_builder.native_testing.agent_lineage import AgentServicePrincipal, NativeAgentEndpointLineage
from services.dify_builder.native_testing.agent_operations import (
    AgentCallAssessment,
    AgentOperationBindingResolver,
    AgentOperationService,
)
from services.dify_builder.native_testing.agent_preparation import AgentPreparationService
from services.dify_builder.native_testing.api_service import NativeTestApiService
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader, native_workflow_revision
from services.dify_builder.native_testing.state_store import (
    NativeExecutionStateStore,
    ObjectReceipt,
    PayloadKind,
    native_payload_read_scope,
)
from tests.unit_tests.services.dify_builder.native_testing.test_agent_associations import (
    AgentStateCase,
    v2_wait_state,
)
from tests.unit_tests.services.dify_builder.native_testing.test_agent_associations import (
    state_case as state_case,  # noqa: PLC0414 - existing SQL/crypto/storage boundary fixture
)
from tests.unit_tests.services.dify_builder.test_execution_policy_service import Owned
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414


@dataclass
class WaitingReadCase:
    api: NativeTestApiService
    factory: sessionmaker[Session]
    actor: Actor
    session_id: str
    request_id: str
    objects: list[ObjectReceipt]


@pytest.fixture
def waiting_read_case(owned: Owned, state_case: AgentStateCase, monkeypatch: pytest.MonkeyPatch) -> WaitingReadCase:
    """Real SQLite owner/query/codec pipeline; only existing encrypted storage is a unit boundary."""
    factory, actor, app, workflow, session_id, input_id = owned
    c = state_case

    def encrypt(tenant: str, raw: str) -> str:
        assert tenant == actor.tenant_id
        return raw.encode().hex()

    def decrypt(tenant: str, stored: str) -> str:
        assert tenant == actor.tenant_id
        return bytes.fromhex(stored).decode()

    monkeypatch.setattr(store_module.encrypter, "encrypt_token", encrypt)
    monkeypatch.setattr(store_module.encrypter, "decrypt_token", decrypt)
    # Restore the real private-read owners replaced by the structural store fixture.
    monkeypatch.setattr(store_module, "validate_private_read", private_reads.validate_private_read)
    monkeypatch.setattr(store_module, "validate_invocation_workflow", private_reads.validate_invocation_workflow)
    monkeypatch.setattr(store_module, "native_workflow_revision", native_workflow_revision)
    workflow.graph = json.dumps(c.context.graph)
    revision = native_workflow_revision(workflow)
    request_id, invocation_id, run_id = [str(uuid4()) for _ in range(3)]
    request_context = {
        "policy_version": "builder-native-test-v1",
        "invocation_id": invocation_id,
        "native_run_id": run_id,
        "mode": "native",
        "execution_revision": revision,
        "profile": {"profile_id": "builder-agent-confirmed-v1"},
    }
    ref = NativeTestContextRef(
        request_id=request_id, invocation_id=invocation_id, context_digest=canonical_digest(request_context)
    )
    context = c.context.model_copy(
        update={
            "ref": ref,
            "tenant_id": actor.tenant_id,
            "actor_id": actor.account_id,
            "app_id": app.id,
            "workflow_id": workflow.id,
            "graph_revision": revision,
            "native_run_id": run_id,
            "root_native_run_id": run_id,
        },
        deep=True,
    )
    scope = WorkflowAgentSessionScope(
        tenant_id=actor.tenant_id,
        app_id=app.id,
        workflow_id=workflow.id,
        workflow_run_id=run_id,
        node_id="agent-node",
        node_execution_id=c.parent.execution_id,
        workflow_agent_binding_id="node-binding",
        agent_id="agent",
        agent_config_snapshot_id="snapshot",
    )
    workspace = AgentTestWorkspaceRef(
        binding_id="binding",
        workspace_id="workspace",
        backend_binding_ref="native:binding:1",
        backend_workspace_ref="native:binding:1",
        pinned_snapshot_id="snapshot",
        home_snapshot_id="home",
        workspace_generation=0,
    )
    allocation = {"scope": asdict(scope), "workspace": workspace.model_dump(mode="json")}
    with factory.begin() as sql:
        sql.merge(workflow)
        test_input = sql.get(DifyBuilderTestInput, input_id)
        assert test_input is not None
        test_input.inputs = dict[str, JsonValue]()
        for model, resource in c.loader.resources.items():
            if resource is None or model.__module__ == "models.account" or model.__name__ == "App":
                continue
            fields = {column.key for column in inspect(resource).mapper.column_attrs}
            for key, value in {"tenant_id": actor.tenant_id, "app_id": app.id, "workflow_id": workflow.id}.items():
                if key in fields:
                    setattr(resource, key, value)
            if isinstance(resource, WorkflowAgentNodeBinding):
                resource.workflow_version = "draft"
            if isinstance(resource, AgentWorkspace):
                resource.owner_id, resource.owner_scope_key = run_id, scope.workspace_owner.owner_scope_key
            sql.add(resource)
        sql.add(
            WorkflowRun(
                id=run_id,
                tenant_id=actor.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                version="draft",
                graph=workflow.graph,
                inputs="{}",
                status=WorkflowExecutionStatus.PAUSED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=actor.account_id,
                total_steps=1,
                exceptions_count=0,
            )
        )
        sql.add(
            WorkflowNodeExecutionModel(
                id=c.parent.execution_id,
                tenant_id=actor.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                workflow_run_id=run_id,
                node_execution_id=str(uuid4()),
                node_id="agent-node",
                node_type="agent",
                title="Agent",
                index=1,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=actor.account_id,
                status=WorkflowNodeExecutionStatus.PAUSED,
                agent_workspace_binding_id="binding",
            )
        )
        sql.add(
            DifyBuilderExecutionRequest(
                id=request_id,
                tenant_id=actor.tenant_id,
                actor_id=actor.account_id,
                app_id=app.id,
                workflow_id=workflow.id,
                session_id=session_id,
                test_input_id=input_id,
                state="waiting",
                context=request_context,
                context_digest=ref.context_digest,
                native_run_id=run_id,
            )
        )
        sql.add(
            NativeTestScope(
                request_id=request_id,
                tenant_id=actor.tenant_id,
                generation=0,
                task_approved=True,
                cancelled=False,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
                budget_limits={},
                budget_spent={},
                profile={},
                max_calls=10,
                max_dispatches=10,
                max_cost_units=10,
            )
        )
        sql.add(
            NativeTestInvocation(
                tenant_id=actor.tenant_id,
                request_id=request_id,
                invocation_id=invocation_id,
                active=True,
                bindings={ALLOCATION: allocation},
            )
        )
    loader = OwnedNativeTestLoader(factory, actor=actor, resolver=AgentOperationBindingResolver())
    store = NativeExecutionStateStore(loader)
    objects: list[ObjectReceipt] = []

    def save(kind: PayloadKind, key: str, value: JsonValue) -> ObjectReceipt:
        receipt = store.prepare_object(ref=ref, tenant_id=actor.tenant_id, kind=kind, logical_key=key, payload=value)
        with factory.begin() as sql:
            sql.add(NativePayloadObject(**vars(receipt)))
        objects.append(receipt)
        return receipt

    context_object = save("context", "context", context.model_dump(mode="json"))
    inputs = save("result", "node-input:" + c.parent.execution_id, {"typed": [True, 1, "1"]})
    parent = AgentParentNodeRef(
        ref=ref,
        execution_id=c.parent.execution_id,
        input_result_ref=inputs.id,
        input_digest=canonical_digest({"typed": [True, 1, "1"]}),
    )
    with factory.begin() as sql:
        sql.add(
            NativeInvocationState(
                tenant_id=actor.tenant_id,
                request_id=request_id,
                invocation_id=invocation_id,
                app_id=app.id,
                workflow_id=workflow.id,
                parent_invocation_id=None,
                context_object_id=context_object.id,
                generation=0,
                state="waiting",
                pending_ids=[],
                resolution=[],
            )
        )
    with factory() as sql:
        owned_row, _ = loader._load(sql, ref=ref, lock=False)
        _, stamp = current_confirmed_workspace(session=sql, owned=owned_row, context=context, allocation=allocation)
    config: JsonValue = {
        "composition": {
            "layers": [
                {"name": "shell", "config": {"runtime": "python"}},
                {"name": "runtime", "config": {"backend_binding_ref": workspace.backend_binding_ref}},
                {"name": "config", "config": {}},
            ]
        },
        "session_snapshot": None,
    }
    config = store._agent_executable_config(config, parent)
    config_object = save(
        "result",
        store._agent_key("agent-config", parent),
        {
            "schema": "agent-config-v2",
            "parent_node": parent.model_dump(mode="json"),
            "workflow_native_run_id": run_id,
            "workspace": workspace.model_dump(mode="json"),
            "resource_digest": stamp,
            "config": config,
        },
    )
    association = AgentNodeAssociation(
        parent_node=parent,
        workflow_native_run_id=run_id,
        agent_run_id="agent-run",
        config_ref=config_object.id,
        config_digest=canonical_digest(config),
        pinned_snapshot_id="snapshot",
        home_snapshot_id="home",
        workspace=workspace,
    )
    association_object = save("result", store._agent_key("agent-bind", parent), association.model_dump(mode="json"))
    backend_checkpoint: dict[str, JsonValue] = {
        "run_id": association.agent_run_id,
        "ref": ref.model_dump(mode="json"),
        "config_ref": config_object.id,
        "config_digest": association.config_digest,
        "generation": 0,
    }
    agent_checkpoint = save(
        "result",
        store._agent_key("agent-cp", parent, 0),
        {
            "schema": "agent-checkpoint-v1",
            "parent_node": parent.model_dump(mode="json"),
            "association_object_ref": association_object.id,
            "agent_generation": 0,
            "backend_wait_event_id": "1234-0",
            "checkpoint": backend_checkpoint,
        },
    )
    wait = AgentWaitAssociation(
        parent_node=parent,
        association_object_ref=association_object.id,
        agent_generation=0,
        checkpoint_object_ref=agent_checkpoint.id,
        checkpoint_digest=canonical_digest(backend_checkpoint),
        backend_wait_event_id="1234-0",
    )
    key = OperationKey(invocation_id=invocation_id, occurrence_path=(parent.execution_id, "bootstrap"), cursor=0)
    intent = EffectIntent(
        key=key,
        kind="tool",
        resource_ref="workspace-shell",
        implementation_revision="snapshot",
        account_ref=None,
        target={"shell": "shell", "runtime": "python"},
        parameters={"script": "python3 --version"},
        input_digest="a" * 64,
        capability_digest="b" * 64,
    )
    proposal = NativeApprovalProposal(
        key=key,
        terms=NativeApprovalTerms(
            max_calls=1,
            max_dispatches=1,
            max_cost_units=1,
            expires_at=(datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        ),
    )
    checkpoint = save(
        "checkpoint",
        "waiting",
        NativeCheckpointPayload(
            schema_version="1",
            native_run_id=run_id,
            generation=0,
            generate_entity_json="{}",
            graph_runtime_state_json="{}",
            response_stream_filter_json="{}",
            node_journals=(
                NodeJournalState(
                    invocation_id=invocation_id,
                    occurrence_path=(parent.execution_id,),
                    input_result_ref=inputs.id,
                    input_digest=parent.input_digest,
                    cursor=0,
                    operation_keys=(),
                    result_refs=(),
                ),
                NodeJournalState(
                    invocation_id=invocation_id,
                    occurrence_path=key.occurrence_path,
                    input_result_ref=inputs.id,
                    input_digest=parent.input_digest,
                    cursor=1,
                    operation_keys=(key,),
                    result_refs=(),
                    intents=(intent,),
                ),
            ),
            child_refs=(),
            input_result_refs=(inputs.id,),
            agent_associations=(wait,),
            approval_proposals=(proposal,),
        ).model_dump(mode="json"),
    )
    assessment = AgentCallAssessment(
        action="Run python",
        account_label=None,
        target_summary="owned workspace",
        parameters_summary="version",
        risk_notice="Runs an approved shell command.",
        destructive=False,
    )
    save(
        "result",
        "agent-intent:" + operation_digest(key),
        {
            "intent": intent.model_dump(mode="json"),
            "proposal": proposal.model_dump(mode="json"),
            "assessment": assessment.model_dump(mode="json"),
        },
    )
    pending_id, operation_id = str(uuid4()), str(uuid4())
    with factory.begin() as sql:
        state = sql.query(NativeInvocationState).filter_by(request_id=request_id).one()
        state.pending_ids, state.checkpoint_id, state.wait_reason = [pending_id], checkpoint.id, "approval"
        sql.add(
            NativeContinuation(
                tenant_id=actor.tenant_id,
                request_id=request_id,
                invocation_id=invocation_id,
                generation=0,
                checkpoint_id=checkpoint.id,
                payload_digest=checkpoint.payload_digest,
                payload_ref=checkpoint.storage_key,
            )
        )
        sql.add(
            NativeEffectOperation(
                id=operation_id,
                tenant_id=actor.tenant_id,
                request_id=request_id,
                invocation_id=invocation_id,
                operation_digest=operation_digest(key),
                intent_digest=canonical_digest(intent.model_dump(mode="json")),
                scope_digest="e" * 64,
                state="pending",
            )
        )
        sql.add(
            NativePendingAction(
                id=pending_id,
                tenant_id=actor.tenant_id,
                request_id=request_id,
                invocation_id=invocation_id,
                generation=0,
                category="approval",
                reference=operation_id,
                reference_digest=canonical_digest(operation_id),
                owner_ref=app.id,
                owner_version="e" * 64,
                operation_id=operation_id,
            )
        )
        invocation = sql.query(NativeTestInvocation).filter_by(request_id=request_id).one()
        snapshot = sql.get(AgentConfigSnapshot, "snapshot")
        assert snapshot is not None
        from models.agent_config_entities import AgentSoulConfig

        descriptor = {
            "node_id": "agent-node",
            "agent_id": "agent",
            "snapshot_id": "snapshot",
            "snapshot_digest": canonical_digest(
                AgentSoulConfig.model_validate(snapshot.config_snapshot_dict).model_dump(mode="json")
            ),
            "shell_boundary": "bootstrap",
            "parent_node": parent.model_dump(mode="json"),
            "config_ref": config_object.id,
            "composition_digest": association.config_digest,
            "workspace": workspace.model_dump(mode="json"),
        }
        invocation.bindings = {
            **invocation.bindings,
            "_agent_operations_v1": {operation_digest(key): descriptor},
        }
    operations = AgentOperationService(
        loader=loader, state_store=store, assessor=lambda **_: pytest.fail("no assessment")
    )
    api = NativeTestApiService(
        session_factory=factory,
        actor=actor,
        resolver=AgentOperationBindingResolver(),
        admission=None,
        resolution=None,
        runtime=None,
        disclosure=operations,
    )
    return WaitingReadCase(api, factory, actor, session_id, request_id, objects)


def test_waiting_get_reads_seven_objects_once(
    waiting_read_case: WaitingReadCase, state_case: AgentStateCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = waiting_read_case
    reads: list[ObjectReceipt] = []
    original = NativeExecutionStateStore._read_object

    def record(row: NativePayloadObject | ObjectReceipt, *, max_bytes: int | None = None) -> JsonValue:
        reads.append(row if isinstance(row, ObjectReceipt) else ObjectReceipt.from_payload_object(row))
        return original(row, max_bytes=max_bytes)

    monkeypatch.setattr(NativeExecutionStateStore, "_read_object", staticmethod(record))
    state_case.events.clear()
    receipt = c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id)
    assert receipt.status == "waiting"
    assert len(receipt.pending) == 1
    assert len(reads) == 19
    assert len(set(reads)) == 7
    assert sorted(Counter(reads).values()) == [2, 2, 2, 2, 3, 3, 5]
    assert state_case.events.count("load") == 7


@pytest.mark.parametrize("drift", ["account", "input", "revision", "snapshot", "receipt"])
def test_waiting_get_rechecks_real_sql_owners_inside_shared_scope(
    waiting_read_case: WaitingReadCase, drift: str
) -> None:
    c = waiting_read_case
    with native_payload_read_scope():
        assert c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id).status == "waiting"
        with c.factory.begin() as sql:
            request = sql.get(DifyBuilderExecutionRequest, c.request_id)
            assert request is not None
            if drift == "account":
                account = sql.get(Account, c.actor.account_id)
                assert account is not None
                account.status = AccountStatus.BANNED
            elif drift == "input":
                test_input = sql.get(DifyBuilderTestInput, request.test_input_id)
                assert test_input is not None
                test_input.inputs = {"changed": True}
            elif drift == "revision":
                workflow = sql.get(Workflow, request.workflow_id)
                assert workflow is not None
                workflow.graph = '{"nodes": [], "edges": []}'
            elif drift == "snapshot":
                agent = sql.get(Agent, "agent")
                assert agent is not None
                agent.active_config_snapshot_id = "foreign"
            else:
                selected = next(value for value in c.objects if value.logical_key.startswith("agent-config:"))
                row = sql.get(NativePayloadObject, selected.id)
                assert row is not None
                row.value_digest = "f" * 64
        with pytest.raises(BuilderExecutionPolicyError):
            c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id)


def test_waiting_get_observes_current_grant_inside_shared_scope(waiting_read_case: WaitingReadCase) -> None:
    c = waiting_read_case
    with native_payload_read_scope():
        initial = c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id)
        assert initial.pending[0].decision_status == "awaiting_decision"
        scope_digest = initial.pending[0].scope_digest
        assert scope_digest is not None
        with c.factory.begin() as sql:
            sql.add(
                NativeEffectGrant(
                    tenant_id=c.actor.tenant_id,
                    request_id=c.request_id,
                    actor_id=c.actor.account_id,
                    scope_digest=scope_digest,
                    decision="denied",
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                    max_calls=1,
                    max_dispatches=1,
                    max_cost_units=1,
                )
            )
        fresh = c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id)
        assert fresh.pending[0].decision_status == "denied"


@pytest.mark.parametrize("drift", [None, "account", "snapshot", "workspace", "receipt"])
def test_lineage_rechecks_real_sql_after_backend_identity(
    waiting_read_case: WaitingReadCase, state_case: AgentStateCase, monkeypatch: pytest.MonkeyPatch, drift: str | None
) -> None:
    c = waiting_read_case
    # SQLite's DateTime adapter returns naive UTC; the deterministic clock stays
    # in that representation. No production expiry or validation is substituted.
    monkeypatch.setattr(store_module, "utc_now", datetime.now)
    store = c.api.store
    association_receipt = next(value for value in c.objects if value.logical_key.startswith("agent-bind:"))
    association = AgentNodeAssociation.model_validate(store._read_object(association_receipt))
    selection = AgentRunTransportSelection(
        agent_run_id=association.agent_run_id,
        parent_node=association.parent_node.model_dump(mode="json"),
        request_digest=association.config_digest,
        agent_generation=0,
    )
    calls = []

    def identity(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        with c.factory.begin() as sql:
            if drift == "account":
                row = sql.get(Account, c.actor.account_id)
                assert row is not None
                row.status = AccountStatus.BANNED
            elif drift == "snapshot":
                agent = sql.get(Agent, "agent")
                assert agent is not None
                agent.active_config_snapshot_id = "other"
            elif drift == "workspace":
                workspace = sql.get(AgentWorkspace, "workspace")
                assert workspace is not None
                workspace.owner_id = "other"
            elif drift == "receipt":
                selected = next(value for value in c.objects if value.logical_key.startswith("agent-config:"))
                payload = sql.get(NativePayloadObject, selected.id)
                assert payload is not None
                payload.value_digest = "f" * 64
        return httpx.Response(
            200,
            json=AgentRuntimeIdentity(
                run_id=association.agent_run_id,
                execution_mode="builder_test",
                native_test_profile="confirmed",
                parent_node=selection.parent_node,
                request_digest=selection.request_digest,
                agent_generation=0,
            ).model_dump(mode="json"),
        )

    with httpx.Client(transport=httpx.MockTransport(identity)) as http:
        backend = Client(base_url="http://agent.invalid", sync_http_client=http)
        preparation = AgentPreparationService(state_store=store, backend=backend, workspace=None, config_builder=None)
        lineage = NativeAgentEndpointLineage(backend=backend, preparation_for_ref=lambda _ref: preparation)
        state_case.events.clear()
        if drift is not None:
            with pytest.raises(BuilderExecutionPolicyError):
                lineage.resolve(principal=AgentServicePrincipal(), selection=selection, boundary="model", caller={})
            assert len(calls) == 1
        else:
            for index in range(2):
                result = lineage.resolve(
                    principal=AgentServicePrincipal(), selection=selection, boundary="model", caller={}
                )
                assert result is not None
                assert result.association == association
                assert len(calls) == index + 1
                assert state_case.events.count("load") == 4 * (index + 1)


def test_lineage_reuses_exact_object_bytes_but_repeats_current_read_owners(
    state_case: AgentStateCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = state_case
    association, _wait = v2_wait_state(c)
    selection = AgentRunTransportSelection(
        agent_run_id=association.agent_run_id,
        parent_node=c.parent.model_dump(mode="json"),
        request_digest=association.config_digest,
        agent_generation=0,
    )
    identities = []

    def identity(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == f"/runs/{association.agent_run_id}/native-identity"
        identities.append(request.content)
        return httpx.Response(
            200,
            json=AgentRuntimeIdentity(
                run_id=association.agent_run_id,
                execution_mode="builder_test",
                native_test_profile="confirmed",
                parent_node=selection.parent_node,
                request_digest=selection.request_digest,
                agent_generation=0,
            ).model_dump(mode="json"),
        )

    reads: list[ObjectReceipt] = []
    original = c.store._read_object

    def record(row: NativePayloadObject | ObjectReceipt, *, max_bytes: int | None = None) -> JsonValue:
        reads.append(row if isinstance(row, ObjectReceipt) else ObjectReceipt.from_payload_object(row))
        return original(row, max_bytes=max_bytes)

    monkeypatch.setattr(c.store, "_read_object", record)
    with httpx.Client(transport=httpx.MockTransport(identity)) as http:
        backend = Client(base_url="http://agent.invalid", sync_http_client=http)
        preparation = AgentPreparationService(state_store=c.store, backend=backend, workspace=None, config_builder=None)
        lineage = NativeAgentEndpointLineage(backend=backend, preparation_for_ref=lambda _ref: preparation)
        c.events.clear()
        result = lineage.resolve(principal=AgentServicePrincipal(), selection=selection, boundary="model", caller={})
    assert result is not None
    assert result.association == association
    assert len(identities) == 1
    # Both sides of backend identity I/O still traverse all existing owners.
    assert len(reads) == 18
    assert sorted(Counter(reads).values()) == [2, 4, 6, 6]
    assert c.events.count("load") == 4


def context_receipt(c: AgentStateCase) -> ObjectReceipt:
    return ObjectReceipt.from_payload_object(next(row for row in c.loader.rows if row.kind == "context"))


def test_nested_scope_keeps_outer_bytes_and_decodes_independent_values(state_case: AgentStateCase) -> None:
    c = state_case
    receipt = context_receipt(c)
    c.events.clear()
    with native_payload_read_scope():
        first = c.store._read_object(receipt)
        assert isinstance(first, dict)
        first["inputs"] = {"mutated": True}
        with native_payload_read_scope():
            second = c.store._read_object(receipt)
        third = c.store._read_object(receipt)
        assert second == third
        assert first != second
        assert c.events.count("load") == 1
    c.store._read_object(receipt)
    assert c.events.count("load") == 2


def test_exception_drops_scope_before_next_command(state_case: AgentStateCase) -> None:
    c = state_case
    receipt = context_receipt(c)
    c.events.clear()

    def interrupted() -> None:
        with native_payload_read_scope():
            c.store._read_object(receipt)
            raise RuntimeError("interrupted")

    with pytest.raises(RuntimeError, match="interrupted"):
        interrupted()
    with native_payload_read_scope():
        c.store._read_object(receipt)
    assert c.events.count("load") == 2


def test_inherited_context_cannot_reactivate_a_finished_scope(state_case: AgentStateCase) -> None:
    c = state_case
    receipt = context_receipt(c)
    with native_payload_read_scope():
        c.store._read_object(receipt)
        inherited = copy_context()

    def command() -> None:
        with native_payload_read_scope():
            c.store._read_object(receipt)

    c.events.clear()
    inherited.run(command)
    inherited.run(command)
    inherited.run(c.store._read_object, receipt)
    assert c.events.count("load") == 3


@pytest.mark.parametrize("field", list(ObjectReceipt.__dataclass_fields__))
def test_changed_full_receipt_never_reuses_bytes(state_case: AgentStateCase, field: str) -> None:
    c = state_case
    receipt = context_receipt(c)
    changed = replace(receipt, **{field: getattr(receipt, field) + "-changed"})
    c.blobs[changed.storage_key] = c.blobs[receipt.storage_key]
    c.events.clear()
    with native_payload_read_scope():
        c.store._read_object(receipt)
        # Some receipt fields are also envelope/value integrity assertions.
        with suppress(BuilderExecutionPolicyError):
            c.store._read_object(changed)
    assert c.events.count("load") == 2


def test_changed_size_limit_keeps_its_own_read_and_rejects_oversize(state_case: AgentStateCase) -> None:
    c = state_case
    receipt = context_receipt(c)
    c.events.clear()
    with native_payload_read_scope():
        c.store._read_object(receipt)
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_config_unavailable"):
            c.store._read_object(receipt, max_bytes=1)
    assert c.events.count("load") == 2


def test_failed_integrity_read_is_not_saved_in_scope(state_case: AgentStateCase) -> None:
    c = state_case
    receipt = context_receipt(c)
    correct = c.blobs[receipt.storage_key]
    c.blobs[receipt.storage_key] = b"00"
    c.events.clear()
    with native_payload_read_scope():
        with pytest.raises(BuilderExecutionPolicyError):
            c.store._read_object(receipt)
        c.blobs[receipt.storage_key] = correct
        assert c.store._read_object(receipt) == c.context.model_dump(mode="json")
    assert c.events.count("load") == 2


def test_cached_encrypted_bytes_are_decrypted_again(
    state_case: AgentStateCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = state_case
    receipt = context_receipt(c)
    c.events.clear()
    with native_payload_read_scope():
        c.store._read_object(receipt)

        def unavailable(_tenant: str, _stored: str) -> str:
            raise OSError("unit key provider unavailable")

        monkeypatch.setattr(store_module.encrypter, "decrypt_token", unavailable)
        with pytest.raises(BuilderExecutionPolicyError, match="native_payload_unavailable"):
            c.store._read_object(receipt)
    assert c.events.count("load") == 1


def test_scope_entry_limit_falls_back_to_uncached_read(state_case: AgentStateCase) -> None:
    c = state_case
    receipt = context_receipt(c)
    c.events.clear()
    with native_payload_read_scope():
        for index in range(store_module._PAYLOAD_READ_MAX_ENTRIES):
            c.store._read_object(receipt, max_bytes=1_000_000 + index)
        c.store._read_object(receipt, max_bytes=2_000_000)
        c.store._read_object(receipt, max_bytes=2_000_000)
    assert c.events.count("load") == store_module._PAYLOAD_READ_MAX_ENTRIES + 2


def test_scope_byte_limit_falls_back_to_uncached_read(state_case: AgentStateCase) -> None:
    c = state_case
    receipt = c.store.prepare_object(
        ref=c.ref,
        tenant_id="tenant",
        kind="result",
        logical_key="large",
        payload="x" * (store_module._PAYLOAD_READ_MAX_BYTES // 2),
    )
    c.events.clear()
    with native_payload_read_scope():
        assert c.store._read_object(receipt) == c.store._read_object(receipt)
    # The encrypted unit boundary uses hex; this object alone exceeds the byte cap.
    assert len(c.blobs[receipt.storage_key]) > store_module._PAYLOAD_READ_MAX_BYTES
    assert c.events.count("load") == 2


@pytest.mark.parametrize("drift", ["cancel", "snapshot", "workspace", "receipt"])
def test_cached_bytes_never_replace_current_owner_checks(state_case: AgentStateCase, drift: str) -> None:
    c = state_case
    association, _ = v2_wait_state(c)
    with native_payload_read_scope():
        c.store.load_prepared_config(ref=c.ref, parent_node=c.parent, config_ref=association.config_ref)
        if drift == "cancel":
            c.loader.scope.cancelled = True
        elif drift == "snapshot":
            agent = c.loader.resources[Agent]
            assert isinstance(agent, Agent)
            agent.active_config_snapshot_id = "other"
        elif drift == "workspace":
            workspace = c.loader.resources[AgentWorkspace]
            assert isinstance(workspace, AgentWorkspace)
            workspace.owner_id = "other"
        else:
            next(row for row in c.loader.rows if row.id == association.config_ref).value_digest = "f" * 64
        with pytest.raises(BuilderExecutionPolicyError):
            c.store.load_prepared_config(ref=c.ref, parent_node=c.parent, config_ref=association.config_ref)
