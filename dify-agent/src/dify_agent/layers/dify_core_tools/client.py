"""Async client for the Dify API inner core-tools invoke endpoint."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import ClassVar

import httpx
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError

from dify_agent.layers.dify_core_tools.configs import DifyCoreToolConfig
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


class DifyCoreToolsClientError(RuntimeError):
    """Raised when the inner core-tools HTTP boundary fails."""

    status_code: int | None
    error_code: str | None
    retryable: bool

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
        retryable: bool,
    ) -> None:
        self.status_code = status_code
        self.error_code = error_code
        self.retryable = retryable
        super().__init__(message)


class DifyCoreToolsClientConfigurationError(DifyCoreToolsClientError):
    """Raised for local layer/configuration precondition failures before HTTP I/O."""


class _DifyCoreToolsCaller(BaseModel):
    tenant_id: str
    user_id: str
    user_from: str
    app_id: str
    invoke_from: str
    conversation_id: str | None = None
    workflow_id: str | None = None
    workflow_run_id: str | None = None
    node_id: str | None = None
    node_execution_id: str | None = None
    agent_id: str | None = None
    agent_config_version_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class _DifyCoreToolsRequestTool(BaseModel):
    """Inner-API tool envelope.

    `runtime_parameters` are API-prepared hidden/form/runtime values attached
    to the tool declaration. `tool_parameters` are the live LLM/user arguments
    passed by the runtime when invoking the tool.
    """

    provider_type: str
    provider_id: str
    tool_name: str
    credential_id: str | None = None
    tool_parameters: dict[str, JsonValue] = Field(default_factory=dict)
    runtime_parameters: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class _DifyCoreToolsInvokeRequest(BaseModel):
    caller: _DifyCoreToolsCaller
    tool: _DifyCoreToolsRequestTool

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyCoreToolsInvokeResponse(BaseModel):
    messages: list[dict[str, JsonValue]] = Field(default_factory=list)
    observation: str
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


@dataclass(slots=True)
class DifyCoreToolsClient:
    """Boundary client for `POST /inner/api/agent/tools/invoke`."""

    base_url: str
    api_key: str = field(repr=False)
    http_client: httpx.AsyncClient = field(repr=False)

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")

    async def invoke(
        self,
        *,
        execution_context: DifyExecutionContextLayerConfig,
        tool_config: DifyCoreToolConfig,
        tool_parameters: dict[str, JsonValue],
    ) -> DifyCoreToolsInvokeResponse:
        _validate_execution_context(execution_context)

        request_payload = _DifyCoreToolsInvokeRequest(
            caller=_DifyCoreToolsCaller(
                tenant_id=execution_context.tenant_id,
                user_id=execution_context.user_id,
                user_from=execution_context.user_from,
                app_id=execution_context.app_id,
                invoke_from=execution_context.invoke_from,
                conversation_id=execution_context.conversation_id,
                workflow_id=execution_context.workflow_id,
                workflow_run_id=execution_context.workflow_run_id,
                node_id=execution_context.node_id,
                node_execution_id=execution_context.node_execution_id,
                agent_id=execution_context.agent_id,
                agent_config_version_id=execution_context.agent_config_version_id,
            ),
            tool=_DifyCoreToolsRequestTool(
                provider_type=tool_config.provider_type,
                provider_id=tool_config.provider_id,
                tool_name=tool_config.tool_name,
                credential_id=tool_config.credential_id,
                tool_parameters=tool_parameters,
                runtime_parameters=tool_config.runtime_parameters,
            ),
        )

        try:
            response = await self.http_client.post(
                f"{self.base_url}/inner/api/agent/tools/invoke",
                headers={
                    "X-Inner-Api-Key": self.api_key,
                    "Content-Type": "application/json",
                },
                json=request_payload.model_dump(mode="json"),
            )
        except (httpx.InvalidURL, httpx.UnsupportedProtocol) as exc:
            raise DifyCoreToolsClientError(f"Core tools are misconfigured: {exc}", retryable=False) from exc
        except httpx.TimeoutException as exc:
            raise DifyCoreToolsClientError("Core tool invocation timed out.", retryable=True) from exc
        except httpx.RequestError as exc:
            raise DifyCoreToolsClientError(f"Core tool invocation request failed: {exc}", retryable=True) from exc

        if response.status_code >= 400:
            raise _build_http_error(response)

        try:
            return DifyCoreToolsInvokeResponse.model_validate_json(response.text)
        except ValidationError as exc:
            raise DifyCoreToolsClientError(
                "Invalid core tool response from Dify API.",
                status_code=response.status_code,
                error_code="invalid_response",
                retryable=False,
            ) from exc


def _validate_execution_context(execution_context: DifyExecutionContextLayerConfig) -> None:
    missing_fields = [
        field_name
        for field_name in ("user_id", "user_from", "app_id")
        if getattr(execution_context, field_name) is None
    ]
    if missing_fields:
        missing = ", ".join(missing_fields)
        raise DifyCoreToolsClientConfigurationError(
            f"Missing required execution context fields: {missing}.",
            error_code="missing_execution_context",
            retryable=False,
        )


def _build_http_error(response: httpx.Response) -> DifyCoreToolsClientError:
    detail = _decode_error_detail(response)
    retryable = response.status_code >= 500 or response.status_code == 429
    message = detail["message"] or f"HTTP {response.status_code}"
    return DifyCoreToolsClientError(
        message,
        status_code=response.status_code,
        error_code=detail["error_code"],
        retryable=retryable,
    )


def _decode_error_detail(response: httpx.Response) -> dict[str, str | None]:
    raw_body = response.text
    try:
        payload = response.json()
    except json.JSONDecodeError:
        payload = None

    if isinstance(payload, dict):
        error_code = payload.get("code")
        message = payload.get("message")
        return {
            "error_code": error_code if isinstance(error_code, str) else None,
            "message": message if isinstance(message, str) and message else raw_body or f"HTTP {response.status_code}",
        }

    return {"error_code": None, "message": raw_body or f"HTTP {response.status_code}"}
