"""Dify plugin tools layer for agent-accessible plugin tools.

This layer consumes API-prepared plugin tool declarations. The API side is
responsible for resolving daemon declarations, applying runtime-parameter
overrides, and producing the clean LLM-facing JSON schema. At run time the layer
only validates hidden/manual inputs, prepares invocation arguments, and maps
daemon responses into agent-friendly observations.

Like the LLM layer, this layer never owns live HTTP clients. The runtime passes
the FastAPI lifespan-owned shared client into ``get_tools`` so the layer can
build Pydantic AI tool adapters on demand.
"""

from __future__ import annotations

from copy import deepcopy
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import ClassVar

import httpx
from pydantic_ai import RunContext, Tool
from pydantic_ai.tools import ToolDefinition
from typing_extensions import Self, override

from agenton.layers import LayerDeps, PlainLayer
from dify_agent.layers.dify_plugin.configs import (
    DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
    DifyPluginToolConfig,
    DifyPluginToolParameter,
    DifyPluginToolParameterForm,
    DifyPluginToolParameterType,
    DifyPluginToolsLayerConfig,
)
from dify_agent.layers.dify_plugin.tool_client import (
    DifyPluginDaemonToolClient,
    DifyPluginToolClientError,
    DifyPluginToolInvokeMessage,
)
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer


# Plugin tools intentionally do not expose a per-tool strictness override in the
# public config. The API supplies already-prepared schemas, but Dify Agent always
# registers those tools in loose mode so daemon tool invocation stays tolerant of
# plugin schema differences and older API-prepared payloads.
PLUGIN_TOOL_STRICT = False


class DifyPluginToolsDeps(LayerDeps):
    """Dependencies required by ``DifyPluginToolsLayer``."""

    execution_context: DifyExecutionContextLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyPluginToolsLayer(PlainLayer[DifyPluginToolsDeps, DifyPluginToolsLayerConfig]):
    """Layer that resolves Dify plugin tools into Pydantic AI tools."""

    type_id: ClassVar[str | None] = DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID

    config: DifyPluginToolsLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyPluginToolsLayerConfig) -> Self:
        """Create the tools layer from validated public config."""
        return cls(config=DifyPluginToolsLayerConfig.model_validate(config))

    async def get_tools(self, *, http_client: httpx.AsyncClient) -> list[Tool[object]]:
        """Build Pydantic AI tool adapters from prepared plugin tool config."""
        tool_clients: dict[str, DifyPluginDaemonToolClient] = {}
        tools: list[Tool[object]] = []

        for tool_config in self.config.tools:
            client = tool_clients.get(tool_config.plugin_id)
            if client is None:
                client = self.deps.execution_context.create_tool_client(
                    plugin_id=tool_config.plugin_id,
                    http_client=http_client,
                )
                tool_clients[tool_config.plugin_id] = client
            effective_parameters = [parameter.model_copy(deep=True) for parameter in tool_config.parameters]
            _validate_required_hidden_parameters(tool_config, effective_parameters)

            tools.append(
                _build_pydantic_ai_tool(
                    client=client,
                    tool_config=tool_config,
                    effective_parameters=effective_parameters,
                )
            )

        return tools


def _validate_required_hidden_parameters(
    tool_config: DifyPluginToolConfig,
    effective_parameters: Sequence[DifyPluginToolParameter],
) -> None:
    missing_names = [
        parameter.name
        for parameter in effective_parameters
        if parameter.form is not DifyPluginToolParameterForm.LLM
        and parameter.required
        and parameter.default is None
        and parameter.name not in tool_config.runtime_parameters
    ]
    if missing_names:
        names = ", ".join(sorted(missing_names))
        raise ValueError(f"Tool '{tool_config.tool_name}' requires non-LLM runtime_parameters for: {names}.")


def _build_pydantic_ai_tool(
    *,
    client: DifyPluginDaemonToolClient,
    tool_config: DifyPluginToolConfig,
    effective_parameters: Sequence[DifyPluginToolParameter],
) -> Tool[object]:
    tool_name = tool_config.name or tool_config.tool_name
    tool_description = tool_config.description or tool_name
    tool_schema = deepcopy(tool_config.parameters_json_schema)

    async def invoke_tool(_ctx: RunContext[object], **tool_arguments: object) -> str:
        try:
            merged_arguments = _prepare_tool_arguments(effective_parameters, tool_config, tool_arguments)
            messages = await client.invoke(
                provider=tool_config.provider,
                tool_name=tool_config.tool_name,
                credential_type=tool_config.credential_type,
                credentials=dict(tool_config.credentials),
                tool_parameters=merged_arguments,
            )
            return _convert_tool_response_to_text(messages)
        except DifyPluginToolClientError as exc:
            return _tool_error_text(tool_name=tool_name, error=exc)
        except ValueError as exc:
            return f"tool parameters validation error: {exc}, please check your tool parameters"

    async def prepare_tool_definition(_ctx: RunContext[object], tool_def: ToolDefinition) -> ToolDefinition:
        return ToolDefinition(
            name=tool_def.name,
            description=tool_def.description,
            parameters_json_schema=tool_schema,
            strict=PLUGIN_TOOL_STRICT,
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


def _prepare_tool_arguments(
    effective_parameters: Sequence[DifyPluginToolParameter],
    tool_config: DifyPluginToolConfig,
    tool_arguments: Mapping[str, object],
) -> dict[str, object]:
    """Build the daemon invocation payload from prepared config + model args.

    Argument precedence intentionally mirrors the old Dify tool runtime contract:

    1. start from config-supplied ``runtime_parameters`` for hidden/manual inputs;
    2. let model-supplied tool arguments override same-named entries;
    3. if neither provided a value, fall back to the prepared parameter default;
    4. if a required parameter still has no value, raise validation error.

    Only parameters declared in ``effective_parameters`` are type-cast here;
    extra merged keys are passed through unchanged for forward compatibility with
    prepared config that may contain additional daemon inputs.
    """
    merged_arguments: dict[str, object] = dict(tool_config.runtime_parameters)
    merged_arguments.update(tool_arguments)
    prepared_arguments: dict[str, object] = {}

    for parameter in effective_parameters:
        if parameter.name in merged_arguments:
            value = merged_arguments[parameter.name]
        elif parameter.default is not None:
            value = parameter.default
        elif parameter.required:
            raise ValueError(f"tool parameter {parameter.name} not found in tool config")
        else:
            continue
        prepared_arguments[parameter.name] = _cast_tool_parameter_value(parameter.type, value)

    for key, value in merged_arguments.items():
        prepared_arguments.setdefault(key, value)
    return prepared_arguments


def _cast_tool_parameter_value(parameter_type: DifyPluginToolParameterType, value: object) -> object:
    """Cast prepared tool argument values into daemon-facing wire shapes.

    The API side prepares declaration metadata, but the actual invocation payload
    still needs to match Dify plugin-daemon expectations. This helper keeps the
    runtime-side coercion rules for common scalar, collection, file, and selector
    parameter types so model-supplied JSON values and config-supplied hidden
    inputs are normalized before transport.
    """
    match parameter_type:
        case (
            DifyPluginToolParameterType.STRING
            | DifyPluginToolParameterType.SECRET_INPUT
            | DifyPluginToolParameterType.SELECT
            | DifyPluginToolParameterType.CHECKBOX
            | DifyPluginToolParameterType.DYNAMIC_SELECT
        ):
            return "" if value is None else value if isinstance(value, str) else str(value)
        case DifyPluginToolParameterType.BOOLEAN:
            if value is None:
                return False
            if isinstance(value, str):
                lowered = value.lower()
                if lowered in {"true", "yes", "y", "1"}:
                    return True
                if lowered in {"false", "no", "n", "0"}:
                    return False
            return value if isinstance(value, bool) else bool(value)
        case DifyPluginToolParameterType.NUMBER:
            if isinstance(value, int | float):
                return value
            if isinstance(value, str) and value:
                return float(value) if "." in value else int(value)
            return value
        case DifyPluginToolParameterType.SYSTEM_FILES | DifyPluginToolParameterType.FILES:
            return value if isinstance(value, list) else [value]
        case DifyPluginToolParameterType.FILE:
            if isinstance(value, list):
                if len(value) != 1:
                    raise ValueError("This parameter only accepts one file but got multiple files while invoking.")
                return value[0]
            return value
        case DifyPluginToolParameterType.MODEL_SELECTOR | DifyPluginToolParameterType.APP_SELECTOR:
            if not isinstance(value, dict):
                raise ValueError("The selector must be a dictionary.")
            return value
        case DifyPluginToolParameterType.ANY:
            if value is not None and not isinstance(value, dict | list | str | int | float | bool):
                raise ValueError("The var selector must be a string, dictionary, list or number.")
            return value
        case DifyPluginToolParameterType.ARRAY:
            if isinstance(value, list):
                return value
            if isinstance(value, str):
                try:
                    parsed_value = json.loads(value)
                except json.JSONDecodeError:
                    return [value]
                if isinstance(parsed_value, list):
                    return parsed_value
            return [value]
        case DifyPluginToolParameterType.OBJECT:
            if isinstance(value, dict):
                return value
            if isinstance(value, str):
                try:
                    parsed_value = json.loads(value)
                except json.JSONDecodeError:
                    return {}
                if isinstance(parsed_value, dict):
                    return parsed_value
            return {}

    raise AssertionError(f"Unsupported tool parameter type: {parameter_type}")


def _tool_error_text(*, tool_name: str, error: DifyPluginToolClientError) -> str:
    """Map expected daemon/tool failures into agent-visible observation text.

    Only known plugin-daemon rejection categories should be softened into tool
    observations. Unexpected local bugs are intentionally not handled here and
    should propagate so tests and callers notice the regression.
    """
    error_type = error.error_type or ""
    if any(token in error_type for token in ("Credential", "Authorization", "Unauthorized")):
        return "Please check your tool provider credentials"
    if any(token in error_type for token in ("ToolNotFound", "ProviderNotFound")):
        return f"there is not a tool named {tool_name}"
    if error.status_code == 400 or any(token in error_type for token in ("BadRequest", "Validate", "Validation")):
        return f"tool parameters validation error: {error}, please check your tool parameters"
    return f"tool invoke error: {error}"


def _convert_tool_response_to_text(tool_response: Sequence[DifyPluginToolInvokeMessage]) -> str:
    """Convert daemon stream messages into the plain-text tool observation.

    This preserves the user-facing semantics Dify's agent tool runtime relies on:
    text is appended directly, links/images become user-check instructions, JSON
    output is included unless explicitly suppressed, variable messages stay
    internal, and everything else falls back to ``str(message)``. JSON fragments
    are deduplicated against existing text so mixed text/JSON streams do not
    repeat the same content unnecessarily.
    """
    parts: list[str] = []
    json_parts: list[str] = []

    for response in tool_response:
        if response.type is DifyPluginToolInvokeMessage.MessageType.TEXT:
            text_message = response.message
            if isinstance(text_message, DifyPluginToolInvokeMessage.TextMessage):
                parts.append(text_message.text)
        elif response.type is DifyPluginToolInvokeMessage.MessageType.LINK:
            link_message = response.message
            if isinstance(link_message, DifyPluginToolInvokeMessage.TextMessage):
                parts.append(f"result link: {link_message.text}. please tell user to check it.")
        elif response.type in {
            DifyPluginToolInvokeMessage.MessageType.IMAGE_LINK,
            DifyPluginToolInvokeMessage.MessageType.IMAGE,
        }:
            parts.append(
                "image has been created and sent to user already, "
                "you do not need to create it, just tell the user to check it now."
            )
        elif response.type is DifyPluginToolInvokeMessage.MessageType.JSON:
            json_message = response.message
            if isinstance(json_message, DifyPluginToolInvokeMessage.JsonMessage) and not json_message.suppress_output:
                json_parts.append(json.dumps(json_message.json_object, ensure_ascii=False, default=str))
        elif response.type is DifyPluginToolInvokeMessage.MessageType.VARIABLE:
            continue
        else:
            parts.append(str(response.message))

    if json_parts:
        existing_parts = set(parts)
        parts.extend(part for part in json_parts if part not in existing_parts)
    return "".join(parts)


__all__ = ["DifyPluginToolsDeps", "DifyPluginToolsLayer"]
