"""Dify plugin-daemon provider for Pydantic AI LLM adapters.

The Pydantic AI provider represents daemon/plugin transport identity. Business
model provider names such as ``openai`` are request-level model identity and are
passed by ``DifyLLMAdapterModel`` for each invocation instead of being stored on
this provider.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import dataclass, field
from typing import NoReturn

import httpx
from graphon.model_runtime.entities.llm_entities import LLMResultChunk
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from pydantic import BaseModel
from typing_extensions import override

from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError, UnexpectedModelBehavior, UserError
from pydantic_ai.providers import Provider

_DEFAULT_DAEMON_TIMEOUT: float | httpx.Timeout | None = 600.0


class PluginDaemonBasicResponse(BaseModel):
    code: int
    message: str
    data: object | None = None


@dataclass(slots=True)
class DifyPluginDaemonLLMClient:
    """HTTP client wrapper for plugin-daemon LLM dispatch requests."""

    plugin_daemon_url: str
    plugin_daemon_api_key: str
    tenant_id: str
    plugin_id: str
    user_id: str | None
    http_client: httpx.AsyncClient = field(repr=False)

    def __post_init__(self) -> None:
        self.plugin_daemon_url = self.plugin_daemon_url.rstrip("/")

    async def iter_llm_result_chunks(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, object],
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, object],
        tools: list[PromptMessageTool] | None,
        stop: list[str] | None,
        stream: bool,
    ) -> AsyncIterator[LLMResultChunk]:
        async for item in self._iter_stream_response(
            model_name=model,
            path=f"plugin/{self.tenant_id}/dispatch/llm/invoke",
            request_data={
                "provider": provider,
                "model_type": "llm",
                "model": model,
                "credentials": credentials,
                "prompt_messages": prompt_messages,
                "model_parameters": model_parameters,
                "tools": tools,
                "stop": stop,
                "stream": stream,
            },
            response_model=LLMResultChunk,
        ):
            yield item

    async def _iter_stream_response[T: BaseModel](
        self,
        *,
        model_name: str,
        path: str,
        request_data: Mapping[str, object],
        response_model: type[T],
    ) -> AsyncIterator[T]:
        payload: dict[str, object] = {"data": _to_jsonable(request_data)}
        if self.user_id is not None:
            payload["user_id"] = self.user_id

        headers = {
            "X-Api-Key": self.plugin_daemon_api_key,
            "X-Plugin-ID": self.plugin_id,
            "Content-Type": "application/json",
        }
        url = f"{self.plugin_daemon_url}/{path}"

        async with self.http_client.stream("POST", url, headers=headers, json=payload) as response:
            if response.is_error:
                body = (await response.aread()).decode("utf-8", errors="replace")
                error = _decode_plugin_daemon_error_payload(body)
                if error is not None:
                    _raise_plugin_daemon_error(
                        model_name=model_name,
                        error_type=error["error_type"],
                        message=error["message"],
                        status_code=response.status_code,
                        body=error,
                    )
                raise ModelHTTPError(response.status_code, model_name, body or None)

            async for raw_line in response.aiter_lines():
                line = raw_line.strip()
                if not line:
                    continue
                if line.startswith("data:"):
                    line = line[5:].strip()

                wrapped = PluginDaemonBasicResponse.model_validate_json(line)
                if wrapped.code != 0:
                    error = _decode_plugin_daemon_error_payload(wrapped.message)
                    if error is not None:
                        _raise_plugin_daemon_error(
                            model_name=model_name,
                            error_type=error["error_type"],
                            message=error["message"],
                            body=error,
                        )
                    raise ModelAPIError(
                        model_name,
                        f"Plugin daemon returned error code {wrapped.code}: {wrapped.message}",
                    )
                if wrapped.data is None:
                    raise UnexpectedModelBehavior("Plugin daemon returned an empty stream item")
                yield response_model.model_validate(wrapped.data)


@dataclass(slots=True, kw_only=True)
class DifyPluginDaemonProvider(Provider[DifyPluginDaemonLLMClient]):
    """Pydantic AI provider for Dify plugin-daemon dispatch requests.

    The provider ``name`` identifies the daemon/plugin context. The business LLM
    provider is supplied by each adapter model request so one daemon provider can
    serve different model-provider selections without mutating transport state.
    When ``http_client`` is omitted the provider owns an ``AsyncClient`` and the
    Pydantic AI provider context manager closes it. When an external client is
    supplied, ownership stays with the caller and provider exit leaves it open.
    """

    tenant_id: str
    plugin_id: str
    plugin_daemon_url: str
    plugin_daemon_api_key: str = field(repr=False)
    user_id: str | None = None
    timeout: float | httpx.Timeout | None = _DEFAULT_DAEMON_TIMEOUT
    http_client: httpx.AsyncClient | None = field(default=None, repr=False)
    _client: DifyPluginDaemonLLMClient = field(init=False, repr=False)
    _own_http_client: httpx.AsyncClient | None = field(init=False, default=None, repr=False)
    _http_client_factory: Callable[[], httpx.AsyncClient] | None = field(init=False, default=None, repr=False)

    def __post_init__(self) -> None:
        self.plugin_daemon_url = self.plugin_daemon_url.rstrip("/")
        if self.http_client is None:
            self._http_client_factory = self._make_http_client
            http_client = self._make_http_client()
            self._own_http_client = http_client
        else:
            http_client = self.http_client
            self._own_http_client = None
            self._http_client_factory = None
        self._client = DifyPluginDaemonLLMClient(
            plugin_daemon_url=self.plugin_daemon_url,
            plugin_daemon_api_key=self.plugin_daemon_api_key,
            tenant_id=self.tenant_id,
            plugin_id=self.plugin_id,
            user_id=self.user_id,
            http_client=http_client,
        )

    def _make_http_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self.timeout, trust_env=False)

    @override
    def _set_http_client(self, http_client: httpx.AsyncClient) -> None:
        self._client.http_client = http_client

    @property
    @override
    def name(self) -> str:
        return f"DifyPlugin/{self.plugin_id}"

    @property
    @override
    def base_url(self) -> str:
        return self.plugin_daemon_url

    @property
    @override
    def client(self) -> DifyPluginDaemonLLMClient:
        return self._client


def _to_jsonable(value: object) -> object:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {key: _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_to_jsonable(item) for item in value]
    return value


def _decode_plugin_daemon_error_payload(raw_message: str) -> dict[str, str] | None:
    try:
        parsed = json.loads(raw_message)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    error_type = parsed.get("error_type")
    message = parsed.get("message")
    if not isinstance(error_type, str) or not isinstance(message, str):
        return None
    return {"error_type": error_type, "message": message}


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
        case "PluginInvokeError":
            nested_error = _decode_plugin_daemon_error_payload(message)
            if nested_error is not None:
                _raise_plugin_daemon_error(
                    model_name=model_name,
                    error_type=nested_error["error_type"],
                    message=nested_error["message"],
                    status_code=status_code,
                    body=nested_error,
                )
            raise ModelAPIError(model_name, message)
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
        case "PluginDaemonInternalServerError" | "PluginDaemonInnerError":
            raise ModelHTTPError(status_code or 500, model_name, http_error_body)
        case "InvokeConnectionError" | "InvokeServerUnavailableError":
            raise ModelHTTPError(status_code or 503, model_name, http_error_body)
        case _:
            raise ModelAPIError(model_name, f"{error_type}: {message}")
