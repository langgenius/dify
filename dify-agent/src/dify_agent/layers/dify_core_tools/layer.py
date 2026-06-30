"""Dify core-tools layer for API-routed agent-accessible tools.

This layer consumes API-prepared tool declarations for provider families that
must execute inside the Dify API service boundary. The runtime keeps the same
prepared-parameter contract as the direct plugin layer, but invocation itself
is delegated to `POST /inner/api/agent/tools/invoke` so credentials and
provider-local state stay in the API process.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import ClassVar

import httpx
from pydantic_ai import RunContext, Tool
from pydantic_ai.tools import ToolDefinition
from typing_extensions import Self, override

from agenton.layers import LayerDeps, PlainLayer
from dify_agent.layers.dify_core_tools.client import (
    DifyCoreToolsClient,
    DifyCoreToolsClientConfigurationError,
    DifyCoreToolsClientError,
)
from dify_agent.layers.dify_core_tools.configs import (
    DIFY_CORE_TOOLS_LAYER_TYPE_ID,
    DifyCoreToolConfig,
    DifyCoreToolsLayerConfig,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer

CORE_TOOL_STRICT = False
TEMPORARY_UNAVAILABLE_OBSERVATION = "Tool is temporarily unavailable. Please continue without it if possible."


class DifyCoreToolsDeps(LayerDeps):
    """Dependencies required by `DifyCoreToolsLayer`."""

    execution_context: DifyExecutionContextLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyCoreToolsLayer(PlainLayer[DifyCoreToolsDeps, DifyCoreToolsLayerConfig]):
    """Layer that resolves API-routed Dify tools into Pydantic AI tools."""

    type_id: ClassVar[str | None] = DIFY_CORE_TOOLS_LAYER_TYPE_ID

    config: DifyCoreToolsLayerConfig
    inner_api_url: str
    inner_api_key: str

    @classmethod
    @override
    def from_config(cls, config: DifyCoreToolsLayerConfig) -> Self:
        del config
        raise TypeError(
            "DifyCoreToolsLayer requires server-side Dify API settings and must use a provider factory."
        )

    @classmethod
    def from_config_with_settings(
        cls,
        config: DifyCoreToolsLayerConfig,
        *,
        inner_api_url: str,
        inner_api_key: str,
    ) -> Self:
        return cls(
            config=DifyCoreToolsLayerConfig.model_validate(config),
            inner_api_url=inner_api_url,
            inner_api_key=inner_api_key,
        )

    async def get_tools(self, *, http_client: httpx.AsyncClient) -> list[Tool[object]]:
        if http_client.is_closed:
            raise RuntimeError("DifyCoreToolsLayer.get_tools() requires an open shared HTTP client.")

        execution_context = self.deps.execution_context.config
        client = DifyCoreToolsClient(
            base_url=self.inner_api_url,
            api_key=self.inner_api_key,
            http_client=http_client,
        )
        tools: list[Tool[object]] = []
        for tool_config in self.config.tools:
            tools.append(
                self._build_tool(
                    client=client,
                    execution_context=execution_context,
                    tool_config=tool_config,
                )
            )
        return tools

    @staticmethod
    def _build_tool(
        *,
        client: DifyCoreToolsClient,
        execution_context: DifyExecutionContextLayerConfig,
        tool_config: DifyCoreToolConfig,
    ) -> Tool[object]:
        tool_name = tool_config.name or tool_config.tool_name
        tool_description = tool_config.description or tool_name
        tool_schema = deepcopy(tool_config.parameters_json_schema)

        async def invoke_tool(_ctx: RunContext[object], **tool_arguments: object) -> str:
            try:
                response = await client.invoke(
                    execution_context=execution_context,
                    tool_config=tool_config,
                    tool_parameters=tool_arguments,
                )
                return response.observation
            except DifyCoreToolsClientConfigurationError:
                return "Tool is unavailable because required execution context is missing."
            except DifyCoreToolsClientError as exc:
                return _tool_error_text(tool_name=tool_name, error=exc)

        async def prepare_tool_definition(_ctx: RunContext[object], tool_def: ToolDefinition) -> ToolDefinition:
            return ToolDefinition(
                name=tool_def.name,
                description=tool_def.description,
                parameters_json_schema=tool_schema,
                strict=CORE_TOOL_STRICT,
                sequential=tool_def.sequential,
                metadata=tool_def.metadata,
                timeout=tool_def.timeout,
                defer_loading=tool_def.defer_loading,
                kind=tool_def.kind,
                return_schema=tool_def.return_schema,
                include_return_schema=tool_def.include_return_schema,
            )

        return Tool(
            invoke_tool,
            takes_ctx=True,
            name=tool_name,
            description=tool_description,
            prepare=prepare_tool_definition,
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


__all__ = ["DifyCoreToolsDeps", "DifyCoreToolsLayer"]
