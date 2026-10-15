"""Actual invocation gates; API authority and durable results stay with their owners.

Tool deferral belongs to the installed SDK pre-execution capability. Stage
boundaries raise structured control before I/O. No approval flag from the model
or SDK is treated as authority, and transport errors are never retried here.
"""

import json
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, override

from dify_agent.protocol.native_testing import (
    AgentApprovalWait,
    AgentDispatchPermit,
    AgentEffectDecision,
    AgentEffectIntent,
    AgentEffectReceipt,
    AgentNativeTestRef,
    AgentOperationKey,
    AgentPolicyStop,
    AgentRecordedResult,
    FiniteJSON,
)
from dify_agent.runtime.context import Deps
from dify_agent.runtime.native_continuation import (
    AgentPendingCall,
    AgentResultStore,
    NativeApprovalSuspended,
    NativeContinuation,
    NativePolicyStopped,
    Stage,
    defer_native_call,
)
from pydantic import JsonValue, TypeAdapter
from pydantic_ai import RunContext
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.capabilities.abstract import CapabilityOrdering
from pydantic_ai.messages import ToolCallPart
from pydantic_ai.tools import ToolDefinition


def canonical_effect_json(value: JsonValue) -> bytes:
    """Match the intent digest's finite, sorted, compact UTF-8 JSON contract."""
    value = TypeAdapter(FiniteJSON).validate_python(value)
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


class AgentPolicyClient(Protocol):
    async def before_call(self, *, ref: AgentNativeTestRef, intent: AgentEffectIntent) -> AgentEffectDecision: ...
    async def record_outcome(
        self,
        *,
        permit: AgentDispatchPermit,
        outcome: Literal["completed", "failed", "unknown", "not_dispatched"],
        result_ref: str | None,
    ) -> AgentEffectReceipt: ...


class NativeEffectDispatcher:
    def __init__(self, *, policy: AgentPolicyClient):
        self.policy = policy

    async def decide(
        self, *, ref: AgentNativeTestRef, intent: AgentEffectIntent, call_id: str, tool_name: str, stage: Stage
    ) -> AgentDispatchPermit | AgentRecordedResult:
        if intent.key.invocation_id != ref.invocation_id:
            raise NativePolicyStopped("native_effect_owner_mismatch")
        decision = await self.policy.before_call(ref=ref, intent=intent)
        if isinstance(decision, AgentApprovalWait):
            raise NativeApprovalSuspended(
                AgentPendingCall(
                    call_id=call_id,
                    tool_name=tool_name,
                    intent=intent,
                    stage=stage,
                    pending_operation_id=decision.pending_operation_id,
                    wait_reason=decision.wait_reason,
                )
            )
        if isinstance(decision, AgentPolicyStop):
            raise NativePolicyStopped(decision.reason_code)
        return decision

    async def dispatch(
        self,
        *,
        ref: AgentNativeTestRef,
        intent: AgentEffectIntent,
        invoke: Callable[[AgentDispatchPermit], Awaitable[JsonValue]],
        result_store: AgentResultStore,
        call_id: str,
        tool_name: str,
        stage: Stage,
    ) -> JsonValue:
        decision = await self.decide(ref=ref, intent=intent, call_id=call_id, tool_name=tool_name, stage=stage)
        if isinstance(decision, AgentRecordedResult):
            return await result_store.load(decision.result_ref)
        return await self.invoke_permitted(
            ref=ref, permit=decision, intent=intent, invoke=invoke, result_store=result_store
        )

    async def invoke_permitted(
        self,
        *,
        ref: AgentNativeTestRef,
        permit: AgentDispatchPermit,
        intent: AgentEffectIntent,
        invoke: Callable[[AgentDispatchPermit], Awaitable[JsonValue]],
        result_store: AgentResultStore,
    ) -> JsonValue:
        try:
            result = await invoke(permit)
            result_ref = await result_store.store(ref=ref, key=intent.key, result=result)
        except BaseException:
            # Once an invocation starts, cancellation or a lost response cannot prove
            # that it did not happen. Recording unknown also closes replay admission.
            await self.policy.record_outcome(permit=permit, outcome="unknown", result_ref=None)
            raise
        await self.policy.record_outcome(permit=permit, outcome="completed", result_ref=result_ref)
        return result


def opaque_invocation_disclosure(*, kind: str, target: str, capability_scope: str) -> dict[str, str]:
    """Private disclosure metadata; executable arguments stay in protected state."""
    return {
        "kind": kind,
        "target": target,
        "authorization_granularity": "single_bounded_invocation",
        "internal_effects": "opaque",
        "capability_scope": capability_scope,
    }


class IntentPreparer(Protocol):
    """Trusted composition resolves current identity/readiness without execution.

    The returned intent must retain the full final target/parameters. Missing
    configuration is handled by its owner before reserving an account effect.
    """

    async def __call__(
        self,
        *,
        ref: AgentNativeTestRef,
        key: AgentOperationKey,
        boundary: str,
        target: JsonValue,
        parameters: JsonValue,
    ) -> AgentEffectIntent: ...


class ShellLineageValidator(Protocol):
    """A4 authenticates durable shell scope/jobs before reserving any operation."""

    async def __call__(
        self, *, ref: AgentNativeTestRef, boundary: str, target: JsonValue, parameters: JsonValue
    ) -> None: ...


@dataclass(frozen=True)
class NativeToolBoundary:
    boundary: str
    target: JsonValue | Callable[[dict[str, Any]], JsonValue]
    prepare_arguments: Callable[[dict[str, Any]], Awaitable[JsonValue]]


@dataclass(frozen=True)
class NativeDispatchEnvelope:
    ref: AgentNativeTestRef
    intent: AgentEffectIntent
    permit: AgentDispatchPermit

    def wire(self) -> dict[str, JsonValue]:
        return {
            "ref": self.ref.model_dump(mode="json"),
            "intent": self.intent.model_dump(mode="json"),
            "permit": self.permit.model_dump(mode="json"),
        }


_dispatch: ContextVar[NativeDispatchEnvelope | None] = ContextVar("native_agent_dispatch", default=None)


def current_native_dispatch() -> NativeDispatchEnvelope | None:
    return _dispatch.get()


@dataclass
class NativeEffectSession:
    continuation: NativeContinuation
    dispatcher: NativeEffectDispatcher
    result_store: AgentResultStore
    prepare_intent: IntentPreparer
    validate_shell_lineage: ShellLineageValidator | None = None
    _prepared: dict[str, tuple[AgentEffectIntent, AgentDispatchPermit | AgentRecordedResult]] = field(
        default_factory=dict, repr=False
    )

    async def intent(
        self, *, boundary: str, call_id: str, target: JsonValue, parameters: JsonValue
    ) -> AgentEffectIntent:
        target = TypeAdapter(FiniteJSON).validate_python(target)
        parameters = TypeAdapter(FiniteJSON).validate_python(parameters)
        if boundary in {
            "shell_run",
            "shell_wait",
            "shell_input",
            "shell_interrupt",
            "bootstrap",
            "config_pull",
            "file_upload",
        }:
            if self.validate_shell_lineage is None:
                raise NativePolicyStopped("native_shell_lineage_unavailable")
            await self.validate_shell_lineage(
                ref=self.continuation.ref, boundary=boundary, target=target, parameters=parameters
            )
        key = AgentOperationKey(
            invocation_id=self.continuation.ref.invocation_id, occurrence_path=(boundary, call_id), cursor=0
        )
        intent = await self.prepare_intent(
            ref=self.continuation.ref, key=key, boundary=boundary, target=target, parameters=parameters
        )
        if (
            intent.key != key
            or canonical_effect_json(intent.target) != canonical_effect_json(target)
            or canonical_effect_json(intent.parameters) != canonical_effect_json(parameters)
        ):
            raise NativePolicyStopped("native_effect_arguments_changed")
        return intent

    async def stage(
        self,
        *,
        boundary: str,
        call_id: str,
        target: JsonValue,
        parameters: JsonValue,
        stage: Stage,
        invoke: Callable[[AgentDispatchPermit], Awaitable[JsonValue]],
    ) -> JsonValue:
        intent = await self.intent(boundary=boundary, call_id=call_id, target=target, parameters=parameters)

        async def invoke_bound(permit: AgentDispatchPermit) -> JsonValue:
            token = _dispatch.set(NativeDispatchEnvelope(self.continuation.ref, intent, permit))
            try:
                return await invoke(permit)
            finally:
                _dispatch.reset(token)

        return await self.dispatcher.dispatch(
            ref=self.continuation.ref,
            intent=intent,
            invoke=invoke_bound,
            result_store=self.result_store,
            call_id=call_id,
            tool_name=boundary,
            stage=stage,
        )


class NativeEffectsCapability(AbstractCapability[Deps]):
    """SDK-owned pre-tool deferral and execution around the original handler."""

    def __init__(self, session: NativeEffectSession):
        self.session = session
        self.id = "native_effects"

    @override
    def get_ordering(self) -> CapabilityOrdering:
        return CapabilityOrdering(position="outermost")

    @override
    async def wrap_run(self, ctx: RunContext[Deps], *, handler):
        if ctx.deps.native_effects is not None and ctx.deps.native_effects is not self.session:
            raise NativePolicyStopped("native_effect_owner_mismatch")
        ctx.deps.native_effects = self.session
        return await handler()

    @override
    async def before_tool_execute(self, ctx: RunContext[Deps], *, call: ToolCallPart, tool_def: ToolDefinition, args):
        if tool_def.kind == "output":
            return args
        boundary = (tool_def.metadata or {}).get("native_effect")
        if not isinstance(boundary, NativeToolBoundary) or not isinstance(args, dict):
            raise NativePolicyStopped("native_tool_boundary_unavailable")
        parameters = await boundary.prepare_arguments(args)
        target = boundary.target(args) if callable(boundary.target) else boundary.target
        intent = await self.session.intent(
            boundary=boundary.boundary, call_id=call.tool_call_id, target=target, parameters=parameters
        )
        try:
            decision = await self.session.dispatcher.decide(
                ref=self.session.continuation.ref,
                intent=intent,
                call_id=call.tool_call_id,
                tool_name=call.tool_name,
                stage="tool",
            )
        except NativeApprovalSuspended as wait:
            defer_native_call(wait.pending)
            raise AssertionError("native deferral returned")
        self.session._prepared[call.tool_call_id] = (intent, decision)
        return args

    @override
    async def wrap_tool_execute(
        self, ctx: RunContext[Deps], *, call: ToolCallPart, tool_def: ToolDefinition, args, handler
    ):
        if tool_def.kind == "output":
            return await handler(args)
        prepared = self.session._prepared.pop(call.tool_call_id, None)
        if prepared is None:
            raise NativePolicyStopped("native_tool_permit_missing")
        intent, decision = prepared
        if isinstance(decision, AgentRecordedResult):
            return await self.session.result_store.load(decision.result_ref)

        async def invoke(permit):
            token = _dispatch.set(NativeDispatchEnvelope(self.session.continuation.ref, intent, permit))
            try:
                return TypeAdapter(JsonValue).validate_python(
                    TypeAdapter(Any).dump_python(await handler(args), mode="json")
                )
            finally:
                _dispatch.reset(token)

        return await self.session.dispatcher.invoke_permitted(
            ref=self.session.continuation.ref,
            permit=decision,
            intent=intent,
            invoke=invoke,
            result_store=self.session.result_store,
        )
