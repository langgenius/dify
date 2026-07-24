"""Validated, read-only UI messages emitted by tools.

The public wire format is the A2UI v0.9.1 flat message shape, narrowed to a
Dify-owned catalog. Tool authors can bind display values to the surface data
model, but cannot supply executable actions, HTML, styles, themes, or custom
components. A complete ``ToolUIMessage`` describes exactly one surface and is
validated as a bounded, self-contained component graph before it crosses into
chat streaming. Sequential data-model patches are materialized with the same
object/array upsert semantics as the web renderer so cumulative limits cannot
be bypassed with individually small updates.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Sequence
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    SerializerFunctionWrapHandler,
    field_validator,
    model_serializer,
    model_validator,
)

A2UI_PROTOCOL = "a2ui"
A2UI_PROTOCOL_VERSION = "v0.9.1"
A2UI_CATALOG_ID = "https://dify.ai/a2ui/catalog/v1"
DIFY_UI_JSON_ENVELOPE_KEY = "__dify_ui__"

MAX_UI_MESSAGES = 64
MAX_UI_COMPONENTS = 100
MAX_UI_STRING_LENGTH = 4096
MAX_UI_PAYLOAD_BYTES = 128 * 1024
MAX_DATA_MODEL_DEPTH = 16
MAX_DATA_MODEL_NODES = 2000
MAX_DATA_MODEL_ARRAY_INDEX = 1000
MAX_JSON_POINTER_SEGMENTS = 16
MAX_UI_PARTS_PER_MESSAGE = 16
MAX_UI_PARTS_PAYLOAD_BYTES = 512 * 1024

_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_ARRAY_INDEX_PATTERN = re.compile(r"^(?:0|[1-9]\d*)$")
_DANGEROUS_POINTER_SEGMENTS = {"__proto__", "constructor", "prototype"}
_DANGEROUS_DATA_KEYS = _DANGEROUS_POINTER_SEGMENTS
_MAX_HISTORY_UI_PART_CANDIDATES = MAX_UI_PARTS_PER_MESSAGE * 4
_UI_PART_ID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://dify.ai/a2ui/part-id/v1")


class _StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        serialize_by_alias=True,
        allow_inf_nan=False,
    )


class A2UIDataBinding(_StrictModel):
    """A JSON Pointer into the surface data model."""

    path: str

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str) -> str:
        return _validate_json_pointer(value, label="data binding path")


type DynamicString = str | A2UIDataBinding
type DynamicNumber = int | float | A2UIDataBinding
type DynamicScalar = str | int | float | bool | None | A2UIDataBinding


class A2UIComponentType(StrEnum):
    CARD = "Card"
    ROW = "Row"
    COLUMN = "Column"
    TEXT = "Text"
    ICON = "Icon"
    DIVIDER = "Divider"
    BADGE = "Badge"
    METRIC = "Metric"
    DATE_TIME = "DateTime"
    PROGRESS = "Progress"
    KEY_VALUE = "KeyValue"


class A2UIComponent(_StrictModel):
    """One flat component entry from the Dify catalog."""

    id: str
    component: A2UIComponentType
    children: list[str] | None = None
    title: DynamicString | None = None
    gap: Literal["small", "medium", "large"] | None = None
    align: Literal["start", "center", "end"] | None = None
    text: DynamicString | None = None
    variant: Literal["body", "caption"] | None = None
    name: (
        Literal[
            "clock",
            "cloud",
            "sun",
            "rain",
            "snow",
            "wind",
            "thermometer",
            "calendar",
            "location",
        ]
        | None
    ) = None
    tone: Literal["neutral", "info", "success", "warning", "critical"] | None = None
    label: DynamicString | None = None
    value: DynamicScalar | None = None
    unit: DynamicString | None = None
    format: Literal["date", "time", "datetime"] | None = None
    max: DynamicNumber | None = None

    @field_validator("id")
    @classmethod
    def _validate_id(cls, value: str) -> str:
        if not _ID_PATTERN.fullmatch(value):
            raise ValueError("component id contains unsupported characters or is too long")
        return value

    @field_validator("children")
    @classmethod
    def _validate_children(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        if len(value) > MAX_UI_COMPONENTS:
            raise ValueError("component has too many children")
        if len(value) != len(set(value)):
            raise ValueError("component children must not contain duplicate ids")
        for child_id in value:
            if not _ID_PATTERN.fullmatch(child_id):
                raise ValueError("child component id contains unsupported characters or is too long")
        return value

    @model_validator(mode="after")
    def _validate_component_props(self) -> A2UIComponent:
        present = self.model_fields_set - {"id", "component"}
        allowed: dict[A2UIComponentType, set[str]] = {
            A2UIComponentType.CARD: {"children", "title"},
            A2UIComponentType.ROW: {"children", "gap", "align"},
            A2UIComponentType.COLUMN: {"children", "gap"},
            A2UIComponentType.TEXT: {"text", "variant"},
            A2UIComponentType.ICON: {"name"},
            A2UIComponentType.DIVIDER: set(),
            A2UIComponentType.BADGE: {"text", "tone"},
            A2UIComponentType.METRIC: {"label", "value", "unit"},
            A2UIComponentType.DATE_TIME: {"value", "format"},
            A2UIComponentType.PROGRESS: {"value", "max", "label"},
            A2UIComponentType.KEY_VALUE: {"label", "value"},
        }
        required: dict[A2UIComponentType, set[str]] = {
            A2UIComponentType.CARD: {"children"},
            A2UIComponentType.ROW: {"children"},
            A2UIComponentType.COLUMN: {"children"},
            A2UIComponentType.TEXT: {"text"},
            A2UIComponentType.ICON: {"name"},
            A2UIComponentType.DIVIDER: set(),
            A2UIComponentType.BADGE: {"text"},
            A2UIComponentType.METRIC: {"label", "value"},
            A2UIComponentType.DATE_TIME: {"value"},
            A2UIComponentType.PROGRESS: {"value", "label"},
            A2UIComponentType.KEY_VALUE: {"label", "value"},
        }
        unexpected = present - allowed[self.component]
        missing = required[self.component] - present
        if unexpected:
            raise ValueError(f"{self.component} does not support properties: {sorted(unexpected)}")
        if missing:
            raise ValueError(f"{self.component} requires properties: {sorted(missing)}")
        nullable_props = (
            {"value"} if self.component in {A2UIComponentType.METRIC, A2UIComponentType.KEY_VALUE} else set()
        )
        null_props = {prop for prop in present if getattr(self, prop) is None and prop not in nullable_props}
        if null_props:
            raise ValueError(f"{self.component} properties cannot be null: {sorted(null_props)}")
        if self.component == A2UIComponentType.DATE_TIME and not isinstance(self.value, str | A2UIDataBinding):
            raise ValueError("DateTime value must be a string or data binding")
        if self.component == A2UIComponentType.PROGRESS and (
            isinstance(self.value, bool) or not isinstance(self.value, int | float | A2UIDataBinding)
        ):
            raise ValueError("Progress value must be a number or data binding")
        if (
            self.component == A2UIComponentType.PROGRESS
            and "max" in present
            and (isinstance(self.max, bool) or not isinstance(self.max, int | float | A2UIDataBinding))
        ):
            raise ValueError("Progress max must be a number or data binding")
        return self

    @model_serializer(mode="wrap")
    def _serialize_component(self, handler: SerializerFunctionWrapHandler) -> dict[str, JsonValue]:
        serialized = handler(self)
        return {
            key: value
            for key, value in serialized.items()
            if key in {"id", "component"} or key in self.model_fields_set
        }


class A2UICreateSurface(_StrictModel):
    surface_id: str = Field(alias="surfaceId")
    catalog_id: Literal["https://dify.ai/a2ui/catalog/v1"] = Field(alias="catalogId")

    @field_validator("surface_id")
    @classmethod
    def _validate_surface_id(cls, value: str) -> str:
        if not _ID_PATTERN.fullmatch(value):
            raise ValueError("surface id contains unsupported characters or is too long")
        return value


class A2UIUpdateComponents(_StrictModel):
    surface_id: str = Field(alias="surfaceId")
    components: Annotated[list[A2UIComponent], Field(min_length=1, max_length=MAX_UI_COMPONENTS)]

    @field_validator("surface_id")
    @classmethod
    def _validate_surface_id(cls, value: str) -> str:
        if not _ID_PATTERN.fullmatch(value):
            raise ValueError("surface id contains unsupported characters or is too long")
        return value

    @field_validator("components")
    @classmethod
    def _validate_unique_component_ids(cls, value: list[A2UIComponent]) -> list[A2UIComponent]:
        ids = [component.id for component in value]
        if len(ids) != len(set(ids)):
            raise ValueError("updateComponents contains duplicate component ids")
        return value


class A2UIUpdateDataModel(_StrictModel):
    surface_id: str = Field(alias="surfaceId")
    value: JsonValue
    path: str | None = None

    @field_validator("surface_id")
    @classmethod
    def _validate_surface_id(cls, value: str) -> str:
        if not _ID_PATTERN.fullmatch(value):
            raise ValueError("surface id contains unsupported characters or is too long")
        return value

    @field_validator("value")
    @classmethod
    def _validate_value(cls, value: JsonValue) -> JsonValue:
        _validate_data_model_value(value)
        return value

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return _validate_json_pointer(value, label="data model path", enforce_array_index_limit=True)

    @model_serializer(mode="wrap")
    def _serialize_update(self, handler: SerializerFunctionWrapHandler) -> dict[str, JsonValue]:
        serialized = handler(self)
        if "path" not in self.model_fields_set:
            serialized.pop("path", None)
        return serialized


class A2UIDeleteSurface(_StrictModel):
    surface_id: str = Field(alias="surfaceId")

    @field_validator("surface_id")
    @classmethod
    def _validate_surface_id(cls, value: str) -> str:
        if not _ID_PATTERN.fullmatch(value):
            raise ValueError("surface id contains unsupported characters or is too long")
        return value


class A2UIMessage(_StrictModel):
    """A single A2UI v0.9.1 server message."""

    version: Literal["v0.9.1"]
    create_surface: A2UICreateSurface | None = Field(default=None, alias="createSurface")
    update_components: A2UIUpdateComponents | None = Field(default=None, alias="updateComponents")
    update_data_model: A2UIUpdateDataModel | None = Field(default=None, alias="updateDataModel")
    delete_surface: A2UIDeleteSurface | None = Field(default=None, alias="deleteSurface")

    @model_validator(mode="after")
    def _validate_exactly_one_operation(self) -> A2UIMessage:
        operations = (
            self.create_surface,
            self.update_components,
            self.update_data_model,
            self.delete_surface,
        )
        if sum(operation is not None for operation in operations) != 1:
            raise ValueError("A2UI message must contain exactly one operation")
        return self

    @model_serializer(mode="wrap")
    def _serialize_message(self, handler: SerializerFunctionWrapHandler) -> dict[str, JsonValue]:
        return {key: value for key, value in handler(self).items() if value is not None}

    @property
    def surface_id(self) -> str:
        operation = self.create_surface or self.update_components or self.update_data_model or self.delete_surface
        assert operation is not None
        return operation.surface_id


class ToolUIMessage(_StrictModel):
    """A complete, validated UI surface emitted by one tool result.

    Validation covers both the component graph and every materialized
    data-model revision, because clients render the message sequence in order.
    """

    protocol: Literal["a2ui"] = "a2ui"
    protocol_version: Literal["v0.9.1"] = "v0.9.1"
    messages: Annotated[list[A2UIMessage], Field(min_length=1, max_length=MAX_UI_MESSAGES)]
    fallback: str | None = None

    @field_validator("fallback")
    @classmethod
    def _validate_fallback(cls, value: str | None) -> str | None:
        if value is not None and len(value) > MAX_UI_STRING_LENGTH:
            raise ValueError("UI fallback is too long")
        return value

    @model_validator(mode="after")
    def _validate_surface(self) -> ToolUIMessage:
        first = self.messages[0]
        if first.create_surface is None:
            raise ValueError("first A2UI message must be createSurface")
        if any(message.create_surface is not None for message in self.messages[1:]):
            raise ValueError("createSurface may only appear as the first message")
        delete_indexes = [index for index, message in enumerate(self.messages) if message.delete_surface]
        if delete_indexes and delete_indexes != [len(self.messages) - 1]:
            raise ValueError("deleteSurface may only appear once as the final message")

        surface_id = first.surface_id
        if any(message.surface_id != surface_id for message in self.messages):
            raise ValueError("all A2UI messages in a tool UI message must target the same surface")

        components: dict[str, A2UIComponent] = {}
        data_model: JsonValue = {}
        root_seen_before_delete = False
        for message in self.messages[1:]:
            if message.update_components is not None:
                for component in message.update_components.components:
                    components[component.id] = component
                if len(components) > MAX_UI_COMPONENTS:
                    raise ValueError("UI surface has too many components")
            if message.update_data_model is not None:
                data_model = _apply_data_model_update(data_model, message.update_data_model)
                _validate_data_model_value(data_model)
            if message.delete_surface is not None:
                root_seen_before_delete = "root" in components

        if "root" not in components and not root_seen_before_delete:
            raise ValueError("UI surface must define a component with id 'root'")

        _validate_component_graph(components)
        payload = self.model_dump(mode="json", by_alias=True, exclude_none=True)
        _validate_bounded_json(payload)
        return self

    @model_serializer(mode="wrap")
    def _serialize_ui_message(self, handler: SerializerFunctionWrapHandler) -> dict[str, JsonValue]:
        return {key: value for key, value in handler(self).items() if value is not None}

    @property
    def surface_id(self) -> str:
        return self.messages[0].surface_id


class MessageUIPart(_StrictModel):
    """SSE/history representation of one tool-owned UI surface revision."""

    part_id: Annotated[str, Field(min_length=1, max_length=512)]
    sequence: Annotated[int, Field(ge=1)]
    protocol: Literal["a2ui"] = "a2ui"
    protocol_version: Literal["v0.9.1"] = "v0.9.1"
    messages: Annotated[list[A2UIMessage], Field(min_length=1, max_length=MAX_UI_MESSAGES)]
    fallback: str | None = None

    @model_validator(mode="after")
    def _validate_messages(self) -> MessageUIPart:
        ToolUIMessage(
            protocol=self.protocol,
            protocol_version=self.protocol_version,
            messages=self.messages,
            fallback=self.fallback,
        )
        return self

    @model_serializer(mode="wrap")
    def _serialize_part(self, handler: SerializerFunctionWrapHandler) -> dict[str, JsonValue]:
        return {key: value for key, value in handler(self).items() if value is not None}

    @classmethod
    def from_tool_ui_message(
        cls,
        *,
        part_id: str,
        sequence: int,
        ui_message: ToolUIMessage,
    ) -> MessageUIPart:
        return cls(
            part_id=part_id,
            sequence=sequence,
            protocol=ui_message.protocol,
            protocol_version=ui_message.protocol_version,
            messages=ui_message.messages,
            fallback=ui_message.fallback,
        )


def extract_ui_message_from_json(value: JsonValue) -> ToolUIMessage | None:
    """Recognize the reserved compatibility envelope used by older SDKs."""

    if not isinstance(value, dict) or set(value) != {DIFY_UI_JSON_ENVELOPE_KEY}:
        return None
    return ToolUIMessage.model_validate(value[DIFY_UI_JSON_ENVELOPE_KEY])


def parse_tool_ui_messages(value: object) -> list[ToolUIMessage]:
    """Validate a list received through the Agent backend metadata channel."""

    if not isinstance(value, list):
        raise ValueError("dify_ui_messages metadata must be a list")
    if len(value) > MAX_UI_PARTS_PER_MESSAGE:
        raise ValueError(f"tool UI batch cannot contain more than {MAX_UI_PARTS_PER_MESSAGE} messages")
    messages = [ToolUIMessage.model_validate(item) for item in value]
    validate_tool_ui_message_batch(messages)
    return messages


def build_ui_part_id(namespace: str, surface_id: str) -> str:
    """Build a stable, bounded ID from an unambiguous tool/surface tuple."""
    if not isinstance(namespace, str) or not isinstance(surface_id, str):
        raise TypeError("UI part namespace and surface id must be strings")
    identity = json.dumps((namespace, surface_id), ensure_ascii=True, separators=(",", ":"))
    return f"ui-{uuid.uuid5(_UI_PART_ID_NAMESPACE, identity)}"


def validate_tool_ui_message_batch(messages: Sequence[ToolUIMessage]) -> None:
    """Enforce the per-tool-call UI batch budget before queue publication."""
    if len(messages) > MAX_UI_PARTS_PER_MESSAGE:
        raise ValueError(f"tool UI batch cannot contain more than {MAX_UI_PARTS_PER_MESSAGE} messages")
    if _serialized_model_list_size(messages) > MAX_UI_PARTS_PAYLOAD_BYTES:
        raise ValueError(f"tool UI batch payload cannot exceed {MAX_UI_PARTS_PAYLOAD_BYTES} bytes")


def validate_ui_part_batch(parts: Sequence[MessageUIPart]) -> None:
    """Enforce persisted/current assistant-message UI budgets."""
    if len(parts) > MAX_UI_PARTS_PER_MESSAGE:
        raise ValueError(f"assistant message cannot contain more than {MAX_UI_PARTS_PER_MESSAGE} UI parts")
    part_ids = [part.part_id for part in parts]
    if len(part_ids) != len(set(part_ids)):
        raise ValueError("assistant message UI parts must have distinct part ids")
    if _serialized_model_list_size(parts) > MAX_UI_PARTS_PAYLOAD_BYTES:
        raise ValueError(f"assistant message UI parts cannot exceed {MAX_UI_PARTS_PAYLOAD_BYTES} bytes")


def upsert_ui_part(parts: Sequence[MessageUIPart], part: MessageUIPart) -> list[MessageUIPart] | None:
    """Return a bounded new part list, or ``None`` for a stale revision."""
    candidate = list(parts)
    for index, existing_part in enumerate(candidate):
        if existing_part.part_id != part.part_id:
            continue
        if existing_part.sequence >= part.sequence:
            return None
        candidate[index] = part
        break
    else:
        candidate.append(part)

    validate_ui_part_batch(candidate)
    return candidate


def parse_history_ui_parts(value: object) -> list[MessageUIPart]:
    """Best-effort recovery of bounded UI parts from untrusted historical metadata."""
    if not isinstance(value, list):
        return []

    parts: list[MessageUIPart] = []
    for item in value[:_MAX_HISTORY_UI_PART_CANDIDATES]:
        try:
            part = MessageUIPart.model_validate(item)
            updated_parts = upsert_ui_part(parts, part)
        except (TypeError, ValueError):
            continue
        if updated_parts is not None:
            parts = updated_parts
    return parts


def _validate_component_graph(components: dict[str, A2UIComponent]) -> None:
    for component in components.values():
        for child_id in component.children or []:
            if child_id not in components:
                raise ValueError(f"component {component.id!r} references unknown child {child_id!r}")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(component_id: str) -> None:
        if component_id in visiting:
            raise ValueError("UI component graph contains a cycle")
        if component_id in visited:
            return
        visiting.add(component_id)
        for child_id in components[component_id].children or []:
            visit(child_id)
        visiting.remove(component_id)
        visited.add(component_id)

    for component_id in components:
        visit(component_id)

    parent_by_child: dict[str, str] = {}
    for component in components.values():
        for child_id in component.children or []:
            if child_id == "root":
                raise ValueError("root component cannot be referenced as a child")
            existing_parent = parent_by_child.get(child_id)
            if existing_parent is not None:
                raise ValueError(
                    f"component {child_id!r} has multiple parents: {existing_parent!r} and {component.id!r}"
                )
            parent_by_child[child_id] = component.id

    reachable = {"root"}
    pending = ["root"]
    while pending:
        component_id = pending.pop()
        for child_id in components[component_id].children or []:
            if child_id in reachable:
                continue
            reachable.add(child_id)
            pending.append(child_id)

    unreachable = set(components) - reachable
    if unreachable:
        raise ValueError(f"UI component graph contains components unreachable from root: {sorted(unreachable)}")


def _serialized_model_list_size(values: Sequence[BaseModel]) -> int:
    payload = [value.model_dump(mode="json", by_alias=True, exclude_none=True) for value in values]
    return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())


def _validate_json_pointer(
    value: str,
    *,
    label: str,
    enforce_array_index_limit: bool = False,
) -> str:
    if not value.startswith("/"):
        raise ValueError(f"{label} must be a JSON Pointer beginning with '/'")
    if len(value) > 256:
        raise ValueError(f"{label} is too long")
    if re.search(r"~(?![01])", value):
        raise ValueError(f"{label} contains an invalid JSON Pointer escape")
    decoded_segments = _decode_json_pointer(value)
    if len(decoded_segments) > MAX_JSON_POINTER_SEGMENTS:
        raise ValueError(f"{label} contains too many segments")
    if set(decoded_segments).intersection(_DANGEROUS_POINTER_SEGMENTS):
        raise ValueError(f"{label} contains a forbidden segment")
    if enforce_array_index_limit and any(
        segment.isdecimal() and int(segment) > MAX_DATA_MODEL_ARRAY_INDEX for segment in decoded_segments
    ):
        raise ValueError(f"{label} contains an array index larger than {MAX_DATA_MODEL_ARRAY_INDEX}")
    return value


def _decode_json_pointer(value: str) -> list[str]:
    if value == "/":
        return []
    return [segment.replace("~1", "/").replace("~0", "~") for segment in value.split("/")[1:]]


def _apply_data_model_update(current: JsonValue, update: A2UIUpdateDataModel) -> JsonValue:
    path = update.path
    if path is None or path == "/":
        return update.value

    segments = _decode_json_pointer(path)

    def apply_at(node: JsonValue | None, segment_index: int) -> JsonValue:
        if segment_index == len(segments):
            return update.value

        segment = segments[segment_index]
        is_array_segment = _ARRAY_INDEX_PATTERN.fullmatch(segment) is not None
        if isinstance(node, list) or (not isinstance(node, dict) and is_array_segment):
            if not is_array_segment:
                raise ValueError("data model array paths must use canonical non-negative indexes")
            index = int(segment)
            if index > MAX_DATA_MODEL_ARRAY_INDEX:
                raise ValueError(f"data model array index cannot exceed {MAX_DATA_MODEL_ARRAY_INDEX}")

            next_node = list(node) if isinstance(node, list) else []
            if index > len(next_node):
                raise ValueError("data model array index cannot create a gap")
            child = next_node[index] if index < len(next_node) else None
            updated_child = apply_at(child, segment_index + 1)
            if index == len(next_node):
                next_node.append(updated_child)
            else:
                next_node[index] = updated_child
            return next_node

        next_node = dict(node) if isinstance(node, dict) else {}
        next_node[segment] = apply_at(next_node.get(segment), segment_index + 1)
        return next_node

    return apply_at(current, 0)


def _validate_data_model_value(value: JsonValue) -> None:
    nodes = 0

    def walk(node: JsonValue, *, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > MAX_DATA_MODEL_NODES:
            raise ValueError("data model value has too many nodes")
        if depth > MAX_DATA_MODEL_DEPTH:
            raise ValueError("data model value is nested too deeply")
        if isinstance(node, list):
            for item in node:
                walk(item, depth=depth + 1)
            return
        if isinstance(node, dict):
            unsafe_keys = set(node).intersection(_DANGEROUS_DATA_KEYS)
            if unsafe_keys:
                raise ValueError(f"data model value contains forbidden keys: {sorted(unsafe_keys)}")
            for item in node.values():
                walk(item, depth=depth + 1)

    walk(value, depth=0)


def _validate_bounded_json(value: JsonValue) -> None:
    def walk(node: JsonValue) -> None:
        if isinstance(node, str):
            if len(node) > MAX_UI_STRING_LENGTH:
                raise ValueError("UI payload contains a string that is too long")
            return
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if isinstance(node, dict):
            for item in node.values():
                walk(item)

    walk(value)
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    if len(encoded) > MAX_UI_PAYLOAD_BYTES:
        raise ValueError("UI payload is too large")
