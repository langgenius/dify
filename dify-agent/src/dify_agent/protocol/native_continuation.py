"""Private data-only checkpoint readback. Parsing grants no execution authority.

The actual store selects a checkpoint and its ACKed Redis event atomically.
Neither this DTO nor a public waiting event proves physical cleanup, C02 approval,
terminal completion, or an outer Workflow checkpoint acknowledgement.
"""

import re
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, Field, JsonValue, TypeAdapter, model_validator
from pydantic_ai.messages import ModelMessage

from dify_agent.protocol.native_testing import (
    AgentApprovalWait,
    AgentEffectIntent,
    AgentNativeTestRef,
    Counter,
    Digest,
    ID,
    NativeDTO,
    WaitReason,
)
from dify_agent.protocol.schemas import RunWaitingEvent, RunWaitingEventData
from dify_agent.protocol.snapshot import SessionSnapshot

MAX_CHECKPOINT_BYTES = 2**20
MAX_CHECKPOINT_EVENT_BYTES = 2**20
MAX_CHECKPOINT_RECORD_BYTES = 2**21 + 16384
MAX_CHECKPOINT_REQUEST_BYTES = 4096
MAX_CHECKPOINT_RESPONSE_BYTES = 2**21

Stage = Literal["model", "tool", "eager", "configuration", "bootstrap", "shell", "interaction"]


class AgentPendingCall(NativeDTO):
    call_id: ID
    tool_name: ID
    native_arguments: JsonValue = None
    deferred_kind: Literal["approval", "external"] = "approval"
    intent: AgentEffectIntent
    stage: Stage
    pending_operation_id: ID
    wait_reason: WaitReason


class AgentCheckpoint(NativeDTO):
    protocol_version: Literal[1] = 1
    run_id: ID
    generation: Counter
    ref: AgentNativeTestRef
    stage: Stage
    pending_calls: tuple[AgentPendingCall, ...] = Field(min_length=1, max_length=4096)
    history: list[ModelMessage]
    operation_cursor: Counter
    result_refs: dict[str, str]
    job_refs: tuple[str, ...]
    config_digest: Digest
    config_ref: ID
    session_snapshot: SessionSnapshot

    @model_validator(mode="after")
    def validate_ownership(self):
        ids = [call.call_id for call in self.pending_calls]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate pending call identity")
        if any(call.intent.key.invocation_id != self.ref.invocation_id for call in self.pending_calls):
            raise ValueError("pending call belongs to another invocation")
        return self

    def waiting_event(self) -> RunWaitingEvent:
        return RunWaitingEvent(
            run_id=self.run_id,
            data=RunWaitingEventData(
                generation=self.generation,
                pending_actions=tuple(
                    AgentApprovalWait(pending_operation_id=p.pending_operation_id, wait_reason=p.wait_reason)
                    for p in self.pending_calls
                ),
            ),
        )


def _redis_stream_id(value: str) -> str:
    if not re.fullmatch(r"(?:0|[1-9][0-9]{0,19})-(?:0|[1-9][0-9]{0,19})", value):
        raise ValueError("invalid Redis stream ID")
    pieces = tuple(int(part) for part in value.split("-"))
    if pieces == (0, 0) or any(part > 2**64 - 1 for part in pieces):
        raise ValueError("invalid Redis stream ID")
    return value


RedisStreamID = Annotated[str, Field(strict=True, max_length=41), AfterValidator(_redis_stream_id)]


class ReadNativeCheckpointRequest(NativeDTO):
    ref: AgentNativeTestRef
    expected_generation: Counter
    waiting_event_id: RedisStreamID
    config_ref: ID
    config_digest: Digest


class SelectedNativeCheckpoint(NativeDTO):
    checkpoint: AgentCheckpoint
    waiting_event: RunWaitingEvent

    @model_validator(mode="after")
    def validate_selected_event(self) -> Self:
        TypeAdapter(RedisStreamID).validate_python(self.waiting_event.id)
        if (
            self.waiting_event.run_id != self.checkpoint.run_id
            or self.waiting_event.data != self.checkpoint.waiting_event().data
        ):
            raise ValueError("checkpoint event mismatch")
        return self

    def validate_selection(self, *, run_id: str, request: ReadNativeCheckpointRequest) -> None:
        cp = self.checkpoint
        if (cp.run_id, cp.ref, cp.generation, cp.config_ref, cp.config_digest, self.waiting_event.id) != (
            run_id,
            request.ref,
            request.expected_generation,
            request.config_ref,
            request.config_digest,
            request.waiting_event_id,
        ):
            raise ValueError("checkpoint selection mismatch")
