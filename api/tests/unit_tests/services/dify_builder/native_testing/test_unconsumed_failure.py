"""An actual failed continuation closes only its unconsumed shell permit."""

from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol, cast

import pytest
import pytest_mock
from dify_agent.protocol.schemas import RunEventsResponse
from sqlalchemy import Table, select
from sqlalchemy.orm import Session as SqlSession

from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
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
from runtime_contracts.builder.native.contracts import DispatchPermit, EffectIntent, OperationKey, operation_digest
from services.dify_builder.native_testing import state_store
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
from services.dify_builder.native_testing.repository import NativeBinding
from tests.unit_tests.services.dify_builder.native_testing import test_confirmed_agent_completion as completion_fixtures
from tests.unit_tests.services.dify_builder.native_testing.test_confirmed_agent_completion import (
    CompletedOwner,
)

completed = completion_fixtures.completed
declining = completion_fixtures.declining
retrying_decline = completion_fixtures.retrying_decline


def _row[T](value: object, expected: type[T]) -> T:
    assert isinstance(value, expected)
    return value


def _present[T](value: T | None) -> T:
    assert value is not None
    return value


@pytest.fixture
def stranded(
    retrying_decline: CompletedOwner, mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> CompletedOwner:
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
    # Keep all nested patches of this shared reader on the inherited mocker
    # owner, so reverse teardown cannot restore an already-stopped mock.
    mocker.patch.object(
        state_store.storage,
        "load",
        side_effect=lambda key: raw.encode() if key == "intent-storage" else original_load(key),
    )
    with owner.factory.begin() as sql:
        for model in (NativeEffectAttempt, NativeEffectDispatchClaim, NativeEffectOutcome, NativePendingAction):
            assert isinstance(model.__table__, Table)
            model.__table__.create(sql.connection(), checkfirst=True)
        native = sql.get(WorkflowRun, owner.native_id)
        assert native is not None
        native.status, native.error = WorkflowExecutionStatus.FAILED, "policy refusal from actual child"
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
        node.id, node.status = parent.execution_id, WorkflowNodeExecutionStatus.FAILED
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
        assert _row(sql.get(NativeEffectOperation, "file-operation"), NativeEffectOperation).state == "not_dispatched"
        assert _row(sql.get(NativeDispatch, "source"), NativeDispatch).state == "completed"
        assert (
            _row(sql.get(DifyBuilderExecutionRequest, owner.request_id), DifyBuilderExecutionRequest).state == "sealed"
        )
        assert _row(sql.get(NativeEffectOperation, "prior-skill"), NativeEffectOperation).result_ref == "skill-result"
        assert _row(sql.get(NativeTestScope, owner.request_id), NativeTestScope).spent_dispatches == 3
        assert len(sql.scalars(select(NativeEffectOutcome)).all()) == 1
        assert len(sql.scalars(select(NativeEffectAttempt)).all()) == 1
        assert sql.scalars(select(NativeEffectDispatchClaim)).all() == []
    assert owner.repo.get_run(owner.verify_id).status == "failed"
    assert owner.repo.get_run(owner.reservation.id).status == "failed"
    assert _present(_present(owner.repo.get_run(owner.verify_id).verification).execution_evidence).sealed


def _reserve_through_actual_owner(
    owner: CompletedOwner, monkeypatch: pytest.MonkeyPatch
) -> tuple[DispatchPermit, EffectIntent]:
    """Reproduce restored before_call with real grant/spend/attempt owners."""
    from sqlalchemy import delete, event

    from models.dify_builder_native_tests import NativeEffectGrant

    def postgres_timestamps(_session: SqlSession, instance: object) -> None:
        if isinstance(instance, (NativeTestScope, NativeEffectGrant, NativeEffectAttempt)):
            if instance.expires_at.tzinfo is None:
                instance.expires_at = instance.expires_at.replace(tzinfo=UTC)

    event.listen(owner.factory, "loaded_as_persistent", postgres_timestamps)
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
        def resolve_binding(self, **_kwargs: object) -> NativeBinding:
            return binding

    monkeypatch.setattr(owner.commands.loader, "resolver", Metadata())
    with owner.factory.begin() as sql:
        table = NativeEffectGrant.__table__
        assert isinstance(table, Table)
        table.create(sql.connection(), checkfirst=True)
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


def _public_get(owner: CompletedOwner, monkeypatch: pytest.MonkeyPatch) -> NativeTestPublicReceipt:
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
        assert _present(run.verification.execution_evidence).sealed
    version = owner.repo.get_session(owner.session.id)[0].version
    assert _public_get(owner, monkeypatch).outcome == "failed"
    assert owner.repo.get_session(owner.session.id)[0].version == version
    with owner.factory() as sql:
        attempt = sql.get(NativeEffectAttempt, permit.attempt_id)
        assert attempt is not None
        assert len(sql.scalars(select(NativeEffectAttempt)).all()) == 1
        assert _row(sql.get(NativeTestScope, owner.request_id), NativeTestScope).spent_dispatches == 3
        assert _row(sql.get(NativeEffectOperation, "prior-skill"), NativeEffectOperation).result_ref == "skill-result"


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

        def claim_during_terminal_read(child: str, *, after: str, limit: int) -> RunEventsResponse:
            authorization.claim_dispatch(ref=owner.ref, intent=effect, permit=permit)
            return events(child, after=after, limit=limit)

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
            assert _row(sql.get(NativeEffectOperation, "file-operation"), NativeEffectOperation).state == "claimed"
            assert sql.scalars(select(NativeEffectOutcome)).all() == []
    else:
        assert _public_get(owner, monkeypatch).outcome == "failed"
        with pytest.raises(BuilderExecutionPolicyError):
            authorization.claim_dispatch(ref=owner.ref, intent=effect, permit=permit)
        with owner.factory() as sql:
            assert sql.scalars(select(NativeEffectDispatchClaim)).all() == []
            assert (
                _row(sql.get(NativeEffectOperation, "file-operation"), NativeEffectOperation).state == "not_dispatched"
            )


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
        "owner_drift",
        "continuation_ref_drift",
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
            _row(sql.get(NativeDispatch, "source"), NativeDispatch).generation = 3
        elif fault == "foreign_attempt":
            _row(sql.get(NativeEffectAttempt, "file-attempt"), NativeEffectAttempt).execution_id = "other-execution"
        elif fault == "live_node":
            _row(
                sql.scalar(select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.node_id == "end")),
                WorkflowNodeExecutionModel,
            ).status = WorkflowNodeExecutionStatus.RUNNING
        elif fault == "unknown_effect":
            _row(sql.get(NativeEffectOperation, "file-operation"), NativeEffectOperation).state = "unknown"
        elif fault == "foreign_owner":
            _row(sql.get(NativeEffectAttempt, "file-attempt"), NativeEffectAttempt).tenant_id = "foreign"
        elif fault == "checkpoint_drift":
            _row(
                sql.get(NativeContinuation, sql.scalar(select(NativeContinuation.id))), NativeContinuation
            ).generation = 0
    if fault == "live_child":
        owner.child_status = "running"
    elif fault in {"receipt_drift", "generation_drift", "owner_drift", "continuation_ref_drift"}:
        original = owner.commands.backend.client.get_events_sync

        def mutate_after_read(child: str, *, after: str, limit: int) -> RunEventsResponse:
            events = original(child, after=after, limit=limit)
            with owner.factory.begin() as sql:
                if fault == "receipt_drift":
                    _row(sql.get(NativePayloadObject, "association"), NativePayloadObject).storage_key = "replacement"
                elif fault == "generation_drift":
                    _row(sql.get(NativeTestScope, owner.request_id), NativeTestScope).generation = 3
                elif fault == "owner_drift":
                    _row(sql.scalar(select(NativeInvocationState)), NativeInvocationState).app_id = "foreign-app"
                else:
                    _row(sql.scalar(select(NativeContinuation)), NativeContinuation).payload_ref = "foreign-receipt"
            return events

        monkeypatch.setattr(owner.commands.backend.client, "get_events_sync", mutate_after_read)
    elif fault == "missing_events":

        def missing_events(*_args: object, **_kwargs: object) -> RunEventsResponse:
            raise LookupError("runtime event retention ended")

        monkeypatch.setattr(owner.commands.backend.client, "get_events_sync", missing_events)
    elif fault == "no_resume_event":
        original = owner.commands.backend.client.get_events_sync

        def terminal_without_resume(child: str, *, after: str, limit: int) -> RunEventsResponse:
            events = original(child, after=after, limit=limit)
            return events.model_copy(update={"events": events.events[1:]})

        monkeypatch.setattr(owner.commands.backend.client, "get_events_sync", terminal_without_resume)
    try:
        result = owner.commands._settle_unconsumed_failure(ref=owner.ref)
    except state_store.BuilderExecutionPolicyError:
        result = False
    assert not result
    with owner.factory() as sql:
        assert (
            _row(sql.get(DifyBuilderExecutionRequest, owner.request_id), DifyBuilderExecutionRequest).state == "running"
        )
        assert _row(sql.get(NativeDispatch, "source"), NativeDispatch).state == "unknown"
        assert not any(outcome.outcome == "not_dispatched" for outcome in sql.scalars(select(NativeEffectOutcome)))
        assert _row(sql.get(NativeEffectOperation, "prior-skill"), NativeEffectOperation).result_ref == "skill-result"


@pytest.mark.parametrize("effect", ["completed", "consumed", "unconsumed"])
def test_optional_terminal_proof_failure_does_not_block_original_resume_settlement(
    stranded: CompletedOwner, monkeypatch: pytest.MonkeyPatch, effect: str
) -> None:
    from tests.unit_tests.services.dify_builder.native_testing.test_confirmed_agent_completion import _context

    owner = stranded
    with owner.factory.begin() as sql:
        state = _row(sql.scalar(select(NativeInvocationState)), NativeInvocationState)
        state.state = "running"
        _row(sql.scalar(select(NativeTestInvocation)), NativeTestInvocation).active = True
        _row(sql.get(NativeDispatch, "source"), NativeDispatch).state = "claimed"
        if effect == "completed":
            operation = _row(sql.get(NativeEffectOperation, "file-operation"), NativeEffectOperation)
            operation.state, operation.result_ref = "completed", "completed-result"
        elif effect == "consumed":
            sql.add(
                NativeEffectDispatchClaim(
                    tenant_id=owner.case.actor.tenant_id,
                    request_id=owner.request_id,
                    invocation_id=owner.ref.invocation_id,
                    operation_id="file-operation",
                    attempt_id="file-attempt",
                    claimed_at=datetime(2026, 1, 1),
                )
            )
    monkeypatch.setattr(owner.commands.api.store, "load_context", lambda **_: _context(owner, generation=2))

    def unavailable(*_args: object, **_kwargs: object) -> RunEventsResponse:
        if effect == "completed":
            pytest.fail("Already completed effects must not require optional backend history")
        raise LookupError("runtime events no longer retained")

    monkeypatch.setattr(owner.commands.backend.client, "get_events_sync", unavailable)
    owner.commands.finish_resume(ref=owner.ref, generation=2, dispatch_id="source")
    with owner.factory() as sql:
        request = _row(sql.get(DifyBuilderExecutionRequest, owner.request_id), DifyBuilderExecutionRequest)
        state = _row(sql.scalar(select(NativeInvocationState)), NativeInvocationState)
        source = _row(sql.get(NativeDispatch, "source"), NativeDispatch)
        if effect == "completed":
            assert request.state == "sealed"
            assert state.state == "completed"
            assert source.state == "completed"
            assert owner.repo.get_run(owner.verify_id).status == "failed"
        else:
            assert request.state == "running"
            assert state.state == "unknown"
            assert source.state == "unknown"
            assert _row(sql.get(NativeEffectOperation, "file-operation"), NativeEffectOperation).state == "claimed"
            assert sql.scalars(select(NativeEffectOutcome)).all() == []


def test_stranded_fixture_restores_real_storage_after_patch_owner_teardown(
    stranded: CompletedOwner,
    mocker: pytest_mock.MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Real inherited fixtures must not restore a stopped mock after teardown."""
    from extensions.ext_storage import Storage
    from extensions.storage.opendal_storage import OpenDALStorage

    assert stranded.commands is not None
    assert state_store.storage.load("intent-storage")
    # This is the actual order of the two pytest owners in the affected shard.
    # Calling both finalizers is idempotent when pytest later completes teardown.
    mocker.stopall()
    monkeypatch.undo()
    assert state_store.storage.load == Storage.load.__get__(state_store.storage, Storage)
    with pytest.MonkeyPatch.context() as storage_patch:
        storage_patch.setattr(
            state_store.storage, "storage_runner", OpenDALStorage(scheme="fs", root=str(tmp_path)), raising=False
        )
        state_store.storage.save("after-fixture.txt", b"subsequent real storage read")
        assert state_store.storage.load("after-fixture.txt") == b"subsequent real storage read"


def _periodic_worker(owner: CompletedOwner, monkeypatch: pytest.MonkeyPatch) -> tuple[Callable[[], int], list[str]]:
    from types import MethodType

    from schedule import dify_builder_reconcile_task as task
    from services.dify_builder import wiring
    from services.dify_builder.native_testing.api_service import NativeTestApiService
    from services.dify_builder.native_testing.confirmed_agent_commands import (
        ConfirmedAgentCommands,
        ProfiledNativeTestCommands,
    )
    from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner
    from tasks.dify_builder_advance_task import advance_native_test

    monkeypatch.setattr(owner.commands.api, "get", MethodType(NativeTestApiService.get, owner.commands.api))
    monkeypatch.setattr(owner.commands, "_request", MethodType(ConfirmedAgentCommands._request, owner.commands))
    monkeypatch.setattr(owner.commands, "_root_ref", MethodType(ConfirmedAgentCommands._root_ref, owner.commands))
    service = ProfiledNativeTestCommands(
        sessions=owner.factory,
        actor=owner.case.actor,
        confirmed_factory=lambda: owner.commands,
        legacy_factory=lambda: pytest.fail("confirmed worker selected legacy execution"),
    )
    selected: list[str] = []

    def service_for_actor(**values: object) -> ProfiledNativeTestCommands:
        assert values["actor"] == owner.case.actor
        selected.append(owner.request_id)
        return service

    monkeypatch.setattr(task, "_session_factory", lambda: owner.factory)
    monkeypatch.setattr(wiring, "build_native_test_api_service", service_for_actor)
    monkeypatch.setattr(wiring, "native_runtime_owner", DifyNativeRuntimeOwner)
    monkeypatch.setattr(advance_native_test, "delay", lambda **_: pytest.fail("unknown was published to outbox"))
    return task.reconcile_native_tests, selected


@pytest.mark.parametrize("column_bound", [False, True])
def test_periodic_worker_settles_original_unused_failure_without_public_get_or_replay(
    stranded: CompletedOwner, monkeypatch: pytest.MonkeyPatch, column_bound: bool
) -> None:
    """A quarantined failed parent must reach the real terminal owner through beat."""
    owner = stranded
    with owner.factory.begin() as sql:
        request = _row(sql.get(DifyBuilderExecutionRequest, owner.request_id), DifyBuilderExecutionRequest)
        request.native_run_id = owner.native_id if column_bound else None
    reconcile, selected = _periodic_worker(owner, monkeypatch)
    before_version = owner.repo.get_session(owner.session.id)[0].version
    assert (
        owner.commands.peek(actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id).outcome
        == "unknown"
    )
    assert owner.repo.get_session(owner.session.id)[0].version == before_version
    reconcile()
    with owner.factory() as sql:
        assert _row(sql.get(NativeEffectOperation, "file-operation"), NativeEffectOperation).state == "not_dispatched"
        assert (
            _row(sql.get(DifyBuilderExecutionRequest, owner.request_id), DifyBuilderExecutionRequest).state == "sealed"
        )
        assert _row(sql.get(NativeDispatch, "source"), NativeDispatch).state == "completed"
        outcomes = sql.scalars(select(NativeEffectOutcome)).all()
        assert len(outcomes) == 1
        assert outcomes[0].outcome == "not_dispatched"
        assert len(sql.scalars(select(NativeEffectAttempt)).all()) == 1
        assert sql.scalars(select(NativeEffectDispatchClaim)).all() == []
        assert _row(sql.get(NativeTestScope, owner.request_id), NativeTestScope).spent_dispatches == 3
        assert len(sql.scalars(select(WorkflowRun)).all()) == 1
        assert len(sql.scalars(select(DifyBuilderExecutionRequest)).all()) == 1
        assert _row(sql.get(NativeEffectOperation, "prior-skill"), NativeEffectOperation).result_ref == "skill-result"
    assert selected == [owner.request_id]
    for identity in (owner.reservation.id, owner.verify_id):
        run = owner.repo.get_run(identity)
        assert run.status == "failed"
        assert run.immutable
        assert _present(_present(run.verification).execution_evidence).sealed
    version = owner.repo.get_session(owner.session.id)[0].version
    reconcile()
    assert selected == [owner.request_id]
    assert owner.repo.get_session(owner.session.id)[0].version == version
    with owner.factory() as sql:
        assert len(sql.scalars(select(NativeEffectOutcome)).all()) == 1
        assert len(sql.scalars(select(NativeEffectAttempt)).all()) == 1
        assert sql.scalars(select(NativeEffectDispatchClaim)).all() == []


@pytest.mark.parametrize("excluded", ["claim", "paused", "cancelled", "foreign_parent", "non_shell", "sealed"])
def test_periodic_worker_excludes_unproven_unknown_candidates(
    stranded: CompletedOwner, monkeypatch: pytest.MonkeyPatch, excluded: str
) -> None:
    owner = stranded
    if excluded == "claim":
        permit, effect = _reserve_through_actual_owner(owner, monkeypatch)
        owner.commands.api.authorization.claim_dispatch(ref=owner.ref, intent=effect, permit=permit)
        with owner.factory.begin() as sql:
            _row(sql.scalar(select(NativeInvocationState)), NativeInvocationState).state = "unknown"
            _row(sql.get(NativeDispatch, "source"), NativeDispatch).state = "unknown"
            _row(sql.scalar(select(NativeTestInvocation)), NativeTestInvocation).active = False
    with owner.factory.begin() as sql:
        if excluded == "paused":
            _row(sql.get(WorkflowRun, owner.native_id), WorkflowRun).status = WorkflowExecutionStatus.PAUSED
        elif excluded == "cancelled":
            _row(sql.get(NativeTestScope, owner.request_id), NativeTestScope).cancelled = True
        elif excluded == "foreign_parent":
            _row(sql.get(WorkflowRun, owner.native_id), WorkflowRun).tenant_id = "foreign"
        elif excluded == "non_shell":
            invocation = _row(sql.scalar(select(NativeTestInvocation)), NativeTestInvocation)
            bindings = dict(invocation.bindings)
            digest = _row(sql.get(NativeEffectOperation, "file-operation"), NativeEffectOperation).operation_digest
            bindings[digest] = {**bindings[digest], "kind": "model"}
            invocation.bindings = bindings
        elif excluded == "sealed":
            _row(sql.get(DifyBuilderExecutionRequest, owner.request_id), DifyBuilderExecutionRequest).state = "sealed"
    reconcile, selected = _periodic_worker(owner, monkeypatch)
    reconcile()
    assert selected == []
    with owner.factory() as sql:
        assert _row(sql.get(NativeEffectOperation, "file-operation"), NativeEffectOperation).state == "claimed"
        assert _row(sql.get(NativeDispatch, "source"), NativeDispatch).state == "unknown"
        assert len(sql.scalars(select(NativeEffectAttempt)).all()) == 1
        assert sql.scalars(select(NativeEffectOutcome)).all() == []
        assert len(sql.scalars(select(NativeEffectDispatchClaim)).all()) == (1 if excluded == "claim" else 0)
    assert owner.repo.get_run(owner.verify_id).status == "running"


# Celery's installed typing omits these real Beat/signal/AMQP APIs. These
# protocols describe the boundary; the test still executes the actual objects.
class _BeatScheduler(Protocol):
    def apply_async(self, entry: object, *, advance: bool) -> object: ...


class _PublishSignal(Protocol):
    def connect(self, receiver: Callable[..., None], *, weak: bool) -> None: ...

    def disconnect(self, receiver: Callable[..., None]) -> bool: ...


class _ConsumerQueues(Protocol):
    consume_from: Mapping[str, object]

    def select(self, include: list[str]) -> None: ...


class _RoutingAMQP(Protocol):
    queues: _ConsumerQueues


class _MemoryChannel(Protocol):
    def queue_purge(self, queue: str) -> int: ...


def test_periodic_worker_beat_routes_registered_task_to_builder_consumer_queue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Beat must publish to the existing worker queue, not an unconsumed default."""
    from celery import Celery
    from celery.beat import ScheduleEntry, Scheduler
    from celery.signals import before_task_publish
    from kombu.transport.memory import Channel as MemoryTransportChannel

    from schedule.dify_builder_reconcile_task import reconcile_interrupted_sessions

    published: list[str | None] = []
    task_name = reconcile_interrupted_sessions.name

    # Celery's environment URLs override even an explicit constructor broker.
    # Keep this real in-memory publication fixture isolated from loaded app config.
    for name in ("CELERY_BROKER_URL", "CELERY_BROKER_READ_URL", "CELERY_BROKER_WRITE_URL"):
        monkeypatch.delenv(name, raising=False)

    def capture_route(sender: str | None = None, routing_key: str | None = None, **_kwargs: object) -> None:
        if sender == task_name:
            published.append(routing_key)

    with Celery("builder-reconcile-route", broker="memory://", set_as_current=False) as app:
        assert app.tasks[task_name].app is app
        with app.connection_for_write() as connection:
            assert isinstance(connection.channel(), MemoryTransportChannel)
        queues = cast(_RoutingAMQP, app.amqp).queues
        queues.select(["dify_builder"])
        entry = cast(Callable[..., object], ScheduleEntry)(name="dify_builder_reconcile", task=task_name, app=app)
        signal = cast(_PublishSignal, before_task_publish)
        signal.connect(capture_route, weak=False)
        try:
            scheduler = cast(Callable[..., _BeatScheduler], Scheduler)(app=app, lazy=True)
            scheduler.apply_async(entry, advance=False)
            assert published == ["dify_builder"]
            assert published[0] in queues.consume_from
        finally:
            signal.disconnect(capture_route)
            with app.connection_for_write() as connection:
                for queue_name in ("celery", "dify_builder"):
                    cast(_MemoryChannel, connection.channel()).queue_purge(queue_name)
