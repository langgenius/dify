"""
File reference detection and conversion for structured output.

This module provides utilities to:
1. Detect file reference fields in JSON Schema (format: "dify-file-ref")
2. Convert file ID strings to File objects after LLM returns
"""

import uuid
from collections.abc import Mapping
from typing import Any

from core.file import File
from core.variables.segments import ArrayFileSegment, FileSegment
from factories.file_factory import build_from_mapping

FILE_REF_FORMAT = "dify-file-ref"


def is_file_ref_property(schema: dict) -> bool:
    """Check if a schema property is a file reference."""
    return schema.get("type") == "string" and schema.get("format") == FILE_REF_FORMAT


def detect_file_ref_fields(schema: Mapping[str, Any], path: str = "") -> list[str]:
    """
    Recursively detect file reference fields in schema.

    Args:
        schema: JSON Schema to analyze
        path: Current path in the schema (used for recursion)

    Returns:
        List of JSON paths containing file refs, e.g., ["image_id", "files[*]"]
    """
    file_ref_paths: list[str] = []
    schema_type = schema.get("type")

    if schema_type == "object":
        for prop_name, prop_schema in schema.get("properties", {}).items():
            current_path = f"{path}.{prop_name}" if path else prop_name

            if is_file_ref_property(prop_schema):
                file_ref_paths.append(current_path)
            elif isinstance(prop_schema, dict):
                file_ref_paths.extend(detect_file_ref_fields(prop_schema, current_path))

    elif schema_type == "array":
        items_schema = schema.get("items", {})
        array_path = f"{path}[*]" if path else "[*]"

        if is_file_ref_property(items_schema):
            file_ref_paths.append(array_path)
        elif isinstance(items_schema, dict):
            file_ref_paths.extend(detect_file_ref_fields(items_schema, array_path))

    return file_ref_paths


def convert_file_refs_in_output(
    output: Mapping[str, Any],
    json_schema: Mapping[str, Any],
    tenant_id: str,
) -> dict[str, Any]:
    """
    Convert file ID strings to File objects based on schema.

    Args:
        output: The structured_output from LLM result
        json_schema: The original JSON schema (to detect file ref fields)
        tenant_id: Tenant ID for file lookup

    Returns:
        Output with file references converted to File objects
    """
    file_ref_paths = detect_file_ref_fields(json_schema)
    if not file_ref_paths:
        return dict(output)

    result = _deep_copy_dict(output)

    for path in file_ref_paths:
        _convert_path_in_place(result, path.split("."), tenant_id)

    return result


def _deep_copy_dict(obj: Mapping[str, Any]) -> dict[str, Any]:
    """Deep copy a mapping to a mutable dict."""
    result: dict[str, Any] = {}
    for key, value in obj.items():
        if isinstance(value, Mapping):
            result[key] = _deep_copy_dict(value)
        elif isinstance(value, list):
            result[key] = [_deep_copy_dict(item) if isinstance(item, Mapping) else item for item in value]
        else:
            result[key] = value
    return result


def _convert_path_in_place(obj: dict, path_parts: list[str], tenant_id: str) -> None:
    """Convert file refs at the given path in place, wrapping in Segment types."""
    if not path_parts:
        return

    current = path_parts[0]
    remaining = path_parts[1:]

    # Handle array notation like "files[*]"
    if current.endswith("[*]"):
        key = current[:-3] if current != "[*]" else None
        target = obj.get(key) if key else obj

        if isinstance(target, list):
            if remaining:
                # Nested array with remaining path - recurse into each item
                for item in target:
                    if isinstance(item, dict):
                        _convert_path_in_place(item, remaining, tenant_id)
            else:
                # Array of file IDs - convert all and wrap in ArrayFileSegment
                files: list[File] = []
                for item in target:
                    file = _convert_file_id(item, tenant_id)
                    if file is not None:
                        files.append(file)
                # Replace the array with ArrayFileSegment
                if key:
                    obj[key] = ArrayFileSegment(value=files)
        return

    if not remaining:
        # Leaf node - convert the value and wrap in FileSegment
        if current in obj:
            file = _convert_file_id(obj[current], tenant_id)
            if file is not None:
                obj[current] = FileSegment(value=file)
            else:
                obj[current] = None
    else:
        # Recurse into nested object
        if current in obj and isinstance(obj[current], dict):
            _convert_path_in_place(obj[current], remaining, tenant_id)


def _convert_file_id(file_id: Any, tenant_id: str) -> File | None:
    """
    Convert a file ID string to a File object.

    Tries multiple file sources in order:
    1. ToolFile (files generated by tools/workflows)
    2. UploadFile (files uploaded by users)
    """
    if not isinstance(file_id, str):
        return None

    # Validate UUID format
    try:
        uuid.UUID(file_id)
    except ValueError:
        return None

    # Try ToolFile first (files generated by tools/workflows)
    try:
        return build_from_mapping(
            mapping={
                "transfer_method": "tool_file",
                "tool_file_id": file_id,
            },
            tenant_id=tenant_id,
        )
    except ValueError:
        pass

    # Try UploadFile (files uploaded by users)
    try:
        return build_from_mapping(
            mapping={
                "transfer_method": "local_file",
                "upload_file_id": file_id,
            },
            tenant_id=tenant_id,
        )
    except ValueError:
        pass

    # File not found in any source
    return None
