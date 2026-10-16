"""CI-only host journal/barrier composition with the real C02/C03 SQL owners.

No Graphon control or real native occurrence producer is qualified here. Input
material uses a distinct fixture-only key, never an effect's immutable result
slot. MetadataOwner remains the existing synthetic trusted fixture; these tests
cannot qualify a production binding/input producer or native execution factory.
"""

from dataclasses import replace

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import NativeContinuation, NativeInvocationState, NativeTestInvocation
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
from services.dify_builder.native_testing.contracts import (
    ApprovalWait,
    DispatchPermit,
    OperationKey,
    PolicyStop,
    RecordedResult,
    operation_digest,
)
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from services.dify_builder.native_testing.pending_actions import NativePendingActionService
from services.dify_builder.native_testing.runtime_contracts import NativeCheckpointPayload
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    continuation_case as continuation_case,  # noqa: PLC0414 - existing real owner fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    ledger_case as ledger_case,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    no_live as no_live,  # noqa: PLC0414
)


def _payload(_c, generation=0, journals=()):
    return NativeCheckpointPayload(
        schema_version="1",
        native_run_id="native-run",
        generation=generation,
        generate_entity_json='{"private":"journal-history"}',
        graph_runtime_state_json='{"frames":["left","right"]}',
        response_stream_filter_json='{"closed":true,"buffer":[1]}',
        node_journals=journals,
        child_refs=(),
        input_result_refs=(),
    )


def _input_fixture(c):
    """Independent test data identity; never registered as a dispatch binding."""
    return c.store.store_result(
        ref=c.ref,
        key=OperationKey(invocation_id=c.ref.invocation_id, occurrence_path=("ci-only-input-material",), cursor=0),
        result=c.context.inputs,
    )


def _journal_effect(c):
    """Bind exact fixture inputs before any C02 operation is created."""
    effect = c.ledger.intent.model_copy(update={"input_digest": canonical_digest(c.context.inputs)})
    with c.factory.begin() as session:
        row = session.scalar(select(NativeTestInvocation).where(NativeTestInvocation.request_id == c.ref.request_id))
        bindings = dict(row.bindings)
        bindings[operation_digest(effect.key)] = {
            **bindings[operation_digest(effect.key)],
            "intent_digest": canonical_digest(effect.model_dump(mode="json")),
        }
        row.bindings = bindings
    c.ledger = replace(c.ledger, intent=effect)
    return effect


@pytest.mark.parametrize("category", ["approval", "configuration", "interaction"])
def test_host_barrier_returns_only_real_committed_wait_category(continuation_case, category):
    c = continuation_case
    if category == "approval":
        pending = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    else:
        service = NativePendingActionService(c.store.loader)
        pending = (
            service.configuration(ref=c.ref, requirements_ref="configuration-1", expected_generation=0)
            if category == "configuration"
            else service.interaction(ref=c.ref, native_form_ref="form-1", expected_generation=0)
        )
    assert isinstance(pending, ApprovalWait)
    receipt = NativeCheckpointBridge(state=c.store, lifecycle=c.lifecycle).commit_wait(
        ref=c.ref,
        generation=0,
        payload=_payload(c),
        pending_operation_ids=(pending.pending_operation_id,),
    )
    assert receipt.wait_reason == category
    recovered = c.store.read_checkpoint(ref=c.ref, checkpoint=receipt.checkpoint)
    assert recovered.graph_runtime_state_json == '{"frames":["left","right"]}'
    with c.factory() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        assert (state.state, state.wait_reason, state.checkpoint_id) == (
            "waiting",
            category,
            receipt.checkpoint.checkpoint_id,
        )
    assert c.ledger.dispatched_attempt_count() == 0


def test_host_barrier_survives_two_real_pause_generations(continuation_case):
    c = continuation_case
    pending_service = NativePendingActionService(c.store.loader)
    bridge = NativeCheckpointBridge(state=c.store, lifecycle=c.lifecycle)
    checkpoints = []
    for generation in (0, 1):
        pending = pending_service.configuration(
            ref=c.ref, requirements_ref="configuration-1", expected_generation=generation
        )
        receipt = bridge.commit_wait(
            ref=c.ref,
            generation=generation,
            payload=_payload(c, generation),
            pending_operation_ids=(pending.pending_operation_id,),
        )
        checkpoints.append(receipt.checkpoint)
        if generation == 0:
            c.resolution.resolved = True
            resumed = c.resume()
            assert c.lifecycle.claim_dispatch(ref=c.ref, generation=resumed.generation, dispatch_id=resumed.dispatch_id)
    assert checkpoints[0] != checkpoints[1]
    with pytest.raises(BuilderExecutionPolicyError, match="native_generation_conflict"):
        bridge.commit_wait(
            ref=c.ref, generation=0, payload=_payload(c), pending_operation_ids=(pending.pending_operation_id,)
        )
    assert c.store.load_context(ref=c.ref).generation == 1


@pytest.mark.parametrize("fault", ["storage", "readback", "checkpoint_sql", "lifecycle_sql"])
def test_host_barrier_owner_failure_never_returns_waiting(continuation_case, monkeypatch, fault):
    from extensions.ext_storage import storage

    c = continuation_case
    pending = c.ledger.guard.before_call(ref=c.ref, intent=c.ledger.intent)
    if fault == "storage":

        def fail_save(*_args, **_kwargs):
            raise OSError("synthetic storage failure")

        monkeypatch.setattr(storage, "save", fail_save)
    elif fault == "readback":
        original_load, original_save = storage.load, storage.save
        new_keys = set()

        def save(key, data):
            original_save(key, data)
            new_keys.add(key)

        def load(key, *args, **kwargs):
            return b"corrupt encrypted payload" if key in new_keys else original_load(key, *args, **kwargs)

        monkeypatch.setattr(storage, "save", save)
        monkeypatch.setattr(storage, "load", load)

    def fail_commit(session):
        if fault == "checkpoint_sql" and any(isinstance(row, NativeContinuation) for row in session.new):
            raise RuntimeError("synthetic checkpoint commit failure")
        if fault == "lifecycle_sql" and any(
            isinstance(row, NativeInvocationState) and row.state == "waiting" for row in session.dirty
        ):
            raise RuntimeError("synthetic lifecycle commit failure")

    event.listen(Session, "before_commit", fail_commit)
    try:
        with pytest.raises((BuilderExecutionPolicyError, RuntimeError)):
            NativeCheckpointBridge(state=c.store, lifecycle=c.lifecycle).commit_wait(
                ref=c.ref,
                generation=0,
                payload=_payload(c),
                pending_operation_ids=(pending.pending_operation_id,),
            )
    finally:
        event.remove(Session, "before_commit", fail_commit)
    with c.factory() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == c.ref.request_id)
        )
        assert state.state == "running"
        assert session.get(DifyBuilderExecutionRequest, c.ref.request_id).state == "running"
    assert c.ledger.dispatched_attempt_count() == 0


def test_host_journal_real_completed_result_replays_without_second_claim(continuation_case):
    c = continuation_case
    effect = _journal_effect(c)
    input_ref = _input_fixture(c)
    c.ledger.confirm()
    guard = c.ledger.guard
    journal = NodeOperationJournal(state=c.store, authorization=guard)
    cursor = journal.open(ref=c.ref, occurrence_path=effect.key.occurrence_path)
    cursor.bind_input(input_result_ref=input_ref, inputs=c.context.inputs)
    assert cursor.next_key() == effect.key
    permit = cursor.before_call(intent=effect)
    assert isinstance(permit, DispatchPermit)
    guard.claim_dispatch(ref=c.ref, intent=effect, permit=permit)
    with pytest.raises(BuilderExecutionPolicyError, match="dispatch_already_consumed"):
        guard.claim_dispatch(ref=c.ref, intent=effect, permit=permit)
    result_ref = c.store.store_result(ref=c.ref, key=effect.key, result={"closed": True, "chunks": [True, 1, "1"]})
    guard.record_outcome(permit=permit, outcome="completed", result_ref=result_ref)
    assert isinstance(cursor.before_call(intent=effect), RecordedResult)
    checkpoint = c.store.commit_checkpoint(
        ref=c.ref, generation=0, payload=_payload(c, journals=journal.snapshot(ref=c.ref))
    )
    restarted = NodeOperationJournal(state=c.store, authorization=guard)
    restarted.restore(ref=c.ref, checkpoint=checkpoint)
    resumed = restarted.open(ref=c.ref, occurrence_path=effect.key.occurrence_path)
    resumed.bind_input(input_result_ref=input_ref, inputs=c.context.inputs)
    assert resumed.next_key() == effect.key
    assert isinstance(resumed.before_call(intent=effect), RecordedResult)
    assert resumed.recorded_result() == {"closed": True, "chunks": [True, 1, "1"]}
    resumed.finish()
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_dispatch_permit"):
        guard.claim_dispatch(ref=c.ref, intent=effect, permit=permit)
    assert c.ledger.dispatched_attempt_count() == 1


def test_host_journal_real_unknown_result_never_becomes_replayable(continuation_case):
    c = continuation_case
    effect = _journal_effect(c)
    input_ref = _input_fixture(c)
    c.ledger.confirm()
    guard = c.ledger.guard
    journal = NodeOperationJournal(state=c.store, authorization=guard)
    cursor = journal.open(ref=c.ref, occurrence_path=effect.key.occurrence_path)
    cursor.bind_input(input_result_ref=input_ref, inputs=c.context.inputs)
    cursor.next_key()
    permit = cursor.before_call(intent=effect)
    assert isinstance(permit, DispatchPermit)
    guard.claim_dispatch(ref=c.ref, intent=effect, permit=permit)
    guard.record_outcome(permit=permit, outcome="unknown", result_ref=None)
    cursor.rewind()
    cursor.next_key()
    assert isinstance(cursor.before_call(intent=effect), PolicyStop)
    assert cursor.snapshot().result_refs == ()
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_result_unavailable"):
        cursor.recorded_result()
    assert c.ledger.dispatched_attempt_count() == 1


@pytest.mark.parametrize("owner", ["request", "invocation", "context"])
def test_host_journal_refuses_foreign_private_input_before_effect(continuation_case, owner):
    c = continuation_case
    input_ref = _input_fixture(c)
    updates = {
        "request": {"request_id": "foreign"},
        "invocation": {"invocation_id": "foreign-child"},
        "context": {"context_digest": "d" * 64},
    }
    foreign = c.ref.model_copy(update=updates[owner])
    journal = NodeOperationJournal(state=c.store, authorization=c.ledger.guard)

    def read_foreign():
        cursor = journal.open(ref=foreign, occurrence_path=("node",))
        cursor.bind_input(input_result_ref=input_ref, inputs=c.context.inputs)

    with pytest.raises(BuilderExecutionPolicyError):
        read_foreign()
    assert c.ledger.dispatched_attempt_count() == 0
