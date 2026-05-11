"""Compatibility helpers for workflows that still reference deprecated `sys.files`.

TODO: Remove this module after all persisted Workflow and Advanced Chat graphs
have been migrated away from the deprecated system file variable.
"""

from __future__ import annotations

import copy
import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

_LEGACY_SYSTEM_NODE_ID = "sys"
_LEGACY_USER_INPUT_NODE_ID = "userinput"
_LEGACY_FILES_VARIABLE = "files"
_COMPAT_VARIABLE_PREFIX = "sys_files"
_COMPAT_VARIABLE_DESCRIPTION = "Compatibility input for deprecated sys.files."
_FILE_LIST_TYPE = "file-list"
_DEFAULT_FILE_NUMBER_LIMITS = 3
_DEFAULT_ALLOWED_FILE_UPLOAD_METHODS = ["local_file", "remote_url"]
_DEFAULT_ALLOWED_FILE_TYPES = ["image", "document", "audio", "video"]
_LEGACY_FILES_TEMPLATE_PATTERN = re.compile(r"\{\{#(?:sys|userinput)\.files#\}\}")


@dataclass(frozen=True)
class LegacySysFilesCompatVariable:
    start_node_id: str
    variable_name: str


@dataclass(frozen=True)
class LegacySysFilesGraphMigrationResult:
    graph: dict[str, Any]
    changed: bool


def migrate_legacy_sys_files_graph(
    graph: Mapping[str, Any],
    *,
    features: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a graph where legacy file-system references point to a Start-node file-list variable."""

    return migrate_legacy_sys_files_graph_with_result(graph, features=features).graph


def migrate_legacy_sys_files_graph_with_result(
    graph: Mapping[str, Any],
    *,
    features: Mapping[str, Any] | None = None,
) -> LegacySysFilesGraphMigrationResult:
    """Return the migrated graph and whether any legacy reference was rewritten."""

    graph_copy = dict(graph)
    nodes = graph_copy.get("nodes")
    if not isinstance(nodes, list):
        return LegacySysFilesGraphMigrationResult(graph=graph_copy, changed=False)

    # Legacy references are stored in node data. Restricting both search and replacement to `nodes`
    # avoids recursively scanning graph-level metadata and edges for every workflow load.
    if not _contains_legacy_sys_files_reference(nodes):
        return LegacySysFilesGraphMigrationResult(graph=graph_copy, changed=False)

    nodes_copy = copy.deepcopy(nodes)
    start_node = _find_start_node(nodes_copy)
    if start_node is None:
        return LegacySysFilesGraphMigrationResult(graph=graph_copy, changed=False)

    start_node_id = start_node.get("id")
    start_node_data = start_node.get("data")
    if not isinstance(start_node_id, str) or not isinstance(start_node_data, dict):
        return LegacySysFilesGraphMigrationResult(graph=graph_copy, changed=False)

    variables = _get_start_variables(start_node_data)
    variable_name = _find_existing_compat_variable_name(variables)
    if variable_name is None:
        variable_name = _next_compat_variable_name(variables)
        variables.append(_build_compat_variable(variable_name, features=features))

    graph_copy["nodes"] = _replace_legacy_sys_files_references(
        nodes_copy,
        start_node_id=start_node_id,
        variable_name=variable_name,
    )
    return LegacySysFilesGraphMigrationResult(graph=graph_copy, changed=True)


def resolve_legacy_sys_files_compat_variable(graph: Mapping[str, Any]) -> LegacySysFilesCompatVariable | None:
    """Resolve the Start-node variable used by the `sys.files` compatibility layer."""

    migrated_graph = migrate_legacy_sys_files_graph(graph)
    nodes = migrated_graph.get("nodes")
    if not isinstance(nodes, list):
        return None

    start_node = _find_start_node(nodes)
    if start_node is None:
        return None

    start_node_id = start_node.get("id")
    start_node_data = start_node.get("data")
    if not isinstance(start_node_id, str) or not isinstance(start_node_data, dict):
        return None

    variable_name = _find_existing_compat_variable_name(_get_start_variables(start_node_data))
    if variable_name is None:
        return None
    return LegacySysFilesCompatVariable(start_node_id=start_node_id, variable_name=variable_name)


def normalize_legacy_sys_files_args(
    *,
    graph: Mapping[str, Any],
    args: Mapping[str, Any],
) -> tuple[dict[str, Any], LegacySysFilesCompatVariable | None]:
    """Map legacy Service/Web API file arguments onto the generated Start-node variable.

    The top-level `files` argument is the existing API surface for system files.
    Some callers send the same payload as `system.files`; both forms are accepted
    here so old integrations keep working after graph references are migrated.
    """

    compat_variable = resolve_legacy_sys_files_compat_variable(graph)
    files, legacy_files_used = _extract_legacy_files(args)
    if compat_variable is None or not legacy_files_used:
        return dict(args), None

    normalized_args = dict(args)
    if "files" not in normalized_args:
        normalized_args["files"] = files

    raw_inputs = normalized_args.get("inputs")
    inputs = dict(raw_inputs) if isinstance(raw_inputs, Mapping) else {}
    inputs.setdefault(compat_variable.variable_name, files)
    normalized_args["inputs"] = inputs
    return normalized_args, compat_variable


def attach_legacy_sys_files_warning(
    response: Mapping[str, Any] | Iterable[Any],
    compat_variable: LegacySysFilesCompatVariable | None,
) -> Mapping[str, Any] | Iterable[Any]:
    if compat_variable is None:
        return response

    warning = build_legacy_sys_files_warning(compat_variable)
    if isinstance(response, Mapping):
        response_with_warning = dict(response)
        existing_warnings = response_with_warning.get("warnings")
        warnings = list(existing_warnings) if isinstance(existing_warnings, list) else []
        warnings.append(warning)
        response_with_warning["warnings"] = warnings
        return response_with_warning

    def _with_warning() -> Iterable[str]:
        try:
            yield f"data: {json.dumps({'event': 'warning', 'warning': warning})}\n\n"
            yield from response
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()

    return _with_warning()


def build_legacy_sys_files_warning(compat_variable: LegacySysFilesCompatVariable) -> str:
    return (
        "sys.files is deprecated. This workflow now reads files from the Start node variable "
        f"`{compat_variable.variable_name}`; update Service API calls to pass files in "
        f"`inputs.{compat_variable.variable_name}` instead of `system.files` or top-level `files`."
    )


def _find_start_node(nodes: list[Any]) -> dict[str, Any] | None:
    for node in nodes:
        if not isinstance(node, dict):
            continue
        data = node.get("data")
        if isinstance(data, dict) and data.get("type") == "start":
            return node
    return None


def _get_start_variables(start_node_data: dict[str, Any]) -> list[dict[str, Any]]:
    variables = start_node_data.get("variables")
    if isinstance(variables, list):
        return variables

    variables = []
    start_node_data["variables"] = variables
    return variables


def _contains_legacy_sys_files_reference(value: Any) -> bool:
    if _is_legacy_sys_files_selector(value):
        return True

    if isinstance(value, str):
        return bool(_LEGACY_FILES_TEMPLATE_PATTERN.search(value))

    if isinstance(value, Mapping):
        return any(_contains_legacy_sys_files_reference(item) for item in value.values())

    if isinstance(value, list):
        return any(_contains_legacy_sys_files_reference(item) for item in value)

    return False


def _replace_legacy_sys_files_references(value: Any, *, start_node_id: str, variable_name: str) -> Any:
    if _is_legacy_sys_files_selector(value):
        return [start_node_id, variable_name]

    if isinstance(value, str):
        return _LEGACY_FILES_TEMPLATE_PATTERN.sub(f"{{{{#{start_node_id}.{variable_name}#}}}}", value)

    if isinstance(value, Mapping):
        return {
            key: _replace_legacy_sys_files_references(
                item,
                start_node_id=start_node_id,
                variable_name=variable_name,
            )
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [
            _replace_legacy_sys_files_references(
                item,
                start_node_id=start_node_id,
                variable_name=variable_name,
            )
            for item in value
        ]

    return value


def _is_legacy_sys_files_selector(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 2
        and value[0] in (_LEGACY_SYSTEM_NODE_ID, _LEGACY_USER_INPUT_NODE_ID)
        and value[1] == _LEGACY_FILES_VARIABLE
    )


def _find_existing_compat_variable_name(variables: list[dict[str, Any]]) -> str | None:
    for variable in variables:
        if (
            variable.get("type") == _FILE_LIST_TYPE
            and variable.get("description") == _COMPAT_VARIABLE_DESCRIPTION
            and isinstance(variable.get("variable"), str)
        ):
            return variable["variable"]
    return None


def _next_compat_variable_name(variables: list[dict[str, Any]]) -> str:
    used_names = {variable.get("variable") for variable in variables if isinstance(variable.get("variable"), str)}
    candidate = _COMPAT_VARIABLE_PREFIX
    suffix = 1
    while candidate in used_names:
        candidate = f"{_COMPAT_VARIABLE_PREFIX}_{suffix}"
        suffix += 1
    return candidate


def _build_compat_variable(variable_name: str, *, features: Mapping[str, Any] | None) -> dict[str, Any]:
    return {
        "variable": variable_name,
        "label": "sys.files",
        "description": _COMPAT_VARIABLE_DESCRIPTION,
        "type": _FILE_LIST_TYPE,
        "required": False,
        "hide": False,
        "default": [],
        **_build_compat_file_upload_settings(features),
    }


def _build_compat_file_upload_settings(features: Mapping[str, Any] | None) -> dict[str, Any]:
    file_upload = features.get("file_upload") if isinstance(features, Mapping) else None
    if not isinstance(file_upload, Mapping) or not file_upload.get("enabled"):
        return {
            "allowed_file_upload_methods": _DEFAULT_ALLOWED_FILE_UPLOAD_METHODS,
            "allowed_file_types": _DEFAULT_ALLOWED_FILE_TYPES,
            "allowed_file_extensions": [],
            "max_length": _DEFAULT_FILE_NUMBER_LIMITS,
        }

    return {
        "allowed_file_upload_methods": file_upload.get(
            "allowed_file_upload_methods",
            _DEFAULT_ALLOWED_FILE_UPLOAD_METHODS,
        ),
        "allowed_file_types": file_upload.get("allowed_file_types", _DEFAULT_ALLOWED_FILE_TYPES),
        "allowed_file_extensions": file_upload.get("allowed_file_extensions", []),
        "max_length": file_upload.get("number_limits", _DEFAULT_FILE_NUMBER_LIMITS),
    }


def _extract_legacy_files(args: Mapping[str, Any]) -> tuple[Any, bool]:
    if "files" in args and args["files"] is not None:
        return args["files"], True

    system = args.get("system")
    if isinstance(system, Mapping) and "files" in system and system["files"] is not None:
        return system["files"], True

    return None, False
