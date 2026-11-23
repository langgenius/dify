"""Native structured output assembly with shared JSON Schema validation.

The runner resolves output_type before invoking Pydantic AI. Its dynamic type
exposes the schema and validates the result in Pydantic AI's retry pipeline.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Final, cast
from urllib.parse import unquote

from jsonschema import Draft4Validator, Draft6Validator, Draft7Validator, SchemaError
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError
from jsonschema.protocols import Validator as JsonSchemaValidator
from jsonschema.validators import validator_for
from pydantic import BaseModel, ConfigDict, GetCoreSchemaHandler, GetJsonSchemaHandler, JsonValue
from pydantic.json_schema import JsonSchemaValue
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.output import OutputSpec, ToolOutput
from pydantic_core import PydanticCustomError, core_schema
from typing_extensions import assert_never

from dify_agent.layers.output.configs import DifyOutputLayerConfig
from dify_agent.runtime.context import Deps

_FINAL_OUTPUT_TOOL_NAME: Final[str] = "final_output"
_VALIDATED_OUTPUT_TYPE_NAME: Final[str] = f"DifyValidatedOutput_{_FINAL_OUTPUT_TOOL_NAME}"
_NON_SCHEMA_VALUE_KEYWORDS: Final[frozenset[str]] = frozenset({"const", "default", "enum", "example", "examples"})
_ANNOTATION_ONLY_KEYWORDS: Final[frozenset[str]] = frozenset(
    {"$comment", "default", "deprecated", "description", "example", "examples", "readOnly", "title", "writeOnly"}
)
_UNEVALUATED_KEYWORDS: Final[frozenset[str]] = frozenset({"unevaluatedItems", "unevaluatedProperties"})
# Keywords whose values are name-to-schema maps. Entry names inside these maps
# are user-chosen data (property names, definition names, ...), never keywords,
# so every entry value is traversed as a schema.
_SCHEMA_MAP_KEYWORDS: Final[frozenset[str]] = frozenset(
    {"$defs", "definitions", "dependencies", "dependentSchemas", "patternProperties", "properties"}
)
_INVALID_JSON_POINTER_ESCAPE_RE: Final[re.Pattern[str]] = re.compile(r"~(?![01])")


@dataclass(frozen=True, slots=True)
class DifyOutputContract:
    """Resolved pydantic-ai output spec for one run.

    ``output_type`` controls both the model-facing output tool schema and the
    runtime validation behavior because the type inside ``ToolOutput`` carries
    custom Pydantic hooks for JSON Schema exposure plus output validation.
    """

    output_type: OutputSpec[object]


class Config(DifyOutputLayerConfig):
    pass


class State(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Capability(AbstractCapability[Deps]):
    """Explicit runner assembly for the native output_type parameter."""

    def __init__(self, name: str):
        self.id = name
        self.name = name

    def build_output_contract(self, deps: Deps) -> DifyOutputContract:
        """Return the pydantic-ai output contract for this layer.

        The returned contract always keeps model-facing schema exposure plus
        runtime validation inside the same dynamically generated dict-like type.
        First-version support is intentionally limited to top-level object JSON
        Schemas so the same schema can be validated with ``jsonschema`` and then
        exposed to Pydantic AI without any wrapper/unwrapper translation. The
        public tool name and exposed schema title are always ``final_output`` so
        providers see one stable structured-output contract shape.

        Raises:
            ValueError: If the JSON Schema is invalid, contains non-local
                references, or cannot be represented as a supported structured
                output tool schema.
        """
        config = Config.model_validate(deps.layers[self.name]["config"])
        user_schema = deepcopy(config.json_schema)
        _reject_non_local_refs(user_schema)
        validated_output_type = _build_validated_output_type(
            user_schema,
            description=config.description,
        )

        return DifyOutputContract(
            output_type=cast(
                OutputSpec[object],
                ToolOutput(
                    validated_output_type,
                    name=_FINAL_OUTPUT_TOOL_NAME,
                    strict=config.strict,
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
    description: str | None,
) -> type[dict[str, object]]:
    """Create a dict-like output type with custom JSON schema and validation hooks.

    The generated type object is fresh per output layer config. Its Pydantic core
    schema performs real ``jsonschema`` validation, while its JSON schema hook
    exposes a model-facing schema that Pydantic AI can turn into an output tool.
    """
    validator = _build_json_schema_validator(schema)
    exposed_schema = _build_exposed_json_schema(schema, description=description)

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
    validated_output_type = cast(type[dict[str, object]], type(_VALIDATED_OUTPUT_TYPE_NAME, (dict,), namespace))
    return validated_output_type


def _build_exposed_json_schema(
    schema: dict[str, JsonValue],
    *,
    description: str | None,
) -> dict[str, JsonValue]:
    """Return the schema exposed to the model through Pydantic AI.

    Pydantic's JSON schema generation cannot safely emit custom schemas that keep
    root-level ``$defs`` references intact, so the exposure copy is inlined for
    supported local ``#/$defs/...`` refs before the final title/description is
    attached.
    """
    exposed_schema = _inline_local_defs_refs(schema)
    exposed_schema["title"] = _FINAL_OUTPUT_TOOL_NAME
    if description is not None:
        exposed_schema["description"] = description
    return exposed_schema


def _reject_non_local_refs(schema: JsonValue) -> None:
    """Raise ``ValueError`` for refs outside direct root ``#/$defs/<name>`` entries.

    JSON Schema allows ordinary instance values under keywords such as ``const``
    and ``examples``. Those values may themselves contain ``{"$ref": ...}`` as
    plain data, so the traversal only inspects positions that still represent
    schema documents rather than blindly recursing into every JSON object. This
    first version supports a single JSON Pointer name token under root ``$defs``
    so every schema accepted here can be materialized into the dynamic output
    type's exposed JSON schema without needing general-purpose root rewriting.
    """
    for ref in _iter_schema_refs(schema):
        _local_defs_ref_name(ref)


def _local_defs_ref_name(ref: str) -> str:
    """Return the decoded name of a direct root ``#/$defs/<name>`` reference.

    Raise ``ValueError`` for remote, unsupported, or malformed refs. To match
    RFC 6901 section 6 and ``referencing``, check the raw fragment's literal
    leading ``/``, percent-decode, split on ``/``, then unescape ``~1`` before
    ``~0``. This keeps percent-encoded slashes as separators and ``~1`` within
    the single name token. Percent-decoding requires valid UTF-8.
    """
    if not ref.startswith("#"):
        raise ValueError(
            "Remote $ref values are not supported; only local fragment refs beginning with '#' are allowed."
        )
    raw_fragment = ref[1:]
    if not raw_fragment.startswith("/"):
        raise ValueError(
            f"Only local refs under '#/$defs/' are supported in this version; got unsupported local ref {ref!r}."
        )
    try:
        segments = unquote(raw_fragment[1:], errors="strict").split("/")
    except UnicodeDecodeError as exc:
        raise ValueError(f"Invalid percent-encoded JSON Pointer in local $ref {ref!r}.") from exc
    if len(segments) < 2 or segments[0] != "$defs":
        raise ValueError(
            f"Only local refs under '#/$defs/' are supported in this version; got unsupported local ref {ref!r}."
        )
    if len(segments) > 2:
        raise ValueError(f"Nested local $ref paths are not supported for structured output: {ref!r}.")

    token = segments[1]
    if _INVALID_JSON_POINTER_ESCAPE_RE.search(token):
        raise ValueError(f"Invalid JSON Pointer escape in local $ref {ref!r}.")
    return token.replace("~1", "/").replace("~0", "~")


def _ref_ignores_siblings(schema: dict[str, JsonValue]) -> bool:
    """Return whether the schema's JSON Schema draft ignores sibling keywords beside ``$ref``."""
    return issubclass(validator_for(schema), (Draft4Validator, Draft6Validator, Draft7Validator))


def _inline_local_defs_refs(schema: dict[str, JsonValue]) -> dict[str, JsonValue]:
    """Inline supported root ``$defs`` refs for Pydantic schema exposure.

    ``jsonschema`` can validate a schema that keeps local refs, but Pydantic's
    JSON schema generation cannot safely preserve custom root ``$defs`` in this
    integration. Inlining keeps the model-facing schema equivalent while still
    letting runtime validation use the original schema document: for Draft
    2019-09 / Draft 2020-12 schemas, validation siblings alongside ``$ref`` are
    composed via ``allOf`` rather than overwriting the referenced definition,
    while Draft-04 / Draft-06 / Draft-07 schemas ignore ``$ref`` siblings.
    Schema containers are rebuilt and literal keyword values are deep-copied,
    so the exposed schema stays independent of the validation schema.
    Unresolvable or recursive references raise ``ValueError`` during contract
    construction.
    """
    raw_defs = schema.get("$defs")
    root_defs = raw_defs if isinstance(raw_defs, dict) else {}
    ignore_ref_siblings = _ref_ignores_siblings(schema)

    def _compose_ref_with_siblings(
        resolved_target: dict[str, JsonValue],
        siblings: dict[str, JsonValue],
        *,
        is_root: bool,
    ) -> dict[str, JsonValue]:
        if not siblings:
            return resolved_target
        if ignore_ref_siblings:
            if is_root and "$schema" in siblings:
                return {"$schema": siblings["$schema"], **resolved_target}
            return resolved_target

        outer: dict[str, JsonValue] = {}
        validation_siblings: dict[str, JsonValue] = {}
        has_unevaluated = False
        for key, value in siblings.items():
            if is_root and key == "$schema":
                outer[key] = value
            elif key in _ANNOTATION_ONLY_KEYWORDS:
                outer[key] = value
            elif key in _UNEVALUATED_KEYWORDS:
                outer[key] = value
                has_unevaluated = True
            else:
                validation_siblings[key] = value

        if not validation_siblings and not has_unevaluated:
            return {**resolved_target, **outer}

        if is_root and validation_siblings.get("type") == "object":
            outer["type"] = "object"
            del validation_siblings["type"]
            if not validation_siblings and not has_unevaluated and resolved_target.get("type") == "object":
                return {**resolved_target, **outer}

        all_of_members: list[JsonValue] = [resolved_target]
        if validation_siblings:
            all_of_members.append(validation_siblings)
        return {**outer, "allOf": all_of_members}

    def resolve(node: JsonValue, *, ref_stack: tuple[str, ...], is_root: bool = False) -> JsonValue:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str):
                ref_name = _local_defs_ref_name(ref)
                if ref_name in ref_stack:
                    raise ValueError("Recursive $defs refs are not supported for structured output exposure.")
                target = root_defs.get(ref_name)
                if not isinstance(target, dict):
                    raise ValueError(f"Local $ref {ref!r} could not be resolved from $defs.")
                resolved_target = cast(dict[str, JsonValue], resolve(target, ref_stack=(*ref_stack, ref_name)))
                siblings: dict[str, JsonValue] = {}
                for key, value in node.items():
                    if key in {"$ref", "$defs"}:
                        continue
                    siblings[key] = _resolve_schema_keyword(key, value, ref_stack=ref_stack)
                return _compose_ref_with_siblings(resolved_target, siblings, is_root=is_root)

            resolved_node: dict[str, JsonValue] = {}
            for key, value in node.items():
                if key == "$defs":
                    continue
                resolved_node[key] = _resolve_schema_keyword(key, value, ref_stack=ref_stack)
            return resolved_node

        if isinstance(node, list):
            return [resolve(item, ref_stack=ref_stack) for item in node]

        return node

    def _resolve_schema_keyword(key: str, value: JsonValue, *, ref_stack: tuple[str, ...]) -> JsonValue:
        """Resolve one keyword value of a schema object according to its position.

        Values of literal-data keywords stay untouched. Values of name-to-schema
        map keywords are resolved entry by entry, so an entry named like a
        keyword (for example a property named ``default``) is still a schema.
        """
        if key in _NON_SCHEMA_VALUE_KEYWORDS:
            return deepcopy(value)
        if key in _SCHEMA_MAP_KEYWORDS and isinstance(value, dict):
            return {name: resolve(entry, ref_stack=ref_stack) for name, entry in value.items()}
        return resolve(value, ref_stack=ref_stack)

    resolved_schema = resolve(schema, ref_stack=(), is_root=True)
    return cast(dict[str, JsonValue], resolved_schema)


def _iter_schema_refs(schema: JsonValue) -> Iterable[str]:
    if isinstance(schema, dict):
        for key, value in schema.items():
            if key == "$ref" and isinstance(value, str):
                yield value
            elif key in _NON_SCHEMA_VALUE_KEYWORDS:
                continue
            elif key in _SCHEMA_MAP_KEYWORDS and isinstance(value, dict):
                # Map entry names are user data, not keywords, so every entry
                # value is a schema regardless of what the entry is called.
                for entry in value.values():
                    yield from _iter_schema_refs(entry)
            else:
                yield from _iter_schema_refs(value)
    elif isinstance(schema, list):
        for item in schema:
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


__all__ = ["DifyOutputContract", "Config", "State", "Capability"]
