"""Journal ordering/reconstruction units; real SQL/encrypted owners remain CI-owned."""

import importlib
import importlib.util
from copy import deepcopy
from dataclasses import dataclass

import pytest

from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import (
    ApprovalWait,
    CheckpointRef,
    DispatchPermit,
    EffectIntent,
    JsonValue,
    NativeTestContextRef,
    PolicyStop,
    RecordedResult,
)
from runtime_contracts.builder.native.runtime_contracts import (
    NativeCheckpointPayload,
    NodeJournalState,
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from tests.unit_tests.services.dify_builder.native_testing.test_claimed_resume_checkpoint import ClaimedCheckpointCase
from tests.unit_tests.services.dify_builder.native_testing.test_claimed_resume_checkpoint import (
    metadata_case as metadata_case,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_contracts import CONTEXT

REF = NativeTestContextRef(request_id="request", invocation_id="invocation", context_digest="a" * 64)
PATH = ("root", "iteration:items:2", "tool:send")
INPUT: dict[str, JsonValue] = {"file": {"id": "file-1"}, "history": [True, 1, "1"]}
CP = CheckpointRef(checkpoint_id="checkpoint", payload_digest="b" * 64)


def journal_class():
    module = "services.dify_builder.native_testing.operation_journal"
    assert importlib.util.find_spec(module) is not None, "native occurrence journal is not implemented"
    return importlib.import_module(module).NodeOperationJournal


class State:
    """Owned-state port double; deliberately no SQL or object-store implementation."""

    def __init__(self):
        self.values: dict[str, JsonValue] = {"inputs": deepcopy(INPUT), "result": {"history": [False, 1, "1"]}}
        self.generation = 0
        self.payload = None
        self.failure = None
        self.reads = []

    def load_context(self, *, ref):
        if self.failure:
            raise self.failure
        if ref != REF:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        return ResolvedNativeTestContext.model_validate(
            {**CONTEXT, "ref": ref, "generation": self.generation, "native_run_id": "run"}
        )

    def read_checkpoint(self, *, ref, checkpoint):
        self.load_context(ref=ref)
        assert checkpoint == CP
        return deepcopy(self.payload)

    def load_result(self, *, ref, result_ref):
        self.load_context(ref=ref)
        self.reads.append(result_ref)
        if result_ref not in self.values:
            raise BuilderExecutionPolicyError("native_result_owner_mismatch")
        return deepcopy(self.values[result_ref])


class Authorization:
    def __init__(self, decision=None):
        self.calls = []
        self.decision = decision or RecordedResult(operation_id="operation", result_ref="result")

    def before_call(self, *, ref, intent):
        self.calls.append((ref, deepcopy(intent)))
        return self.decision


@dataclass
class ClaimedJournalCase:
    owner: ClaimedCheckpointCase
    state: State
    lifecycle: NativeTestLifecycleService
    target: NodeOperationJournal
    authorization: Authorization
    expected: NativeCheckpointPayload
    original: EffectIntent


@dataclass
class ImpostorCheckpointLifecycle:
    store: State

    def claimed_resume_checkpoint(self, **_kwargs):
        return CP


@dataclass
class ImpostorCheckpointPayload:
    payload: NativeCheckpointPayload

    def model_dump(self, **_kwargs):
        return self.payload.model_dump()


@dataclass
class ImpostorRunContext:
    ref: NativeTestContextRef
    generation: int
    native_run_id: str


def make_journal(state=None, authorization=None):
    state, authorization = state or State(), authorization or Authorization()
    return journal_class()(state=state, authorization=authorization), state, authorization


def intent(key, **changes):
    return EffectIntent(
        key=key,
        kind="tool",
        resource_ref="tool",
        implementation_revision="v1",
        account_ref="account",
        target="recipient",
        parameters=changes.get("parameters", {"value": True}),
        input_digest=changes.get("input_digest", canonical_digest(INPUT)),
        capability_digest="c" * 64,
    )


def bound(journal, path=PATH):
    cursor = journal.open(ref=REF, occurrence_path=path)
    cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
    return cursor


def payload(journals, generation=0):
    return NativeCheckpointPayload(
        schema_version="1",
        native_run_id="run",
        generation=generation,
        generate_entity_json='{"private":"history"}',
        graph_runtime_state_json='{"frames":[1,2]}',
        response_stream_filter_json='{"closed":true}',
        node_journals=journals,
        child_refs=(),
        input_result_refs=("inputs",),
    )


def test_iteration_and_child_identity_survive_delivery_restart():
    journal, _, _ = make_journal()
    first = bound(journal)
    original = first.next_key()
    assert bound(journal).next_key() == original
    assert bound(journal, ("root", "iteration:items:3", "tool:send")).next_key() != original
    assert bound(journal, (*PATH, "child:other")).next_key() != original
    first.rewind()
    assert first.next_key() == original


def test_completed_replay_rechecks_c02_and_reads_private_result_after_restart():
    journal, state, authorization = make_journal()
    first = bound(journal)
    original = intent(first.next_key())
    decision = first.before_call(intent=original)
    assert first.recorded_result() == state.values["result"]
    state.payload = payload(journal.snapshot(ref=REF))
    restarted, _, _ = make_journal(state, authorization)
    restarted.restore(ref=REF, checkpoint=CP)
    cursor = bound(restarted)
    assert cursor.before_call(intent=intent(cursor.next_key())) == decision
    assert cursor.recorded_result() == state.values["result"]
    cursor.finish()
    assert len(authorization.calls) == 2  # C02 is consulted again; no transport exists here.
    assert cursor.snapshot().result_refs == ("result",)


@pytest.mark.parametrize("parameters", [{"value": 1}, {"value": "true"}, {"other": True}])
def test_typed_intent_sequence_conflict_refuses_before_authorization(parameters):
    journal, _, authorization = make_journal()
    cursor = bound(journal)
    cursor.before_call(intent=intent(cursor.next_key()))
    cursor.rewind()
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_intent_conflict"):
        cursor.before_call(intent=intent(cursor.next_key(), parameters=parameters))
    assert len(authorization.calls) == 1


def test_input_typed_digest_and_owner_ref_are_checked_before_authorization():
    journal, state, authorization = make_journal()
    cursor = journal.open(ref=REF, occurrence_path=PATH)
    changed = {**INPUT, "history": [1, 1, "1"]}
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_input_mismatch"):
        cursor.bind_input(input_result_ref="inputs", inputs=changed)
    with pytest.raises(BuilderExecutionPolicyError, match="native_result_owner_mismatch"):
        cursor.bind_input(input_result_ref="foreign-child-inputs", inputs=INPUT)
    cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_input_mismatch"):
        cursor.before_call(intent=intent(cursor.next_key(), input_digest="d" * 64))
    assert authorization.calls == []
    assert state.reads == ["inputs", "foreign-child-inputs", "inputs"]


@pytest.mark.parametrize(
    "decision",
    [
        PolicyStop(reason_code="effect_outcome_unknown"),
        ApprovalWait(pending_operation_id="pending", wait_reason="configuration"),
        DispatchPermit(
            permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
        ),
    ],
)
def test_unknown_pending_or_incomplete_stream_is_never_a_replayable_result(decision):
    journal, state, authorization = make_journal(authorization=Authorization(decision))
    cursor = bound(journal)
    current = intent(cursor.next_key())
    assert cursor.before_call(intent=current) == decision
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_result_unavailable"):
        cursor.recorded_result()
    assert cursor.snapshot().result_refs == ()
    cursor.rewind()
    assert cursor.before_call(intent=intent(cursor.next_key())) == decision
    assert len(authorization.calls) == 2
    assert state.reads == ["inputs"]


def test_only_contiguous_completed_prefix_can_advance_and_finish_checks_old_suffix():
    journal, _, authorization = make_journal()
    cursor = bound(journal)
    cursor.before_call(intent=intent(cursor.next_key()))
    cursor.before_call(intent=intent(cursor.next_key()))
    cursor.rewind()
    cursor.before_call(intent=intent(cursor.next_key()))
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_sequence_conflict"):
        cursor.finish()
    cursor.before_call(intent=intent(cursor.next_key()))
    cursor.finish()
    authorization.decision = PolicyStop(reason_code="effect_outcome_unknown")
    cursor.before_call(intent=intent(cursor.next_key()))
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_sequence_conflict"):
        cursor.before_call(intent=intent(cursor.next_key()))


def test_snapshot_isolated_from_caller_mutation_and_parallel_frames():
    journal, _, authorization = make_journal()
    cursor = bound(journal)
    original = intent(cursor.next_key())
    cursor.before_call(intent=original)
    assert isinstance(original.parameters, dict)
    original.parameters["value"] = "changed"
    saved = cursor.snapshot()
    saved.intents[0].parameters["value"] = "also-changed"
    other = bound(journal, ("root", "parallel:right", "model"))
    other.before_call(intent=intent(other.next_key()))
    journals = journal.snapshot(ref=REF)
    assert len(journals) == 2
    assert journals[0].intents[0].parameters == {"value": True}
    assert len(authorization.calls) == 2


@pytest.mark.parametrize(
    "change", ["owner", "cursor", "intent_order", "result_prefix", "duplicate", "input_digest", "generation", "run"]
)
def test_restore_rejects_malformed_or_stale_checkpoint_without_authorization(change):
    journal, state, authorization = make_journal()
    cursor = bound(journal)
    cursor.before_call(intent=intent(cursor.next_key()))
    saved = cursor.snapshot().model_dump(mode="json")
    if change == "owner":
        saved["invocation_id"] = "foreign"
        saved["operation_keys"][0]["invocation_id"] = "foreign"
        saved["intents"][0]["key"]["invocation_id"] = "foreign"
    elif change == "cursor":
        saved["cursor"] = 2
    elif change == "intent_order":
        saved["intents"] = []
    elif change == "result_prefix":
        saved["result_refs"] = ["result", "result"]
    elif change == "input_digest":
        saved["input_digest"] = "d" * 64
    state.payload = payload((NodeJournalState.model_validate(saved),))
    if change == "duplicate":
        empty = NodeJournalState.model_validate(
            {**saved, "operation_keys": [], "intents": [], "result_refs": [], "cursor": 0}
        )
        state.payload = payload((empty, empty))
    elif change == "generation":
        state.payload = payload((NodeJournalState.model_validate(saved),), generation=2)
    elif change == "run":
        state.payload = state.payload.model_copy(update={"native_run_id": "foreign-run"})
    restarted, _, _ = make_journal(state, authorization)
    with pytest.raises(BuilderExecutionPolicyError):
        restarted.restore(ref=REF, checkpoint=CP)
    assert len(authorization.calls) == 1


def test_two_pause_generations_preserve_ordered_journals():
    journal, state, _ = make_journal()
    cursor = bound(journal)
    cursor.before_call(intent=intent(cursor.next_key()))
    for generation in (0, 1):
        state.payload = payload(journal.snapshot(ref=REF), generation=generation)
        state.generation = generation + 1
        restarted, _, _ = make_journal(state)
        restarted.restore(ref=REF, checkpoint=CP)
        cursor = bound(restarted)
        for _ in range(generation + 1):
            cursor.before_call(intent=intent(cursor.next_key()))
        cursor.finish()
        cursor.before_call(intent=intent(cursor.next_key()))
        assert len(cursor.snapshot().operation_keys) == generation + 2
        journal = restarted


def test_owner_revocation_and_result_read_failure_never_publish_result():
    journal, state, authorization = make_journal()
    cursor = bound(journal)
    state.failure = BuilderExecutionPolicyError("native_owner_mismatch")
    with pytest.raises(BuilderExecutionPolicyError, match="native_owner_mismatch"):
        cursor.before_call(intent=intent(cursor.next_key()))
    assert authorization.calls == []
    state.failure = None
    state.values.pop("result")
    cursor.rewind()
    with pytest.raises(BuilderExecutionPolicyError, match="native_result_owner_mismatch"):
        cursor.before_call(intent=intent(cursor.next_key()))
    assert cursor.snapshot().result_refs == ()
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_result_unavailable"):
        cursor.recorded_result()


def test_unbound_cursor_can_reopen_same_identity_without_creating_input_material():
    journal, state, authorization = make_journal()
    first = journal.open(ref=REF, occurrence_path=PATH)
    original = first.next_key()
    assert journal.open(ref=REF, occurrence_path=PATH).next_key() == original
    assert state.reads == []
    assert authorization.calls == []


def test_unknown_recheck_of_saved_result_cannot_advance_or_finish():
    journal, _, authorization = make_journal()
    cursor = bound(journal)
    cursor.before_call(intent=intent(cursor.next_key()))
    cursor.rewind()
    authorization.decision = PolicyStop(reason_code="effect_outcome_unknown")
    cursor.before_call(intent=intent(cursor.next_key()))
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_result_unavailable"):
        cursor.finish()
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_sequence_conflict"):
        cursor.before_call(intent=intent(cursor.next_key()))
    assert len(authorization.calls) == 2


def test_result_ref_conflict_and_generation_drift_never_expose_cached_replay():
    journal, state, authorization = make_journal()
    cursor = bound(journal)
    cursor.before_call(intent=intent(cursor.next_key()))
    authorization.decision = RecordedResult(operation_id="operation", result_ref="other")
    cursor.rewind()
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_result_conflict"):
        cursor.before_call(intent=intent(cursor.next_key()))
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_result_unavailable"):
        cursor.recorded_result()
    state.generation = 1
    cursor.rewind()
    with pytest.raises(BuilderExecutionPolicyError, match="native_generation_conflict"):
        cursor.before_call(intent=intent(cursor.next_key()))
    assert len(authorization.calls) == 2


def test_null_and_closed_stream_material_replay_without_type_coercion():
    journal, state, authorization = make_journal()
    cursor = bound(journal)
    state.values["result"] = None
    cursor.before_call(intent=intent(cursor.next_key()))
    assert cursor.recorded_result() is None
    state.values["stream"] = {"closed": True, "chunks": [True, 1, "1"], "usage": {"tokens": 2}}
    authorization.decision = RecordedResult(operation_id="operation-2", result_ref="stream")
    cursor.before_call(intent=intent(cursor.next_key()))
    assert cursor.recorded_result() == {"closed": True, "chunks": [True, 1, "1"], "usage": {"tokens": 2}}
    cursor.finish()


def test_restore_generation_change_during_private_reads_is_atomic(monkeypatch):
    journal, state, authorization = make_journal()
    cursor = bound(journal)
    cursor.before_call(intent=intent(cursor.next_key()))
    state.payload = payload(journal.snapshot(ref=REF))
    restarted, _, _ = make_journal(state, authorization)
    original = state.load_result

    def advance_during_read(**kwargs):
        result = original(**kwargs)
        state.generation = 1
        return result

    monkeypatch.setattr(state, "load_result", advance_during_read)
    with pytest.raises(BuilderExecutionPolicyError, match="native_generation_conflict"):
        restarted.restore(ref=REF, checkpoint=CP)
    assert restarted.snapshot(ref=REF) == ()
    assert len(authorization.calls) == 1


def test_same_slot_unknown_recheck_invalidates_delivery_completed_prefix():
    journal, _, authorization = make_journal()
    cursor = bound(journal)
    current = intent(cursor.next_key())
    cursor.before_call(intent=current)
    authorization.decision = PolicyStop(reason_code="effect_outcome_unknown")
    cursor.before_call(intent=current)
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_result_unavailable"):
        cursor.finish()
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_sequence_conflict"):
        cursor.before_call(intent=intent(cursor.next_key()))
    assert len(authorization.calls) == 2


@pytest.mark.parametrize(
    "decision",
    [
        DispatchPermit(
            permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
        ),
        ApprovalWait(pending_operation_id="pending", wait_reason="interaction"),
    ],
)
def test_c02_generation_change_never_exposes_decision_or_completion(monkeypatch, decision):
    journal, state, authorization = make_journal(authorization=Authorization(decision))
    cursor = bound(journal)
    current = intent(cursor.next_key())
    original = authorization.before_call

    def advance_during_authorization(**kwargs):
        reserved = original(**kwargs)
        state.generation = 1
        return reserved

    monkeypatch.setattr(authorization, "before_call", advance_during_authorization)
    with pytest.raises(BuilderExecutionPolicyError, match="native_generation_conflict"):
        cursor.before_call(intent=current)
    assert len(authorization.calls) == 1
    assert cursor.snapshot().result_refs == ()
    assert state.reads == ["inputs"]
    with pytest.raises(BuilderExecutionPolicyError, match="native_generation_conflict"):
        cursor.recorded_result()
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_result_unavailable"):
        cursor.finish()


def test_same_generation_c02_permit_is_returned_without_replay_or_completion():
    permit = DispatchPermit(
        permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
    )
    journal, state, authorization = make_journal(authorization=Authorization(permit))
    cursor = bound(journal)
    assert cursor.before_call(intent=intent(cursor.next_key())) == permit
    assert len(authorization.calls) == 1
    assert state.generation == 0
    assert cursor.snapshot().result_refs == ()
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_result_unavailable"):
        cursor.recorded_result()
    with pytest.raises(BuilderExecutionPolicyError, match="native_journal_result_unavailable"):
        cursor.finish()


def test_resolve_cursor_returns_only_existing_bound_current_issued_key_without_authorizing():
    journal, _, authorization = make_journal()
    cursor = bound(journal)
    key = cursor.next_key()
    assert journal.resolve_cursor(ref=REF, key=key) is cursor
    assert journal.resolve_cursor(ref=REF, key=key) is cursor
    assert authorization.calls == []
    assert cursor.snapshot().operation_keys == ()


@pytest.mark.parametrize("stage", ["missing", "unbound", "unissued", "old-key", "generation", "owner"])
def test_resolve_cursor_rejects_missing_or_untrusted_delivery_without_authorizing(stage):
    journal, state, authorization = make_journal()
    cursor = bound(journal)
    key = cursor.next_key()
    ref = REF
    if stage == "missing":
        key = key.model_copy(update={"occurrence_path": ("missing",)})
    elif stage == "unbound":
        journal.open(ref=REF, occurrence_path=PATH).next_key()
    elif stage == "unissued":
        cursor.rewind()
    elif stage == "old-key":
        cursor.next_key()
    elif stage == "generation":
        state.generation += 1
    else:
        ref = REF.model_copy(update={"invocation_id": "foreign"})
    with pytest.raises(BuilderExecutionPolicyError):
        journal.resolve_cursor(ref=ref, key=key)
    assert authorization.calls == []


def test_resolve_cursor_returns_replacement_identity_for_same_occurrence_only_after_input_and_key_prepare():
    journal, _, authorization = make_journal()
    first = bound(journal)
    key = first.next_key()
    replacement = bound(journal)
    assert replacement.next_key() == key
    assert journal.resolve_cursor(ref=REF, key=key) is replacement
    assert replacement is not first
    assert authorization.calls == []


@pytest.fixture
def claimed_case(metadata_case, monkeypatch):
    """Actual lifecycle selector; synthetic C03/SQL/permission boundary ports only."""
    from dataclasses import replace

    from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext

    c = metadata_case
    c.state.generation = c.dispatch.generation = 2
    c.scope.generation = 3
    authority = replace(c.authority, generation=2)

    def permission(loader, ref):
        assert loader is c.loader
        if ref != c.ref:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        return authority

    monkeypatch.setattr("services.dify_builder.native_testing.lifecycle.validate_private_read", permission)

    class ClaimedState(State):
        def load_context(self, *, ref):
            if self.failure:
                raise self.failure
            if ref != c.ref:
                raise BuilderExecutionPolicyError("native_owner_mismatch")
            return deepcopy(self.context)

    state = ClaimedState()
    state.context = ResolvedNativeTestContext(
        ref=c.ref,
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        graph={},
        inputs=INPUT,
        graph_revision="c" * 64,
        input_revision=canonical_digest(INPUT),
        resource_manifest=(),
        generation=2,
        root_native_run_id="run",
        native_run_id="run",
        parent_invocation_id=None,
        call_depth=0,
        budget_ref="request",
        cancellation_ref="request",
        execution_mode="native",
    )
    c.service.store = state
    source, _, authorization = make_journal(state)
    cursor = source.open(ref=c.ref, occurrence_path=PATH)
    cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
    original = intent(cursor.next_key())
    cursor.before_call(intent=original)
    state.payload = payload(source.snapshot(ref=c.ref))
    target, _, _ = make_journal(state, authorization)
    return ClaimedJournalCase(
        owner=c,
        state=state,
        lifecycle=c.service,
        target=target,
        authorization=authorization,
        expected=state.payload.model_copy(deep=True),
        original=original,
    )


@pytest.mark.parametrize("generation", [2, 4])
def test_claimed_restore_authenticates_older_checkpoint_then_rechecks_c02(claimed_case, monkeypatch, generation):
    from dataclasses import replace

    c = claimed_case
    c.owner.state.generation = c.owner.dispatch.generation = generation
    c.state.context = c.state.context.model_copy(update={"generation": generation})
    authority = replace(c.owner.authority, generation=generation)
    monkeypatch.setattr("services.dify_builder.native_testing.lifecycle.validate_private_read", lambda *_: authority)
    with pytest.raises(BuilderExecutionPolicyError, match="native_generation_conflict"):
        c.target.restore(ref=c.owner.ref, checkpoint=CP)
    c.target.restore_claimed(
        ref=c.owner.ref,
        generation=generation,
        dispatch_id="dispatch",
        lifecycle=c.lifecycle,
        expected_payload=c.expected,
    )
    assert len(c.authorization.calls) == 1  # Restoration does not authorize replay.
    cursor = c.target.open(ref=c.owner.ref, occurrence_path=PATH)
    cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
    current = intent(cursor.next_key())
    assert current.key == c.original.key
    assert isinstance(cursor.before_call(intent=current), RecordedResult)
    assert len(c.authorization.calls) == 2
    cursor.finish()


def _retained_cursor(c):
    cursor = c.target.open(ref=c.owner.ref, occurrence_path=("retained",))
    cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
    cursor.next_key()
    return cursor, cursor.snapshot()


def _assert_retained(c, cursor, saved):
    assert c.target._open[(c.owner.ref, ("retained",))] is cursor
    assert cursor.snapshot() == saved
    assert c.target._saved == {}


@pytest.mark.parametrize("owner", ["namespace", "second_state", "subclass"])
def test_claimed_restore_requires_actual_lifecycle_and_same_state(claimed_case, owner):
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService

    c = claimed_case
    cursor, saved = _retained_cursor(c)
    if owner == "namespace":
        lifecycle = ImpostorCheckpointLifecycle(store=c.state)
    elif owner == "second_state":
        lifecycle = NativeTestLifecycleService(c.owner.loader, state_store=State())
    else:

        class FakeLifecycle(NativeTestLifecycleService):
            def claimed_resume_checkpoint(self, **_):
                return CP

        lifecycle = FakeLifecycle(c.owner.loader, state_store=c.state)
    with pytest.raises(BuilderExecutionPolicyError):
        c.target.restore_claimed(
            ref=c.owner.ref, generation=2, dispatch_id="dispatch", lifecycle=lifecycle, expected_payload=c.expected
        )
    _assert_retained(c, cursor, saved)


@pytest.mark.parametrize(
    "fault",
    [
        "generation_zero",
        "generation_bool",
        "generation_string",
        "ref",
        "foreign_ref",
        "expected_namespace",
        "expected_generation_bool",
        "expected_payload",
        "actual_run",
        "context_generation",
        "context_mode",
        "context_namespace",
    ],
)
def test_claimed_restore_revalidates_runtime_arguments_and_actual_context(claimed_case, fault):
    c = claimed_case
    cursor, saved = _retained_cursor(c)
    ref, generation, expected = c.owner.ref, 2, c.expected
    if fault == "generation_zero":
        generation = 0
    elif fault == "generation_bool":
        generation = True
    elif fault == "generation_string":
        generation = "2"
    elif fault == "ref":
        ref = ref.model_copy(update={"context_digest": "invalid"})
    elif fault == "foreign_ref":
        ref = ref.model_copy(update={"context_digest": "f" * 64})
    elif fault == "expected_namespace":
        expected = ImpostorCheckpointPayload(c.expected)
    elif fault == "expected_generation_bool":
        expected = expected.model_copy(update={"generation": False})
    elif fault == "expected_payload":
        expected = expected.model_copy(update={"graph_runtime_state_json": '{"forged":true}'})
    elif fault == "actual_run":
        c.state.payload = c.state.payload.model_copy(update={"native_run_id": "other-run"})
    elif fault == "context_generation":
        c.state.context = c.state.context.model_copy(update={"generation": 3})
    elif fault == "context_mode":
        c.state.context = c.state.context.model_copy(update={"execution_mode": "mock"})
    else:
        c.state.context = ImpostorRunContext(ref=ref, generation=2, native_run_id="run")
    with pytest.raises(BuilderExecutionPolicyError):
        c.target.restore_claimed(
            ref=ref, generation=generation, dispatch_id="dispatch", lifecycle=c.lifecycle, expected_payload=expected
        )
    _assert_retained(c, cursor, saved)


@pytest.mark.parametrize("fault", ["input", "result", "sequence"])
def test_claimed_restore_keeps_ordered_private_validation_atomic(claimed_case, fault):
    c = claimed_case
    cursor, saved = _retained_cursor(c)
    if fault == "input":
        c.state.values["inputs"] = {"changed": True}
    elif fault == "result":
        c.state.values.pop("result")
    else:
        invalid = c.state.payload.node_journals[0].model_copy(update={"cursor": 2})
        c.state.payload = c.state.payload.model_copy(update={"node_journals": (invalid,)})
        c.expected = c.state.payload.model_copy(deep=True)
    with pytest.raises(BuilderExecutionPolicyError):
        c.target.restore_claimed(
            ref=c.owner.ref, generation=2, dispatch_id="dispatch", lifecycle=c.lifecycle, expected_payload=c.expected
        )
    _assert_retained(c, cursor, saved)
    assert len(c.authorization.calls) == 1


@pytest.mark.parametrize(
    "fault", ["unclaimed", "expired", "changed_reference", "context_generation", "context_run", "context_inputs"]
)
def test_claimed_restore_rechecks_actual_claim_and_context_after_private_reads(claimed_case, monkeypatch, fault):
    c = claimed_case
    cursor, saved = _retained_cursor(c)
    original = c.state.load_result

    def revoke_during_read(**kwargs):
        value = original(**kwargs)
        if fault == "unclaimed":
            c.owner.dispatch.state = "queued"
        elif fault == "expired":
            c.owner.dispatch.claim_expires_at = c.lifecycle.clock()
        elif fault == "changed_reference":
            c.owner.obj.payload_digest = c.owner.continuation.payload_digest = "d" * 64
        elif fault == "context_generation":
            c.state.context = c.state.context.model_copy(update={"generation": 3})
        elif fault == "context_run":
            c.state.context = c.state.context.model_copy(update={"native_run_id": "other-run"})
        else:
            c.state.context = c.state.context.model_copy(update={"inputs": {"changed": True}})
        return value

    monkeypatch.setattr(c.state, "load_result", revoke_during_read)
    with pytest.raises(BuilderExecutionPolicyError):
        c.target.restore_claimed(
            ref=c.owner.ref, generation=2, dispatch_id="dispatch", lifecycle=c.lifecycle, expected_payload=c.expected
        )
    _assert_retained(c, cursor, saved)
    assert len(c.authorization.calls) == 1
