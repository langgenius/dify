"""Bounded scalar calls through existing C02/C03 and ordered journal authority.

The admitted input/binding producer prepares each cursor and operation intent.
A callback represents exactly one physical operation outside DB transactions;
protocol, credential, cancellation and streaming owners remain separate. This
component supplies no durable whole-run fence or production activation.
"""

from collections.abc import Callable
from typing import NoReturn, Protocol

from pydantic import TypeAdapter

from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_json
from runtime_contracts.builder.native.contracts import (
    DispatchPermit,
    EffectIntent,
    EffectReceipt,
    FiniteJSON,
    JsonValue,
    NativeTestContextRef,
    Outcome,
    RecordedResult,
)
from runtime_contracts.builder.native.runtime_contracts import NativeStatePort
from services.dify_builder.native_testing.control import NativeControlBridge, NativePolicyStop
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal, OperationCursor

_JSON = TypeAdapter(FiniteJSON)


class ScalarAuthorizationPort(Protocol):
    """Existing C02 consumption and immutable settlement, without SQL ownership."""

    def claim_dispatch(self, *, ref: NativeTestContextRef, intent: EffectIntent, permit: DispatchPermit) -> None: ...

    def record_outcome(self, *, permit: DispatchPermit, outcome: Outcome, result_ref: str | None) -> EffectReceipt: ...


class NativeCallAdapter:
    """Execute a finite scalar once; the caller supplies its admitted byte budget."""

    def __init__(
        self,
        *,
        state: NativeStatePort,
        authorization: ScalarAuthorizationPort,
        journal: NodeOperationJournal,
        max_result_bytes: int,
    ) -> None:
        if type(max_result_bytes) is not int or max_result_bytes <= 0:
            raise ValueError("native_call_result_budget_required")
        self._state, self._authorization, self._journal = state, authorization, journal
        self._max_result_bytes = max_result_bytes

    def _same_cursor(self, *, ref: NativeTestContextRef, intent: EffectIntent, cursor: OperationCursor) -> None:
        if self._journal.resolve_cursor(ref=ref, key=intent.key) is not cursor:
            raise BuilderExecutionPolicyError("native_journal_cursor_replaced")

    def _bounded_result(self, value: object) -> JsonValue:
        # FiniteJSON refuses iterators/generators without consuming a prefix.
        result = _JSON.validate_python(value)
        if len(canonical_json(result)) > self._max_result_bytes:
            raise BuilderExecutionPolicyError("native_call_result_too_large")
        return result

    def call(
        self,
        *,
        ref: NativeTestContextRef,
        intent: EffectIntent,
        dispatch: Callable[[DispatchPermit], JsonValue],
    ) -> JsonValue:
        try:
            ref = NativeTestContextRef.model_validate(ref.model_dump(mode="json"))
            intent = EffectIntent.model_validate(intent.model_dump(mode="json"))
            cursor = self._journal.resolve_cursor(ref=ref, key=intent.key)
            decision = cursor.before_call(intent=intent)
        except BuilderExecutionPolicyError as error:
            # A replay read failure cannot turn a recorded physical effect into
            # a new attempt. Structural journal refusals retain their reason.
            reason = error.reason_code
            if not (reason.startswith("native_journal_") or reason == "native_generation_conflict"):
                reason = "outcome_unknown"
            raise NativePolicyStop(ref=ref, reason_code=reason) from None
        except Exception:
            raise NativePolicyStop(ref=ref, reason_code="outcome_unknown") from None
        decision = NativeControlBridge.resolve(ref=ref, decision=decision)
        if isinstance(decision, RecordedResult):
            try:
                self._same_cursor(ref=ref, intent=intent, cursor=cursor)
                return self._bounded_result(cursor.recorded_result())
            except Exception:
                raise NativePolicyStop(ref=ref, reason_code="outcome_unknown") from None
        return self._execute_claimed_call(ref=ref, intent=intent, permit=decision, dispatch=dispatch, cursor=cursor)

    def _execute_claimed_call(
        self,
        *,
        ref: NativeTestContextRef,
        intent: EffectIntent,
        permit: DispatchPermit,
        dispatch: Callable[[DispatchPermit], JsonValue],
        cursor: OperationCursor,
    ) -> JsonValue:
        try:
            self._same_cursor(ref=ref, intent=intent, cursor=cursor)
            self._authorization.claim_dispatch(ref=ref, intent=intent, permit=permit)
        except BuilderExecutionPolicyError as error:
            # C02 policy refusal is known no-dispatch for this delivery. Never
            # settle another delivery's claim, especially an already-used one.
            raise NativePolicyStop(ref=ref, reason_code=error.reason_code) from None
        except BaseException:
            # A claim commit acknowledgement may be lost. No IO took place here,
            # but this owner cannot infer whether the durable claim committed.
            raise NativePolicyStop(ref=ref, reason_code="outcome_unknown") from None
        try:
            self._same_cursor(ref=ref, intent=intent, cursor=cursor)
        except Exception as error:
            # The successful claim belongs to this delivery and the callback
            # has definitely not begun. Preserve that truthful distinction.
            reason = error.reason_code if isinstance(error, BuilderExecutionPolicyError) else "outcome_unknown"
            try:
                self._authorization.record_outcome(permit=permit, outcome="not_dispatched", result_ref=None)
            except BaseException:
                reason = "outcome_unknown"
            raise NativePolicyStop(ref=ref, reason_code=reason) from None
        try:
            result = dispatch(permit)
        except BaseException:
            # Confined to the sole physical callback: even callback control or
            # process-interruption exceptions cannot imply no dispatch.
            self._unknown(ref=ref, permit=permit)
        try:
            self._same_cursor(ref=ref, intent=intent, cursor=cursor)
            result = self._bounded_result(result)
            result_ref = self._state.store_result(ref=ref, key=intent.key, result=result)
            self._same_cursor(ref=ref, intent=intent, cursor=cursor)
        except BaseException:
            self._unknown(ref=ref, permit=permit)
        try:
            receipt = self._authorization.record_outcome(permit=permit, outcome="completed", result_ref=result_ref)
            receipt = EffectReceipt.model_validate(receipt.model_dump(mode="json"))
            if (receipt.operation_id, receipt.attempt_id, receipt.outcome, receipt.result_ref) != (
                permit.operation_id,
                permit.attempt_id,
                "completed",
                result_ref,
            ):
                raise BuilderExecutionPolicyError("native_call_completion_mismatch")
            self._same_cursor(ref=ref, intent=intent, cursor=cursor)
            completed = cursor.before_call(intent=intent)
            if not isinstance(completed, RecordedResult) or (completed.operation_id, completed.result_ref) != (
                permit.operation_id,
                result_ref,
            ):
                raise BuilderExecutionPolicyError("native_call_completion_unavailable")
            self._same_cursor(ref=ref, intent=intent, cursor=cursor)
            return self._bounded_result(cursor.recorded_result())
        except BaseException:
            # Completion may already be immutable. Never overwrite with unknown,
            # retry its acknowledgement, claim again, or return partial success.
            raise NativePolicyStop(ref=ref, reason_code="outcome_unknown") from None

    def _unknown(self, *, ref: NativeTestContextRef, permit: DispatchPermit) -> NoReturn:
        try:
            self._authorization.record_outcome(permit=permit, outcome="unknown", result_ref=None)
        except BaseException:
            # This is one settlement attempt. A concurrent completed receipt or
            # lost ack stays untouched; the host must retain unknown projection.
            raise NativePolicyStop(ref=ref, reason_code="outcome_unknown") from None
        raise NativePolicyStop(ref=ref, reason_code="outcome_unknown") from None
