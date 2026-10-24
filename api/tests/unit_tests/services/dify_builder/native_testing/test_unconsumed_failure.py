"""An actual failed continuation closes only its unconsumed shell permit."""

from datetime import UTC, datetime

import pytest
from dify_agent.protocol.schemas import RunEventsResponse
from sqlalchemy import Table, select

from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeContinuation,
    NativeDispatch,
    NativeEffectAttempt,
    NativeEffectDispatchClaim,
    NativeEffectOperation,
    NativeEffectOutcome,
    NativeInvocationState,
    NativePayloadObject,
    NativePendingAction,
    NativeTestInvocation,
    NativeTestScope,
)
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from runtime_contracts.builder.execution import canonical_digest
from runtime_contracts.builder.native.contracts import EffectIntent, OperationKey, operation_digest
from services.dify_builder.native_testing import state_store
from services.dify_builder.native_testing.repository import NativeBinding
from tests.unit_tests.services.dify_builder.native_testing.test_confirmed_agent_completion import (
    CompletedOwner,
)
from tests.unit_tests.services.dify_builder.native_testing.test_confirmed_agent_completion import (
    completed as completed,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.native_testing.test_confirmed_agent_completion import (
    declining as declining,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.native_testing.test_confirmed_agent_completion import (
    retrying_decline as retrying_decline,  # noqa: PLC0414
)


@pytest.fixture
def stranded(retrying_decline: CompletedOwner, monkeypatch: pytest.MonkeyPatch) -> CompletedOwner:
    owner = retrying_decline
    with owner.factory() as sql:
        checkpoint = sql.get(NativePayloadObject, "checkpoint")
        assert checkpoint is not None
        payload = state_store.NativeCheckpointPayload.model_validate(owner.commands.api.store._read_object(checkpoint))
    parent = payload.agent_associations[0].parent_node
    effect = EffectIntent(
        key=OperationKey(
            invocation_id=owner.ref.invocation_id,
            occurrence_path=(parent.execution_id, "config_pull", "file"),
            cursor=0,
        ),
        kind="shell",
        resource_ref="binding",
        implementation_revision="snapshot",
        account_ref=None,
        target={},
        parameters={"script": "bounded"},
        input_digest=parent.input_digest,
        capability_digest="b" * 64,
    )
    digest = operation_digest(effect.key)
    binding = NativeBinding(
        intent_digest=canonical_digest(effect.model_dump(mode="json")),
        kind="shell",
        resource_ref="binding",
        implementation_revision="snapshot",
        account_ref=None,
        capability_digest="b" * 64,
        resource_version="v1",
        credential_version=None,
        isolated=False,
        egress=True,
        new_data=True,
        destructive=False,
        approval_scope="operation",
        cost_units=1,
        budget={},
        execution_id=parent.execution_id,
        invocation_digest=canonical_digest(effect.model_dump(mode="json")),
    )
    raw, digest_value = state_store.encode_payload(
        tenant_id=owner.case.actor.tenant_id,
        request_id=owner.request_id,
        invocation_id=owner.ref.invocation_id,
        kind="result",
        payload={"intent": effect.model_dump(mode="json")},
    )
    original_load = state_store.storage.load
    monkeypatch.setattr(
        state_store.storage, "load", lambda key: raw.encode() if key == "intent-storage" else original_load(key)
    )
    with owner.factory.begin() as sql:
        for model in (NativeEffectAttempt, NativeEffectDispatchClaim, NativeEffectOutcome, NativePendingAction):
            assert isinstance(model.__table__, Table)
            model.__table__.create(sql.connection(), checkfirst=True)
        native = sql.get(WorkflowRun, owner.native_id)
        assert native is not None
        native.status, native.error = "failed", "policy refusal from actual child"
        request = sql.get(DifyBuilderExecutionRequest, owner.request_id)
        assert request is not None
        request.state = "running"
        state = sql.scalar(select(NativeInvocationState))
        assert state is not None
        state.state, state.generation, state.wait_reason = "unknown", 2, None
        state.pending_ids = ["file-pending"]
        state.outcome = None
        scope = sql.get(NativeTestScope, owner.request_id)
        assert scope is not None
        scope.generation, scope.spent_calls, scope.spent_dispatches, scope.spent_cost_units = 2, 3, 3, 3
        scope.expires_at = datetime(2000, 1, 1)
        source = sql.get(NativeDispatch, "source")
        assert source is not None
        source.generation, source.state = 2, "unknown"
        invocation = sql.scalar(select(NativeTestInvocation))
        assert invocation is not None
        invocation.active = False
        invocation.bindings = {
            digest: binding.model_dump(mode="json"),
            "_agent_operations_v1": {
                digest: {
                    "shell_boundary": "config_pull",
                    "parent_node": parent.model_dump(mode="json"),
                    "workflow_native_run_id": owner.native_id,
                }
            },
        }
        prior = sql.scalar(select(NativeEffectOperation))
        assert prior is not None
        prior.state, prior.result_ref = "completed", "prior-result"
        sql.add(
            NativeEffectOperation(
                id="prior-skill",
                tenant_id=scope.tenant_id,
                request_id=owner.request_id,
                invocation_id=owner.ref.invocation_id,
                operation_digest="f" * 64,
                intent_digest="e" * 64,
                scope_digest="d" * 64,
                state="completed",
                result_ref="skill-result",
            )
        )
        sql.add(
            NativeEffectOperation(
                id="file-operation",
                tenant_id=scope.tenant_id,
                request_id=owner.request_id,
                invocation_id=owner.ref.invocation_id,
                operation_digest=digest,
                intent_digest=binding.intent_digest,
                scope_digest="a" * 64,
                state="claimed",
                result_ref=None,
            )
        )
        sql.add(
            NativeEffectAttempt(
                id="file-attempt",
                tenant_id=scope.tenant_id,
                request_id=owner.request_id,
                invocation_id=owner.ref.invocation_id,
                operation_id="file-operation",
                grant_id="file-grant",
                dispatch_index=1,
                permit_digest="a" * 64,
                expires_at=datetime(2000, 1, 1),
                cost_units=1,
                budget_reservation_ref="budget",
                execution_id=parent.execution_id,
                invocation_digest=binding.invocation_digest,
                budget={},
                profile={},
            )
        )
        sql.add(
            NativePendingAction(
                id="file-pending",
                tenant_id=scope.tenant_id,
                request_id=owner.request_id,
                invocation_id=owner.ref.invocation_id,
                generation=1,
                category="approval",
                operation_id="file-operation",
                reference_digest="a" * 64,
                reference="file-operation",
                owner_ref="file-operation",
                owner_version="a" * 64,
            )
        )
        sql.add(
            NativePayloadObject(
                id="intent",
                tenant_id=scope.tenant_id,
                request_id=owner.request_id,
                invocation_id=owner.ref.invocation_id,
                kind="result",
                logical_key="agent-intent:" + digest,
                storage_key="intent-storage",
                payload_digest=digest_value,
                value_digest=canonical_digest({"intent": effect.model_dump(mode="json")}),
            )
        )
        node = sql.scalar(select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.node_id == "agent"))
        assert node is not None
        node.id, node.status = parent.execution_id, "failed"
    owner.child_status = "failed"

    def events(child: str, *, after: str, limit: int) -> RunEventsResponse:
        assert owner.writer_depth == 0
        assert child == "original-child"
        assert after == "1-0"
        assert limit == 100
        return RunEventsResponse.model_validate(
            {
                "run_id": child,
                "next_cursor": None,
                "events": [
                    {
                        "id": "2-0",
                        "run_id": child,
                        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
                        "type": "run_resumed",
                        "data": {"generation": 2},
                    },
                    {
                        "id": "3-0",
                        "run_id": child,
                        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
                        "type": "run_failed",
                        "data": {"error": "policy refusal"},
                    },
                ],
            }
        )

    monkeypatch.setattr(owner.commands.backend.client, "get_events_sync", events)
    owner.commands.publish = lambda **_: pytest.fail("terminal settlement published a replay")
    return owner


@pytest.mark.parametrize("source_state", ["claimed", "unknown"])
def test_failed_exact_source_seals_unconsumed_attempt_and_preserves_completed_results(
    stranded: CompletedOwner, source_state: str
) -> None:
    owner = stranded
    with owner.factory.begin() as sql:
        source = sql.get(NativeDispatch, "source")
        assert source is not None
        source.state = source_state
        state = sql.scalar(select(NativeInvocationState))
        assert state is not None
        state.state = "running" if source_state == "claimed" else "unknown"
    owner.commands.finish_resume(ref=owner.ref, generation=2, dispatch_id="source")
    with owner.factory() as sql:
        assert sql.get(NativeEffectOperation, "file-operation").state == "not_dispatched"
        assert sql.get(NativeDispatch, "source").state == "completed"
        assert sql.get(DifyBuilderExecutionRequest, owner.request_id).state == "sealed"
        assert sql.get(NativeEffectOperation, "prior-skill").result_ref == "skill-result"
        assert sql.get(NativeTestScope, owner.request_id).spent_dispatches == 3
        assert len(sql.scalars(select(NativeEffectOutcome)).all()) == 1
        assert len(sql.scalars(select(NativeEffectAttempt)).all()) == 1
        assert sql.scalars(select(NativeEffectDispatchClaim)).all() == []
    assert owner.repo.get_run(owner.verify_id).status == "failed"
    assert owner.repo.get_run(owner.reservation.id).status == "failed"
    assert owner.repo.get_run(owner.verify_id).verification.execution_evidence.sealed


def _reserve_through_actual_owner(owner: CompletedOwner, monkeypatch: pytest.MonkeyPatch):
    """Reproduce restored before_call with real grant/spend/attempt owners."""
    from sqlalchemy import DateTime, delete, event

    def postgres_timestamps(_session, instance):
        for column in instance.__mapper__.columns:
            value = getattr(instance, column.key)
            if (
                isinstance(column.type, DateTime)
                and column.type.timezone
                and isinstance(value, datetime)
                and value.tzinfo is None
            ):
                setattr(instance, column.key, value.replace(tzinfo=UTC))

    event.listen(owner.factory, "loaded_as_persistent", postgres_timestamps)
    from models.dify_builder_native_tests import NativeEffectGrant
    from runtime_contracts.builder.native.contracts import DispatchPermit
    from services.dify_builder.native_testing.authorization import _scope_digest
    from services.dify_builder.native_testing.repository import utc_now

    with owner.factory() as sql:
        row = sql.get(NativePayloadObject, "intent")
        assert row is not None
        effect = EffectIntent.model_validate(owner.commands.api.store._read_object(row)["intent"])
        invocation = sql.scalar(select(NativeTestInvocation))
        assert invocation is not None
        binding = NativeBinding.model_validate(invocation.bindings[operation_digest(effect.key)])

    class Metadata:
        def resolve_binding(self, **_kwargs):
            return binding

    monkeypatch.setattr(owner.commands.loader, "resolver", Metadata())
    with owner.factory.begin() as sql:
        NativeEffectGrant.__table__.create(sql.connection(), checkfirst=True)
        sql.execute(delete(NativeEffectAttempt))
        op = sql.get(NativeEffectOperation, "file-operation")
        assert op is not None
        op.state, op.scope_digest = "pending", _scope_digest(effect, binding)
        scope = sql.get(NativeTestScope, owner.request_id)
        assert scope is not None
        scope.expires_at = datetime(2099, 1, 1)
        scope.spent_calls, scope.spent_dispatches, scope.spent_cost_units = 2, 2, 2
        invocation = sql.scalar(select(NativeTestInvocation))
        assert invocation is not None
        invocation.active = True
        state = sql.scalar(select(NativeInvocationState))
        assert state is not None
        state.state = "running"
        source = sql.get(NativeDispatch, "source")
        assert source is not None
        source.state = "claimed"
        sql.add(
            NativeEffectGrant(
                id="file-grant",
                tenant_id=scope.tenant_id,
                request_id=owner.request_id,
                actor_id=owner.case.actor.account_id,
                scope_digest=op.scope_digest,
                decision="approved",
                expires_at=datetime(2099, 1, 1),
                max_calls=1,
                max_dispatches=1,
                max_cost_units=1,
                spent_calls=0,
                spent_dispatches=0,
                spent_cost_units=0,
            )
        )
    # The load adapter above models PostgreSQL's timezone-aware timestamps.
    monkeypatch.setattr(owner.commands.api.authorization, "clock", utc_now)
    permit = owner.commands.api.authorization.before_call(ref=owner.ref, intent=effect)
    assert isinstance(permit, DispatchPermit), permit
    return permit, effect


def _public_get(owner: CompletedOwner, monkeypatch: pytest.MonkeyPatch):
    from types import MethodType

    from services.dify_builder.native_testing.api_service import NativeTestApiService

    monkeypatch.setattr(owner.commands.api, "get", MethodType(NativeTestApiService.get, owner.commands.api))
    return owner.commands.get(actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id)


def test_restored_real_permit_then_expired_preparation_reconciles_original_run_on_get(
    stranded: CompletedOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    owner = stranded
    permit, _effect = _reserve_through_actual_owner(owner, monkeypatch)
    with owner.factory.begin() as sql:
        scope = sql.get(NativeTestScope, owner.request_id)
        assert scope is not None
        scope.expires_at = datetime(2000, 1, 1)
    with pytest.raises(BuilderExecutionPolicyError, match="native_expired"):
        owner.commands.api.store.load_context(ref=owner.ref)
    with owner.factory.begin() as sql:
        source = sql.get(NativeDispatch, "source")
        state = sql.scalar(select(NativeInvocationState))
        invocation = sql.scalar(select(NativeTestInvocation))
        assert source is not None
        assert state is not None
        assert invocation is not None
        source.state, state.state, invocation.active = "unknown", "unknown", False
    receipt = _public_get(owner, monkeypatch)
    assert receipt.status == "terminal"
    assert receipt.outcome == "failed"
    assert receipt.pending == ()
    for identity in (owner.reservation.id, owner.verify_id):
        run = owner.repo.get_run(identity)
        assert run.status == "failed"
        assert run.immutable
        assert run.verification is not None
        assert run.verification.execution_evidence.sealed
    version = owner.repo.get_session(owner.session.id)[0].version
    assert _public_get(owner, monkeypatch).outcome == "failed"
    assert owner.repo.get_session(owner.session.id)[0].version == version
    with owner.factory() as sql:
        attempt = sql.get(NativeEffectAttempt, permit.attempt_id)
        assert attempt is not None
        assert len(sql.scalars(select(NativeEffectAttempt)).all()) == 1
        assert sql.get(NativeTestScope, owner.request_id).spent_dispatches == 3
        assert sql.get(NativeEffectOperation, "prior-skill").result_ref == "skill-result"


@pytest.mark.parametrize("winner", ["claim", "settlement"])
def test_real_physical_claim_and_terminal_settlement_serialize_on_existing_owner(
    stranded: CompletedOwner, monkeypatch: pytest.MonkeyPatch, winner: str
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    owner = stranded
    permit, effect = _reserve_through_actual_owner(owner, monkeypatch)
    authorization = owner.commands.api.authorization
    if winner == "claim":
        events = owner.commands.backend.client.get_events_sync

        def claim_during_terminal_read(*args, **kwargs):
            authorization.claim_dispatch(ref=owner.ref, intent=effect, permit=permit)
            return events(*args, **kwargs)

        monkeypatch.setattr(owner.commands.backend.client, "get_events_sync", claim_during_terminal_read)
        receipt = _public_get(owner, monkeypatch)
        assert receipt.outcome is None
        assert receipt.status == "running"
        # The worker's ordinary terminal settlement quarantines the consumed
        # attempt; GET cannot discharge it afterward.
        monkeypatch.setattr(owner.commands.backend.client, "get_events_sync", events)
        from tests.unit_tests.services.dify_builder.native_testing.test_confirmed_agent_completion import _context

        monkeypatch.setattr(owner.commands.api.store, "load_context", lambda **_: _context(owner, generation=2))
        owner.commands.finish_resume(ref=owner.ref, generation=2, dispatch_id="source")
        assert _public_get(owner, monkeypatch).outcome == "unknown"
        with owner.factory() as sql:
            assert len(sql.scalars(select(NativeEffectDispatchClaim)).all()) == 1
            assert sql.get(NativeEffectOperation, "file-operation").state == "claimed"
            assert sql.scalars(select(NativeEffectOutcome)).all() == []
    else:
        assert _public_get(owner, monkeypatch).outcome == "failed"
        with pytest.raises(BuilderExecutionPolicyError):
            authorization.claim_dispatch(ref=owner.ref, intent=effect, permit=permit)
        with owner.factory() as sql:
            assert sql.scalars(select(NativeEffectDispatchClaim)).all() == []
            assert sql.get(NativeEffectOperation, "file-operation").state == "not_dispatched"


@pytest.mark.parametrize(
    "fault",
    [
        "claim",
        "outcome",
        "result",
        "stale_source",
        "foreign_attempt",
        "live_child",
        "live_node",
        "unknown_effect",
        "receipt_drift",
        "generation_drift",
        "foreign_owner",
        "checkpoint_drift",
        "no_resume_event",
        "missing_events",
    ],
)
def test_failure_settlement_refuses_ambiguous_or_changed_evidence(
    stranded: CompletedOwner, monkeypatch: pytest.MonkeyPatch, fault: str
) -> None:
    owner = stranded
    with owner.factory.begin() as sql:
        scope = sql.get(NativeTestScope, owner.request_id)
        assert scope is not None
        if fault == "claim":
            sql.add(
                NativeEffectDispatchClaim(
                    tenant_id=scope.tenant_id,
                    request_id=owner.request_id,
                    invocation_id=owner.ref.invocation_id,
                    operation_id="file-operation",
                    attempt_id="file-attempt",
                    claimed_at=datetime(2026, 1, 1),
                )
            )
        elif fault == "outcome":
            sql.add(
                NativeEffectOutcome(
                    tenant_id=scope.tenant_id,
                    request_id=owner.request_id,
                    invocation_id=owner.ref.invocation_id,
                    operation_id="file-operation",
                    attempt_id="file-attempt",
                    outcome="unknown",
                )
            )
        elif fault == "result":
            op = sql.get(NativeEffectOperation, "file-operation")
            assert op is not None
            op.result_ref = "committed-result"
        elif fault == "stale_source":
            sql.get(NativeDispatch, "source").generation = 3
        elif fault == "foreign_attempt":
            sql.get(NativeEffectAttempt, "file-attempt").execution_id = "other-execution"
        elif fault == "live_node":
            sql.scalar(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.node_id == "end")
            ).status = "running"
        elif fault == "unknown_effect":
            sql.get(NativeEffectOperation, "file-operation").state = "unknown"
        elif fault == "foreign_owner":
            sql.get(NativeEffectAttempt, "file-attempt").tenant_id = "foreign"
        elif fault == "checkpoint_drift":
            sql.get(NativeContinuation, sql.scalar(select(NativeContinuation.id))).generation = 0
    if fault == "live_child":
        owner.child_status = "running"
    elif fault in {"receipt_drift", "generation_drift"}:
        original = owner.commands.backend.client.get_events_sync

        def mutate_after_read(*args, **kwargs):
            events = original(*args, **kwargs)
            with owner.factory.begin() as sql:
                if fault == "receipt_drift":
                    sql.get(NativePayloadObject, "association").storage_key = "replacement"
                else:
                    sql.get(NativeTestScope, owner.request_id).generation = 3
            return events

        monkeypatch.setattr(owner.commands.backend.client, "get_events_sync", mutate_after_read)
    elif fault == "missing_events":

        def missing_events(*_args, **_kwargs):
            raise LookupError("runtime event retention ended")

        monkeypatch.setattr(owner.commands.backend.client, "get_events_sync", missing_events)
    elif fault == "no_resume_event":
        original = owner.commands.backend.client.get_events_sync

        def terminal_without_resume(*args, **kwargs):
            events = original(*args, **kwargs)
            return events.model_copy(update={"events": events.events[1:]})

        monkeypatch.setattr(owner.commands.backend.client, "get_events_sync", terminal_without_resume)
    try:
        result = owner.commands._settle_unconsumed_failure(ref=owner.ref)
    except state_store.BuilderExecutionPolicyError:
        result = False
    assert not result
    with owner.factory() as sql:
        assert sql.get(DifyBuilderExecutionRequest, owner.request_id).state == "running"
        assert sql.get(NativeDispatch, "source").state == "unknown"
        assert not any(outcome.outcome == "not_dispatched" for outcome in sql.scalars(select(NativeEffectOutcome)))
        assert sql.get(NativeEffectOperation, "prior-skill").result_ref == "skill-result"
