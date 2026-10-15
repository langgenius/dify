"""Authenticated policy transport. Wire parsing never grants execution authority."""

from dataclasses import dataclass, field
from typing import Literal

import httpx
from pydantic import Field, JsonValue, TypeAdapter

from dify_agent.protocol.native_testing import (
    ID,
    AgentDispatchPermit,
    AgentEffectDecision,
    AgentEffectIntent,
    AgentEffectReceipt,
    AgentNativeTestRef,
    NativeDTO,
)


class AgentBeforeCallPayload(NativeDTO):
    ref: AgentNativeTestRef
    intent: AgentEffectIntent


class AgentPhysicalDispatchPayload(AgentBeforeCallPayload):
    permit: AgentDispatchPermit


class AgentOutcomePayload(NativeDTO):
    ref: AgentNativeTestRef
    permit: AgentDispatchPermit
    outcome: Literal["completed", "failed", "unknown", "not_dispatched"]
    result_ref: ID | None


class AgentMaterializePayload(NativeDTO):
    ref: AgentNativeTestRef
    intent: AgentEffectIntent
    permit: AgentDispatchPermit
    tool_ref: ID
    phase: Literal["refresh", "business"]


class AgentMaterialization(NativeDTO):
    """Operation-local transport data; never persist in history or evidence."""

    credential_type: Literal["api-key", "oauth2", "unauthorized"]
    credentials: dict[str, str | int | float | bool | None] = Field(repr=False)
    runtime_parameters: dict[str, JsonValue] = Field(repr=False)


class AgentPolicyTransportUnavailable(RuntimeError):
    """A control transport failure cannot become retryable tool/model text."""


@dataclass
class HttpAgentPolicyClient:
    base_url: str
    api_key: str = field(repr=False)
    http_client: httpx.AsyncClient = field(repr=False)
    # Bound by trusted composition; outcome must retain the original owner ref.
    ref: AgentNativeTestRef | None = None

    async def _post(self, path: str, payload: NativeDTO):
        try:
            response = await self.http_client.post(
                f"{self.base_url.rstrip('/')}/inner/api/agent/native-testing/{path}",
                headers={"X-Inner-Api-Key": self.api_key},
                json=payload.model_dump(mode="json"),
            )
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise AgentPolicyTransportUnavailable("native_policy_transport_unavailable") from None

    async def before_call(self, *, ref: AgentNativeTestRef, intent: AgentEffectIntent) -> AgentEffectDecision:
        if self.ref is not None and self.ref != ref:
            raise AgentPolicyTransportUnavailable("native_policy_owner_mismatch")
        self.ref = ref
        return TypeAdapter(AgentEffectDecision).validate_python(
            await self._post("before-call", AgentBeforeCallPayload(ref=ref, intent=intent))
        )

    async def record_outcome(
        self,
        *,
        permit: AgentDispatchPermit,
        outcome: Literal["completed", "failed", "unknown", "not_dispatched"],
        result_ref: str | None,
    ) -> AgentEffectReceipt:
        if self.ref is None:
            raise AgentPolicyTransportUnavailable("native_policy_owner_missing")
        payload = AgentOutcomePayload(ref=self.ref, permit=permit, outcome=outcome, result_ref=result_ref)
        return AgentEffectReceipt.model_validate(await self._post("outcome", payload))

    async def materialize(
        self,
        *,
        ref: AgentNativeTestRef,
        intent: AgentEffectIntent,
        permit: AgentDispatchPermit,
        tool_ref: str,
        phase: Literal["refresh", "business"],
    ) -> AgentMaterialization:
        return AgentMaterialization.model_validate(
            await self._post(
                "materialize",
                AgentMaterializePayload(ref=ref, intent=intent, permit=permit, tool_ref=tool_ref, phase=phase),
            )
        )

    async def claim_dispatch(
        self, *, ref: AgentNativeTestRef, intent: AgentEffectIntent, permit: AgentDispatchPermit
    ) -> None:
        result = await self._post("claim-dispatch", AgentPhysicalDispatchPayload(ref=ref, intent=intent, permit=permit))
        if result != {"claimed": True}:
            raise AgentPolicyTransportUnavailable("native_dispatch_claim_invalid")
