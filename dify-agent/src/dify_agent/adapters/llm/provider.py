"""Dify API provider for Pydantic AI LLM adapters.

The Pydantic AI provider represents API/plugin transport identity. Business
model provider names such as ``openai`` are request-level model identity and are
passed by ``DifyLLMAdapterModel`` for each invocation instead of being stored on
this provider.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from itertools import count
from typing import TYPE_CHECKING, NoReturn, Protocol, cast, override
from uuid import NAMESPACE_URL, uuid5

import httpx

from dify_agent.adapters.native_testing.transport import agent_api_endpoint
from graphon.model_runtime.entities.llm_entities import LLMResultChunk
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from pydantic import BaseModel, JsonValue, TypeAdapter
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError, UnexpectedModelBehavior, UserError
from pydantic_ai.providers import Provider

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.plugin_daemon_transport import (
    decode_plugin_daemon_error_payload,
    to_plugin_daemon_jsonable,
    unwrap_plugin_daemon_error,
)
from dify_agent.runtime.native_continuation import NativePolicyStopped

if TYPE_CHECKING:
    from dify_agent.runtime.native_effects import NativeEffectSession


def _model_receipt_bytes(value: object) -> int:
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


class ProtectedModelChunkReceipt:
    """Shared gateway/SDK receipt: exact chunks with identical prompts stored once."""

    def __init__(self) -> None:
        self._prompts: list[JsonValue] = []
        self._chunks: list[JsonValue] = []
        self._prompt_refs: dict[str, int] = {}
        self.value: dict[str, JsonValue] = {
            "format": "dify-model-chunks-v1",
            "prompts": self._prompts,
            "chunks": self._chunks,
        }
        self._size = _model_receipt_bytes(self.value)

    def append(self, chunk: LLMResultChunk) -> None:
        # Plugins may construct chunks with raw prompt dicts; normalize exactly
        # as the SDK's HTTP decoder does before comparing protected receipts.
        value = LLMResultChunk.model_validate(chunk.model_dump(mode="json")).model_dump(mode="json")
        prompt = value.pop("prompt_messages")
        prompt_key = json.dumps(prompt, ensure_ascii=False, sort_keys=True)
        prompt_ref = self._prompt_refs.get(prompt_key)
        added_prompt_bytes = 0
        if prompt_ref is None:
            prompt_ref = len(self._prompts)
            added_prompt_bytes = _model_receipt_bytes(prompt) + (2 if self._prompts else 0)
        entry = {"prompt_ref": prompt_ref, "chunk": value}
        size = self._size + added_prompt_bytes + _model_receipt_bytes(entry) + (2 if self._chunks else 0)
        if size > 1024 * 1024:
            raise NativePolicyStopped("native_model_result_too_large")
        if added_prompt_bytes:
            self._prompt_refs[prompt_key] = prompt_ref
            self._prompts.append(TypeAdapter(JsonValue).validate_python(prompt))
        self._chunks.append(TypeAdapter(JsonValue).validate_python(entry))
        self._size = size


def _decode_model_receipt(result: JsonValue) -> list[LLMResultChunk]:
    # Existing completed receipts are lists and must remain replayable verbatim.
    if isinstance(result, list):
        return [LLMResultChunk.model_validate(chunk) for chunk in result]
    try:
        if not isinstance(result, dict) or set(result) != {"format", "prompts", "chunks"}:
            raise ValueError
        if result["format"] != "dify-model-chunks-v1" or _model_receipt_bytes(result) > 1024 * 1024:
            raise ValueError
        prompts, entries = result["prompts"], result["chunks"]
        if not isinstance(prompts, list) or not all(isinstance(prompt, list) for prompt in prompts):
            raise ValueError
        if not isinstance(entries, list):
            raise ValueError
        chunks = []
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {"prompt_ref", "chunk"}:
                raise ValueError
            ref, chunk = entry["prompt_ref"], entry["chunk"]
            if type(ref) is not int or not 0 <= ref < len(prompts):
                raise ValueError
            if not isinstance(chunk, dict) or "prompt_messages" in chunk:
                raise ValueError
            chunks.append(LLMResultChunk.model_validate({**chunk, "prompt_messages": prompts[ref]}))
        return chunks
    except (ValueError, TypeError):
        raise UnexpectedModelBehavior("Invalid protected model result") from None


class DifyLLMClient(Protocol):
    """Transport contract consumed by the Pydantic AI model adapter."""

    http_client: httpx.AsyncClient

    def iter_llm_result_chunks(
        self,
        *,
        provider: str,
        model: str,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, object],
        tools: list[PromptMessageTool] | None,
        stop: list[str] | None,
        stream: bool,
    ) -> AsyncIterator[LLMResultChunk]: ...


class PluginDaemonBasicResponse(BaseModel):
    code: int
    message: str
    data: object | None = None


@dataclass(slots=True)
class DifyApiLLMClient:
    """HTTP client for the API-owned Agent LLM metering gateway."""

    plugin_id: str
    inner_api_url: str
    inner_api_key: str = field(repr=False)
    execution_context: DifyExecutionContextLayerConfig
    agent_run_id: str
    http_client: httpx.AsyncClient = field(repr=False)
    native_effects: NativeEffectSession | None = field(default=None, repr=False)
    _call_counter: count[int] = field(default_factory=lambda: count(1), init=False, repr=False)

    def __post_init__(self) -> None:
        self.inner_api_url = self.inner_api_url.rstrip("/")

    async def iter_llm_result_chunks(
        self,
        *,
        provider: str,
        model: str,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, object],
        tools: list[PromptMessageTool] | None,
        stop: list[str] | None,
        stream: bool,
    ) -> AsyncIterator[LLMResultChunk]:
        arguments = {
            "provider": provider,
            "model": model,
            "prompt_messages": prompt_messages,
            "model_parameters": model_parameters,
            "tools": tools,
            "stop": stop,
            "stream": stream,
        }
        if self.native_effects is None:
            async for chunk in self._iter_llm_result_chunks(**arguments):
                yield chunk
            return
        # The existing API gateway always invokes a stream, including requests
        # from a non-streaming consumer. Freeze that actual effective argument.
        arguments["stream"] = True

        async def invoke(_permit) -> JsonValue:
            receipt = ProtectedModelChunkReceipt()
            async for chunk in self._iter_llm_result_chunks(**arguments):
                receipt.append(chunk)
            return receipt.value

        state = self.native_effects.continuation
        result = await self.native_effects.stage(
            boundary="model",
            call_id=f"model-{state.operation_cursor}",
            target={
                "plugin_id": self.plugin_id,
                "provider": provider if provider.count("/") == 2 else f"{self.plugin_id}/{provider}",
                "model": model,
            },
            parameters=TypeAdapter(JsonValue).validate_python(
                to_plugin_daemon_jsonable(
                    {
                        "prompt_messages": prompt_messages,
                        "model_parameters": model_parameters,
                        "tools": tools,
                        "stop": stop,
                        "stream": True,
                    }
                )
            ),
            stage="model",
            invoke=invoke,
        )
        chunks = _decode_model_receipt(result)
        state.operation_cursor += 1
        for chunk in chunks:
            yield chunk

    async def _iter_llm_result_chunks(
        self,
        *,
        provider: str,
        model: str,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, object],
        tools: list[PromptMessageTool] | None,
        stop: list[str] | None,
        stream: bool,
    ) -> AsyncIterator[LLMResultChunk]:
        call_index = next(self._call_counter)
        invocation_id = str(uuid5(NAMESPACE_URL, f"dify-agent:{self.agent_run_id}:llm:{call_index}"))
        context = self.execution_context
        missing = [
            field_name
            for field_name, value in (
                ("user_id", context.user_id),
                ("user_from", context.user_from),
                ("app_id", context.app_id),
            )
            if value is None
        ]
        if missing:
            raise UserError(f"Agent LLM Gateway requires execution context fields: {', '.join(missing)}")

        caller = context.model_dump(mode="json")
        caller.update(
            {
                "invocation_id": invocation_id,
                "agent_run_id": self.agent_run_id,
                "call_index": call_index,
            }
        )
        provider_id = provider if provider.count("/") == 2 else f"{self.plugin_id}/{provider}"
        payload = to_plugin_daemon_jsonable(
            {
                "caller": caller,
                "target": {
                    "provider": provider_id,
                    "model": model,
                    "prompt_messages": prompt_messages,
                    "model_parameters": model_parameters,
                    "tools": tools,
                    "stop": stop,
                    "stream": stream,
                },
            }
        )
        if self.native_effects is not None:
            from dify_agent.runtime.native_effects import current_native_dispatch

            envelope = current_native_dispatch()
            if envelope is None:
                raise NativePolicyStopped("native_tool_permit_missing")
            payload = TypeAdapter(dict[str, JsonValue]).validate_python(payload)
            payload["native_dispatch"] = envelope.wire()
        url, headers = agent_api_endpoint(
            self.http_client,
            base_url=self.inner_api_url,
            legacy_path="agent/llm/invoke",
            runtime_path="llm/invoke",
            api_key=self.inner_api_key,
        )
        headers["Content-Type"] = "application/json"

        try:
            async with self.http_client.stream("POST", url, headers=headers, json=payload) as response:
                if response.is_error:
                    if self.native_effects is not None:
                        raise NativePolicyStopped("native_model_transport_unavailable")
                    body = (await response.aread()).decode("utf-8", errors="replace")
                    _raise_agent_gateway_http_error(
                        model_name=model,
                        status_code=response.status_code,
                        body=body,
                    )

                async for raw_line in response.aiter_lines():
                    line = raw_line.strip()
                    if not line:
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    wrapped = PluginDaemonBasicResponse.model_validate_json(line)
                    if wrapped.code != 0:
                        error = decode_plugin_daemon_error_payload(wrapped.message)
                        if error is not None:
                            resolved_error = unwrap_plugin_daemon_error(
                                error_type=error["error_type"],
                                message=error["message"],
                            )
                            _raise_plugin_daemon_error(
                                model_name=model,
                                error_type=resolved_error["error_type"],
                                message=resolved_error["message"],
                                body=resolved_error,
                            )
                        raise ModelAPIError(model, wrapped.message)
                    if wrapped.data is None:
                        raise UnexpectedModelBehavior("Agent LLM Gateway returned an empty stream item")
                    yield LLMResultChunk.model_validate(wrapped.data)
        except (httpx.InvalidURL, httpx.UnsupportedProtocol) as exc:
            raise UserError(f"Agent LLM Gateway is misconfigured: {exc}") from exc
        except httpx.TimeoutException as exc:
            raise ModelHTTPError(504, model, "Agent LLM Gateway timed out") from exc
        except httpx.RequestError as exc:
            raise ModelHTTPError(503, model, f"Agent LLM Gateway request failed: {exc}") from exc


@dataclass(slots=True, kw_only=True)
class DifyApiLLMProvider(Provider[DifyLLMClient]):
    """Pydantic AI provider backed by Dify API's metered model gateway."""

    plugin_id: str
    inner_api_url: str
    inner_api_key: str = field(repr=False)
    execution_context: DifyExecutionContextLayerConfig
    agent_run_id: str
    http_client: httpx.AsyncClient = field(repr=False)
    native_effects: NativeEffectSession | None = field(default=None, repr=False)
    _client: DifyLLMClient = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.inner_api_url = self.inner_api_url.rstrip("/")
        self._client = DifyApiLLMClient(
            plugin_id=self.plugin_id,
            inner_api_url=self.inner_api_url,
            inner_api_key=self.inner_api_key,
            execution_context=self.execution_context,
            agent_run_id=self.agent_run_id,
            http_client=self.http_client,
            native_effects=self.native_effects,
        )

    @override
    def _set_http_client(self, http_client: httpx.AsyncClient) -> None:
        self._client.http_client = http_client

    @property
    @override
    def name(self) -> str:
        return f"DifyAPI/{self.plugin_id}"

    @property
    @override
    def base_url(self) -> str:
        return self.inner_api_url

    @property
    @override
    def client(self) -> DifyLLMClient:
        return self._client


def _raise_agent_gateway_http_error(*, model_name: str, status_code: int, body: str) -> NoReturn:
    message = body or f"Agent LLM Gateway returned HTTP {status_code}"
    try:
        payload = cast(object, json.loads(body))
    except json.JSONDecodeError:
        payload = None
    if isinstance(payload, dict):
        typed_payload = cast(dict[str, object], payload)
        candidate = typed_payload.get("message") or typed_payload.get("description")
        if isinstance(candidate, str) and candidate:
            message = candidate
    raise ModelHTTPError(status_code, model_name, message)


def _raise_plugin_daemon_error(
    *,
    model_name: str,
    error_type: str,
    message: str,
    status_code: int | None = None,
    body: object | None = None,
) -> NoReturn:
    http_error_body = body or {"error_type": error_type, "message": message}

    match error_type:
        case "PluginDaemonUnauthorizedError" | "InvokeAuthorizationError":
            raise ModelHTTPError(status_code or 401, model_name, http_error_body)
        case "PluginPermissionDeniedError":
            raise ModelHTTPError(status_code or 403, model_name, http_error_body)
        case (
            "PluginDaemonBadRequestError"
            | "InvokeBadRequestError"
            | "CredentialsValidateFailedError"
            | "PluginUniqueIdentifierError"
        ):
            raise ModelHTTPError(status_code or 400, model_name, http_error_body)
        case "EndpointSetupFailedError" | "TriggerProviderCredentialValidationError":
            raise UserError(message)
        case "PluginDaemonNotFoundError" | "PluginNotFoundError":
            raise ModelHTTPError(status_code or 404, model_name, http_error_body)
        case "InvokeRateLimitError":
            raise ModelHTTPError(status_code or 429, model_name, http_error_body)
        case "AgentLLMQuotaExceededError" | "QuotaExceededError":
            raise ModelHTTPError(status_code or 429, model_name, http_error_body)
        case "PluginDaemonInternalServerError" | "PluginDaemonInnerError":
            raise ModelHTTPError(status_code or 500, model_name, http_error_body)
        case "InvokeConnectionError" | "InvokeServerUnavailableError":
            raise ModelHTTPError(status_code or 503, model_name, http_error_body)
        case _:
            raise ModelAPIError(model_name, f"{error_type}: {message}")
