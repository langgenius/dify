"""
File path detection and conversion for structured output.

This module provides utilities to:
1. Detect sandbox file path fields in JSON Schema (format: "file-path")
2. Adapt schemas to add file-path descriptions before model invocation
3. Convert sandbox file path strings into File objects via a resolver
"""

from collections.abc import Callable, Mapping, Sequence
from typing import Any, cast

from core.file import File
from core.variables.segments import ArrayFileSegment, FileSegment

FILE_PATH_FORMAT = "file-path"
FILE_PATH_DESCRIPTION_SUFFIX = "this field contains a file path from the Dify sandbox"


def is_file_path_property(schema: Mapping[str, Any]) -> bool:
    """Check if a schema property represents a sandbox file path."""
    if schema.get("type") != "string":
        return False
    format_value = schema.get("format")
    if not isinstance(format_value, str):
        return False
    normalized_format = format_value.lower().replace("_", "-")
    return normalized_format == FILE_PATH_FORMAT


def detect_file_path_fields(schema: Mapping[str, Any], path: str = "") -> list[str]:
    """Recursively detect file path fields in a JSON schema."""
    file_path_fields: list[str] = []
    schema_type = schema.get("type")

    if schema_type == "object":
        properties = schema.get("properties")
        if isinstance(properties, Mapping):
            properties_mapping = cast(Mapping[str, Any], properties)
            for prop_name, prop_schema in properties_mapping.items():
                if not isinstance(prop_schema, Mapping):
                    continue
                prop_schema_mapping = cast(Mapping[str, Any], prop_schema)
                current_path = f"{path}.{prop_name}" if path else prop_name

                if is_file_path_property(prop_schema_mapping):
                    file_path_fields.append(current_path)
                else:
                    file_path_fields.extend(detect_file_path_fields(prop_schema_mapping, current_path))

    elif schema_type == "array":
        items_schema = schema.get("items")
        if not isinstance(items_schema, Mapping):
            return file_path_fields
        items_schema_mapping = cast(Mapping[str, Any], items_schema)
        array_path = f"{path}[*]" if path else "[*]"

        if is_file_path_property(items_schema_mapping):
            file_path_fields.append(array_path)
        else:
            file_path_fields.extend(detect_file_path_fields(items_schema_mapping, array_path))

    return file_path_fields


def adapt_schema_for_sandbox_file_paths(schema: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Normalize sandbox file path fields and collect their JSON paths."""
    result = _deep_copy_value(schema)
    if not isinstance(result, dict):
        raise ValueError("structured_output_schema must be a JSON object")
    result_dict = cast(dict[str, Any], result)

    file_path_fields: list[str] = []
    _adapt_schema_in_place(result_dict, path="", file_path_fields=file_path_fields)
    return result_dict, file_path_fields


def convert_sandbox_file_paths_in_output(
    output: Mapping[str, Any],
    file_path_fields: Sequence[str],
    file_resolver: Callable[[str], File],
) -> tuple[dict[str, Any], list[File]]:
    """Convert sandbox file paths into File objects using the resolver."""
    if not file_path_fields:
        return dict(output), []

    result = _deep_copy_value(output)
    if not isinstance(result, dict):
        raise ValueError("Structured output must be a JSON object")
    result_dict = cast(dict[str, Any], result)

    files: list[File] = []
    for path in file_path_fields:
        _convert_path_in_place(result_dict, path.split("."), file_resolver, files)

    return result_dict, files


def _adapt_schema_in_place(schema: dict[str, Any], path: str, file_path_fields: list[str]) -> None:
    schema_type = schema.get("type")

    if schema_type == "object":
        properties = schema.get("properties")
        if isinstance(properties, Mapping):
            properties_mapping = cast(Mapping[str, Any], properties)
            for prop_name, prop_schema in properties_mapping.items():
                if not isinstance(prop_schema, dict):
                    continue
                prop_schema_dict = cast(dict[str, Any], prop_schema)
                current_path = f"{path}.{prop_name}" if path else prop_name

                if is_file_path_property(prop_schema_dict):
                    _normalize_file_path_schema(prop_schema_dict)
                    file_path_fields.append(current_path)
                else:
                    _adapt_schema_in_place(prop_schema_dict, current_path, file_path_fields)

    elif schema_type == "array":
        items_schema = schema.get("items")
        if not isinstance(items_schema, dict):
            return
        items_schema_dict = cast(dict[str, Any], items_schema)
        array_path = f"{path}[*]" if path else "[*]"

        if is_file_path_property(items_schema_dict):
            _normalize_file_path_schema(items_schema_dict)
            file_path_fields.append(array_path)
        else:
            _adapt_schema_in_place(items_schema_dict, array_path, file_path_fields)


def _normalize_file_path_schema(schema: dict[str, Any]) -> None:
    schema["type"] = "string"
    schema["format"] = FILE_PATH_FORMAT
    description = schema.get("description", "")
    if description:
        if FILE_PATH_DESCRIPTION_SUFFIX not in description:
            schema["description"] = f"{description}\n{FILE_PATH_DESCRIPTION_SUFFIX}"
    else:
        schema["description"] = FILE_PATH_DESCRIPTION_SUFFIX


def _deep_copy_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        mapping = cast(Mapping[str, Any], value)
        return {key: _deep_copy_value(item) for key, item in mapping.items()}
    if isinstance(value, list):
        list_value = cast(list[Any], value)
        return [_deep_copy_value(item) for item in list_value]
    return value


def _convert_path_in_place(
    obj: dict[str, Any],
    path_parts: list[str],
    file_resolver: Callable[[str], File],
    files: list[File],
) -> None:
    if not path_parts:
        return

    current = path_parts[0]
    remaining = path_parts[1:]

    if current.endswith("[*]"):
        key = current[:-3] if current != "[*]" else ""
        target_value = obj.get(key) if key else obj

        if isinstance(target_value, list):
            target_list = cast(list[Any], target_value)
            if remaining:
                for item in target_list:
                    if isinstance(item, dict):
                        item_dict = cast(dict[str, Any], item)
                        _convert_path_in_place(item_dict, remaining, file_resolver, files)
            else:
                resolved_files: list[File] = []
                for item in target_list:
                    if not isinstance(item, str):
                        raise ValueError("File path must be a string")
                    file = file_resolver(item)
                    files.append(file)
                    resolved_files.append(file)
                if key:
                    obj[key] = ArrayFileSegment(value=resolved_files)
        return

    if not remaining:
        if current not in obj:
            return
        value = obj[current]
        if value is None:
            obj[current] = None
            return
        if not isinstance(value, str):
            raise ValueError("File path must be a string")
        file = file_resolver(value)
        files.append(file)
        obj[current] = FileSegment(value=file)
        return

    if current in obj and isinstance(obj[current], dict):
        _convert_path_in_place(obj[current], remaining, file_resolver, files)
