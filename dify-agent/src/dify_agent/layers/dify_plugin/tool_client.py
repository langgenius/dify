"""Async plugin-daemon client for Dify plugin tool invocation.

The agent runtime talks to the plugin daemon rather than importing provider SDKs
directly. The tools layer now consumes API-prepared declarations from config, so
this module only keeps the invoke-time boundary:

- POST ``/plugin/{tenant_id}/dispatch/tool/invoke``
- request headers ``X-Api-Key``, ``X-Plugin-ID``, and ``Content-Type``
- top-level ``user_id`` forwarding when shared execution context includes one
- stream decoding and blob-chunk merging for agent observations

The shared execution-context layer still owns tenant/user daemon context, while
each tool's own ``plugin_id`` determines the transport identity placed in
``X-Plugin-ID``.
"""

from __future__ import annotations

import base64
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from enum import StrEnum

import httpx
from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator

from dify_agent.layers.dify_plugin.configs import DifyPluginToolCredentialType
from dify_agent.plugin_daemon_transport import (
    decode_plugin_daemon_error_payload,
    to_plugin_daemon_jsonable,
    unwrap_plugin_daemon_error,
)


class PluginDaemonBasicResponse(BaseModel):
    """Common plugin-daemon stream and JSON wrapper."""

    code: int
    message: str
    data: object | None = None


@dataclass(slots=True)
class FileChunk:
    """Buffer for accumulating streamed blob chunks."""

    total_length: int
    bytes_written: int = field(default=0, init=False)
    data: bytearray = field(init=False)

    def __post_init__(self) -> None:
        self.data = bytearray(self.total_length)


class DifyPluginToolInvokeMessage(BaseModel):
    """Subset of Dify tool stream messages needed for agent observations."""

    class TextMessage(BaseModel):
        text: str

    class JsonMessage(BaseModel):
        json_object: dict[str, object] | list[object]
        suppress_output: bool = False

    class BlobMessage(BaseModel):
        blob: bytes

    class BlobChunkMessage(BaseModel):
        id: str
        sequence: int
        total_length: int
        blob: bytes
        end: bool

    class FileMessage(BaseModel):
        file_marker: str = "file_marker"

        @model_validator(mode="before")
        @classmethod
        def validate_file_marker(cls, values: object) -> object:
            if isinstance(values, dict) and "file_marker" not in values:
                raise ValueError("Invalid FileMessage: missing file_marker")
            return values

    class VariableMessage(BaseModel):
        variable_name: str
        variable_value: object
        stream: bool = False

    class LogMessage(BaseModel):
        id: str
        label: str
        parent_id: str | None = None
        error: str | None = None
        status: str
        data: Mapping[str, object] = Field(default_factory=dict)
        metadata: Mapping[str, object] = Field(default_factory=dict)

    class MessageType(StrEnum):
        TEXT = "text"
        IMAGE = "image"
        LINK = "link"
        BLOB = "blob"
        JSON = "json"
        IMAGE_LINK = "image_link"
        BINARY_LINK = "binary_link"
        VARIABLE = "variable"
        FILE = "file"
        LOG = "log"
        BLOB_CHUNK = "blob_chunk"

    type: MessageType = MessageType.TEXT
    message: (
        TextMessage | JsonMessage | BlobChunkMessage | BlobMessage | LogMessage | FileMessage | VariableMessage | None
    )
    meta: dict[str, object] | None = None

    @field_validator("message", mode="before")
    @classmethod
    def decode_message(cls, value: object, info: ValidationInfo) -> object:
        if isinstance(value, dict) and "blob" in value:
            try:
                value = {**value, "blob": base64.b64decode(value["blob"])}
            except Exception:
                return value

        msg_type = info.data.get("type") if isinstance(info.data, dict) else None
        if msg_type == cls.MessageType.JSON and isinstance(value, dict) and "json_object" not in value:
            return {"json_object": value}
        if msg_type == cls.MessageType.FILE and isinstance(value, dict):
            return {"file_marker": value.get("file_marker", "file_marker")}
        return value


class DifyPluginToolClientError(Exception):
    """Raised when the plugin daemon rejects a tool-layer request."""

    error_type: str | None
    status_code: int | None

    def __init__(self, message: str, *, error_type: str | None = None, status_code: int | None = None) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.status_code = status_code


@dataclass(slots=True)
class DifyPluginDaemonToolClient:
    """HTTP wrapper for the invoke-only plugin-daemon tool boundary.

    Callers provide business-level provider/tool/credential data per invocation,
    while this client supplies daemon transport identity from shared runtime
    context: tenant path segment, daemon API key, plugin-specific ``X-Plugin-ID``
    header, and optional top-level ``user_id``.
    """

    plugin_daemon_url: str
    plugin_daemon_api_key: str
    tenant_id: str
    plugin_id: str
    user_id: str | None
    http_client: httpx.AsyncClient = field(repr=False)

    def __post_init__(self) -> None:
        self.plugin_daemon_url = self.plugin_daemon_url.rstrip("/")

    async def invoke(
        self,
        *,
        provider: str,
        tool_name: str,
        credential_type: DifyPluginToolCredentialType,
        credentials: dict[str, object],
        tool_parameters: Mapping[str, object],
    ) -> list[DifyPluginToolInvokeMessage]:
        """Invoke a plugin tool and collect its observation stream."""
        raw_messages = [
            item
            async for item in self._iter_stream_response(
                path=f"plugin/{self.tenant_id}/dispatch/tool/invoke",
                request_data={
                    "provider": provider,
                    "tool": tool_name,
                    "credentials": credentials,
                    "credential_type": credential_type,
                    "tool_parameters": dict(tool_parameters),
                },
                response_model=DifyPluginToolInvokeMessage,
            )
        ]
        return merge_blob_chunks(raw_messages)

    async def _iter_stream_response[T: BaseModel](
        self,
        *,
        path: str,
        request_data: Mapping[str, object],
        response_model: type[T],
    ) -> AsyncIterator[T]:
        """Send one daemon stream request and yield typed items.

        The daemon expects the actual invoke payload nested under ``data``. When
        the shared plugin context included ``user_id``, it is forwarded as a
        top-level peer to ``data`` so daemon-side auditing and credential logic
        can attribute the request to the end user.
        """
        payload: dict[str, object] = {"data": to_plugin_daemon_jsonable(dict(request_data))}
        if self.user_id is not None:
            payload["user_id"] = self.user_id

        url = f"{self.plugin_daemon_url}/{path}"
        async with self.http_client.stream("POST", url, headers=self._headers(), json=payload) as response:
            if response.is_error:
                body = (await response.aread()).decode("utf-8", errors="replace")
                error = decode_plugin_daemon_error_payload(body)
                if error is not None:
                    resolved_error = unwrap_plugin_daemon_error(
                        error_type=error["error_type"],
                        message=error["message"],
                    )
                    _raise_tool_daemon_error(
                        error_type=resolved_error["error_type"],
                        message=resolved_error["message"],
                        status_code=response.status_code,
                    )
                raise DifyPluginToolClientError(
                    body or "Plugin daemon stream request failed.", status_code=response.status_code
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
                        _raise_tool_daemon_error(
                            error_type=resolved_error["error_type"],
                            message=resolved_error["message"],
                        )
                    raise DifyPluginToolClientError(wrapped.message or "Plugin daemon returned an error stream item.")
                if wrapped.data is None:
                    raise DifyPluginToolClientError("Plugin daemon returned an empty stream item.")
                yield response_model.model_validate(wrapped.data)

    def _headers(self) -> dict[str, str]:
        """Build required plugin-daemon transport headers for tool invocation."""
        return {
            "X-Api-Key": self.plugin_daemon_api_key,
            "X-Plugin-ID": self.plugin_id,
            "Content-Type": "application/json",
        }


def merge_blob_chunks(
    response: list[DifyPluginToolInvokeMessage],
    *,
    max_file_size: int = 30 * 1024 * 1024,
    max_chunk_size: int = 8192,
) -> list[DifyPluginToolInvokeMessage]:
    """Merge streamed blob chunks into complete blob messages.

    This mirrors Dify API's plugin-daemon chunk-merging behavior before the
    higher-level observation conversion logic sees tool stream messages.
    """
    files: dict[str, FileChunk] = {}
    merged_messages: list[DifyPluginToolInvokeMessage] = []

    for resp in response:
        if resp.type is DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK:
            if not isinstance(resp.message, DifyPluginToolInvokeMessage.BlobChunkMessage):
                raise TypeError("Blob chunk responses must carry BlobChunkMessage payloads.")

            chunk_id = resp.message.id
            total_length = resp.message.total_length
            blob_data = resp.message.blob
            is_end = resp.message.end

            if chunk_id not in files:
                files[chunk_id] = FileChunk(total_length)

            if files[chunk_id].bytes_written + len(blob_data) > max_file_size:
                del files[chunk_id]
                raise ValueError(f"File is too large which reached the limit of {max_file_size / 1024 / 1024}MB")
            if len(blob_data) > max_chunk_size:
                raise ValueError(f"File chunk is too large which reached the limit of {max_chunk_size / 1024}KB")

            files[chunk_id].data[files[chunk_id].bytes_written : files[chunk_id].bytes_written + len(blob_data)] = (
                blob_data
            )
            files[chunk_id].bytes_written += len(blob_data)

            if is_end:
                merged_messages.append(
                    DifyPluginToolInvokeMessage(
                        type=DifyPluginToolInvokeMessage.MessageType.BLOB,
                        message=DifyPluginToolInvokeMessage.BlobMessage(
                            blob=bytes(files[chunk_id].data[: files[chunk_id].bytes_written])
                        ),
                        meta=resp.meta,
                    )
                )
                del files[chunk_id]
        else:
            merged_messages.append(resp)

    return merged_messages


def _raise_tool_daemon_error(
    *,
    error_type: str,
    message: str,
    status_code: int | None = None,
) -> None:
    raise DifyPluginToolClientError(message, error_type=error_type, status_code=status_code)


__all__ = [
    "DifyPluginDaemonToolClient",
    "DifyPluginToolClientError",
    "DifyPluginToolCredentialType",
    "DifyPluginToolInvokeMessage",
    "merge_blob_chunks",
]
