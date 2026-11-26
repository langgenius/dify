"""Async plugin-daemon client for Dify plugin tool invocation.

The agent runtime talks to the plugin daemon rather than importing provider SDKs
directly. The tools layer now consumes API-prepared declarations from config, so
this module only keeps the invoke-time boundary:

- POST ``/plugin/{tenant_id}/dispatch/tool/invoke``
- request headers ``X-Api-Key``, ``X-Plugin-ID``, ``X-Plugin-Unique-Identifier``, and ``Content-Type``
- top-level ``user_id`` forwarding when shared execution context includes one
- stream decoding and blob-chunk merging for agent observations

The shared execution-context layer still owns tenant/user daemon context, while
each tool's own ``plugin_id`` and ``plugin_unique_identifier`` bind the transport
to the package whose declaration and credentials were prepared by the API.
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Self

import httpx
from pydantic import (
    BaseModel,
    Field,
    ModelWrapValidatorHandler,
    PrivateAttr,
    ValidationError,
    ValidationInfo,
    field_validator,
    model_validator,
)

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
    next_sequence: int = field(default=0, init=False)
    data: bytearray = field(init=False)
    meta: dict[str, object] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        self.data = bytearray(self.total_length)


def _decode_blob_bytes(raw_blob: object) -> bytes:
    """Decode wire base64 strings strictly while accepting in-memory bytes."""
    if isinstance(raw_blob, bytes):
        return raw_blob
    if isinstance(raw_blob, bytearray):
        return bytes(raw_blob)
    if isinstance(raw_blob, str):
        try:
            return base64.b64decode(raw_blob, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Invalid base64-encoded blob payload") from exc
    raise ValueError("Blob payload must be a base64 string or bytes")


class DifyPluginToolInvokeMessage(BaseModel):
    """Subset of Dify tool stream messages needed for agent observations."""

    class TextMessage(BaseModel):
        text: str

    class JsonMessage(BaseModel):
        json_object: dict[str, object] | list[object]
        suppress_output: bool = False

    class BlobMessage(BaseModel):
        blob: bytes

        @field_validator("blob", mode="before")
        @classmethod
        def _validate_blob(cls, value: object) -> bytes:
            return _decode_blob_bytes(value)

    class BlobChunkMessage(BaseModel):
        id: str
        sequence: int
        total_length: int
        blob: bytes
        end: bool

        @field_validator("blob", mode="before")
        @classmethod
        def _validate_blob(cls, value: object) -> bytes:
            return _decode_blob_bytes(value)

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

        @field_validator("metadata", mode="before")
        @classmethod
        def _normalize_metadata(cls, value: object) -> object:
            # The plugin SDK's ``create_log_message`` defaults ``metadata`` to
            # None, which the daemon serializes as ``metadata: null``. Mirror the
            # canonical core model (ToolInvokeMessage.LogMessage) and coerce that
            # null back to an empty mapping so the message union still resolves.
            return value or {}

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
    _chunk_error: str | None = PrivateAttr(default=None)

    @property
    def chunk_error(self) -> str | None:
        """Internal blob or chunk decoding/merging error attached only when error isolation is enabled."""
        return self._chunk_error

    @model_validator(mode="wrap")
    @classmethod
    def _validate_with_optional_blob_isolation(
        cls,
        value: object,
        handler: ModelWrapValidatorHandler[Self],
        info: ValidationInfo,
    ) -> Self:
        """Decode BLOB/BLOB_CHUNK payloads with per-file error isolation when enabled.

        Two-stage invariant:
        - `BLOB` frames with invalid Base64 isolate into `message=None` plus `_chunk_error`,
          preserving sibling outputs from the same tool call.
        - `BLOB_CHUNK` frames with invalid Base64 still validate framing via an empty-bytes
          `BlobChunkMessage` placeholder before attaching `_chunk_error`, so malformed chunk
          schemas still fail validation while valid frames forward `chunk_id` to lock failure
          in `merge_blob_chunks`.
        """
        isolate_blob_errors = isinstance(info.context, Mapping) and bool(info.context.get("isolate_blob_errors"))
        if not isolate_blob_errors or not isinstance(value, Mapping):
            return handler(value)

        raw_type = value.get("type")
        if not isinstance(raw_type, str):
            return handler(value)

        raw_message = value.get("message")
        if raw_type == cls.MessageType.BLOB and isinstance(raw_message, Mapping) and "blob" in raw_message:
            try:
                decoded = _decode_blob_bytes(raw_message["blob"])
            except ValueError as exc:
                item = handler({**value, "message": None})
                item._chunk_error = str(exc)
                return item
            return handler({**value, "message": {**raw_message, "blob": decoded}})

        if raw_type == cls.MessageType.BLOB_CHUNK and isinstance(raw_message, Mapping) and "blob" in raw_message:
            try:
                decoded = _decode_blob_bytes(raw_message["blob"])
            except ValueError as exc:
                placeholder = cls.BlobChunkMessage.model_validate({**raw_message, "blob": b""})
                item = handler({**value, "message": placeholder})
                item._chunk_error = str(exc)
                return item
            return handler({**value, "message": {**raw_message, "blob": decoded}})

        return handler(value)

    @field_validator("message", mode="before")
    @classmethod
    def decode_message(cls, value: object, info: ValidationInfo) -> object:
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
    context: tenant path segment, daemon API key, plugin ID and complete package
    identifier headers, and optional top-level ``user_id``.
    """

    plugin_daemon_url: str
    plugin_daemon_api_key: str
    tenant_id: str
    plugin_id: str
    user_id: str | None
    http_client: httpx.AsyncClient = field(repr=False)
    plugin_unique_identifier: str | None = None
    max_file_size: int = 30 * 1024 * 1024

    def __post_init__(self) -> None:
        if (
            self.plugin_unique_identifier is not None
            and self.plugin_unique_identifier.partition(":")[0] != self.plugin_id
        ):
            raise ValueError("Plugin unique identifier does not match plugin_id")
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
                validation_context={"isolate_blob_errors": True},
            )
        ]
        return merge_blob_chunks(raw_messages, max_file_size=self.max_file_size, isolate_errors=True)

    async def _iter_stream_response[T: BaseModel](
        self,
        *,
        path: str,
        request_data: Mapping[str, object],
        response_model: type[T],
        validation_context: dict[str, object] | None = None,
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

                try:
                    wrapped = PluginDaemonBasicResponse.model_validate_json(line)
                except ValidationError as exc:
                    raise DifyPluginToolClientError(
                        "Invalid plugin daemon stream frame.",
                        error_type="PluginDaemonBadResponseError",
                    ) from exc
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
                try:
                    yield response_model.model_validate(wrapped.data, context=validation_context)
                except ValidationError as exc:
                    raise DifyPluginToolClientError(
                        "Invalid plugin daemon tool message payload.",
                        error_type="PluginDaemonBadResponseError",
                    ) from exc

    def _headers(self) -> dict[str, str]:
        """Build required plugin-daemon transport headers for tool invocation."""
        headers = {
            "X-Api-Key": self.plugin_daemon_api_key,
            "X-Plugin-ID": self.plugin_id,
            "Content-Type": "application/json",
        }
        if self.plugin_unique_identifier is not None:
            headers["X-Plugin-Unique-Identifier"] = self.plugin_unique_identifier
        return headers


def _has_valid_size(meta: Mapping[str, object]) -> bool:
    size = meta.get("size")
    return isinstance(size, int) and not isinstance(size, bool)


def _backfill_size(meta: dict[str, object], total_length: int) -> None:
    if not _has_valid_size(meta) and total_length >= 0:
        meta["size"] = total_length


def _chunk_error_message(*, error: str, meta: dict[str, object] | None) -> DifyPluginToolInvokeMessage:
    item = DifyPluginToolInvokeMessage(
        type=DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK,
        message=None,
        meta=meta or None,
    )
    item._chunk_error = error
    return item


def merge_blob_chunks(
    response: list[DifyPluginToolInvokeMessage],
    *,
    max_file_size: int = 30 * 1024 * 1024,
    max_chunk_size: int = 8192,
    isolate_errors: bool = False,
) -> list[DifyPluginToolInvokeMessage]:
    """Merge streamed blob chunks into complete blob messages.

    This mirrors Dify API's plugin-daemon chunk-merging behavior before the
    higher-level observation conversion logic sees tool stream messages. Metadata
    from every chunk is retained; later values override earlier ones for the same
    file, including when the final chunk has no metadata.

    When ``isolate_errors=True``, chunk-level decoding, size, sequence,
    completeness, or framing failures are isolated per ``chunk_id`` into a single
    ``BLOB_CHUNK`` item carrying ``chunk_error`` instead of aborting the whole
    tool stream, and any stream that ends without ``end=True`` emits one
    incomplete ``BLOB_CHUNK`` item per unfinished file.
    """
    files: dict[str, FileChunk] = {}
    failed_files: dict[str, tuple[DifyPluginToolInvokeMessage, dict[str, object]]] = {}
    merged_messages: list[DifyPluginToolInvokeMessage] = []

    def _fail_chunk(
        *,
        chunk_id: str,
        error: str,
        meta: Mapping[str, object] | None,
        total_length: int,
    ) -> None:
        if not isolate_errors:
            raise ValueError(error)
        failed_meta: dict[str, object] = dict(meta) if isinstance(meta, Mapping) else {}
        _backfill_size(failed_meta, total_length)
        failed_message = _chunk_error_message(error=error, meta=failed_meta or None)
        merged_messages.append(failed_message)
        failed_files[chunk_id] = (failed_message, failed_meta)

    for resp in response:
        if resp.type is DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK:
            if not isinstance(resp.message, DifyPluginToolInvokeMessage.BlobChunkMessage):
                if isolate_errors:
                    merged_messages.append(
                        _chunk_error_message(
                            error=resp.chunk_error or "Blob chunk responses must carry BlobChunkMessage payloads.",
                            meta=dict(resp.meta) if isinstance(resp.meta, Mapping) else None,
                        )
                    )
                    continue
                if resp.chunk_error is not None:
                    raise ValueError(resp.chunk_error)
                raise TypeError("Blob chunk responses must carry BlobChunkMessage payloads.")

            chunk_id = resp.message.id
            total_length = resp.message.total_length
            blob_data = resp.message.blob
            is_end = resp.message.end

            if isolate_errors and chunk_id in failed_files:
                failed_message, failed_meta = failed_files[chunk_id]
                if isinstance(resp.meta, Mapping):
                    failed_meta.update(resp.meta)
                    _backfill_size(failed_meta, total_length)
                    failed_message.meta = failed_meta or None
                continue

            if resp.chunk_error is not None:
                chunk = files.pop(chunk_id, None)
                if chunk is not None and isinstance(resp.meta, Mapping):
                    chunk.meta.update(resp.meta)
                _fail_chunk(
                    chunk_id=chunk_id,
                    error=resp.chunk_error,
                    meta=chunk.meta if chunk is not None else resp.meta,
                    total_length=chunk.total_length if chunk is not None else total_length,
                )
                continue

            if chunk_id not in files:
                # The declared length is plugin-controlled while the whole buffer is
                # pre-allocated, so an invalid or oversized claim must be rejected
                # before the allocation below rather than after it.
                if total_length < 0:
                    _fail_chunk(
                        chunk_id=chunk_id,
                        error=f"Invalid blob chunk total_length: {total_length}",
                        meta=resp.meta,
                        total_length=total_length,
                    )
                    continue
                if total_length > max_file_size:
                    _fail_chunk(
                        chunk_id=chunk_id,
                        error=f"File is too large which reached the limit of {max_file_size / 1024 / 1024}MB",
                        meta=resp.meta,
                        total_length=total_length,
                    )
                    continue
                files[chunk_id] = FileChunk(total_length)

            current_file = files[chunk_id]
            if isinstance(resp.meta, Mapping):
                current_file.meta.update(resp.meta)

            next_offset = current_file.bytes_written + len(blob_data)
            if next_offset > max_file_size:
                chunk = files.pop(chunk_id)
                _fail_chunk(
                    chunk_id=chunk_id,
                    error=f"File is too large which reached the limit of {max_file_size / 1024 / 1024}MB",
                    meta=chunk.meta,
                    total_length=total_length,
                )
                continue
            if len(blob_data) > max_chunk_size:
                chunk = files.pop(chunk_id)
                _fail_chunk(
                    chunk_id=chunk_id,
                    error=f"File chunk is too large which reached the limit of {max_chunk_size / 1024}KB",
                    meta=chunk.meta,
                    total_length=total_length,
                )
                continue
            if isolate_errors and (
                resp.message.sequence != current_file.next_sequence
                or total_length != current_file.total_length
                or next_offset > current_file.total_length
                or (is_end and next_offset != current_file.total_length)
            ):
                chunk = files.pop(chunk_id)
                _fail_chunk(
                    chunk_id=chunk_id,
                    error="Plugin file chunks have an invalid sequence or length",
                    meta=chunk.meta,
                    total_length=chunk.total_length,
                )
                continue

            current_file.data[current_file.bytes_written : next_offset] = blob_data
            current_file.bytes_written = next_offset
            current_file.next_sequence += 1

            if is_end:
                merged_messages.append(
                    DifyPluginToolInvokeMessage(
                        type=DifyPluginToolInvokeMessage.MessageType.BLOB,
                        message=DifyPluginToolInvokeMessage.BlobMessage(
                            blob=bytes(current_file.data[: current_file.bytes_written])
                        ),
                        meta=current_file.meta or None,
                    )
                )
                del files[chunk_id]
        else:
            if not isolate_errors and resp.chunk_error is not None:
                raise ValueError(resp.chunk_error)
            merged_messages.append(resp)

    if isolate_errors and files:
        for chunk in files.values():
            merged_messages.append(
                DifyPluginToolInvokeMessage(
                    type=DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK,
                    message=None,
                    meta=chunk.meta or None,
                )
            )

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
