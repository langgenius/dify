"""Dify core-tools layer for API-routed agent-accessible tools.

This layer consumes API-prepared tool declarations for provider families that
must execute inside the Dify API service boundary. The runtime keeps the same
prepared-parameter contract as the direct plugin layer, but invocation itself
is delegated to `POST /inner/api/agent/tools/invoke` so credentials and
provider-local state stay in the API process.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from typing import cast, override

from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.trace import StatusCode, get_current_span
from pydantic import JsonValue
from pydantic_ai import RunContext, Tool, ToolReturn
from pydantic_ai.tools import ToolDefinition

from pydantic import BaseModel, ConfigDict
from pydantic_ai.toolsets import FunctionToolset
from dify_agent.runtime.context import Deps
from dify_agent.layers.dify_core_tools.client import (
    DifyCoreToolsClient,
    DifyCoreToolsClientConfigurationError,
    DifyCoreToolsClientError,
    _validate_execution_context,
)
from dify_agent.layers.dify_core_tools.configs import (
    DifyCoreToolConfig,
    DifyCoreToolsLayerConfig,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.tool_call_limits import (
    ToolCallLimitGuard,
    prepare_core_tool_validation_arguments,
    validate_limited_tool_arguments,
)
from dify_agent.protocol.tool_call_limits import TOOL_VALIDATION_FAILED_METADATA_KEY


CORE_TOOL_STRICT = False
TEMPORARY_UNAVAILABLE_OBSERVATION = "Tool is temporarily unavailable. Please continue without it if possible."


class Config(DifyCoreToolsLayerConfig):
    pass


class State(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Toolset(FunctionToolset[Deps]):
    """Expose API-prepared schemas and borrow the lifespan API client."""

    def __init__(self, name: str):
        super().__init__(id=name)
        self.name = name
        self._loaded = False

    @override
    async def get_tools(self, ctx: RunContext[Deps]):
        if not self._loaded:
            config = Config.model_validate(ctx.deps.layers[self.name]["config"])
            execution_context = DifyExecutionContextLayerConfig.model_validate(
                ctx.deps.layers[config.execution_context]["config"]
            )
            http_client = ctx.deps.services.dify_api_http_client
            if http_client.is_closed:
                raise RuntimeError("Core tools require an open shared HTTP client.")
            client = DifyCoreToolsClient(
                base_url=ctx.deps.services.inner_api_url,
                api_key=ctx.deps.services.inner_api_key,
                http_client=http_client,
            )
            for tool_config in config.tools:
                self.add_tool(
                    self._build_tool(
                        client=client,
                        execution_context=execution_context,
                        tool_config=tool_config,
                        call_limit=ToolCallLimitGuard.for_tool(ctx.deps, tool_config),
                    )
                )
            self._loaded = True
        return await super().get_tools(ctx)

    @staticmethod
    def _build_tool(
        *,
        client: DifyCoreToolsClient,
        execution_context: DifyExecutionContextLayerConfig,
        tool_config: DifyCoreToolConfig,
        call_limit: ToolCallLimitGuard | None = None,
    ) -> Tool[Deps]:
        tool_name = tool_config.name or tool_config.tool_name
        tool_description = tool_config.description or tool_name
        tool_schema = deepcopy(tool_config.parameters_json_schema)

        async def invoke_tool(_ctx: RunContext[Deps], **tool_arguments: object) -> str | ToolReturn:
            """Validate before reserving, then dispatch only an authoritative admission."""
            reservation = None
            failed = False
            try:
                if call_limit is not None:
                    _validate_execution_context(execution_context)
                    validation_arguments = prepare_core_tool_validation_arguments(
                        tool_schema, tool_config.parameters, tool_config.runtime_parameters, tool_arguments
                    )
                    validate_limited_tool_arguments(
                        tool_schema,
                        tool_config.parameters,
                        tool_config.runtime_parameters,
                        tool_arguments,
                        prepared_arguments=validation_arguments,
                    )
                    reservation = await call_limit.reserve(_ctx)
                    if not reservation.allowed:
                        return call_limit.denied(reservation)
                response = await client.invoke(
                    execution_context=execution_context,
                    tool_config=tool_config,
                    tool_parameters=cast(dict[str, JsonValue], tool_arguments),
                )
                observation = response.observation
            except DifyCoreToolsClientConfigurationError as exc:
                failed = True
                _mark_tool_span_failed(_ctx, exc)
                observation = "Tool is unavailable because required execution context is missing."
            except DifyCoreToolsClientError as exc:
                failed = True
                _mark_tool_span_failed(_ctx, exc)
                observation = _tool_error_text(tool_name=tool_name, error=exc)
            except ValueError as exc:
                failed = True
                observation = f"tool parameters validation error: {exc}, please check your tool parameters"
                if call_limit is not None and reservation is None:
                    # This attempt failed before admission and consumed no quota.
                    return ToolReturn(observation, metadata={TOOL_VALIDATION_FAILED_METADATA_KEY: True})
            if call_limit is not None and reservation is not None:
                return call_limit.result(reservation, observation, failed=failed)
            return observation

        async def prepare_tool_definition(_ctx: RunContext[Deps], tool_def: ToolDefinition) -> ToolDefinition | None:
            """Remove exhausted tools on later model turns; in-flight calls still reserve."""
            if call_limit is not None and not await call_limit.available(_ctx):
                return None
            return replace(tool_def, parameters_json_schema=tool_schema, strict=CORE_TOOL_STRICT)

        return Tool(
            invoke_tool,
            takes_ctx=True,
            name=tool_name,
            description=tool_description,
            prepare=prepare_tool_definition,
        )


def _mark_tool_span_failed(ctx: RunContext[Deps], error: DifyCoreToolsClientError) -> None:
    """Keep handled API errors on this native tool span without failing the Agent.

    Pydantic AI wraps tool execution in the current ``execute_tool`` span. When
    instrumentation is disabled, an ambient Agent/platform span must stay intact.
    Only record a safe exception type; the observation retains its existing text
    and the instrumentation's content policy controls whether that text is traced.
    """
    span = get_current_span()
    # Logfire wraps unsampled NonRecordingSpan as ReadableSpan, so check recording
    # before accessing SDK attributes that the underlying span does not expose.
    if not span.is_recording():
        return
    attributes = span.attributes if isinstance(span, ReadableSpan) else None
    if (
        not attributes
        or attributes.get("gen_ai.operation.name") != "execute_tool"
        or ctx.tool_call_id is None
        or attributes.get("gen_ai.tool.call.id") != ctx.tool_call_id
        or attributes.get("gen_ai.tool.name") != ctx.tool_name
    ):
        return
    error_type = type(error).__name__
    span.set_attribute("error.type", error_type)
    span.set_status(StatusCode.ERROR, error_type)


def _tool_error_text(*, tool_name: str, error: DifyCoreToolsClientError) -> str:
    if error.retryable:
        return TEMPORARY_UNAVAILABLE_OBSERVATION
    error_code = error.error_code or ""
    if error_code == "app_not_found":
        return "Tool is unavailable because its app context no longer exists."
    if error_code == "app_tenant_mismatch":
        return "Tool is unavailable because its app context is invalid."
    if error_code == "agent_tool_credential_invalid":
        return "Please check your tool provider credentials"
    if error_code == "agent_tool_declaration_not_found":
        return f"there is not a tool named {tool_name}"
    if error_code == "tool_parameters_invalid":
        return f"tool parameters validation error: {error}, please check your tool parameters"
    if error_code == "agent_tool_invoke_failed":
        return f"tool invoke error: {error}"
    return f"tool invoke error: {error}"


__all__ = ["Config", "State", "Toolset"]
