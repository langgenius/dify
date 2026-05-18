"""Client-safe DTOs for Dify Agent structured output configuration.

This module contains only the public config schema and stable layer type id for
the optional structured output layer. Runtime conversion into pydantic-ai output
specifications happens in ``dify_agent.layers.output.output_layer`` so client
imports do not pull in server execution code.
"""

from __future__ import annotations

import re
from typing import ClassVar, Final

from pydantic import ConfigDict, JsonValue, field_validator

from agenton.layers import LayerConfig


DIFY_OUTPUT_LAYER_TYPE_ID: Final[str] = "dify.output"
_OUTPUT_TOOL_NAME_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class DifyOutputLayerConfig(LayerConfig):
    """Public config for the conventionally named structured output layer.

    The runtime only reads the layer named by
    ``dify_agent.protocol.DIFY_AGENT_OUTPUT_LAYER_ID``. ``json_schema`` must
    therefore describe the final top-level object output, not a provider-specific
    response wrapper. First-version support is intentionally limited to object
    schemas plus local ``#/$defs/...`` references so the same caller-provided
    schema can drive both runtime validation and model-facing tool exposure; the
    exposure copy may inline supported ``$defs`` refs as needed for the
    Pydantic/Pydantic AI integration. ``name`` becomes the structured-output
    tool name exposed to pydantic-ai, defaults to ``final_result``, and must be
    1-64 ASCII letters, numbers, underscores, or hyphens so downstream model
    providers accept it consistently. ``description`` and ``strict`` are passed
    through to the generated structured-output tool definition.
    """

    json_schema: dict[str, JsonValue]
    name: str = "final_result"
    description: str | None = None
    strict: bool | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @field_validator("json_schema")
    @classmethod
    def _ensure_object_schema(cls, value: dict[str, JsonValue]) -> dict[str, JsonValue]:
        if value.get("type") != "object":
            raise ValueError("Schema must declare an object output.")
        return value

    @field_validator("name")
    @classmethod
    def _ensure_safe_tool_name(cls, value: str) -> str:
        if not _OUTPUT_TOOL_NAME_PATTERN.fullmatch(value):
            raise ValueError("name must be 1-64 characters of letters, numbers, underscores, or hyphens.")
        return value


__all__ = ["DIFY_OUTPUT_LAYER_TYPE_ID", "DifyOutputLayerConfig"]
