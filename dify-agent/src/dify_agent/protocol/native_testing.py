"""Independent native-testing v1 wire DTOs. Decoding never grants authority.

This protocol is independent of composition/snapshot v2. Executable JSON is
preserved; callers must use protected references in place of secret values.
"""

import hashlib
import json
import re
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Annotated, Literal
from uuid import UUID

if TYPE_CHECKING:
    from dify_agent.protocol.schemas import CreateRunRequest

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    JsonValue,
    TypeAdapter,
    field_validator,
    model_validator,
)


class NativeDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)


def _utf8(value: str) -> str:
    value.encode("utf-8", errors="strict")
    return value


def _finite_json(value: object) -> JsonValue:
    # Strict JSON refuses Python-only containers and coerced dictionary keys.
    validated = TypeAdapter(JsonValue).validate_python(value, strict=True)
    json.dumps(validated, allow_nan=False, ensure_ascii=False).encode("utf-8", errors="strict")
    return validated


def _utc_timestamp(value: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)", value):
        raise ValueError("expected UTC RFC3339 timestamp")
    if datetime.fromisoformat(value).utcoffset() != timedelta(0):
        raise ValueError("expected UTC timestamp")
    return value


ID = Annotated[str, Field(strict=True, min_length=1, max_length=128), AfterValidator(_utf8)]
Digest = Annotated[str, Field(strict=True, pattern=r"^[0-9a-f]{64}$")]
Counter = Annotated[int, Field(strict=True, ge=0, le=2**63 - 1)]
FiniteJSON = Annotated[JsonValue, BeforeValidator(_finite_json)]
UTCTimestamp = Annotated[str, Field(strict=True, max_length=32), AfterValidator(_utc_timestamp)]
WaitReason = Literal["approval", "configuration", "interaction"]


class AgentNativeTestRef(NativeDTO):
    policy_version: Literal["builder-native-test-v1"]
    request_id: ID
    invocation_id: ID
    context_digest: Digest


class ContinueRunRequest(NativeDTO):
    ref: AgentNativeTestRef
    expected_generation: Counter
    idempotency_key: ID


class NativeTestCapabilities(NativeDTO):
    protocol_version: int = Field(strict=True)
    features: frozenset[str]


class NativeTestProtocolUnsupported(RuntimeError):
    code = "native_test_protocol_unsupported"

    def __init__(self) -> None:
        super().__init__(self.code)


# A2 provides transport and pending state, not a qualified policy/runtime owner.
NATIVE_TEST_CAPABILITIES = NativeTestCapabilities(protocol_version=1, features=frozenset({"pending-call-v1"}))


def require_native_test_capabilities(capabilities: NativeTestCapabilities) -> None:
    required = {"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"}
    if capabilities.protocol_version != 1 or not required.issubset(capabilities.features):
        raise NativeTestProtocolUnsupported()


class AgentOperationKey(NativeDTO):
    invocation_id: ID
    occurrence_path: Annotated[tuple[ID, ...], Field(min_length=1, max_length=128)]
    cursor: Counter


class AgentEffectIntent(NativeDTO):
    key: AgentOperationKey
    kind: Literal["code", "model", "http", "tool", "oauth", "knowledge", "file", "shell", "bootstrap"]
    resource_ref: ID
    implementation_revision: ID
    account_ref: ID | None
    target: FiniteJSON
    parameters: FiniteJSON
    input_digest: Digest
    capability_digest: Digest


class AgentDispatchPermit(NativeDTO):
    kind: Literal["dispatch"] = "dispatch"
    permit_id: ID
    attempt_id: ID
    operation_id: ID
    expires_at: UTCTimestamp


class AgentApprovalWait(NativeDTO):
    kind: Literal["waiting"] = "waiting"
    pending_operation_id: ID
    wait_reason: WaitReason = "approval"


class AgentRecordedResult(NativeDTO):
    kind: Literal["recorded"] = "recorded"
    operation_id: ID
    result_ref: ID


class AgentPolicyStop(NativeDTO):
    kind: Literal["stop"] = "stop"
    reason_code: Annotated[str, Field(strict=True, pattern=r"^[a-z][a-z0-9_]{0,127}$")]


AgentEffectDecision = Annotated[
    AgentDispatchPermit | AgentApprovalWait | AgentRecordedResult | AgentPolicyStop,
    Field(discriminator="kind"),
]


class AgentEffectReceipt(NativeDTO):
    operation_id: ID
    attempt_id: ID
    outcome: Literal["completed", "failed", "unknown", "not_dispatched"]
    result_ref: ID | None


class ContinuationClaim(NativeDTO):
    run_id: ID
    generation: Counter
    idempotency_key: ID
    claim_id: ID


class AgentCheckpointRef(NativeDTO):
    checkpoint_id: ID
    payload_digest: Digest


class AgentWaitingReceipt(NativeDTO):
    request_id: ID
    invocation_id: ID
    generation: Counter
    checkpoint: AgentCheckpointRef
    pending_operation_ids: Annotated[tuple[ID, ...], Field(max_length=4096)]
    wait_reason: WaitReason


class AgentResumeReceipt(NativeDTO):
    request_id: ID
    generation: Counter
    dispatch_id: ID
    status: Literal["queued", "running", "waiting", "terminal"]


class AgentCancellationReceipt(NativeDTO):
    request_id: ID
    generation: Counter
    status: Literal["cancelling", "cancelled", "unknown"]
    operation_states: Annotated[
        dict[ID, Literal["completed", "failed", "unknown", "not_dispatched"]], Field(max_length=4096)
    ]


MAX_AGENT_CONTROL_BYTES = 4096
MAX_AGENT_CONFIG_BYTES = 1024 * 1024


class AgentParentNodeRef(NativeDTO):
    """Bound native UUID and protected typed input identity; no dispatch authority."""

    ref: AgentNativeTestRef
    execution_id: ID
    input_result_ref: ID
    input_digest: Digest

    @field_validator("execution_id")
    @classmethod
    def canonical_execution_uuid(cls, value: str) -> str:
        if str(UUID(value)) != value:
            raise ValueError("expected canonical execution UUID")
        return value


class AgentPrepareRunPayload(NativeDTO):
    parent_node: AgentParentNodeRef
    agent_run_id: ID
    request_digest: Digest


class AgentPrepareRunResponse(NativeDTO):
    config_ref: ID
    config_digest: Digest
    association_object_ref: ID


class AgentReadPreparedConfigPayload(NativeDTO):
    parent_node: AgentParentNodeRef
    config_ref: ID


class ReadAgentRuntimeIdentity(NativeDTO):
    parent_node: AgentParentNodeRef | None
    request_digest: Digest


class AgentRuntimeIdentitySeed(NativeDTO):
    execution_mode: Literal["ordinary", "builder_test"]
    parent_node: AgentParentNodeRef | None
    request_digest: Digest

    @model_validator(mode="after")
    def exact_mode_parent(self):
        if (self.execution_mode == "builder_test") != (self.parent_node is not None):
            raise ValueError("runtime identity mode and parent must agree")
        return self


class AgentRuntimeIdentity(AgentRuntimeIdentitySeed):
    run_id: ID
    agent_generation: Counter


class AgentPreparedConfigResponse(NativeDTO):
    parent_node: AgentParentNodeRef
    config_ref: ID
    config_digest: Digest
    config: FiniteJSON


def executable_request_digest(request: "CreateRunRequest") -> str:
    """Only executable config and state; mode/ref/parent are separately exact owned."""
    value = request.model_dump(mode="json", include={"composition", "session_snapshot"})
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()
