"""Authenticated policy transport. Wire parsing never grants execution authority."""

from dataclasses import dataclass, field
from typing import Literal

import httpx
from pydantic import Field, JsonValue, TypeAdapter

from dify_agent.adapters.native_testing.transport import agent_api_endpoint
from dify_agent.protocol.native_testing import (
    ID,
    MAX_AGENT_CONFIG_BYTES,
    MAX_AGENT_CONTROL_BYTES,
    AgentDispatchPermit,
    AgentEffectDecision,
    AgentEffectIntent,
    AgentEffectReceipt,
    AgentNativeTestRef,
    AgentPreparedConfigResponse,
    AgentPrepareRunPayload,
    AgentPrepareRunResponse,
    AgentReadPreparedConfigPayload,
    AgentPrepareIntentPayload,
    AgentStoreResultPayload,
    AgentStoredResultResponse,
    AgentReadResultPayload,
    AgentReadResultResponse,
    NativeDTO,
    executable_request_digest,
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

    async def prepare_intent(self, *, payload: AgentPrepareIntentPayload) -> AgentEffectIntent:
        self._require_ref(payload.ref)
        return AgentEffectIntent.model_validate(await self._post("prepare-intent", payload))

    async def store_result(self, *, payload: AgentStoreResultPayload) -> str:
        self._require_ref(payload.ref)
        return AgentStoredResultResponse.model_validate(await self._post("results", payload)).result_ref

    async def read_result(self, *, payload: AgentReadResultPayload) -> JsonValue:
        self._require_ref(payload.ref)
        return AgentReadResultResponse.model_validate(await self._post("read-result", payload)).result

    def _require_ref(self, ref: AgentNativeTestRef) -> None:
        if self.ref is None or self.ref != ref:
            raise AgentPolicyTransportUnavailable("native_policy_owner_mismatch")

    async def _post(self, path: str, payload: NativeDTO):
        url, headers = agent_api_endpoint(
            self.http_client,
            base_url=self.base_url,
            legacy_path=f"agent/native-testing/{path}",
            runtime_path=f"native-testing/{path}",
            api_key=self.api_key,
        )
        try:
            response = await self.http_client.post(
                url,
                headers=headers,
                json=payload.model_dump(mode="json"),
            )
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise AgentPolicyTransportUnavailable("native_policy_transport_unavailable") from None

    async def _post_preparation(self, path: str, payload: NativeDTO, *, response_limit: int) -> bytes:
        body = payload.model_dump_json().encode()
        if len(body) > MAX_AGENT_CONTROL_BYTES:
            raise AgentPolicyTransportUnavailable("native_preparation_unavailable")
        parent = getattr(payload, "parent_node", None)
        if parent is None or (self.ref is not None and self.ref != parent.ref):
            raise AgentPolicyTransportUnavailable("native_policy_owner_mismatch")
        self.ref = parent.ref
        url, headers = agent_api_endpoint(
            self.http_client,
            base_url=self.base_url,
            legacy_path=f"agent/native-testing/{path}",
            runtime_path=f"native-testing/{path}",
            api_key=self.api_key,
        )
        try:
            async with self.http_client.stream(
                "POST",
                url,
                headers={
                    **headers,
                    "Content-Type": "application/json",
                    "Accept-Encoding": "identity",
                },
                content=body,
                # Allow finite metadata/storage readbacks without retrying preparation.
                timeout=httpx.Timeout(30.0),
                follow_redirects=False,
            ) as response:
                if response.status_code != 200 or response.headers.get("content-encoding", "identity") != "identity":
                    raise AgentPolicyTransportUnavailable("native_preparation_unavailable")
                result = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=min(response_limit + 1, 65536)):
                    if len(result) + len(chunk) > response_limit:
                        raise AgentPolicyTransportUnavailable("native_preparation_unavailable")
                    result.extend(chunk)
                return bytes(result)
        except httpx.HTTPError:
            raise AgentPolicyTransportUnavailable("native_preparation_unavailable") from None

    async def prepare_run(self, *, payload: AgentPrepareRunPayload) -> AgentPrepareRunResponse:
        try:
            result = AgentPrepareRunResponse.model_validate_json(
                await self._post_preparation("prepare-run", payload, response_limit=MAX_AGENT_CONTROL_BYTES)
            )
            if result.config_digest != payload.request_digest:
                raise ValueError
            return result
        except ValueError:
            raise AgentPolicyTransportUnavailable("native_preparation_unavailable") from None

    async def read_prepared_config(self, *, payload: AgentReadPreparedConfigPayload) -> AgentPreparedConfigResponse:
        from dify_agent.protocol.schemas import CreateRunRequest

        try:
            result = AgentPreparedConfigResponse.model_validate_json(
                await self._post_preparation("prepared-config", payload, response_limit=MAX_AGENT_CONFIG_BYTES)
            )
            if (
                result.parent_node != payload.parent_node
                or result.config_ref != payload.config_ref
                or not isinstance(result.config, dict)
                or set(result.config) != {"composition", "session_snapshot"}
            ):
                raise ValueError
            request = CreateRunRequest.model_validate(
                {
                    **result.config,
                    "execution_mode": "builder_test",
                    "native_test_ref": payload.parent_node.ref,
                    "native_test_protocol_version": 1,
                    "native_parent_node": payload.parent_node,
                }
            )
            if executable_request_digest(request) != result.config_digest:
                raise ValueError
            return result
        except ValueError:
            raise AgentPolicyTransportUnavailable("native_preparation_unavailable") from None

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
