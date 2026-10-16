"""Scalar composition units with real journal/control and stand-in C02/C03 ports.

No SQL service, transport, credential owner or production binding is qualified
by these synthetic values. Counters expose each physical callback attempt.
"""

import importlib
import importlib.util
from collections.abc import Iterator
from copy import deepcopy

import pytest

from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.contracts import (
    ApprovalWait,
    DispatchPermit,
    EffectIntent,
    EffectReceipt,
    JsonValue,
    NativeTestContextRef,
    PolicyStop,
    RecordedResult,
)
from services.dify_builder.native_testing.control import NativeApprovalWait, NativePolicyStop
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from services.dify_builder.native_testing.runtime_contracts import ResolvedNativeTestContext

REF = NativeTestContextRef(request_id="request", invocation_id="invocation", context_digest="a" * 64)
PATH = ("root", "http:write")
INPUT: dict[str, JsonValue] = {"history": [True, 1, "1"]}


def adapter_class():
    module = "services.dify_builder.native_testing.call_adapter"
    assert importlib.util.find_spec(module) is not None, "scalar call adapter is not implemented"
    return importlib.import_module(module).NativeCallAdapter


class State:
    """Protected storage stand-in; real encrypted/SQL owners remain CI-owned."""

    def __init__(self, events):
        self.events = events
        self.values: dict[str, JsonValue] = {"inputs": deepcopy(INPUT)}
        self.context = ResolvedNativeTestContext(
            ref=REF,
            tenant_id="tenant",
            actor_id="actor",
            app_id="app",
            workflow_id="workflow",
            graph={},
            inputs=INPUT,
            graph_revision="graph-v1",
            input_revision="input-v1",
            resource_manifest=(),
            generation=0,
            root_native_run_id="run",
            native_run_id="run",
            parent_invocation_id=None,
            call_depth=0,
            budget_ref="budget",
            cancellation_ref="cancellation",
            execution_mode="native",
        )
        self.store_error = None
        self.read_error = None
        self.store_hook = None

    def load_context(self, *, ref):
        if ref != REF:
            raise BuilderExecutionPolicyError("native_owner_mismatch")
        return self.context

    def commit_checkpoint(self, *, ref, generation, payload):
        del ref, generation, payload
        raise AssertionError("scalar units do not commit checkpoints")

    def read_checkpoint(self, *, ref, checkpoint):
        del ref, checkpoint
        raise AssertionError("scalar units do not read checkpoints")

    def store_result(self, *, ref, key, result):
        assert ref == REF
        assert key.invocation_id == REF.invocation_id
        self.events.append(("store", deepcopy(result)))
        if self.store_hook:
            self.store_hook()
        if self.store_error:
            raise self.store_error
        result_ref = f"result-{key.cursor}"
        if result_ref in self.values and self.values[result_ref] != result:
            raise BuilderExecutionPolicyError("native_payload_conflict")
        self.values[result_ref] = deepcopy(result)
        return result_ref

    def load_result(self, *, ref, result_ref):
        assert ref == REF
        self.events.append(("read", result_ref))
        if self.read_error and result_ref != "inputs":
            raise self.read_error
        return deepcopy(self.values[result_ref])


class Authorization:
    """One-shot and immutable C02 stand-in, never an SQL qualification."""

    def __init__(self, events):
        self.events = events
        self.decisions = {}
        self.permits = {}
        self.claimed = set()
        self.outcomes = {}
        self.claim_error = None
        self.claim_hook = None
        self.before_hook = None
        self.settlement_error = None
        self.settlement_commits = False
        self.settlement_hook = None

    def before_call(self, *, ref, intent):
        assert ref == REF
        self.events.append(("authorize", intent.key.cursor))
        if self.before_hook:
            self.before_hook()
        index = intent.key.cursor
        if index in self.decisions:
            return self.decisions[index]
        if index in self.outcomes:
            outcome, result_ref = self.outcomes[index]
            if outcome == "completed":
                return RecordedResult(operation_id=f"operation-{index}", result_ref=result_ref)
            return PolicyStop(reason_code="outcome_unknown")
        if index in self.claimed:
            return PolicyStop(reason_code="dispatch_in_progress")
        return self.permits.setdefault(
            index,
            DispatchPermit(
                permit_id=f"permit-{index}",
                attempt_id=f"attempt-{index}",
                operation_id=f"operation-{index}",
                expires_at="2030-01-01T00:00:00Z",
            ),
        )

    def claim_dispatch(self, *, ref, intent, permit):
        assert ref == REF
        assert permit is self.permits[intent.key.cursor]
        self.events.append(("claim", intent.key.cursor))
        if self.claim_hook:
            self.claim_hook()
        if self.claim_error:
            raise self.claim_error
        if intent.key.cursor in self.claimed:
            raise BuilderExecutionPolicyError("dispatch_already_consumed")
        self.claimed.add(intent.key.cursor)

    def record_outcome(self, *, permit, outcome, result_ref):
        index = int(permit.operation_id.rsplit("-", 1)[1])
        self.events.append(("settle", outcome, result_ref))
        if self.settlement_hook:
            self.settlement_hook()
        if not self.settlement_error or self.settlement_commits:
            assert index not in self.outcomes or self.outcomes[index] == (outcome, result_ref)
            self.outcomes[index] = (outcome, result_ref)
        if self.settlement_error:
            raise self.settlement_error
        return EffectReceipt(
            operation_id=permit.operation_id, attempt_id=permit.attempt_id, outcome=outcome, result_ref=result_ref
        )


class Case:
    def __init__(self, **adapter_options):
        self.events = []
        self.state = State(self.events)
        self.authorization = Authorization(self.events)
        self.journal = NodeOperationJournal(state=self.state, authorization=self.authorization)
        self.cursor = self.journal.open(ref=REF, occurrence_path=PATH)
        self.cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
        adapter_options.setdefault("max_result_bytes", 4096)
        self.adapter = adapter_class()(
            state=self.state, authorization=self.authorization, journal=self.journal, **adapter_options
        )
        self.calls = 0
        self.value: object = {"typed": [False, 2, "2", None]}
        self.dispatch_hook = None
        self.dispatch_error = None

    def intent(self, **changes):
        return EffectIntent(
            key=self.cursor.next_key(),
            kind="http",
            resource_ref="endpoint",
            implementation_revision="v1",
            account_ref="account",
            target={"url": "https://example.invalid/synthetic"},
            parameters=changes.get("parameters", {"value": True}),
            input_digest=canonical_digest(INPUT),
            capability_digest="c" * 64,
        )

    def dispatch(self, permit):
        assert permit is self.authorization.permits[self.cursor.snapshot().operation_keys[-1].cursor]
        assert self.events[-1][0] == "claim"
        self.events.append(("dispatch", permit.operation_id))
        self.calls += 1
        if self.dispatch_hook:
            self.dispatch_hook()
        if self.dispatch_error:
            raise self.dispatch_error
        return self.value

    def call(self, intent=None, **kwargs):
        return self.adapter.call(ref=REF, intent=intent or self.intent(), dispatch=self.dispatch, **kwargs)


def assert_unknown(case):
    with pytest.raises(NativePolicyStop) as raised:
        case.call()
    assert raised.value.ref == REF
    assert raised.value.reason_code == "outcome_unknown"
    assert case.cursor.snapshot().result_refs == ()
    with pytest.raises(BuilderExecutionPolicyError):
        case.cursor.finish()


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_wait_preserves_category_and_never_claims_dispatches_or_settles(reason):
    case = Case()
    case.authorization.decisions[0] = ApprovalWait(pending_operation_id="pending", wait_reason=reason)
    with pytest.raises(NativeApprovalWait) as raised:
        case.call()
    assert (raised.value.ref, raised.value.pending_operation_id, raised.value.wait_reason) == (REF, "pending", reason)
    assert case.calls == 0
    assert [event[0] for event in case.events] == ["read", "authorize"]


@pytest.mark.parametrize("reason", ["effect_denied", "outcome_unknown", "dispatch_in_progress"])
def test_stop_never_claims_dispatches_or_settles(reason):
    case = Case()
    case.authorization.decisions[0] = PolicyStop(reason_code=reason)
    with pytest.raises(NativePolicyStop) as raised:
        case.call()
    assert raised.value.reason_code == reason
    assert case.calls == 0
    assert [event[0] for event in case.events] == ["read", "authorize"]


@pytest.mark.parametrize("value", [None, False, True, 0, 1.5, "1", [], [True, 1, "1"], {"file": {"id": "file-1"}}])
def test_complete_scalar_stores_before_settlement_then_replays_current_authority(value):
    case = Case()
    case.value = value
    assert case.call() == value
    assert case.calls == 1
    assert case.events == [
        ("read", "inputs"),
        ("authorize", 0),
        ("claim", 0),
        ("dispatch", "operation-0"),
        ("store", value),
        ("settle", "completed", "result-0"),
        ("authorize", 0),
        ("read", "result-0"),
    ]
    case.cursor.finish()
    case.cursor = case.journal.open(ref=REF, occurrence_path=PATH)
    case.cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
    assert case.call() == value
    assert case.calls == 1
    case.cursor.finish()


def test_two_operations_complete_in_order_and_replay_null_without_fabricated_prefix():
    case = Case()
    case.value = None
    assert case.call() is None
    case.value = [False, 3, "3"]
    assert case.call() == [False, 3, "3"]
    case.cursor.finish()
    assert case.cursor.snapshot().result_refs == ("result-0", "result-1")
    case.cursor.rewind()
    assert case.call() is None
    assert case.call() == [False, 3, "3"]
    case.cursor.finish()
    assert case.calls == 2


@pytest.mark.parametrize("reason", ["dispatch_already_consumed", "invalid_dispatch_permit", "native_revision_drift"])
def test_known_claim_refusal_preserves_reason_without_io_or_settlement(reason):
    case = Case()
    case.authorization.claim_error = BuilderExecutionPolicyError(reason)
    with pytest.raises(NativePolicyStop) as raised:
        case.call()
    assert raised.value.reason_code == reason
    assert case.calls == 0
    assert not case.authorization.outcomes
    assert [event[0] for event in case.events] == ["read", "authorize", "claim"]


def test_claim_ack_ambiguity_never_retries_claim_or_dispatches_or_settles():
    case = Case()
    case.authorization.claim_error = OSError("claim commit acknowledgement lost")
    assert_unknown(case)
    assert case.calls == 0
    assert not case.authorization.outcomes
    assert [event[0] for event in case.events].count("claim") == 1


@pytest.mark.parametrize("error", [OSError("provider timeout"), RuntimeError("partial response"), KeyboardInterrupt()])
def test_callback_failure_records_unknown_once_and_never_replays(error):
    case = Case()
    case.dispatch_error = error
    assert_unknown(case)
    assert case.calls == 1
    assert case.authorization.outcomes == {0: ("unknown", None)}
    case.cursor.rewind()
    with pytest.raises(NativePolicyStop, match="native_control_stop"):
        case.call()
    assert case.calls == 1
    assert [event for event in case.events if event[0] == "settle"] == [("settle", "unknown", None)]


@pytest.mark.parametrize("value", [float("inf"), float("nan"), (1, 2), {1: "wrong-key"}, b"bytes", object()])
def test_non_json_or_non_finite_callback_result_is_unknown_and_never_stored(value):
    case = Case()
    case.value = value
    assert_unknown(case)
    assert case.calls == 1
    assert not any(event[0] == "store" for event in case.events)
    assert case.authorization.outcomes == {0: ("unknown", None)}


def test_generator_is_not_consumed_or_treated_as_scalar_completion():
    case = Case()
    consumed = []

    def stream():
        consumed.append(True)
        yield "prefix"

    case.value = stream()
    assert isinstance(case.value, Iterator)
    assert_unknown(case)
    assert consumed == []
    assert case.calls == 1
    assert case.authorization.outcomes == {0: ("unknown", None)}


def test_utf8_result_size_bound_is_enforced_before_storage():
    case = Case(max_result_bytes=4)
    case.value = "éé"  # six encoded JSON bytes, despite two Python characters.
    assert_unknown(case)
    assert not any(event[0] == "store" for event in case.events)


def test_store_failure_after_dispatch_records_unknown_once_without_retry():
    case = Case()
    case.state.store_error = OSError("storage readback or SQL ack failed")
    assert_unknown(case)
    assert case.calls == 1
    assert case.authorization.outcomes == {0: ("unknown", None)}
    assert [event[0] for event in case.events].count("store") == 1


@pytest.mark.parametrize("commits", [False, True])
def test_completion_ack_failure_never_attempts_contradictory_unknown_settlement(commits):
    case = Case()
    case.authorization.settlement_error = OSError("completion ack lost")
    case.authorization.settlement_commits = commits
    assert_unknown(case)
    assert case.calls == 1
    assert [event for event in case.events if event[0] == "settle"] == [("settle", "completed", "result-0")]
    assert case.authorization.outcomes == ({0: ("completed", "result-0")} if commits else {})


def test_unknown_settlement_failure_is_contained_without_second_settlement():
    case = Case()
    case.dispatch_error = OSError("dispatched response lost")
    case.authorization.settlement_error = OSError("unknown acknowledgement lost")
    assert_unknown(case)
    assert case.calls == 1
    assert [event for event in case.events if event[0] == "settle"] == [("settle", "unknown", None)]


def test_current_recorded_result_private_read_failure_never_dispatches():
    case = Case()
    case.authorization.decisions[0] = RecordedResult(operation_id="operation-0", result_ref="private-result")
    case.state.read_error = BuilderExecutionPolicyError("native_result_owner_mismatch")
    assert_unknown(case)
    assert case.calls == 0
    assert not case.authorization.outcomes


@pytest.mark.parametrize("boundary", ["before", "claim", "dispatch", "store", "settlement"])
def test_generation_change_across_owner_boundaries_never_returns_success(boundary):
    case = Case()

    def drift():
        case.state.context = case.state.context.model_copy(update={"generation": 1})

    if boundary == "before":
        case.authorization.before_hook = drift
    elif boundary == "claim":
        case.authorization.claim_hook = drift
    elif boundary == "dispatch":
        case.dispatch_hook = drift
    elif boundary == "store":
        case.state.store_hook = drift
    else:
        case.authorization.settlement_hook = drift
    with pytest.raises(NativePolicyStop):
        case.call()
    assert case.calls == (0 if boundary in ("before", "claim") else 1)
    assert case.cursor.snapshot().result_refs == ()
    if boundary == "settlement":
        assert [event for event in case.events if event[0] == "settle"] == [("settle", "completed", "result-0")]


def test_foreign_ref_is_refused_before_authorization_and_dispatch():
    case = Case()
    foreign = REF.model_copy(update={"invocation_id": "other"})
    with pytest.raises(NativePolicyStop):
        case.adapter.call(ref=foreign, intent=case.intent(), dispatch=case.dispatch)
    assert case.calls == 0
    assert not any(event[0] == "authorize" for event in case.events)


def test_unbound_or_missing_occurrence_never_opens_or_mints_input():
    case = Case()
    case.cursor = case.journal.open(ref=REF, occurrence_path=("root", "other"))
    with pytest.raises(NativePolicyStop):
        case.call()
    assert case.calls == 0
    assert not any(event[0] == "authorize" for event in case.events)


def test_changed_ordered_intent_is_refused_without_repeated_dispatch():
    case = Case()
    case.call()
    case.cursor.rewind()
    with pytest.raises(NativePolicyStop):
        case.call(case.intent(parameters={"value": 1}))
    assert case.calls == 1


def test_duplicate_delivery_while_claimed_never_issues_another_physical_call():
    case = Case()
    case.dispatch_error = RuntimeError("uncertain physical response")
    assert_unknown(case)
    case.cursor = case.journal.open(ref=REF, occurrence_path=PATH)
    case.cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
    with pytest.raises(NativePolicyStop) as raised:
        case.call()
    assert raised.value.reason_code == "outcome_unknown"
    assert case.calls == 1
    assert [event[0] for event in case.events].count("claim") == 1


@pytest.mark.parametrize("limit", [0, -1, True, 1.5, "4096", None])
def test_invalid_result_budget_is_refused_before_any_effect(limit):
    with pytest.raises(ValueError):
        Case(max_result_bytes=limit)


def test_generation_drift_after_claim_is_truthfully_not_dispatched():
    case = Case()
    case.authorization.claim_hook = lambda: setattr(
        case.state, "context", case.state.context.model_copy(update={"generation": 1})
    )
    with pytest.raises(NativePolicyStop) as raised:
        case.call()
    assert raised.value.reason_code == "native_generation_conflict"
    assert case.calls == 0
    assert case.authorization.outcomes == {0: ("not_dispatched", None)}


def test_same_occurrence_cursor_replacement_during_callback_is_not_completion_authority():
    case = Case()

    def replace():
        replacement = case.journal.open(ref=REF, occurrence_path=PATH)
        replacement.bind_input(input_result_ref="inputs", inputs=INPUT)
        replacement.next_key()

    case.dispatch_hook = replace
    assert_unknown(case)
    assert case.calls == 1
    assert case.authorization.outcomes == {0: ("unknown", None)}


def test_owner_drift_during_storage_stops_without_completion():
    case = Case()
    case.state.store_hook = lambda: setattr(
        case.state,
        "context",
        case.state.context.model_copy(update={"ref": REF.model_copy(update={"request_id": "other"})}),
    )
    assert_unknown(case)
    assert case.calls == 1
    assert case.authorization.outcomes == {0: ("unknown", None)}


def test_forced_duplicate_permit_is_refused_by_one_shot_claim_without_settlement():
    case = Case()
    current = case.intent()
    permit = case.authorization.before_call(ref=REF, intent=current)
    case.authorization.claimed.add(0)
    case.authorization.decisions[0] = permit
    with pytest.raises(NativePolicyStop) as raised:
        case.call(current)
    assert raised.value.reason_code == "dispatch_already_consumed"
    assert case.calls == 0
    assert not case.authorization.outcomes


def test_saved_result_reference_never_overrides_current_denial():
    case = Case()
    case.call()
    case.cursor.rewind()
    case.authorization.decisions[0] = PolicyStop(reason_code="effect_denied")
    with pytest.raises(NativePolicyStop) as raised:
        case.call()
    assert raised.value.reason_code == "effect_denied"
    assert case.calls == 1
    assert case.cursor.snapshot().result_refs == ("result-0",)
    with pytest.raises(BuilderExecutionPolicyError):
        case.cursor.finish()


def test_late_completed_receipt_survives_conflicting_unknown_attempt():
    case = Case()
    case.dispatch_error = OSError("response lost")
    case.authorization.settlement_hook = lambda: case.authorization.outcomes.update({0: ("completed", "late-result")})
    assert_unknown(case)
    assert case.calls == 1
    assert case.authorization.outcomes == {0: ("completed", "late-result")}
    assert [event for event in case.events if event[0] == "settle"] == [("settle", "unknown", None)]


def test_lost_completion_ack_can_only_replay_after_current_c02_and_protected_read():
    case = Case()
    case.authorization.settlement_error = OSError("ack lost")
    case.authorization.settlement_commits = True
    assert_unknown(case)
    case.authorization.settlement_error = None
    case.cursor.rewind()
    assert case.call() == {"typed": [False, 2, "2", None]}
    assert case.calls == 1
    assert [event[0] for event in case.events].count("claim") == 1
    assert [event for event in case.events if event[0] == "settle"] == [("settle", "completed", "result-0")]
    case.cursor.finish()


@pytest.mark.parametrize(
    "decision",
    [
        PolicyStop(reason_code="native_cancelled"),
        ApprovalWait(pending_operation_id="later-pending", wait_reason="interaction"),
    ],
)
def test_completion_recheck_cannot_emit_new_wait_or_success_without_recorded_authority(decision):
    case = Case()
    case.authorization.settlement_hook = lambda: case.authorization.decisions.update({0: decision})
    assert_unknown(case)
    assert case.calls == 1
    assert [event for event in case.events if event[0] == "settle"] == [("settle", "completed", "result-0")]


def test_postcompletion_protected_read_failure_never_overwrites_completed_outcome():
    case = Case()
    case.authorization.settlement_hook = lambda: setattr(case.state, "read_error", OSError("readback failed"))
    assert_unknown(case)
    assert case.calls == 1
    assert case.authorization.outcomes == {0: ("completed", "result-0")}
    assert [event for event in case.events if event[0] == "settle"] == [("settle", "completed", "result-0")]


def test_result_at_exact_utf8_byte_budget_completes():
    case = Case(max_result_bytes=4)
    case.value = "é"  # two quotes plus two UTF-8 bytes.
    assert case.call() == "é"
    case.cursor.finish()
    assert case.calls == 1


def test_replay_returns_isolated_mutable_value_from_protected_storage():
    case = Case()
    result = case.call()
    assert result == {"typed": [False, 2, "2", None]}
    result["typed"].append("local-only")
    case.cursor.rewind()
    assert case.call() == {"typed": [False, 2, "2", None]}
    assert case.calls == 1


def test_claim_commit_lost_ack_retains_spent_claim_without_io_or_settlement():
    case = Case()
    case.authorization.claim_hook = lambda: case.authorization.claimed.add(0)
    case.authorization.claim_error = OSError("commit ack lost")
    assert_unknown(case)
    assert case.authorization.claimed == {0}
    assert case.calls == 0
    case.cursor.rewind()
    with pytest.raises(NativePolicyStop) as raised:
        case.call()
    assert raised.value.reason_code == "dispatch_in_progress"
    assert [event[0] for event in case.events].count("claim") == 1
    assert not case.authorization.outcomes
