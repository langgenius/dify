"""Dify plugin tools layer for agent-accessible plugin tools.

This layer consumes API-prepared plugin tool declarations. The API side is
responsible for resolving daemon declarations, applying runtime-parameter
overrides, and producing the clean LLM-facing JSON schema. At run time the layer
only validates hidden/manual inputs, prepares invocation arguments, and maps
daemon responses into agent-friendly observations.

Like the LLM layer, this layer never owns live HTTP clients. The runtime passes
the FastAPI lifespan-owned shared plugin-daemon and Dify API clients into
``get_tools`` so the layer can build Pydantic AI tool adapters on demand.
"""

from __future__ import annotations

from copy import deepcopy
import json
import mimetypes
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import override
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, ConfigDict
from pydantic_ai import RunContext, Tool
from pydantic_ai.tools import ToolDefinition

from pydantic_ai.toolsets import FunctionToolset
from dify_agent.runtime.context import Deps
from dify_agent.agent_stub.protocol import AgentStubFileMapping, format_media_observation
from dify_agent.layers.agent_files import (
    AgentFileDownload,
    file_mapping_from_link,
    request_agent_file_download,
    upload_agent_tool_file,
    upload_sandbox_path,
)
from dify_agent.layers.dify_plugin.configs import (
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
from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig
from dify_agent.layers.execution_context.layer import Capability as ExecutionContextCapability


# Plugin tools intentionally do not expose a per-tool strictness override in the
# public config. The API supplies already-prepared schemas, but Dify Agent always
# registers those tools in loose mode so daemon tool invocation stays tolerant of
# plugin schema differences and older API-prepared payloads.
PLUGIN_TOOL_STRICT = False
PLUGIN_FILE_DEFAULT_TYPE = "custom"
_SUPPORTED_REMOTE_URL_PREFIXES = ("http://", "https://")


class Config(DifyPluginToolsLayerConfig):
    pass


class State(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Toolset(FunctionToolset[Deps]):
    """Prepare native tools once per run; all clients and shell resources are borrowed."""

    def __init__(self, name: str):
        super().__init__(id=name)
        self.name = name
        self._loaded = False

    @override
    async def get_tools(self, ctx: RunContext[Deps]):
        if not self._loaded:
            config = Config.model_validate(ctx.deps.layers[self.name]["config"])
            services = ctx.deps.services
            if services.dify_api_http_client.is_closed:
                raise RuntimeError("Plugin tools require an open shared Dify API HTTP client.")
            tool_clients: dict[tuple[str, str | None], DifyPluginDaemonToolClient] = {}
            file_context = _PluginToolFileContext(
                execution_context=DifyExecutionContextLayerConfig.model_validate(
                    ctx.deps.layers[config.execution_context]["config"]
                ),
                deps=ctx.deps,
                shell=config.shell,
            )
            for tool_config in config.tools:
                plugin_identity = (tool_config.plugin_id, tool_config.plugin_unique_identifier)
                client = tool_clients.get(plugin_identity)
                if client is None:
                    client = ExecutionContextCapability.create_tool_client(
                        ctx.deps,
                        config.execution_context,
                        plugin_id=tool_config.plugin_id,
                        plugin_unique_identifier=tool_config.plugin_unique_identifier,
                        http_client=services.plugin_daemon_http_client,
                    )
                    tool_clients[plugin_identity] = client
                effective_parameters = [parameter.model_copy(deep=True) for parameter in tool_config.parameters]
                _validate_required_hidden_parameters(tool_config, effective_parameters)
                self.add_tool(
                    _build_pydantic_ai_tool(
                        client=client,
                        tool_config=tool_config,
                        effective_parameters=effective_parameters,
                        file_context=file_context,
                    )
                )
            self._loaded = True
        return await super().get_tools(ctx)


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
    file_context: "_PluginToolFileContext",
) -> Tool[Deps]:
    tool_name = tool_config.name or tool_config.tool_name
    tool_description = tool_config.description or tool_name
    tool_schema = deepcopy(tool_config.parameters_json_schema)

    async def invoke_tool(_ctx: RunContext[Deps], **tool_arguments: object) -> str:
        try:
            merged_arguments = await _prepare_tool_arguments(
                effective_parameters,
                tool_config,
                tool_arguments,
                file_context=file_context,
            )
            messages = await client.invoke(
                provider=tool_config.provider,
                tool_name=tool_config.tool_name,
                credential_type=tool_config.credential_type,
                credentials=dict(tool_config.credentials),
                tool_parameters=merged_arguments,
            )
            return await _convert_tool_response_to_text(messages, file_context=file_context)
        except DifyPluginToolClientError as exc:
            return _tool_error_text(tool_name=tool_name, error=exc)
        except ValueError as exc:
            return f"tool parameters validation error: {exc}, please check your tool parameters"
        except httpx.HTTPError as exc:
            return f"tool file request failed: {exc}"

    async def prepare_tool_definition(_ctx: RunContext[Deps], tool_def: ToolDefinition) -> ToolDefinition:
        return replace(tool_def, parameters_json_schema=tool_schema, strict=PLUGIN_TOOL_STRICT)

    return Tool(
        invoke_tool,
        takes_ctx=True,
        name=tool_name,
        description=tool_description,
        prepare=prepare_tool_definition,
    )


async def _prepare_tool_arguments(
    effective_parameters: Sequence[DifyPluginToolParameter],
    tool_config: DifyPluginToolConfig,
    tool_arguments: Mapping[str, object],
    *,
    file_context: "_PluginToolFileContext",
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
        prepared_arguments[parameter.name] = await _cast_tool_parameter_value(
            parameter.type,
            value,
            file_context=file_context,
        )

    for key, value in merged_arguments.items():
        prepared_arguments.setdefault(key, value)
    return prepared_arguments


@dataclass(slots=True)
class _PluginToolFileContext:
    execution_context: DifyExecutionContextLayerConfig
    deps: Deps
    shell: str | None

    async def to_plugin_file_parameter(self, value: object) -> dict[str, object]:
        """Convert a URL, workspace path or copied handle into a daemon file parameter.

        Display metadata on a handle is untrusted and ignored; managed files
        obtain authoritative metadata through the control plane. Invalid
        locators raise ValueError before daemon invocation.
        """
        if isinstance(value, str):
            if _is_remote_url(value):
                return _plugin_file_parameter_from_url(value)
            mapping = await self._upload_sandbox_path(value)
            return await self._plugin_file_parameter_from_mapping(mapping)

        if isinstance(value, Mapping):
            if _is_plugin_file_parameter(value):
                return _normalize_plugin_file_parameter(value)
            locator = {key: value[key] for key in ("transfer_method", "reference", "url") if key in value}
            return await self._plugin_file_parameter_from_mapping(AgentStubFileMapping.model_validate(locator))

        raise ValueError("file parameter must be an HTTP(S) URL, sandbox path, or file mapping.")

    async def _upload_sandbox_path(self, path: str) -> AgentStubFileMapping:
        if self.shell is None:
            raise ValueError("sandbox file path parameters require an active shell layer.")
        return await upload_sandbox_path(self.deps.resources.shells[self.shell], path)

    async def _plugin_file_parameter_from_mapping(self, mapping: AgentStubFileMapping) -> dict[str, object]:
        """Dispatch a validated locator without revalidating sandbox upload results."""
        if mapping.transfer_method == "remote_url":
            assert mapping.url is not None
            return _plugin_file_parameter_from_url(mapping.url)

        download = await request_agent_file_download(
            self.deps.services,
            self.execution_context,
            mapping,
        )
        return _plugin_file_parameter_from_download(download, base_url=self.deps.services.inner_api_url)


async def _cast_tool_parameter_value(
    parameter_type: DifyPluginToolParameterType,
    value: object,
    *,
    file_context: _PluginToolFileContext,
) -> object:
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
            values = value if isinstance(value, list) else [value]
            return [await file_context.to_plugin_file_parameter(item) for item in values]
        case DifyPluginToolParameterType.FILE:
            if isinstance(value, list):
                if len(value) != 1:
                    raise ValueError("This parameter only accepts one file but got multiple files while invoking.")
                return await file_context.to_plugin_file_parameter(value[0])
            return await file_context.to_plugin_file_parameter(value)
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


def _is_remote_url(value: str) -> bool:
    return value.lower().startswith(_SUPPORTED_REMOTE_URL_PREFIXES)


def _is_plugin_file_parameter(value: Mapping[str, object]) -> bool:
    url = value.get("url")
    return isinstance(url, str) and bool(url) and "transfer_method" not in value


def _normalize_plugin_file_parameter(value: Mapping[str, object]) -> dict[str, object]:
    url = value.get("url")
    if not isinstance(url, str) or not url:
        raise ValueError("plugin file parameter requires url.")
    return _plugin_file_parameter(
        url=url,
        filename=value.get("filename"),
        mime_type=value.get("mime_type"),
        extension=value.get("extension"),
        size=value.get("size"),
        file_type=value.get("type"),
    )


def _plugin_file_parameter_from_url(url: str) -> dict[str, object]:
    if not _is_remote_url(url):
        raise ValueError("remote file URL must start with http:// or https://.")
    filename = _filename_from_url(url)
    mime_type = mimetypes.guess_type(filename or url)[0] if filename else None
    return _plugin_file_parameter(
        url=url,
        filename=filename,
        mime_type=mime_type,
        extension=_extension_from_filename(filename),
        size=-1,
        file_type=PLUGIN_FILE_DEFAULT_TYPE,
    )


def _plugin_file_parameter_from_download(download: AgentFileDownload, *, base_url: str) -> dict[str, object]:
    return _plugin_file_parameter(
        url=base_url.rstrip("/") + download.download_uri
        if download.download_uri.startswith("/")
        else download.download_uri,
        filename=download.filename,
        mime_type=download.mime_type,
        extension=_extension_from_filename(download.filename),
        size=download.size,
        file_type=PLUGIN_FILE_DEFAULT_TYPE,
    )


def _plugin_file_parameter(
    *,
    url: str,
    filename: object,
    mime_type: object,
    extension: object,
    size: object,
    file_type: object,
) -> dict[str, object]:
    normalized: dict[str, object] = {
        "dify_model_identity": "__dify__file__",
        "type": file_type if isinstance(file_type, str) and file_type else PLUGIN_FILE_DEFAULT_TYPE,
        "url": url,
    }
    if isinstance(filename, str) and filename:
        normalized["filename"] = filename
    if isinstance(mime_type, str) and mime_type:
        normalized["mime_type"] = mime_type
    if isinstance(extension, str) and extension:
        normalized["extension"] = extension
    if isinstance(size, int):
        normalized["size"] = size
    return normalized


def _filename_from_url(url: str) -> str | None:
    parsed = urlparse(url)
    filename = parsed.path.rsplit("/", 1)[-1]
    return filename or None


def _extension_from_filename(filename: str | None) -> str | None:
    if not filename or "." not in filename:
        return None
    suffix = "." + filename.rsplit(".", 1)[-1]
    return suffix if len(suffix) > 1 else None


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


def _normalized_json_part(text: str) -> str:
    """Render one part as canonical JSON so formatting differences do not hide duplicates."""
    try:
        return json.dumps(json.loads(text), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (ValueError, RecursionError):
        return text


async def _convert_tool_response_to_text(
    tool_response: Sequence[DifyPluginToolInvokeMessage], *, file_context: _PluginToolFileContext
) -> str:
    """Convert daemon stream messages into the plain-text tool observation.

    This preserves the user-facing semantics Dify's agent tool runtime relies on:
    Text/JSON semantics are preserved. Media returns copyable locators only;
    plugin blobs are persisted first, and upload failures remain text without
    exposing the blob. Only an explicit read_media call attaches media later.
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
            DifyPluginToolInvokeMessage.MessageType.BINARY_LINK,
            DifyPluginToolInvokeMessage.MessageType.FILE,
            DifyPluginToolInvokeMessage.MessageType.BLOB,
            DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK,
        }:
            parts.append(await _media_response_to_text(response, file_context))
        elif response.type is DifyPluginToolInvokeMessage.MessageType.JSON:
            json_message = response.message
            if isinstance(json_message, DifyPluginToolInvokeMessage.JsonMessage) and not json_message.suppress_output:
                json_parts.append(json.dumps(json_message.json_object, ensure_ascii=False, default=str))
        elif response.type is DifyPluginToolInvokeMessage.MessageType.VARIABLE:
            continue
        else:
            parts.append(str(response.message))

    if json_parts:
        existing_parts = {_normalized_json_part(part) for part in parts}
        parts.extend(part for part in json_parts if _normalized_json_part(part) not in existing_parts)
    return "".join(parts)


async def _media_response_to_text(response: DifyPluginToolInvokeMessage, context: _PluginToolFileContext) -> str:
    """Persist blob outputs and soften file conversion errors into text observations.

    No media response, including a failed or incomplete blob, is stringified.
    The control plane rechecks authorization when the locator is consumed.
    """
    meta = response.meta or {}
    filename = meta.get("filename")
    filename = filename if isinstance(filename, str) and filename else None
    mime_type = meta.get("mime_type")
    mime_type = mime_type if isinstance(mime_type, str) and mime_type else None
    size = meta.get("size")
    size = size if isinstance(size, int) and not isinstance(size, bool) else None
    try:
        if response.type is DifyPluginToolInvokeMessage.MessageType.BLOB and isinstance(
            response.message, DifyPluginToolInvokeMessage.BlobMessage
        ):
            size = len(response.message.blob)
            mime_type = mime_type or "application/octet-stream"
            filename = filename or "tool-output" + (mimetypes.guess_extension(mime_type) or ".bin")
            mapping = await upload_agent_tool_file(
                context.deps.services,
                context.execution_context,
                content=response.message.blob,
                filename=filename,
                mime_type=mime_type,
                max_size=context.deps.services.agent_file_upload_max_bytes,
            )
        elif response.type is DifyPluginToolInvokeMessage.MessageType.FILE:
            file = meta.get("file")
            if not isinstance(file, dict):
                raise ValueError("file metadata is missing")
            mapping = AgentStubFileMapping.model_validate(
                {"transfer_method": "remote_url", "url": file.get("url") or file.get("remote_url")}
                if file.get("transfer_method") == "remote_url"
                else {"transfer_method": file.get("transfer_method"), "reference": file.get("reference")}
            )
            file_name = file.get("filename")
            file_mime_type = file.get("mime_type")
            file_size = file.get("size")
            filename = filename or (file_name if isinstance(file_name, str) else None)
            mime_type = mime_type or (file_mime_type if isinstance(file_mime_type, str) else None)
            size = (
                size
                if size is not None
                else (file_size if isinstance(file_size, int) and not isinstance(file_size, bool) else None)
            )
        elif isinstance(response.message, DifyPluginToolInvokeMessage.TextMessage):
            mapping = file_mapping_from_link(response.message.text)
            filename = filename or _filename_from_url(response.message.text)
            mime_type = mime_type or mimetypes.guess_type(filename or "")[0]
        else:
            raise ValueError("media output is incomplete or has no usable locator")
        return format_media_observation(mapping, filename=filename, mime_type=mime_type, size=size)
    except Exception as exc:
        return f"\nTool media unavailable ({filename}, {mime_type}, {size} bytes): {exc}.\n"


__all__ = ["Config", "State", "Toolset"]
