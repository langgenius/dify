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

from pydantic import BaseModel, ConfigDict, JsonValue, TypeAdapter
from pydantic_ai import RunContext, Tool
from pydantic_ai.tools import ToolDefinition
from pydantic_ai.toolsets import FunctionToolset
from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient

from dify_agent.layers.dify_core_tools.client import (
    DifyCoreToolsClient,
    DifyCoreToolsClientConfigurationError,
    DifyCoreToolsClientError,
)
from dify_agent.layers.dify_core_tools.configs import (
    DifyCoreToolConfig,
    DifyCoreToolsLayerConfig,
)
from dify_agent.layers.dify_plugin.tool_client import DifyPluginToolClientError
from dify_agent.layers.dify_plugin.tools_layer import (
    _DifyPluginToolFileClient,
    _PluginToolFileContext,
    _prepare_tool_arguments,
    _require_native_file_dependencies,
    _validate_required_hidden_parameters,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.runtime.context import Deps
from dify_agent.runtime.native_continuation import NativePolicyStopped
from dify_agent.runtime.native_effects import NativeToolBoundary, canonical_effect_json, current_native_dispatch

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
            http_client = ctx.deps.dify_api_http_client
            if http_client.is_closed:
                raise RuntimeError("Core tools require an open shared HTTP client.")
            client = DifyCoreToolsClient(
                base_url=ctx.deps.services.inner_api_url,
                api_key=ctx.deps.services.inner_api_key,
                http_client=http_client,
            )
            file_context = _PluginToolFileContext(
                file_client=_DifyPluginToolFileClient(
                    base_url=ctx.deps.services.inner_api_url,
                    api_key=ctx.deps.services.inner_api_key,
                    http_client=http_client,
                ),
                execution_context=execution_context,
                deps=ctx.deps,
                shell=config.shell,
            )
            for tool_config in config.tools:
                if tool_config.uses_plugin_parameters:
                    _validate_required_hidden_parameters(tool_config, tool_config.parameters)
                self.add_tool(
                    self._build_tool(
                        client=client,
                        execution_context=execution_context,
                        tool_config=tool_config,
                        file_context=file_context,
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
        file_context: _PluginToolFileContext | None = None,
    ) -> Tool[Deps]:
        tool_name = tool_config.name or tool_config.tool_name
        tool_description = tool_config.description or tool_name
        tool_schema = deepcopy(tool_config.parameters_json_schema)

        async def native_arguments(arguments: dict[str, object]) -> dict[str, JsonValue]:
            # File references stay canonical; the API owner materializes them only
            # after validating this same invocation's permit.
            prepared = await _prepare_tool_arguments(
                tool_config.parameters, tool_config, arguments, file_context=None, materialize_files=False
            )
            _require_native_file_dependencies(tool_config.parameters, prepared)
            return TypeAdapter(dict[str, JsonValue]).validate_python(prepared)

        async def invoke_tool(_ctx: RunContext[Deps], **tool_arguments: object) -> str:
            if _ctx.deps.native_effects is not None:
                if _ctx.deps.native_effects.continuation.native_test_profile != "confirmed" or not isinstance(
                    client.http_client, AgentRuntimeHTTPClient
                ):
                    raise NativePolicyStopped("native_dispatch_fence_unavailable")
                envelope = current_native_dispatch()
                prepared = await native_arguments(tool_arguments)
                target: dict[str, JsonValue] = {
                    "provider_type": tool_config.provider_type,
                    "provider_id": tool_config.provider_id,
                    "tool_name": tool_config.tool_name,
                }
                if envelope is None or envelope.ref != _ctx.deps.native_effects.continuation.ref:
                    raise NativePolicyStopped("native_dispatch_fence_unavailable")
                if canonical_effect_json(envelope.intent.parameters) != canonical_effect_json(
                    prepared
                ) or canonical_effect_json(envelope.intent.target) != canonical_effect_json(target):
                    raise NativePolicyStopped("native_effect_arguments_changed")
                # API owns materialization and the adjacent physical dispatch claim.
                # Errors remain control and close this issued operation as unknown.
                response = await client.invoke(
                    execution_context=execution_context,
                    tool_config=tool_config,
                    tool_parameters=prepared,
                )
                return response.observation
            prepared = tool_arguments
            if tool_config.uses_plugin_parameters:
                try:
                    prepared = await _prepare_tool_arguments(
                        tool_config.parameters, tool_config, tool_arguments, file_context=file_context
                    )
                except DifyPluginToolClientError as exc:
                    return f"tool invoke error: {exc}"
                except ValueError as exc:
                    return f"tool parameters validation error: {exc}, please check your tool parameters"
            try:
                response = await client.invoke(
                    execution_context=execution_context,
                    tool_config=tool_config,
                    tool_parameters=cast(dict[str, JsonValue], prepared),
                )
                return response.observation
            except DifyCoreToolsClientConfigurationError:
                return "Tool is unavailable because required execution context is missing."
            except DifyCoreToolsClientError as exc:
                return _tool_error_text(tool_name=tool_name, error=exc)

        async def prepare_tool_definition(_ctx: RunContext[Deps], tool_def: ToolDefinition) -> ToolDefinition:
            return replace(tool_def, parameters_json_schema=tool_schema, strict=CORE_TOOL_STRICT)

        return Tool(
            invoke_tool,
            takes_ctx=True,
            name=tool_name,
            description=tool_description,
            prepare=prepare_tool_definition,
            metadata={
                "native_effect": NativeToolBoundary(
                    boundary="core_tool",
                    target={
                        "provider_type": tool_config.provider_type,
                        "provider_id": tool_config.provider_id,
                        "tool_name": tool_config.tool_name,
                    },
                    prepare_arguments=native_arguments,
                )
            },
        )


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
