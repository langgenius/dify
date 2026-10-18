"""Ordinary confirmed Agent runs using the existing API authority and SDK history.

Configuration and results stay with their immutable API owners. Redis checkpoints
carry references and SDK call history, never credentials or client decisions.
This owner makes no test-scope or hidden child-continuation isolation claim.
"""

from dataclasses import dataclass
from typing import cast

from pydantic import JsonValue
from pydantic_ai import DeferredToolResults, ToolApproved
from pydantic_ai.messages import ToolCallPart

from dify_agent.adapters.native_testing.client import HttpAgentPolicyClient
from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient, current_runtime_identity
from dify_agent.protocol.native_testing import (
    AgentApprovalWait,
    AgentNativeTestRef,
    AgentOperationKey,
    AgentPolicyStop,
    AgentPrepareIntentPayload,
    AgentPrepareRunPayload,
    AgentReadPreparedConfigPayload,
    AgentReadResultPayload,
    AgentStoreResultPayload,
    NativeTestCapabilities,
    executable_request_digest,
)
from dify_agent.protocol.schemas import CreateRunRequest
from dify_agent.runtime.native_continuation import (
    AgentCheckpoint,
    NativeContinuation,
    NativeContinuationConflict,
    NativePolicyStopped,
    PreparedContinuation,
)
from dify_agent.runtime.native_effects import (
    NativeEffectDispatcher,
    NativeEffectSession,
    NativeEffectsCapability,
    canonical_effect_json,
)


@dataclass
class _APIResultStore:
    client: HttpAgentPolicyClient
    ref: AgentNativeTestRef

    async def store(self, *, ref: AgentNativeTestRef, key: AgentOperationKey, result: JsonValue) -> str:
        if ref != self.ref or key.invocation_id != self.ref.invocation_id:
            raise NativePolicyStopped("native_effect_owner_mismatch")
        return await self.client.store_result(payload=AgentStoreResultPayload(ref=ref, key=key, result=result))

    async def load(self, result_ref: str) -> JsonValue:
        return await self.client.read_result(payload=AgentReadResultPayload(ref=self.ref, result_ref=result_ref))


class ConfirmedNativeContinuationOwner:
    """Concrete owner for the explicit confirmed profile, with no legacy fallback."""

    capabilities = NativeTestCapabilities(protocol_version=1, features={"pending-call-v1", "policy-gate-v1"})
    profile = "confirmed"

    def __init__(self, *, http_client: AgentRuntimeHTTPClient, base_url: str):
        if not isinstance(http_client, AgentRuntimeHTTPClient):
            raise NativePolicyStopped("native_run_bound_transport_required")
        self.http_client = http_client
        self.base_url = base_url

    def _client(self, ref: AgentNativeTestRef) -> HttpAgentPolicyClient:
        identity = current_runtime_identity()
        if identity.execution_mode != "builder_test" or identity.parent_node is None or identity.parent_node.ref != ref:
            raise NativePolicyStopped("native_effect_owner_mismatch")
        return HttpAgentPolicyClient(base_url=self.base_url, api_key="", http_client=self.http_client, ref=ref)

    def _continuation(
        self, *, run_id: str, ref: AgentNativeTestRef, config_ref: str, config_digest: str
    ) -> NativeContinuation:
        continuation = NativeContinuation(
            run_id=run_id,
            ref=ref,
            generation=0,
            config_ref=config_ref,
            config_digest=config_digest,
            native_test_profile="confirmed",
        )
        client = self._client(ref)
        parent = current_runtime_identity().parent_node
        if parent is None:
            raise NativePolicyStopped("native_effect_owner_mismatch")
        continuation.parent_execution_id = parent.execution_id

        async def prepare_intent(**kwargs):
            return await client.prepare_intent(payload=AgentPrepareIntentPayload(**kwargs))

        session = NativeEffectSession(
            continuation=continuation,
            dispatcher=NativeEffectDispatcher(policy=client),
            result_store=_APIResultStore(client, ref),
            prepare_intent=prepare_intent,
        )
        continuation.capabilities.append(NativeEffectsCapability(session))
        return continuation

    async def prepare(self, *, run_id: str, request: CreateRunRequest) -> NativeContinuation:
        if (
            request.native_test_profile != "confirmed"
            or request.native_parent_node is None
            or request.native_test_ref is None
        ):
            raise NativePolicyStopped("native_confirmed_profile_required")
        identity = current_runtime_identity()
        digest = executable_request_digest(request)
        if (
            identity.run_id != run_id
            or identity.parent_node != request.native_parent_node
            or identity.request_digest != digest
        ):
            raise NativePolicyStopped("native_effect_owner_mismatch")
        response = await self._client(request.native_test_ref).prepare_run(
            payload=AgentPrepareRunPayload(
                parent_node=request.native_parent_node, agent_run_id=run_id, request_digest=digest
            )
        )
        continuation = self._continuation(
            run_id=run_id,
            ref=request.native_test_ref,
            config_ref=response.config_ref,
            config_digest=response.config_digest,
        )
        continuation.create_idempotency_key = request.idempotency_key
        return continuation

    async def restore(self, *, checkpoint: AgentCheckpoint) -> PreparedContinuation:
        identity = current_runtime_identity()
        if (
            checkpoint.native_test_profile != "confirmed"
            or identity.run_id != checkpoint.run_id
            or identity.parent_node is None
            or identity.request_digest != checkpoint.config_digest
            or identity.agent_generation != checkpoint.generation
        ):
            raise NativeContinuationConflict("confirmed checkpoint owner mismatch")
        client = self._client(checkpoint.ref)
        saved = await client.read_prepared_config(
            payload=AgentReadPreparedConfigPayload(parent_node=identity.parent_node, config_ref=checkpoint.config_ref)
        )
        if saved.config_digest != checkpoint.config_digest or not isinstance(saved.config, dict):
            raise NativeContinuationConflict("immutable configuration changed")
        request = CreateRunRequest.model_validate(
            {
                **saved.config,
                "idempotency_key": checkpoint.create_idempotency_key,
                "execution_mode": "builder_test",
                "native_test_profile": "confirmed",
                "native_test_ref": checkpoint.ref,
                "native_parent_node": identity.parent_node,
                "native_test_protocol_version": 1,
            }
        )
        request = request.model_copy(update={"session_snapshot": checkpoint.session_snapshot})
        continuation = self._continuation(
            run_id=checkpoint.run_id,
            ref=checkpoint.ref,
            config_ref=checkpoint.config_ref,
            config_digest=checkpoint.config_digest,
        )
        continuation.generation = checkpoint.generation
        continuation.create_idempotency_key = checkpoint.create_idempotency_key
        continuation.history = checkpoint.history
        continuation.session_snapshot = checkpoint.session_snapshot
        continuation.operation_cursor = checkpoint.operation_cursor
        continuation.result_refs = dict(checkpoint.result_refs)
        continuation.job_refs = checkpoint.job_refs
        session = cast(NativeEffectsCapability, continuation.capabilities[0]).session
        results = DeferredToolResults() if checkpoint.stage == "tool" else None
        for pending in checkpoint.pending_calls:
            if checkpoint.stage == "tool":
                matches = [
                    part
                    for message in checkpoint.history
                    for part in message.parts
                    if isinstance(part, ToolCallPart) and part.tool_call_id == pending.call_id
                ]
                if (
                    len(matches) != 1
                    or matches[0].tool_name != pending.tool_name
                    or canonical_effect_json(matches[0].args_as_dict())
                    != canonical_effect_json(pending.native_arguments)
                ):
                    raise NativePolicyStopped("native_effect_arguments_changed")
            decision = await client.before_call(ref=checkpoint.ref, intent=pending.intent)
            if isinstance(decision, AgentPolicyStop):
                raise NativePolicyStopped(decision.reason_code)
            if isinstance(decision, AgentApprovalWait):
                raise NativeContinuationConflict("native decision is still waiting")
            if results is not None:
                if pending.deferred_kind != "approval":
                    raise NativePolicyStopped("native_external_continuation_unsupported")
                session.restored_calls[pending.call_id] = (pending, decision)
                results.approvals[pending.call_id] = ToolApproved()
        return PreparedContinuation(request=request, continuation=continuation, deferred_tool_results=results)
