"""Actual PostgreSQL grant/result owners with a deterministic physical boundary.

The callback is a test-owned business effect; no provider/model/OAuth is called.
"""

# Imported aliases register shared pytest fixtures in this module.
# ruff: noqa: PLC0414

from uuid import uuid4

import pytest
from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload
from dify_agent.protocol.native_testing import AgentDispatchPermit, AgentEffectIntent, AgentNativeTestRef
from sqlalchemy import func, select

from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession
from models.dify_builder_native_tests import NativeEffectDispatchClaim, NativeEffectOperation, NativeTestScope
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
from services.dify_builder.native_testing.agent_operations import (
    AgentToolDispatchOwner,
    admit_confirmed_agent_execution,
)
from services.dify_builder.native_testing.contracts import ApprovalWait, DispatchPermit, RecordedResult
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    continuation_case as continuation_case,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_native_tables as migrated_native_tables,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    native_owner as native_owner,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    no_live as no_live,
)


def payload(case, permit):
    return AgentPhysicalDispatchPayload(
        ref=AgentNativeTestRef.model_validate(case.ref.model_dump(mode="json")),
        intent=AgentEffectIntent.model_validate(case.ledger.intent.model_dump(mode="json")),
        permit=AgentDispatchPermit.model_validate(permit.model_dump(mode="json")),
    )


def test_actual_sql_approval_dispatch_and_result_replay_once(continuation_case):
    case = continuation_case
    calls = []
    guard = case.ledger.guard
    assert isinstance(guard.before_call(ref=case.ref, intent=case.ledger.intent), ApprovalWait)
    assert calls == []
    case.ledger.confirm()
    permit = guard.before_call(ref=case.ref, intent=case.ledger.intent)
    assert isinstance(permit, DispatchPermit)
    owner = AgentToolDispatchOwner(authorization=guard, state_store=case.store, revalidate=lambda **_kwargs: None)
    assert (
        owner.invoke(envelope=payload(case, permit), invoke=lambda: calls.append("dispatch") or "real observation")
        == "real observation"
    )
    with pytest.raises(BuilderExecutionPolicyError):
        owner.invoke(envelope=payload(case, permit), invoke=lambda: calls.append("duplicate"))
    replay = guard.before_call(ref=case.ref, intent=case.ledger.intent)
    assert isinstance(replay, RecordedResult)
    assert case.store.load_result(ref=case.ref, result_ref=replay.result_ref) == "real observation"
    assert calls == ["dispatch"]
    with case.factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectDispatchClaim)
                .where(NativeEffectDispatchClaim.request_id == case.ref.request_id)
            )
            == 1
        )


def test_physical_timeout_is_unknown_and_cannot_dispatch_again(continuation_case):
    case = continuation_case
    calls = []
    case.ledger.confirm()
    guard = case.ledger.guard
    permit = guard.before_call(ref=case.ref, intent=case.ledger.intent)
    assert isinstance(permit, DispatchPermit)
    owner = AgentToolDispatchOwner(authorization=guard, state_store=case.store, revalidate=lambda **_kwargs: None)

    def lost_response():
        calls.append("dispatch")
        raise TimeoutError("test response lost")

    with pytest.raises(TimeoutError):
        owner.invoke(envelope=payload(case, permit), invoke=lost_response)
    with pytest.raises(BuilderExecutionPolicyError):
        owner.invoke(envelope=payload(case, permit), invoke=lost_response)
    with case.factory() as session:
        assert (
            session.scalar(
                select(NativeEffectOperation.state).where(NativeEffectOperation.request_id == case.ref.request_id)
            )
            == "unknown"
        )
    assert calls == ["dispatch"]


def test_confirmed_admission_uses_original_key_and_preallocated_parent_run(continuation_case, native_owner):
    case = continuation_case
    factory, actor, _app, _workflow, session_id, test_input_id = native_owner
    with factory() as session:
        version = session.get(DifyBuilderSession, session_id).version
    run_id = str(uuid4())
    kwargs = {
        "actor": actor,
        "session_id": session_id,
        "test_input_id": test_input_id,
        "expected_version": version,
        "native_run_id": run_id,
        "idempotency_key": "owned-test-reservation",
        "limits": {"calls": 4, "dispatches": 4, "cost_units": 4},
    }
    first = admit_confirmed_agent_execution(**kwargs)
    second = admit_confirmed_agent_execution(**kwargs)
    assert first == second
    assert first.native_run_id == run_id
    with factory() as session:
        row = session.get(DifyBuilderExecutionRequest, first.ref.request_id)
        scope = session.get(NativeTestScope, first.ref.request_id)
        assert row.context["profile"]["profile_id"] == "builder-agent-confirmed-v1"
        assert scope.task_approved is True
        assert scope.spent_calls == 0
    with pytest.raises(BuilderExecutionPolicyError, match="native_idempotency_conflict"):
        admit_confirmed_agent_execution(**{**kwargs, "native_run_id": str(uuid4())})


@pytest.mark.parametrize("canvas_save", [False, True])
def test_confirmed_deferred_calls_have_distinct_pending_and_one_c03_snapshot(
    continuation_case, native_owner, canvas_save
):
    """SQL owners are real; current tool metadata is the explicit no-I/O fixture."""
    from datetime import UTC, datetime, timedelta

    from models.dify_builder_native_tests import (
        NativeEffectAttempt,
        NativeEffectGrant,
        NativePendingAction,
        NativeTestInvocation,
    )
    from services.dify_builder.execution_contracts import canonical_digest
    from services.dify_builder.native_testing.api_service import NativeTestApiService
    from services.dify_builder.native_testing.approval_contracts import NativeApprovalProposal, NativeApprovalTerms
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from services.dify_builder.native_testing.contracts import OperationKey, operation_digest
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
    from services.dify_builder.native_testing.public_contracts import PendingActionDisclosure
    from services.dify_builder.native_testing.repository import NativeBinding, OwnedNativeTestLoader
    from services.dify_builder.native_testing.runtime_contracts import NativeCheckpointPayload, NodeJournalState
    from services.dify_builder.native_testing.state_store import NativeExecutionStateStore

    case = continuation_case
    factory, actor, _app, _workflow, session_id, test_input_id = native_owner
    with factory() as session:
        version = session.get(DifyBuilderSession, session_id).version
    context = admit_confirmed_agent_execution(
        actor=actor,
        session_id=session_id,
        test_input_id=test_input_id,
        expected_version=version,
        native_run_id=str(uuid4()),
        idempotency_key="two-deferred-calls",
        limits={"calls": 4, "dispatches": 4, "cost_units": 4},
    )
    ref, execution_id = context.ref, str(uuid4())
    typed_inputs = {"synthetic": True}
    effects = tuple(
        case.ledger.intent.model_copy(
            update={
                "key": OperationKey(
                    invocation_id=ref.invocation_id,
                    occurrence_path=(execution_id, "core_tool", f"call-{index}"),
                    cursor=0,
                ),
                "parameters": {"limit": index},
                "input_digest": canonical_digest(typed_inputs),
            }
        )
        for index in (1, 2)
    )
    bindings, descriptors = {}, {}
    for effect in effects:
        identity = operation_digest(effect.key)
        bindings[identity] = NativeBinding(
            intent_digest=canonical_digest(effect.model_dump(mode="json")),
            kind="tool",
            resource_ref=effect.resource_ref,
            implementation_revision=effect.implementation_revision,
            account_ref=effect.account_ref,
            capability_digest=effect.capability_digest,
            resource_version="fixture-current-pin",
            credential_version="credential-v1",
            isolated=False,
            egress=True,
            new_data=True,
            destructive=False,
            approval_scope="operation",
            cost_units=1,
            budget={},
            execution_id=execution_id,
            invocation_digest=canonical_digest(effect.model_dump(mode="json")),
        ).model_dump(mode="json")
        descriptors[identity] = {
            "node_id": "fixture-agent",
            "agent_id": "fixture-published-agent",
            "snapshot_id": "fixture-pin",
            "snapshot_digest": "a" * 64,
            "graph_revision": context.graph_revision,
        }
    with factory.begin() as session:
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
        )
        invocation.bindings = {**bindings, "_agent_operations_v1": descriptors}
    loader = OwnedNativeTestLoader(factory, actor=actor, resolver=case.ledger.metadata)
    guard, store = EffectAuthorizationService(loader), NativeExecutionStateStore(loader)
    lifecycle = NativeTestLifecycleService(loader, state_store=store)
    first = guard.before_call(ref=ref, intent=effects[0])
    assert isinstance(first, ApprovalWait)
    lifecycle.fence_pending(ref=ref, pending_operation_ids=(first.pending_operation_id,), expected_generation=0)
    second = guard.before_call(ref=ref, intent=effects[1])
    assert isinstance(second, ApprovalWait)
    assert second.pending_operation_id != first.pending_operation_id
    lifecycle.fence_pending(
        ref=ref, pending_operation_ids=(first.pending_operation_id, second.pending_operation_id), expected_generation=0
    )
    assert guard.before_call(ref=ref, intent=effects[1]) == second
    # Another execution or publication cannot join this Agent's self fence.
    for foreign_execution, foreign_snapshot in ((str(uuid4()), "fixture-pin"), (execution_id, "other-pin")):
        foreign = effects[1].model_copy(
            update={
                "key": OperationKey(
                    invocation_id=ref.invocation_id,
                    occurrence_path=(foreign_execution, "core_tool", str(uuid4())),
                    cursor=0,
                )
            }
        )
        identity = operation_digest(foreign.key)
        with factory.begin() as session:
            invocation = session.scalar(
                select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
            )
            raw = dict(invocation.bindings)
            raw[identity] = {
                **bindings[operation_digest(effects[1].key)],
                "intent_digest": canonical_digest(foreign.model_dump(mode="json")),
                "invocation_digest": canonical_digest(foreign.model_dump(mode="json")),
                "execution_id": foreign_execution,
            }
            raw["_agent_operations_v1"] = {
                **raw["_agent_operations_v1"],
                identity: {**descriptors[operation_digest(effects[1].key)], "snapshot_id": foreign_snapshot},
            }
            invocation.bindings = raw
        assert guard.before_call(ref=ref, intent=foreign) == first
    with factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectAttempt)
                .where(NativeEffectAttempt.request_id == ref.request_id)
            )
            == 0
        )
        assert session.get(NativeTestScope, ref.request_id).spent_calls == 0
        pending = session.scalars(
            select(NativePendingAction).where(NativePendingAction.request_id == ref.request_id)
        ).all()
        assert {row.id for row in pending} == {first.pending_operation_id, second.pending_operation_id}
        assert len({row.operation_id for row in pending}) == 2
    input_ref = store.store_node_inputs(ref=ref, generation=0, native_execution_id=execution_id, inputs=typed_inputs)
    terms = NativeApprovalTerms(
        max_calls=1,
        max_dispatches=1,
        max_cost_units=1,
        expires_at=(datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
    )
    checkpoint_payload = NativeCheckpointPayload(
        schema_version="1",
        native_run_id=context.native_run_id,
        generation=0,
        generate_entity_json="{}",
        graph_runtime_state_json="{}",
        response_stream_filter_json="{}",
        child_refs=(),
        input_result_refs=(input_ref,),
        node_journals=tuple(
            NodeJournalState(
                invocation_id=ref.invocation_id,
                occurrence_path=effect.key.occurrence_path,
                input_result_ref=input_ref,
                input_digest=canonical_digest(typed_inputs),
                cursor=0,
                operation_keys=(effect.key,),
                result_refs=(),
                intents=(effect,),
            )
            for effect in effects
        ),
        approval_proposals=tuple(NativeApprovalProposal(key=effect.key, terms=terms) for effect in effects),
    )
    checkpoint = store.commit_checkpoint(ref=ref, generation=0, payload=checkpoint_payload)
    paused = lifecycle.pause(
        ref=ref,
        checkpoint=checkpoint,
        pending_operation_ids=(first.pending_operation_id, second.pending_operation_id),
        expected_generation=0,
    )
    if canvas_save:
        import json

        from models.workflow import Workflow

        with factory.begin() as session:
            workflow = session.get(Workflow, context.workflow_id)
            graph = json.loads(workflow.graph)
            graph["viewport"] = {"x": 8, "y": 21, "zoom": 0.7}
            graph["nodes"][0]["positionAbsolute"] = {"x": 8, "y": 21}
            workflow.graph = json.dumps(graph, separators=(",", ":"))
    selected = store.read_checkpoint(ref=ref, checkpoint=paused.checkpoint)
    assert tuple(intent for journal in selected.node_journals for intent in journal.intents) == effects
    assert tuple(proposal.key for proposal in selected.approval_proposals) == tuple(effect.key for effect in effects)

    class FixtureDisclosure:
        def describe(self, *, actor, resolved):
            assert actor == loader.actor
            with factory() as session:
                operation = session.scalar(
                    select(NativeEffectOperation).where(
                        NativeEffectOperation.request_id == ref.request_id,
                        NativeEffectOperation.operation_digest == operation_digest(resolved.intent.key),
                    )
                )
                pending = session.scalar(
                    select(NativePendingAction).where(NativePendingAction.operation_id == operation.id)
                )
                return PendingActionDisclosure(
                    pending_operation_id=pending.id,
                    wait_reason="approval",
                    version=1,
                    scope_digest=pending.owner_version,
                    account_label="inert fixture account",
                    action="fixture tool",
                    target=None,
                    parameters_summary=resolved.intent.parameters,
                    risk_notice="No provider I/O in this SQL component test",
                    required_configuration=(),
                    native_form_ref=None,
                    approval_limits=terms,
                )

    api = NativeTestApiService(
        session_factory=factory,
        actor=actor,
        resolver=case.ledger.metadata,
        admission=None,
        resolution=None,
        runtime=None,
        disclosure=FixtureDisclosure(),
    )
    receipt = api.get(actor=actor, session_id=session_id, request_id=ref.request_id)
    for item in receipt.pending:
        api.decide(
            actor=actor,
            session_id=session_id,
            request_id=ref.request_id,
            pending_operation_id=item.pending_operation_id,
            decision="confirm",
            scope_digest=item.scope_digest,
            expected_version=receipt.version,
            idempotency_key="decision-" + item.pending_operation_id,
        )
    with factory() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectGrant)
                .where(NativeEffectGrant.request_id == ref.request_id)
            )
            == 2
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(NativeEffectAttempt)
                .where(NativeEffectAttempt.request_id == ref.request_id)
            )
            == 0
        )
