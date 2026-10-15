"""Shared native test protocol; decoding a reference never grants authority.

Only the server-side context loader can resolve a reference to trusted scope.
These DTOs contain references, typed business JSON and outcome projections;
credentials and client-declared grants are not part of this protocol.
"""

import re
from datetime import datetime, timedelta
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    JsonValue,
    TypeAdapter,
    ValidationError,
)

from services.dify_builder.execution_contracts import (
    BoundedID,
    BuilderExecutionPolicyError,
    Digest,
    ReasonCode,
    canonical_digest,
    canonical_json,
)


def _utf8(value: str) -> str:
    canonical_json(value)
    return value


ID = Annotated[BoundedID, AfterValidator(_utf8)]
Counter = Annotated[int, Field(strict=True, ge=0, le=2**63 - 1)]
_JSON = TypeAdapter(JsonValue)


def _finite_json(value: object) -> JsonValue:
    # Reuse the canonical owner for finite numbers and UTF-8; strict JSON
    # validation additionally refuses Python-only containers and coerced keys.
    canonical_json(value)
    return _JSON.validate_python(value, strict=True)


FiniteJSON = Annotated[JsonValue, BeforeValidator(_finite_json)]
Outcome = Literal["completed", "failed", "unknown", "not_dispatched"]
WaitReason = Literal["approval", "configuration", "interaction"]


def _utc_timestamp(value: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)", value):
        raise ValueError("expected UTC RFC3339 timestamp")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError("invalid UTC timestamp") from None
    if parsed.utcoffset() != timedelta(0):
        raise ValueError("expected UTC timestamp")
    return value


UTCTimestamp = Annotated[str, Field(strict=True, max_length=32), AfterValidator(_utc_timestamp)]


class FrozenDTO(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", hide_input_in_errors=True)


class NativeTestContextRef(FrozenDTO):
    """Untrusted structural reference until resolved by the server-side loader."""

    policy_version: Literal["builder-native-test-v1"] = "builder-native-test-v1"
    request_id: ID
    invocation_id: ID
    context_digest: Digest


class OperationKey(FrozenDTO):
    """Durable logical occurrence, independent of worker or dispatch retries."""

    invocation_id: ID
    occurrence_path: Annotated[tuple[ID, ...], Field(min_length=1, max_length=128)]
    cursor: Counter


class EffectIntent(FrozenDTO):
    key: OperationKey
    kind: Literal["code", "model", "http", "tool", "oauth", "knowledge", "file", "shell", "bootstrap"]
    resource_ref: ID
    implementation_revision: ID
    account_ref: ID | None
    target: FiniteJSON
    parameters: FiniteJSON
    input_digest: Digest
    capability_digest: Digest


class DispatchPermit(FrozenDTO):
    kind: Literal["dispatch"] = "dispatch"
    permit_id: ID
    attempt_id: ID
    operation_id: ID
    expires_at: UTCTimestamp


class ApprovalWait(FrozenDTO):
    kind: Literal["waiting"] = "waiting"
    pending_operation_id: ID
    wait_reason: WaitReason = "approval"


class RecordedResult(FrozenDTO):
    kind: Literal["recorded"] = "recorded"
    operation_id: ID
    result_ref: ID


class PolicyStop(FrozenDTO):
    kind: Literal["stop"] = "stop"
    reason_code: ReasonCode


EffectDecision = Annotated[DispatchPermit | ApprovalWait | RecordedResult | PolicyStop, Field(discriminator="kind")]


class EffectReceipt(FrozenDTO):
    operation_id: ID
    attempt_id: ID
    outcome: Outcome
    result_ref: ID | None


class CheckpointRef(FrozenDTO):
    checkpoint_id: ID
    payload_digest: Digest


class WaitingReceipt(FrozenDTO):
    request_id: ID
    invocation_id: ID
    generation: Counter
    checkpoint: CheckpointRef
    pending_operation_ids: Annotated[tuple[ID, ...], Field(max_length=4096)]
    wait_reason: WaitReason


class ResumeReceipt(FrozenDTO):
    request_id: ID
    generation: Counter
    dispatch_id: ID
    status: Literal["queued", "running", "waiting", "terminal"]


class CancellationReceipt(FrozenDTO):
    request_id: ID
    generation: Counter
    status: Literal["cancelling", "cancelled", "unknown"]
    # Public outcome projection, never private queued/claimed ledger states.
    operation_states: Annotated[dict[ID, Outcome], Field(max_length=4096)]


def operation_digest(key: OperationKey) -> str:
    """Canonical identity shared by durable claims and all execution adapters."""
    return canonical_digest(key.model_dump(mode="json"))


def decode_native_ref(raw: JsonValue) -> NativeTestContextRef:
    """Validate structure only; accepted JSON cannot authorize execution."""
    try:
        return NativeTestContextRef.model_validate(raw)
    except (ValidationError, ValueError, TypeError, UnicodeError):
        raise BuilderExecutionPolicyError("invalid_native_test_ref") from None
