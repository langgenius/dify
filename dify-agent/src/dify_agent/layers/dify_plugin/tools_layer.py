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
from dataclasses import dataclass, field
from typing import ClassVar
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, ConfigDict, JsonValue, ValidationError
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
from dify_agent.layers.shell.layer import DifyShellLayer


# Plugin tools intentionally do not expose a per-tool strictness override in the
# public config. The API supplies already-prepared schemas, but Dify Agent always
# registers those tools in loose mode so daemon tool invocation stays tolerant of
# plugin schema differences and older API-prepared payloads.
PLUGIN_TOOL_STRICT = False
PLUGIN_FILE_DEFAULT_TYPE = "custom"
_FILE_UPLOAD_BEGIN = "<<<DIFY_PLUGIN_TOOL_FILE_UPLOAD_BEGIN>>>"
_FILE_UPLOAD_END = "<<<DIFY_PLUGIN_TOOL_FILE_UPLOAD_END>>>"
_FILE_UPLOAD_TIMEOUT_SECONDS = 60.0
_SUPPORTED_REMOTE_URL_PREFIXES = ("http://", "https://")


class DifyPluginToolsDeps(LayerDeps):
    """Dependencies required by ``DifyPluginToolsLayer``."""

    execution_context: DifyExecutionContextLayer  # pyright: ignore[reportUninitializedInstanceVariable]
    shell: DifyShellLayer | None  # pyright: ignore[reportUninitializedInstanceVariable]


class DifyPluginToolsClientConfigurationError(ValueError):
    """Raised when local plugin-tool file conversion preconditions are missing."""


class _BackwardsInvocationEnvelope(BaseModel):
    data: JsonValue = None
    error: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore")


class _DownloadFileResponse(BaseModel):
    filename: str
    mime_type: str | None = None
    size: int
    download_url: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


@dataclass(slots=True)
class _DifyPluginToolFileClient:
    """Resolve Dify file mappings into signed URLs for plugin file parameters."""

    base_url: str
    api_key: str = field(repr=False)
    http_client: httpx.AsyncClient = field(repr=False)

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")

    async def request_download(
        self,
        *,
        execution_context: object,
        file_mapping: Mapping[str, object],
    ) -> _DownloadFileResponse:
        missing_fields = [
            field_name
            for field_name in ("user_id", "user_from")
            if getattr(execution_context, field_name, None) is None
        ]
        if missing_fields:
            missing = ", ".join(missing_fields)
            raise DifyPluginToolsClientConfigurationError(
                f"Missing required execution context fields for file parameters: {missing}."
            )

        payload = {
            "tenant_id": getattr(execution_context, "tenant_id"),
            "user_id": getattr(execution_context, "user_id"),
            "user_from": getattr(execution_context, "user_from"),
            "invoke_from": getattr(execution_context, "invoke_from"),
            "file": dict(file_mapping),
        }
        try:
            response = await self.http_client.post(
                f"{self.base_url}/inner/api/download/file/request",
                headers={
                    "X-Inner-Api-Key": self.api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        except (httpx.InvalidURL, httpx.UnsupportedProtocol) as exc:
            raise DifyPluginToolClientError(f"Dify API file download is misconfigured: {exc}") from exc
        except httpx.TimeoutException as exc:
            raise DifyPluginToolClientError("Dify API file download request timed out.") from exc
        except httpx.RequestError as exc:
            raise DifyPluginToolClientError(f"Dify API file download request failed: {exc}") from exc

        if response.status_code >= 400:
            raise DifyPluginToolClientError(
                response.text or f"HTTP {response.status_code}", status_code=response.status_code
            )
        try:
            envelope = _BackwardsInvocationEnvelope.model_validate_json(response.text)
        except ValidationError as exc:
            raise DifyPluginToolClientError("Invalid Dify API file download response.") from exc
        if envelope.error:
            raise DifyPluginToolClientError(envelope.error, status_code=response.status_code)
        if not isinstance(envelope.data, dict):
            raise DifyPluginToolClientError("Dify API file download response is missing data.")
        try:
            return _DownloadFileResponse.model_validate(envelope.data)
        except ValidationError as exc:
            raise DifyPluginToolClientError("Invalid Dify API file download data.") from exc


@dataclass(slots=True)
class DifyPluginToolsLayer(PlainLayer[DifyPluginToolsDeps, DifyPluginToolsLayerConfig]):
    """Layer that resolves Dify plugin tools into Pydantic AI tools."""

    type_id: ClassVar[str | None] = DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID

    config: DifyPluginToolsLayerConfig
    inner_api_url: str
    inner_api_key: str

    @classmethod
    @override
    def from_config(cls, config: DifyPluginToolsLayerConfig) -> Self:
        """Reject construction without server-injected Dify API settings."""
        del config
        raise TypeError("DifyPluginToolsLayer requires server-side Dify API settings and must use a provider factory.")

    @classmethod
    def from_config_with_settings(
        cls,
        config: DifyPluginToolsLayerConfig,
        *,
        inner_api_url: str,
        inner_api_key: str,
    ) -> Self:
        return cls(
            config=DifyPluginToolsLayerConfig.model_validate(config),
            inner_api_url=inner_api_url,
            inner_api_key=inner_api_key,
        )

    async def get_tools(
        self,
        *,
        http_client: httpx.AsyncClient,
        dify_api_http_client: httpx.AsyncClient,
    ) -> list[Tool[object]]:
        """Build Pydantic AI tool adapters from prepared plugin tool config."""
        if dify_api_http_client.is_closed:
            raise RuntimeError("DifyPluginToolsLayer.get_tools() requires an open shared Dify API HTTP client.")

        tool_clients: dict[str, DifyPluginDaemonToolClient] = {}
        tools: list[Tool[object]] = []
        file_client = _DifyPluginToolFileClient(
            base_url=self.inner_api_url,
            api_key=self.inner_api_key,
            http_client=dify_api_http_client,
        )
        file_context = _PluginToolFileContext(
            file_client=file_client,
            execution_context=self.deps.execution_context.config,
            shell=self.deps.shell,
        )

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
                    file_context=file_context,
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
    file_context: "_PluginToolFileContext",
) -> Tool[object]:
    tool_name = tool_config.name or tool_config.tool_name
    tool_description = tool_config.description or tool_name
    tool_schema = deepcopy(tool_config.parameters_json_schema)

    async def invoke_tool(_ctx: RunContext[object], **tool_arguments: object) -> str:
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
    file_client: _DifyPluginToolFileClient
    execution_context: object
    shell: DifyShellLayer | None

    async def to_plugin_file_parameter(self, value: object) -> dict[str, object]:
        if isinstance(value, str):
            if _is_remote_url(value):
                return _plugin_file_parameter_from_url(value)
            mapping = await self._upload_sandbox_path(value)
            return await self._plugin_file_parameter_from_mapping(mapping)

        if isinstance(value, Mapping):
            if _is_plugin_file_parameter(value):
                return _normalize_plugin_file_parameter(value)
            return await self._plugin_file_parameter_from_mapping(value)

        raise ValueError("file parameter must be an HTTP(S) URL, sandbox path, or file mapping.")

    async def _upload_sandbox_path(self, path: str) -> dict[str, object]:
        if self.shell is None:
            raise ValueError("sandbox file path parameters require an active shell layer.")
        script = (
            "python - <<'PY'\n"
            "import json\n"
            "import subprocess\n"
            "import sys\n\n"
            f"command = ['dify-agent', 'file', 'upload', {json.dumps(path)}]\n"
            "completed = subprocess.run(command, capture_output=True, text=True, check=False)\n"
            "if completed.returncode != 0:\n"
            "    print(completed.stderr or completed.stdout or f'upload exited with code {completed.returncode}', file=sys.stderr)\n"
            "    sys.exit(completed.returncode or 1)\n"
            "try:\n"
            "    payload = json.loads(completed.stdout)\n"
            "except ValueError as exc:\n"
            "    print(f'upload returned invalid JSON: {exc}', file=sys.stderr)\n"
            "    sys.exit(1)\n"
            f"print('{_FILE_UPLOAD_BEGIN}' + json.dumps(payload, separators=(',', ':')) + '{_FILE_UPLOAD_END}')\n"
            "PY"
        )
        result = await self.shell.run_remote_script_complete(
            script,
            timeout=_FILE_UPLOAD_TIMEOUT_SECONDS,
            inject_agent_stub_env=True,
        )
        if result.exit_code != 0:
            raise ValueError(
                "sandbox file upload failed: "
                + f"{result.status} exit_code={result.exit_code} output_complete={result.output_complete} "
                + result.output.strip()
            )
        return _parse_uploaded_file_mapping(result.output)

    async def _plugin_file_parameter_from_mapping(self, mapping: Mapping[str, object]) -> dict[str, object]:
        transfer_method = mapping.get("transfer_method")
        if transfer_method == "remote_url":
            url = mapping.get("url")
            if not isinstance(url, str) or not url:
                raise ValueError("remote_url file mapping requires url.")
            return _plugin_file_parameter_from_url(url)

        if transfer_method not in {"local_file", "tool_file", "datasource_file"}:
            raise ValueError(
                "file mapping transfer_method must be local_file, tool_file, datasource_file, or remote_url."
            )
        reference = mapping.get("reference")
        if not isinstance(reference, str) or not reference:
            raise ValueError(f"{transfer_method} file mapping requires reference.")

        download = await self.file_client.request_download(
            execution_context=self.execution_context,
            file_mapping={
                "transfer_method": transfer_method,
                "reference": reference,
            },
        )
        return _plugin_file_parameter_from_download(download)


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


def _plugin_file_parameter_from_download(download: _DownloadFileResponse) -> dict[str, object]:
    return _plugin_file_parameter(
        url=download.download_url,
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


def _parse_uploaded_file_mapping(output: str) -> dict[str, object]:
    begin_index = output.find(_FILE_UPLOAD_BEGIN)
    end_index = output.find(_FILE_UPLOAD_END, begin_index + len(_FILE_UPLOAD_BEGIN))
    if begin_index < 0 or end_index < 0:
        raise ValueError("sandbox file upload did not return a framed file mapping.")
    raw_payload = output[begin_index + len(_FILE_UPLOAD_BEGIN) : end_index]
    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        raise ValueError("sandbox file upload returned invalid file mapping JSON.") from exc
    if not isinstance(payload, dict):
        raise ValueError("sandbox file upload returned a non-object file mapping.")
    transfer_method = payload.get("transfer_method")
    reference = payload.get("reference")
    if transfer_method != "tool_file" or not isinstance(reference, str) or not reference:
        raise ValueError("sandbox file upload returned an invalid tool_file mapping.")
    return {"transfer_method": "tool_file", "reference": reference}


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
