"""Protected native continuation state and the API-owned authority seam.

No request/configuration or credential snapshot is stored here. The immutable
configuration reference is resolved by an installed server owner; parsing wire
DTOs and constructing native ToolApproved values never authorizes an effect.
"""

from dataclasses import dataclass, field
from typing import Literal, Protocol

from pydantic import Field, JsonValue, TypeAdapter, ValidationError, model_validator
from pydantic_ai import ApprovalRequired, CallDeferred, DeferredToolRequests, DeferredToolResults, ToolApproved
from pydantic_ai.messages import ModelMessage
from pydantic_ai.capabilities import AbstractCapability

from dify_agent.protocol.native_testing import (
    AgentApprovalWait,
    AgentEffectIntent,
    AgentNativeTestRef,
    AgentOperationKey,
    Counter,
    ID,
    Digest,
    FiniteJSON,
    NativeDTO,
    NativeTestCapabilities,
    WaitReason,
)
from dify_agent.protocol.schemas import CreateRunRequest, RunWaitingEvent, RunWaitingEventData
from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.runtime.context import Deps
from dify_agent.layers.history import persistent_messages

Stage = Literal["model", "tool", "eager", "configuration", "bootstrap", "shell", "interaction"]


class NativeContinuationConflict(RuntimeError):
    """Generation, owner or cancellation no longer permits this continuation."""


class NativePolicyStopped(RuntimeError):
    """Control-plane denial, never retryable text returned to the model."""

    def __init__(self, reason_code: str):
        self.reason_code = reason_code
        super().__init__(reason_code)


class AgentPendingCall(NativeDTO):
    call_id: ID
    tool_name: ID
    native_arguments: JsonValue = None
    deferred_kind: Literal["approval", "external"] = "approval"
    intent: AgentEffectIntent
    stage: Stage
    pending_operation_id: ID
    wait_reason: WaitReason


class NativeApprovalSuspended(Exception):
    def __init__(self, pending: AgentPendingCall):
        self.pending = pending
        self.pending_operation_id = pending.pending_operation_id
        self.wait_reason = pending.wait_reason
        super().__init__(pending.pending_operation_id)


def defer_native_call(pending: AgentPendingCall) -> None:
    """Use only at the pre-tool native capability boundary, before any effect."""
    if pending.stage != "tool":
        raise NativeApprovalSuspended(pending)
    metadata = {"native_pending_call": pending.model_dump(mode="json")}
    if pending.deferred_kind == "external":
        raise CallDeferred(metadata=metadata)
    raise ApprovalRequired(metadata=metadata)


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


class NativeRunResult(Protocol):
    output: object

    def all_messages(self) -> list[ModelMessage]: ...


@dataclass
class NativeContinuation:
    run_id: str
    ref: AgentNativeTestRef
    generation: int
    config_ref: str
    config_digest: str
    capabilities: list[AbstractCapability[Deps]] = field(default_factory=list, repr=False)
    operation_cursor: int = 0
    result_refs: dict[str, str] = field(default_factory=dict)
    job_refs: tuple[str, ...] = ()
    history: list[ModelMessage] = field(default_factory=list)
    session_snapshot: SessionSnapshot = field(default_factory=lambda: SessionSnapshot(layers={}))

    def capture(self, *, result: NativeRunResult, deps: Deps) -> AgentCheckpoint:
        if not isinstance(result.output, DeferredToolRequests):
            raise NativeContinuationConflict("run did not defer")
        pending = []
        approval_ids = {call.tool_call_id for call in result.output.approvals}
        for call in result.output.approvals + result.output.calls:
            metadata = result.output.metadata.get(call.tool_call_id, {})
            item = AgentPendingCall.model_validate(metadata.get("native_pending_call"))
            if item.call_id != call.tool_call_id or item.tool_name != call.tool_name:
                raise NativeContinuationConflict("native call identity or arguments changed")
            pending.append(
                item.model_copy(
                    update={
                        "native_arguments": call.args_as_dict(),
                        "deferred_kind": "approval" if call.tool_call_id in approval_ids else "external",
                    }
                )
            )
        self.history = persistent_messages(result.all_messages())
        self.session_snapshot = SessionSnapshot(layers={name: entry["state"] for name, entry in deps.layers.items()})
        return self._checkpoint(tuple(pending), "tool")

    def capture_wait(self, wait: NativeApprovalSuspended) -> AgentCheckpoint:
        return self._checkpoint((wait.pending,), wait.pending.stage)

    def _checkpoint(self, calls: tuple[AgentPendingCall, ...], stage: Stage) -> AgentCheckpoint:
        return AgentCheckpoint(
            run_id=self.run_id,
            generation=self.generation,
            ref=self.ref,
            stage=stage,
            pending_calls=calls,
            history=self.history,
            operation_cursor=self.operation_cursor,
            result_refs=self.result_refs,
            job_refs=self.job_refs,
            config_digest=self.config_digest,
            config_ref=self.config_ref,
            session_snapshot=self.session_snapshot,
        )


def validate_deferred_results(checkpoint: AgentCheckpoint, results: DeferredToolResults) -> None:
    """Reject denial, altered arguments and partial/foreign continuation inputs.

    This is a framework-input check; the installed API owner must revalidate all
    decisions first. Denial terminates the invocation tree through that owner.
    """
    approvals = {call.call_id for call in checkpoint.pending_calls if call.deferred_kind == "approval"}
    external = {call.call_id for call in checkpoint.pending_calls if call.deferred_kind == "external"}
    if set(results.approvals) != approvals or set(results.calls) != external:
        raise NativePolicyStopped("invalid_native_continuation")
    for approval in results.approvals.values():
        if not isinstance(approval, ToolApproved) or approval.override_args is not None:
            raise NativePolicyStopped("native_approval_denied_or_changed")
    for value in results.calls.values():
        try:
            TypeAdapter(FiniteJSON).validate_python(value)
        except (ValidationError, ValueError, TypeError):
            raise NativePolicyStopped("invalid_native_external_result") from None


@dataclass
class PreparedContinuation:
    request: CreateRunRequest
    continuation: NativeContinuation
    deferred_tool_results: DeferredToolResults | None = None


class NativeContinuationOwner(Protocol):
    """Installed A3/A5 owner; absent owner means native tests are unavailable.

    prepare stores bounded current request/config under a protected immutable
    server reference. restore reloads and verifies it against config_digest and
    ref, resolves durable pending actions through the shared API owner, and only
    then constructs framework results. No client decision is accepted.
    """

    capabilities: NativeTestCapabilities

    async def prepare(self, *, run_id: str, request: CreateRunRequest) -> NativeContinuation: ...
    async def restore(self, *, checkpoint: AgentCheckpoint) -> PreparedContinuation: ...


class AgentResultStore(Protocol):
    """Protected bounded payload owner scoped at construction to the invocation."""

    async def store(self, *, ref: AgentNativeTestRef, key: AgentOperationKey, result: JsonValue) -> str: ...
    async def load(self, result_ref: str) -> JsonValue: ...
