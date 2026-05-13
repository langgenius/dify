"""Runtime layer for Dify Agent structured final output contracts.

``DifyOutputLayer`` is intentionally state-free and does not participate in
prompt, user prompt, or tool aggregation. Instead, the scheduler and runner read
the conventionally named layer after ``Compositor.enter(...)`` and convert its
top-level object JSON Schema into a ``ToolOutput(...)`` whose inner dynamic type
both exposes the model-facing schema and validates runtime output. ``jsonschema``
performs the real content validation inside that custom Pydantic-compatible
dict-like type, so Pydantic AI's normal output validation flow can request
retries without a separate Dify-owned output-validator callback. Keeping both
steps here lets request validation and execution reuse the same schema checks
without teaching Agenton core about output aggregation.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Final, cast

from jsonschema import SchemaError
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError
from jsonschema.protocols import Validator as JsonSchemaValidator
from jsonschema.validators import validator_for
from pydantic import GetCoreSchemaHandler, GetJsonSchemaHandler, JsonValue
from pydantic.json_schema import JsonSchemaValue
from pydantic_ai.output import OutputSpec, ToolOutput
from pydantic_core import PydanticCustomError, core_schema
from typing_extensions import Self, assert_never, override


from agenton.layers import EmptyRuntimeState, NoLayerDeps, PlainLayer
from dify_agent.layers.output.configs import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig


_LOCAL_DEFS_REF_PREFIX: Final[str] = "#/$defs/"
_NON_SCHEMA_VALUE_KEYWORDS: Final[frozenset[str]] = frozenset({"const", "default", "enum", "example", "examples"})


@dataclass(frozen=True, slots=True)
class DifyOutputContract:
    """Resolved pydantic-ai output spec for one run.

    ``output_type`` controls both the model-facing output tool schema and the
    runtime validation behavior because the type inside ``ToolOutput`` carries
    custom Pydantic hooks for JSON Schema exposure plus output validation.
    """

    output_type: OutputSpec[object]


@dataclass(slots=True)
class DifyOutputLayer(PlainLayer[NoLayerDeps, DifyOutputLayerConfig, EmptyRuntimeState]):
    """State-free layer that stores the final structured output contract."""

    type_id = DIFY_OUTPUT_LAYER_TYPE_ID

    config: DifyOutputLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyOutputLayerConfig) -> Self:
        """Create the output layer from validated public config."""
        return cls(config=DifyOutputLayerConfig.model_validate(config))

    def build_output_contract(self) -> DifyOutputContract:
        """Return the pydantic-ai output contract for this layer.

        The returned contract always keeps model-facing schema exposure plus
        runtime validation inside the same dynamically generated dict-like type.
        First-version support is intentionally limited to top-level object JSON
        Schemas so the same schema can be validated with ``jsonschema`` and then
        exposed to Pydantic AI without any wrapper/unwrapper translation.

        Raises:
            ValueError: If the JSON Schema is invalid, contains non-local
                references, or cannot be represented as a supported structured
                output tool schema.
        """
        user_schema = deepcopy(self.config.json_schema)
        _reject_non_local_refs(user_schema)
        validated_output_type = _build_validated_output_type(
            user_schema,
            name=self.config.name,
            description=self.config.description,
        )

        return DifyOutputContract(
            output_type=cast(
                OutputSpec[object],
                ToolOutput(
                    validated_output_type,
                    name=self.config.name,
                    strict=self.config.strict,
                ),
            ),
        )


def _build_json_schema_validator(schema: dict[str, JsonValue]) -> JsonSchemaValidator:
    """Build a reusable validator after checking the schema itself."""
    validator_class = validator_for(schema)
    try:
        validator_class.check_schema(schema)
    except SchemaError as exc:
        raise ValueError(str(exc)) from exc
    return validator_class(schema)


def _build_validated_output_type(
    schema: dict[str, JsonValue],
    *,
    name: str,
    description: str | None,
) -> type[dict[str, object]]:
    """Create a dict-like output type with custom JSON schema and validation hooks.

    The generated type is unique per output layer config. Its Pydantic core
    schema performs real ``jsonschema`` validation, while its JSON schema hook
    exposes a model-facing schema that Pydantic AI can turn into an output tool.
    """
    validator = _build_json_schema_validator(schema)
    exposed_schema = _build_exposed_json_schema(schema, name=name, description=description)
    type_name = _build_output_type_name(name)

    def _validate_output(value: dict[str, object]) -> object:
        errors = sorted(validator.iter_errors(cast(JsonValue, value)), key=lambda error: _sort_error_path(error.path))
        if errors:
            message = _format_json_schema_error(errors[0])
            raise PydanticCustomError(
                "json_schema_validation",
                "Output does not match JSON Schema: {message}",
                {"message": message},
            )
        return validated_output_type(value)

    @classmethod
    def __get_pydantic_core_schema__(
        cls,
        source_type: Any,
        handler: GetCoreSchemaHandler,
    ) -> core_schema.CoreSchema:
        del source_type, handler
        return core_schema.no_info_after_validator_function(
            _validate_output,
            core_schema.dict_schema(
                keys_schema=core_schema.str_schema(),
                values_schema=core_schema.any_schema(),
            ),
        )

    @classmethod
    def __get_pydantic_json_schema__(
        cls,
        schema_: core_schema.CoreSchema,
        handler: GetJsonSchemaHandler,
    ) -> JsonSchemaValue:
        del cls, schema_, handler
        return deepcopy(exposed_schema)

    namespace = {
        "__module__": __name__,
        "__is_model_like__": True,
        "__get_pydantic_core_schema__": __get_pydantic_core_schema__,
        "__get_pydantic_json_schema__": __get_pydantic_json_schema__,
    }
    validated_output_type = cast(type[dict[str, object]], type(type_name, (dict,), namespace))
    return validated_output_type


def _build_exposed_json_schema(
    schema: dict[str, JsonValue],
    *,
    name: str,
    description: str | None,
) -> dict[str, JsonValue]:
    """Return the schema exposed to the model through Pydantic AI.

    Pydantic's JSON schema generation cannot safely emit custom schemas that keep
    root-level ``$defs`` references intact, so the exposure copy is inlined for
    supported local ``#/$defs/...`` refs before the final title/description is
    attached.
    """
    exposed_schema = _inline_local_defs_refs(schema)
    exposed_schema["title"] = name
    if description is not None:
        exposed_schema["description"] = description
    return exposed_schema


def _build_output_type_name(name: str) -> str:
    """Return a deterministic debug-friendly class name for one output schema."""
    sanitized = "".join(character if character.isalnum() else "_" for character in name).strip("_") or "final_result"
    return f"DifyValidatedOutput_{sanitized}"


def _reject_non_local_refs(schema: JsonValue) -> None:
    """Reject references that would require external fetching or non-local state.

    JSON Schema allows ordinary instance values under keywords such as ``const``
    and ``examples``. Those values may themselves contain ``{"$ref": ...}`` as
    plain data, so the traversal only inspects positions that still represent
    schema documents rather than blindly recursing into every JSON object. This
    first version only supports local refs under ``#/$defs/`` so every schema
    accepted here can be materialized into the dynamic output type's exposed JSON
    schema without needing general-purpose root rewriting.
    """
    for ref in _iter_schema_refs(schema):
        if not ref.startswith("#"):
            raise ValueError(
                "Remote $ref values are not supported; only local fragment refs beginning with '#' are allowed."
            )
        if not ref.startswith(_LOCAL_DEFS_REF_PREFIX):
            raise ValueError(
                f"Only local refs under '#/$defs/' are supported in this version; got unsupported local ref {ref!r}."
            )


def _inline_local_defs_refs(schema: dict[str, JsonValue]) -> dict[str, JsonValue]:
    """Inline supported root ``$defs`` refs for Pydantic schema exposure.

    ``jsonschema`` can validate a schema that keeps local refs, but Pydantic's
    JSON schema generation cannot safely preserve custom root ``$defs`` in this
    integration. Inlining keeps the model-facing schema equivalent while still
    letting runtime validation use the original schema document.
    """
    root_defs = schema.get("$defs")
    if not isinstance(root_defs, dict):
        return deepcopy(schema)

    def resolve(node: JsonValue, *, ref_stack: tuple[str, ...]) -> JsonValue:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str):
                ref_name = ref.removeprefix(_LOCAL_DEFS_REF_PREFIX)
                if ref_name in ref_stack:
                    raise ValueError("Recursive $defs refs are not supported for structured output exposure.")
                target = root_defs.get(ref_name)
                if not isinstance(target, dict):
                    raise ValueError(f"Local $ref {ref!r} could not be resolved from $defs.")
                resolved_target = resolve(deepcopy(target), ref_stack=(*ref_stack, ref_name))
                merged = cast(dict[str, JsonValue], deepcopy(resolved_target))
                for key, value in node.items():
                    if key == "$ref":
                        continue
                    if key in _NON_SCHEMA_VALUE_KEYWORDS:
                        merged[key] = deepcopy(value)
                    else:
                        merged[key] = _resolve_or_copy(value, ref_stack=ref_stack)
                return merged

            resolved_node: dict[str, JsonValue] = {}
            for key, value in node.items():
                if key == "$defs":
                    continue
                if key in _NON_SCHEMA_VALUE_KEYWORDS:
                    resolved_node[key] = deepcopy(value)
                else:
                    resolved_node[key] = _resolve_or_copy(value, ref_stack=ref_stack)
            return resolved_node

        if isinstance(node, list):
            return [_resolve_or_copy(item, ref_stack=ref_stack) for item in node]

        return deepcopy(node)

    def _resolve_or_copy(value: JsonValue, *, ref_stack: tuple[str, ...]) -> JsonValue:
        if isinstance(value, dict | list):
            return resolve(value, ref_stack=ref_stack)
        return deepcopy(value)

    resolved_schema = resolve(deepcopy(schema), ref_stack=())
    return cast(dict[str, JsonValue], resolved_schema)


def _iter_schema_refs(schema: JsonValue) -> Iterable[str]:
    if isinstance(schema, dict):
        for key, value in schema.items():
            if key == "$ref" and isinstance(value, str):
                yield value
            elif key in _NON_SCHEMA_VALUE_KEYWORDS:
                continue
            elif isinstance(value, dict | list):
                yield from _iter_schema_refs(value)
    elif isinstance(schema, list):
        for item in schema:
            if isinstance(item, dict | list):
                yield from _iter_schema_refs(item)
    elif isinstance(schema, str | int | float | bool) or schema is None:
        return
    else:  # pragma: no cover - JsonValue exhaustiveness guard
        assert_never(schema)


def _format_json_schema_error(error: JsonSchemaValidationError) -> str:
    return f"{_format_json_path(list(error.path))}: {error.message}"


def _format_json_path(path: Sequence[object]) -> str:
    if not path:
        return "$"

    formatted_path = "$"
    for segment in path:
        if isinstance(segment, int):
            formatted_path += f"[{segment}]"
        elif isinstance(segment, str):
            formatted_path += f".{segment}"
        else:  # pragma: no cover - jsonschema paths are strings or integers
            formatted_path += f"[{segment!r}]"
    return formatted_path


def _sort_error_path(path: Sequence[object]) -> tuple[str, ...]:
    return tuple(str(segment) for segment in path)


__all__ = ["DifyOutputContract", "DifyOutputLayer"]
