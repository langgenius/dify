"""Ordered private node reconstruction, with C02 retaining all effect authority.

Occurrence paths must come from the native runtime's immutable frame/iteration/
child identity. This module cannot qualify a caller's path or produce bindings.
Inputs must already have an independently owned C03 reference; an effect's result
slot must never be repurposed for inputs. Only encrypted checkpoints persist this
journal. Between checkpoints C02's immutable intent and dispatch ledger fences
redelivery, including a crash after a physical call but before checkpointing.
"""

from copy import deepcopy
from typing import Protocol

from pydantic import TypeAdapter

from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.contracts import (
    CheckpointRef,
    EffectDecision,
    EffectIntent,
    FiniteJSON,
    JsonValue,
    NativeTestContextRef,
    OperationKey,
    RecordedResult,
    operation_digest,
)
from services.dify_builder.native_testing.runtime_contracts import NativeStatePort, NodeJournalState

_JSON = TypeAdapter(FiniteJSON)


class JournalAuthorizationPort(Protocol):
    def before_call(self, *, ref: NativeTestContextRef, intent: EffectIntent) -> EffectDecision:
        """C02 decision only; a returned permit still requires claim_dispatch."""
        ...


class OperationCursor:
    """One delivery's cursor over an immutable occurrence's saved sequence.

    Rewind begins at zero without deleting history. before_call always consults
    C02; cached references never bypass current authorization. A DispatchPermit
    does not close a result or authorize another transport. The call adapter must
    claim it and settle its complete/closed result through the existing owners;
    rechecking C02 can then yield RecordedResult. Unknown/unclosed streams remain
    without a result reference and cannot advance the sequence.
    """

    def __init__(
        self,
        *,
        state: NativeStatePort,
        authorization: JournalAuthorizationPort,
        ref: NativeTestContextRef,
        occurrence_path: tuple[str, ...],
        generation: int,
        saved: NodeJournalState | None,
    ):
        self._state, self._authorization, self._ref = state, authorization, ref
        self._path, self._generation = occurrence_path, generation
        self._saved = saved.model_copy(deep=True) if saved is not None else None
        self._position = 0
        self._completed_prefix = 0
        self._input_bound = False
        self._recorded: JsonValue = None
        self._has_recorded = False

    def _check_context(self) -> None:
        context = self._state.load_context(ref=self._ref)
        if context.ref != self._ref or context.generation != self._generation:
            raise BuilderExecutionPolicyError("native_generation_conflict")

    def bind_input(self, *, input_result_ref: str, inputs: JsonValue) -> None:
        """Compare typed actual inputs to existing protected input material."""
        self._check_context()
        value = _JSON.validate_python(inputs)
        stored = self._state.load_result(ref=self._ref, result_ref=input_result_ref)
        digest = canonical_digest(_JSON.validate_python(stored))
        if digest != canonical_digest(value) or (
            self._saved is not None
            and (self._saved.input_result_ref, self._saved.input_digest) != (input_result_ref, digest)
        ):
            raise BuilderExecutionPolicyError("native_journal_input_mismatch")
        if self._saved is None:
            self._saved = NodeJournalState(
                invocation_id=self._ref.invocation_id,
                occurrence_path=self._path,
                input_result_ref=input_result_ref,
                input_digest=digest,
                cursor=0,
                operation_keys=(),
                result_refs=(),
                intents=(),
            )
        self._input_bound = True

    def next_key(self) -> OperationKey:
        key = OperationKey(invocation_id=self._ref.invocation_id, occurrence_path=self._path, cursor=self._position)
        self._position += 1
        self._has_recorded = False
        self._recorded = None
        return key

    def rewind(self) -> None:
        self._position = 0
        self._completed_prefix = 0
        self._has_recorded = False
        self._recorded = None

    def before_call(self, *, intent: EffectIntent) -> EffectDecision:
        """Check ordered intent, then obtain the authoritative current decision."""
        self._has_recorded = False
        self._recorded = None
        self._check_context()
        intent = EffectIntent.model_validate(intent.model_dump(mode="json"))
        saved = self._saved
        if saved is None or not self._input_bound or intent.input_digest != saved.input_digest:
            raise BuilderExecutionPolicyError("native_journal_input_mismatch")
        index = self._position - 1
        expected = OperationKey(invocation_id=self._ref.invocation_id, occurrence_path=self._path, cursor=max(index, 0))
        if index < 0 or intent.key != expected or index > self._completed_prefix:
            raise BuilderExecutionPolicyError("native_journal_sequence_conflict")
        if index < len(saved.operation_keys):
            if operation_digest(intent.key) != operation_digest(saved.operation_keys[index]) or canonical_digest(
                intent.model_dump(mode="json")
            ) != canonical_digest(saved.intents[index].model_dump(mode="json")):
                raise BuilderExecutionPolicyError("native_journal_intent_conflict")
        elif index == len(saved.operation_keys):
            saved = saved.model_copy(
                update={
                    "cursor": index + 1,
                    "operation_keys": (*saved.operation_keys, intent.key),
                    "intents": (*saved.intents, intent.model_copy(deep=True)),
                },
                deep=True,
            )
            self._saved = saved
        else:
            raise BuilderExecutionPolicyError("native_journal_sequence_conflict")
        # A repeated recheck of the same slot can revoke this delivery's proof
        # of completion, while the saved result reference remains historical fact.
        self._completed_prefix = min(self._completed_prefix, index)
        decision = self._authorization.before_call(ref=self._ref, intent=intent)
        self._check_context()
        if isinstance(decision, RecordedResult):
            if index < len(saved.result_refs) and saved.result_refs[index] != decision.result_ref:
                raise BuilderExecutionPolicyError("native_journal_result_conflict")
            result = self._state.load_result(ref=self._ref, result_ref=decision.result_ref)
            result = _JSON.validate_python(result)
            self._check_context()
            if index == len(saved.result_refs):
                self._saved = saved.model_copy(update={"result_refs": (*saved.result_refs, decision.result_ref)})
            self._recorded, self._has_recorded = deepcopy(result), True
            if index == self._completed_prefix:
                self._completed_prefix += 1
        return decision

    def recorded_result(self) -> JsonValue:
        """Return only a just-validated C02 replay, preserving null as a real value."""
        self._check_context()
        if not self._has_recorded:
            raise BuilderExecutionPolicyError("native_journal_result_unavailable")
        return deepcopy(self._recorded)

    def finish(self) -> None:
        """A node cannot silently omit a previously recorded operation suffix."""
        if self._saved is None or self._position != len(self._saved.operation_keys):
            raise BuilderExecutionPolicyError("native_journal_sequence_conflict")
        if self._completed_prefix != len(self._saved.operation_keys):
            raise BuilderExecutionPolicyError("native_journal_result_unavailable")

    def snapshot(self) -> NodeJournalState:
        if self._saved is None:
            raise BuilderExecutionPolicyError("native_journal_input_mismatch")
        return self._saved.model_copy(deep=True)


class NodeOperationJournal:
    """Checkpoint-backed sequences; no second ledger, storage or binding owner."""

    def __init__(self, *, state: NativeStatePort, authorization: JournalAuthorizationPort):
        self._state, self._authorization = state, authorization
        self._saved: dict[tuple[NativeTestContextRef, tuple[str, ...]], NodeJournalState] = {}
        self._open: dict[tuple[NativeTestContextRef, tuple[str, ...]], OperationCursor] = {}

    def open(self, *, ref: NativeTestContextRef, occurrence_path: tuple[str, ...]) -> OperationCursor:
        ref = NativeTestContextRef.model_validate(ref.model_dump(mode="json"))
        key = OperationKey(invocation_id=ref.invocation_id, occurrence_path=occurrence_path, cursor=0)
        context = self._state.load_context(ref=ref)
        if context.ref != ref:
            raise BuilderExecutionPolicyError("native_journal_owner_mismatch")
        identity = (ref, key.occurrence_path)
        active = self._open.get(identity)
        saved = active._saved if active is not None else self._saved.get(identity)
        cursor = OperationCursor(
            state=self._state,
            authorization=self._authorization,
            ref=ref,
            occurrence_path=key.occurrence_path,
            generation=context.generation,
            saved=saved,
        )
        self._open[identity] = cursor
        return cursor

    def resolve_cursor(self, *, ref: NativeTestContextRef, key: OperationKey) -> OperationCursor:
        """Find an already prepared delivery without creating execution authority.

        The input owner must have opened, bound and issued this exact current
        key. Callers retaining a cursor must also compare returned object
        identity across owner boundaries: reopening replaces the delivery.
        This lookup never advances a cursor or consults C02.
        """
        ref = NativeTestContextRef.model_validate(ref.model_dump(mode="json"))
        key = OperationKey.model_validate(key.model_dump(mode="json"))
        if key.invocation_id != ref.invocation_id:
            raise BuilderExecutionPolicyError("native_journal_owner_mismatch")
        cursor = self._open.get((ref, key.occurrence_path))
        if cursor is None or cursor._ref != ref:
            raise BuilderExecutionPolicyError("native_journal_cursor_unavailable")
        cursor._check_context()
        if not cursor._input_bound or cursor._saved is None:
            raise BuilderExecutionPolicyError("native_journal_input_mismatch")
        if cursor._position - 1 != key.cursor:
            raise BuilderExecutionPolicyError("native_journal_sequence_conflict")
        return cursor

    def restore(self, *, ref: NativeTestContextRef, checkpoint: CheckpointRef) -> None:
        """Read exclusively through C03; runtime must supply its claimed checkpoint.

        C03 resume advances generation once before delivering the prior snapshot.
        A same-generation read also supports a restarted pending node. Choosing
        the active checkpoint remains the lifecycle/production factory's job.
        """
        context = self._state.load_context(ref=ref)
        payload = self._state.read_checkpoint(ref=ref, checkpoint=checkpoint)
        if context.ref != ref or payload.native_run_id != context.native_run_id:
            raise BuilderExecutionPolicyError("native_journal_owner_mismatch")
        if payload.generation not in (context.generation, context.generation - 1):
            raise BuilderExecutionPolicyError("native_generation_conflict")
        restored = {}
        for original in payload.node_journals:
            saved = NodeJournalState.model_validate(original.model_dump(mode="json"))
            identity = (ref, saved.occurrence_path)
            if saved.invocation_id != ref.invocation_id or identity in restored:
                raise BuilderExecutionPolicyError("native_journal_owner_mismatch")
            if (
                type(saved.cursor) is not int
                or saved.cursor != len(saved.operation_keys)
                or len(saved.intents) != len(saved.operation_keys)
                or len(saved.result_refs) > len(saved.operation_keys)
                or any(
                    key.cursor != index or operation_digest(saved.intents[index].key) != operation_digest(key)
                    for index, key in enumerate(saved.operation_keys)
                )
                or any(intent.input_digest != saved.input_digest for intent in saved.intents)
            ):
                raise BuilderExecutionPolicyError("native_journal_sequence_conflict")
            inputs = self._state.load_result(ref=ref, result_ref=saved.input_result_ref)
            if canonical_digest(_JSON.validate_python(inputs)) != saved.input_digest:
                raise BuilderExecutionPolicyError("native_journal_input_mismatch")
            for result_ref in saved.result_refs:
                self._state.load_result(ref=ref, result_ref=result_ref)
            restored[identity] = saved.model_copy(deep=True)
        current = self._state.load_context(ref=ref)
        if (current.ref, current.generation, current.native_run_id) != (
            context.ref,
            context.generation,
            context.native_run_id,
        ):
            raise BuilderExecutionPolicyError("native_generation_conflict")
        self._saved = {**{key: value for key, value in self._saved.items() if key[0] != ref}, **restored}
        self._open = {key: value for key, value in self._open.items() if key[0] != ref}

    def snapshot(self, *, ref: NativeTestContextRef) -> tuple[NodeJournalState, ...]:
        self._state.load_context(ref=ref)
        states = {
            identity: saved.model_copy(deep=True) for identity, saved in self._saved.items() if identity[0] == ref
        }
        states.update({identity: cursor.snapshot() for identity, cursor in self._open.items() if identity[0] == ref})
        return tuple(states.values())
