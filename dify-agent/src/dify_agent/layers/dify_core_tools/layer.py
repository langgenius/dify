"""Dify core-tools layer for API-routed agent-accessible tools.

This layer consumes API-prepared tool declarations for provider families that
must execute inside the Dify API service boundary. The runtime keeps the same
prepared-parameter contract as the direct plugin layer, but invocation itself
is delegated to `POST /inner/api/agent/tools/invoke` so credentials and
provider-local state stay in the API process.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass
from typing import ClassVar

import httpx
from pydantic_ai import RunContext, Tool, ToolReturn
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
_DIFY_UI_ENVELOPE_KEY = "__dify_ui__"
_MAX_UI_MESSAGE_PAYLOAD_BYTES = 128 * 1024
_MAX_UI_MESSAGES_PER_TOOL_CALL = 16
_MAX_UI_MESSAGES_PAYLOAD_BYTES = 512 * 1024


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
        raise TypeError("DifyCoreToolsLayer requires server-side Dify API settings and must use a provider factory.")

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

        async def invoke_tool(_ctx: RunContext[object], **tool_arguments: object) -> str | ToolReturn:
            try:
                response = await client.invoke(
                    execution_context=execution_context,
                    tool_config=tool_config,
                    tool_parameters=tool_arguments,
                )
                ui_messages = _extract_ui_messages(response.messages)
                if ui_messages:
                    return ToolReturn(
                        response.observation,
                        metadata={"dify_ui_messages": ui_messages},
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


def _extract_ui_messages(messages: Sequence[Mapping[str, object]]) -> list[dict[str, object]]:
    """Extract a bounded UI batch, dropping the complete batch on invalid input."""
    ui_messages: list[dict[str, object]] = []
    ui_payload_size = 2  # Compact JSON encoding of an empty list.

    def append_ui_message(value: object) -> bool:
        nonlocal ui_payload_size
        if len(ui_messages) >= _MAX_UI_MESSAGES_PER_TOOL_CALL:
            return False
        payload = _normalize_ui_payload(value)
        if payload is None:
            return False
        try:
            encoded = json.dumps(
                payload,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            ).encode()
        except (TypeError, ValueError):
            return False
        if len(encoded) > _MAX_UI_MESSAGE_PAYLOAD_BYTES:
            return False
        candidate_size = ui_payload_size + len(encoded) + int(bool(ui_messages))
        if candidate_size > _MAX_UI_MESSAGES_PAYLOAD_BYTES:
            return False
        ui_messages.append(payload)
        ui_payload_size = candidate_size
        return True

    for tool_message in messages:
        message_type = tool_message.get("type")
        payload = tool_message.get("message")
        if not isinstance(payload, dict):
            continue
        if message_type == "ui":
            if not append_ui_message(payload):
                return []
            continue
        if message_type == "variable":
            if payload.get("variable_name") == _DIFY_UI_ENVELOPE_KEY and not append_ui_message(
                payload.get("variable_value")
            ):
                return []
            continue
        if message_type == "json":
            json_object = payload.get("json_object")
            if isinstance(json_object, dict) and set(json_object) == {_DIFY_UI_ENVELOPE_KEY}:
                if not append_ui_message(json_object[_DIFY_UI_ENVELOPE_KEY]):
                    return []
    return ui_messages


def _normalize_ui_payload(value: object) -> dict[str, object] | None:
    """Validate the transport-level UI envelope shared with the plugin boundary."""
    if not isinstance(value, dict):
        return None
    required_keys = {"protocol", "protocol_version", "messages"}
    allowed_keys = required_keys | {"fallback"}
    if not required_keys.issubset(value) or not set(value).issubset(allowed_keys):
        return None
    if value.get("protocol") != "a2ui" or value.get("protocol_version") != "v0.9.1":
        return None
    ui_operations = value.get("messages")
    if (
        not isinstance(ui_operations, list)
        or not 1 <= len(ui_operations) <= 64
        or not all(isinstance(operation, dict) for operation in ui_operations)
    ):
        return None
    fallback = value.get("fallback")
    if fallback is not None and (not isinstance(fallback, str) or len(fallback) > 4096):
        return None

    payload = dict(value)
    if fallback is None:
        payload.pop("fallback", None)
    return payload


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
