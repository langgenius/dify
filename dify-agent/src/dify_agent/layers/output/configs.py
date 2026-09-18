"""Client-safe DTOs for Dify Agent structured output configuration.

This module contains only the public config schema and stable layer type id for
the optional structured output layer. Runtime conversion into pydantic-ai output
specifications happens in ``dify_agent.layers.output.output_layer`` so client
imports do not pull in server execution code.
"""

from __future__ import annotations

from typing import ClassVar, Final

from pydantic import ConfigDict, JsonValue, field_validator

from agenton.layers import LayerConfig


DIFY_OUTPUT_LAYER_TYPE_ID: Final[str] = "dify.output"


class DifyOutputLayerConfig(LayerConfig):
    """Public config for the conventionally named structured output layer.

    The runtime only reads the layer named by
    ``dify_agent.protocol.DIFY_AGENT_OUTPUT_LAYER_ID``. ``json_schema`` must
    therefore describe the final top-level object output, not a provider-specific
    response wrapper. First-version support is intentionally limited to object
    schemas plus local ``#/$defs/...`` references so the same caller-provided
    schema can drive both runtime validation and model-facing tool exposure; the
    exposure copy may inline supported ``$defs`` refs as needed for the
    Pydantic/Pydantic AI integration. The structured-output tool name and schema
    title exposed to pydantic-ai are fixed to ``final_output`` so callers only
    control the JSON Schema itself plus any optional description/strictness
    metadata.
    """

    json_schema: dict[str, JsonValue]
    description: str | None = None
    strict: bool | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @field_validator("json_schema")
    @classmethod
    def _ensure_object_schema(cls, value: dict[str, JsonValue]) -> dict[str, JsonValue]:
        if value.get("type") != "object":
            raise ValueError("Schema must declare an object output.")
        return value


__all__ = ["DIFY_OUTPUT_LAYER_TYPE_ID", "DifyOutputLayerConfig"]
