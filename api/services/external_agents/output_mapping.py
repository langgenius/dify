"""Deterministic final-output mapping, strict declared types and trusted File import.

Mapping ambiguity fails before defaults. Only completed business artifacts or a
direct Message participate, never history/status text. Output publication is one
return value after every file has been materialized and every field validated.
"""

import json
import math
from collections.abc import Mapping, Sequence

from .file_profile import DEFAULT_FILE_LIMITS, FileLimits
from .io_contracts import (
    ExternalIOError,
    FileScope,
    JsonObject,
    JsonValue,
    OutputField,
    OutputFileMaterializerPort,
    OutputMappingResult,
    StoredFile,
)
from .protocol import TRACEABILITY_URI, GatewayReceipt


def contains_file(field: OutputField) -> bool:
    """Identify declared file types recursively; ordinary String content is irrelevant."""
    return (
        field.kind == "file"
        or any(contains_file(child) for child in field.children)
        or (field.item is not None and contains_file(field.item))
    )


def validate_output_fields(fields: Sequence[OutputField]) -> None:
    """Reject duplicate declaration names and all file-valued defaults before execution."""
    names = [field.name for field in fields]
    if len(names) != len(set(names)) or any(not name for name in names):
        raise ExternalIOError("invalid_output_schema", "Output names must be nonempty and unique.")
    for field in fields:
        if field.kind not in ("string", "number", "integer", "boolean", "object", "array", "file"):
            raise ExternalIOError("invalid_output_schema", "An output type is unsupported.")
        if field.has_default and contains_file(field):
            raise ExternalIOError(
                "file_default_forbidden", "File-valued defaults are not supported, including nested files."
            )
        if field.children:
            validate_output_fields(field.children)
        if field.item is not None:
            validate_output_fields((field.item,))
        if field.kind == "array" and field.item is None:
            raise ExternalIOError("invalid_output_schema", "An array output needs an item type.")
        if field.has_default:
            _validate_value(field.default, field, field.name)


def _json_object(text: str) -> JsonObject:
    def pairs(values: list[tuple[str, JsonValue]]) -> JsonObject:
        result: JsonObject = {}
        for key, value in values:
            if key in result:
                raise ExternalIOError("ambiguous_output", "Structured output contains a duplicate key.")
            result[key] = value
        return result

    def invalid_constant(_value: str) -> None:
        raise ExternalIOError("invalid_output_number", "Non-finite JSON numbers are not supported.")

    def finite_float(number: str) -> float:
        result = float(number)
        if not math.isfinite(result):
            raise ExternalIOError("invalid_output_number", "Non-finite JSON numbers are not supported.")
        return result

    try:
        value = json.loads(text, object_pairs_hook=pairs, parse_constant=invalid_constant, parse_float=finite_float)
    except (ValueError, TypeError, RecursionError) as error:
        if isinstance(error, ExternalIOError):
            raise
        raise ExternalIOError("invalid_structured_output", "Explicit JSON output is not strict JSON.") from error
    if not isinstance(value, dict):
        raise ExternalIOError("invalid_structured_output", "Structured output must be a top-level JSON object.")
    return value


def _validate_value(value: object, field: OutputField, path: str) -> JsonValue:
    if field.kind == "file":
        if isinstance(value, StoredFile):
            return value.value
    elif (
        field.kind == "string"
        and isinstance(value, str)
        or field.kind == "boolean"
        and isinstance(value, bool)
        or field.kind == "integer"
        and isinstance(value, int)
        and not isinstance(value, bool)
    ):
        return value
    elif field.kind == "number":
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        if isinstance(value, float) and math.isfinite(value):
            return value
    elif field.kind == "object" and isinstance(value, dict):
        if field.children:
            return _validate_record(value, field.children, path)[0]
        return _json_object(json.dumps(value, allow_nan=False))
    elif field.kind == "array" and isinstance(value, list) and field.item is not None:
        return [_validate_value(item, field.item, f"{path}[{index}]") for index, item in enumerate(value)]
    raise ExternalIOError("output_validation_failed", f"Output {path} does not match its declared type.")


def _validate_record(
    values: dict[str, object], fields: Sequence[OutputField], prefix: str = ""
) -> tuple[JsonObject, tuple[str, ...]]:
    output: JsonObject = {}
    defaults: list[str] = []
    for field in fields:
        path = f"{prefix}.{field.name}" if prefix else field.name
        if field.name not in values and not field.required:
            pass
        else:
            try:
                if field.name not in values:
                    raise ExternalIOError("output_validation_failed", f"Required output {path} was not provided.")
                output[field.name] = _validate_value(values[field.name], field, path)
            except ExternalIOError:
                if not field.has_default:
                    raise
                output[field.name] = _validate_value(field.default, field, path)
                defaults.append(path)
    return output, tuple(defaults)


def normalize_node_defaults(defaults: Mapping[str, object], fields: Sequence[OutputField]) -> JsonObject:
    """Project explicitly provided non-file node defaults through the output schema.

    Extra object members never survive validation; child defaults use the same
    rules as business output. This does not participate in source selection and
    therefore cannot hide an ambiguous remote mapping.
    """
    declared = {field.name: field for field in fields}
    if any(key not in declared or contains_file(declared[key]) for key in defaults):
        raise ExternalIOError("invalid_node_default", "Node defaults must target declared non-file outputs.")
    return {key: _validate_value(value, declared[key], key) for key, value in defaults.items()}


def _trace_only(artifact: JsonObject) -> bool:
    """Recognize only the tested Traceability data-only artifact shape, not a name heuristic."""
    extensions = artifact.get("extensions", [])
    parts = artifact.get("parts", [])
    return (
        isinstance(extensions, list)
        and TRACEABILITY_URI in extensions
        and isinstance(parts, list)
        and bool(parts)
        and all(
            isinstance(part, dict) and isinstance(part.get("data"), dict) and set(part["data"]) == {"trace_id", "steps"}
            for part in parts
        )
    )


def map_output(
    receipt: GatewayReceipt,
    fields: Sequence[OutputField],
    *,
    scope: FileScope,
    materializer: OutputFileMaterializerPort | None,
    trace_artifact_ids: frozenset[str] = frozenset(),
    limits: FileLimits = DEFAULT_FILE_LIMITS,
    max_variable_bytes: int = 200 * 1024,
) -> OutputMappingResult:
    """Map a validated final receipt without any remote business-task replay.

    The materializer is an admitted, deletion-aware storage adapter. A failure
    returns no downstream values; any partial imported copies remain owned by
    the invocation's cleanup lease. Mapping ambiguities cannot use defaults.
    """
    validate_output_fields(fields)
    names = {field.name for field in fields}
    sources: list[tuple[str, str | None, list[JsonValue]]] = []
    if receipt.kind == "message":
        parts = receipt.payload.get("parts", [])
        if not isinstance(parts, list):
            raise ExternalIOError("invalid_response", "The Message parts are invalid.")
        sources.append(("message", None, parts))
    else:
        if receipt.state != "TASK_STATE_COMPLETED":
            raise ExternalIOError("task_not_completed", "Only a completed Task can publish business output.")
        artifacts = receipt.payload.get("artifacts", [])
        if not isinstance(artifacts, list):
            raise ExternalIOError("invalid_response", "The Task artifacts are invalid.")
        ids: set[str] = set()
        for artifact in artifacts:
            if not isinstance(artifact, dict) or not isinstance(artifact.get("artifactId"), str):
                raise ExternalIOError("invalid_response", "An artifact is invalid.")
            artifact_id = artifact["artifactId"]
            if artifact_id in ids:
                raise ExternalIOError("ambiguous_output", "Duplicate completed artifact IDs are ambiguous.")
            ids.add(artifact_id)
            if artifact_id not in trace_artifact_ids and not _trace_only(artifact):
                parts = artifact.get("parts", [])
                if not isinstance(parts, list):
                    raise ExternalIOError("invalid_response", "The artifact parts are invalid.")
                name = artifact.get("name")
                sources.append((artifact_id, name if isinstance(name, str) and name else None, parts))

    candidates: dict[str, object] = {}
    plain: list[str] = []
    structured = False
    files: list[tuple[str, str | None, int, JsonObject]] = []
    for artifact_id, artifact_name, parts in sources:
        for index, part in enumerate(parts):
            if not isinstance(part, dict):
                raise ExternalIOError("invalid_response", "An output Part is invalid.")
            record: JsonObject | None = None
            if "data" in part:
                structured = True
                data = part["data"]
                if not isinstance(data, dict):
                    raise ExternalIOError(
                        "invalid_structured_output", "Structured output must use top-level object keys."
                    )
                record = data
            elif "text" in part:
                value = part["text"]
                if not isinstance(value, str):
                    raise ExternalIOError("invalid_response", "The text Part is invalid.")
                media_type = part.get("mediaType", "text/plain")
                if isinstance(media_type, str) and media_type.split(";", 1)[0].strip().lower() == "application/json":
                    structured = True
                    record = _json_object(value)
                else:
                    plain.append(value)
            elif "raw" in part or "url" in part:
                files.append((artifact_id, artifact_name, index, part))
            if record is not None:
                for key in record.keys() & names:
                    if key in candidates:
                        raise ExternalIOError("ambiguous_output", f"More than one source provides output {key}.")
                    candidates[key] = record[key]
    if not structured and plain:
        candidates["text"] = "".join(plain)
    file_fields = {
        field.name: field
        for field in fields
        if field.kind == "file" or (field.kind == "array" and field.item is not None and field.item.kind == "file")
    }
    grouped: dict[str, list[tuple[str, int, JsonObject]]] = {}
    if len(files) > limits.max_files:
        raise ExternalIOError("too_many_files", "The response exceeds the effective file count limit.")
    for artifact_id, name, index, part in files:
        target = name if name is not None else next(iter(file_fields)) if len(file_fields) == 1 else None
        if target not in file_fields or target is None:
            raise ExternalIOError("ambiguous_output", "The file output target cannot be uniquely mapped.")
        if target in candidates:
            raise ExternalIOError("ambiguous_output", "A structured field competes with a file output.")
        grouped.setdefault(target, []).append((artifact_id, index, part))
    for name, group in grouped.items():
        if file_fields[name].kind == "file" and len(group) != 1:
            raise ExternalIOError("ambiguous_output", "A File output must receive exactly one file.")
    total = 0
    for name, group in grouped.items():
        if materializer is None:
            raise ExternalIOError("file_materializer_unavailable", "File output storage is not configured.")
        stored: list[StoredFile] = []
        for artifact_id, index, part in group:
            imported = materializer.materialize(
                scope, part, artifact_id=artifact_id, part_index=index, max_bytes=limits.max_total_bytes - total
            )
            total += imported.size
            if total > limits.max_total_bytes:
                raise ExternalIOError("file_total_too_large", "The total output file bytes exceed the effective limit.")
            stored.append(imported)
        candidates[name] = stored[0] if file_fields[name].kind == "file" else stored
    values, defaults = _validate_record(candidates, fields)
    applied = list(defaults)
    for field in fields:
        if field.name in values:
            encoded = json.dumps(values[field.name], ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode(
                "utf-8"
            )
            if len(encoded) > max_variable_bytes:
                if not field.has_default:
                    raise ExternalIOError("output_variable_too_large", "An output exceeds the variable byte limit.")
                fallback = _validate_value(field.default, field, field.name)
                if (
                    len(
                        json.dumps(fallback, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
                    )
                    > max_variable_bytes
                ):
                    raise ExternalIOError("output_variable_too_large", "An output default exceeds the variable limit.")
                values[field.name] = fallback
                applied.append(field.name)
    return OutputMappingResult(values=values, defaults_applied=tuple(dict.fromkeys(applied)))


def safe_receipt_metadata(receipt: GatewayReceipt) -> JsonObject:
    """Return non-resurrecting history metadata; never persist raw/base64/secret URLs."""
    return {"kind": receipt.kind, "task_id": receipt.task_id, "context_id": receipt.context_id, "state": receipt.state}
