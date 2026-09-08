"""Owned trace data crossing the engine, storage and provider boundaries.

Models may contain JSON dictionaries while being assembled. Only serialized bytes
cross a thread boundary; frozen Pydantic models alone do not freeze dictionaries.
"""

import json
import math
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from enum import Enum
from typing import Literal, Self
from urllib.parse import parse_qsl, urlsplit, urlunsplit
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator


class TraceSource(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    tenant_id: str
    operation_id: str
    app_id: str | None = None
    pipeline_id: str | None = None
    workflow_run_id: str | None = None
    actor_id: str | None = None
    message_id: str | None = None
    conversation_id: str | None = None
    external_trace_id: str | None = Field(default=None, max_length=512)
    session_id: str | None = Field(default=None, max_length=512)

    @field_validator(
        "tenant_id", "operation_id", "app_id", "pipeline_id", "workflow_run_id", "message_id", "conversation_id"
    )
    @classmethod
    def validate_identifier(cls, value: str | None) -> str | None:
        return str(UUID(value)) if value is not None else None

    @model_validator(mode="after")
    def validate_owner(self) -> Self:
        if self.app_id and self.pipeline_id:
            raise ValueError("A trace belongs to an app or a pipeline, not both")
        return self


class TraceSpan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    span_id: str
    parent_span_id: str | None = None
    span_name: str
    span_type: str = "operation"
    source_app_id: str | None = None
    source_pipeline_id: str | None = None
    source_workflow_id: str | None = None
    source_workflow_version: str | None = None
    node_execution_id: str | None = None
    node_id: str | None = None
    attempt: int = Field(default=0, ge=0)
    started_at: datetime | None = None
    ended_at: datetime | None = None
    status: Literal["ok", "error", "handled_error", "cancelled", "incomplete"] = "ok"
    error: str | None = None
    inputs: JsonValue = None
    outputs: JsonValue = None
    attributes: dict[str, JsonValue] = Field(default_factory=dict)
    usage: dict[str, JsonValue] = Field(default_factory=dict)
    events: tuple[dict[str, JsonValue], ...] = ()

    @field_validator("started_at", "ended_at")
    @classmethod
    def normalize_utc(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class ParentSpanReference(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    export_id: str
    span_id: str


class CompletedTrace(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[2] = 2
    source: TraceSource
    trace_id: str
    root_span_id: str
    spans: tuple[TraceSpan, ...]
    parent: ParentSpanReference | None = None
    links: tuple[str, ...] = ()
    complete: bool = True
    truncation: dict[str, JsonValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_span_tree(self) -> Self:
        seen: set[str] = set()
        for span in self.spans:
            if span.span_id in seen:
                raise ValueError("Duplicate trace span")
            if span.span_id == self.root_span_id:
                if span.parent_span_id is not None:
                    raise ValueError("Trace root has a local parent")
            elif span.parent_span_id not in seen:
                raise ValueError("Trace spans must follow their parents")
            seen.add(span.span_id)
        if self.root_span_id not in seen:
            raise ValueError("Trace root is missing")
        if not self.complete and not self.truncation:
            raise ValueError("Incomplete trace must explain missing data")
        return self


class TraceProviderSettings(BaseModel):
    """Configuration identity only; never contains decrypted credentials."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    tenant_id: str
    app_id: str | None = None
    destination_type: Literal["app_provider", "enterprise"] = "app_provider"
    provider_name: str
    config_id: str | None = None
    config_revision: int = Field(default=0, ge=0)
    destination_settings_hash: str = ""

    @model_validator(mode="after")
    def validate_destination(self) -> Self:
        UUID(self.tenant_id)
        if self.app_id is not None:
            UUID(self.app_id)
        if self.config_id is not None:
            UUID(self.config_id)
        if self.destination_type == "app_provider" and (self.app_id is None or self.config_id is None):
            raise ValueError("App tracing requires an app and configuration")
        return self


class ExportedParentSpans(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    spans: dict[str, dict[str, JsonValue]] = Field(default_factory=dict)


class QueuedTrace(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    trace_json: bytes
    provider_settings: TraceProviderSettings
    export_id: str

    @classmethod
    def from_trace(cls, completed_trace: CompletedTrace, provider_settings: TraceProviderSettings) -> Self:
        if completed_trace.source.tenant_id != provider_settings.tenant_id:
            raise ValueError("Trace and provider belong to different tenants")
        if (
            provider_settings.destination_type == "app_provider"
            and completed_trace.source.app_id != provider_settings.app_id
        ):
            raise ValueError("Trace and provider belong to different apps")
        export_id = str(
            uuid5(
                NAMESPACE_URL,
                ":".join(
                    (
                        completed_trace.source.tenant_id,
                        completed_trace.source.operation_id,
                        completed_trace.root_span_id,
                        provider_settings.destination_type,
                        provider_settings.app_id or "workspace",
                        provider_settings.provider_name,
                        provider_settings.config_id or "enterprise",
                        str(provider_settings.config_revision),
                    )
                ),
            )
        )
        return cls(
            trace_json=completed_trace.model_dump_json().encode(),
            provider_settings=provider_settings,
            export_id=export_id,
        )


def make_trace_id(tenant_id: str, operation_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"dify:trace:{tenant_id}:{operation_id}"))


def make_span_id(tenant_id: str, operation_id: str, execution_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"dify:span:{tenant_id}:{operation_id}:{execution_id}"))


def copy_trace_value(value: object, max_bytes: int = 65536) -> JsonValue:
    """Copy bounded JSON and remove credential fields without retaining input objects."""
    remaining = max_bytes

    def copy_value(item: object, depth: int) -> JsonValue:
        nonlocal remaining
        if remaining <= 32 or depth > 12:
            remaining -= 24
            return "[trace value truncated]"
        remaining -= 8
        if item is None or isinstance(item, bool | int):
            if isinstance(item, int) and item.bit_length() > 1024:
                remaining -= 27
                return "[trace integer truncated]"
            size = len(json.dumps(item))
            if size > remaining:
                remaining -= 24
                return "[trace value truncated]"
            remaining -= size
            return item
        if isinstance(item, float):
            number = item if math.isfinite(item) else None
            remaining -= len(json.dumps(number))
            return number
        if isinstance(item, Enum):
            return copy_value(item.value, depth)
        if isinstance(item, datetime | Decimal | UUID):
            item = str(item)
        if isinstance(item, str):
            if item.startswith(("https://", "http://")):
                url = urlsplit(item[:16384])
                if (
                    len(item) > 16384
                    or url.username
                    or any(
                        any(
                            secret in key.lower()
                            for secret in ("signature", "token", "credential", "secret", "api_key")
                        )
                        for key, _ in parse_qsl(url.query)
                    )
                ):
                    host = url.netloc.rsplit("@", 1)[-1]
                    item = urlunsplit((url.scheme, host, url.path, "", ""))
            # Bound JSON bytes, including escaped controls and multibyte characters.
            end = min(len(item), remaining)
            prefix = item[:end]
            encoded_size = len(json.dumps(prefix, ensure_ascii=False).encode())
            if encoded_size > remaining - 24:
                low, high = 0, end
                while low < high:
                    middle = (low + high + 1) // 2
                    if len(json.dumps(item[:middle], ensure_ascii=False).encode()) <= remaining - 24:
                        low = middle
                    else:
                        high = middle - 1
                end = low
                prefix = item[:end]
            result = prefix if end == len(item) else prefix + "[truncated]"
            remaining -= len(json.dumps(result, ensure_ascii=False).encode())
            return result
        if isinstance(item, BaseModel):
            # Pydantic iteration exposes raw fields without recursively serializing them.
            item = dict(item)
        if isinstance(item, Mapping):
            # Reserve the container and its possible truncation marker before children consume the budget.
            remaining -= 32
            copied: dict[str, JsonValue] = {}
            for key, child in item.items():
                if remaining <= 32 or len(copied) >= 256:
                    copied["_trace_truncated"] = True
                    break
                if not isinstance(key, str):
                    continue
                if key.lower().replace("-", "_") in {
                    "authorization",
                    "api_key",
                    "secret_key",
                    "password",
                    "credentials",
                    "access_token",
                    "secret",
                    "token",
                }:
                    continue
                key_size = len(json.dumps(key[:256], ensure_ascii=False).encode()) + 4
                if remaining - key_size <= 32:
                    copied["_trace_truncated"] = True
                    break
                remaining -= key_size
                copied[key[:256]] = copy_value(child, depth + 1)
            return copied
        if isinstance(item, Sequence) and not isinstance(item, bytes | bytearray):
            remaining -= 32
            copied_items: list[JsonValue] = []
            for child in item:
                if remaining <= 32 or len(copied_items) >= 256:
                    copied_items.append("[trace items truncated]")
                    break
                copied_items.append(copy_value(child, depth + 1))
            return copied_items
        return copy_value(f"[unsupported {type(item).__name__}]", depth)

    return copy_value(value, 0)


def copy_trace_fields(fields: Mapping[str, object]) -> dict[str, JsonValue]:
    copied = copy_trace_value(fields)
    return copied if isinstance(copied, dict) else {"_trace_truncated": True}
