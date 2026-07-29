"""Compatibility helpers for workflows that still reference deprecated `sys.files`.

TODO: Remove this module after all persisted Workflow and Advanced Chat graphs
have been migrated from the deprecated system file variable to `userinput.files`.
"""

from __future__ import annotations

import json
from collections.abc import Generator, Iterable, Mapping
from dataclasses import dataclass
from typing import Any

_LEGACY_SYSTEM_NODE_ID = "sys"
_USER_INPUT_NODE_ID = "userinput"
_LEGACY_FILES_VARIABLE = "files"
_USER_INPUT_FILE_SELECTOR = [_USER_INPUT_NODE_ID, _LEGACY_FILES_VARIABLE]
_USER_INPUT_FILE_INPUT_KEY = ".".join(_USER_INPUT_FILE_SELECTOR)
_LEGACY_FILES_TEMPLATE = "{{#sys.files#}}"
_USER_INPUT_FILES_TEMPLATE = "{{#userinput.files#}}"


@dataclass(frozen=True)
class LegacySysFilesCompatVariable:
    node_id: str
    variable_name: str


@dataclass(frozen=True)
class LegacySysFilesGraphMigrationResult:
    graph: dict[str, Any]
    changed: bool


def migrate_legacy_sys_files_graph_with_result(
    graph: Mapping[str, Any],
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

    graph_copy["nodes"] = _replace_legacy_sys_files_references(nodes)
    return LegacySysFilesGraphMigrationResult(graph=graph_copy, changed=True)


def resolve_legacy_sys_files_compat_variable(graph: Mapping[str, Any]) -> LegacySysFilesCompatVariable | None:
    """Resolve the target variable used by the `sys.files` compatibility layer."""

    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return None
    if not _contains_file_input_reference(nodes):
        return None
    return LegacySysFilesCompatVariable(node_id=_USER_INPUT_NODE_ID, variable_name=_LEGACY_FILES_VARIABLE)


def normalize_legacy_sys_files_args(
    *,
    graph: Mapping[str, Any],
    args: Mapping[str, Any],
) -> tuple[dict[str, Any], LegacySysFilesCompatVariable | None]:
    """Map Service/Web API file arguments onto the `userinput.files` system alias.

    The top-level `files` argument and hidden `system.files` payload both feed
    the same runtime file collection. After graph references are migrated, the
    file collection is exposed in the variable pool as `userinput.files`.
    """

    normalized_args = dict(args)
    files_from_input, input_files_used = _extract_userinput_files(args)
    if input_files_used:
        normalized_args["files"] = files_from_input
        return normalized_args, None

    compat_variable = resolve_legacy_sys_files_compat_variable(graph)
    if compat_variable is None:
        return normalized_args, None

    files, legacy_files_used = _extract_legacy_files(args)
    if not legacy_files_used:
        return normalized_args, None

    if normalized_args.get("files") is None:
        normalized_args["files"] = files

    raw_inputs = normalized_args.get("inputs")
    inputs = dict(raw_inputs) if isinstance(raw_inputs, Mapping) else {}
    inputs.setdefault(_USER_INPUT_FILE_INPUT_KEY, files)
    normalized_args["inputs"] = inputs
    return normalized_args, compat_variable


def attach_legacy_sys_files_warning(
    response: Mapping[str, Any] | Iterable[Any],
    compat_variable: LegacySysFilesCompatVariable,
) -> Mapping[str, Any] | Generator[str, None, None]:
    warning = build_legacy_sys_files_warning(compat_variable)
    if isinstance(response, Mapping):
        response_with_warning = dict(response)
        existing_warnings = response_with_warning.get("warnings")
        warnings = list(existing_warnings) if isinstance(existing_warnings, list) else []
        warnings.append(warning)
        response_with_warning["warnings"] = warnings
        return response_with_warning

    def _with_warning() -> Generator[str, None, None]:
        try:
            yield f"data: {json.dumps({'event': 'warning', 'warning': warning})}\n\n"
            yield from response
        finally:
            if hasattr(response, "close"):
                response.close()

    return _with_warning()


def build_legacy_sys_files_warning(compat_variable: LegacySysFilesCompatVariable) -> str:
    variable_selector = ".".join((compat_variable.node_id, compat_variable.variable_name))
    return (
        "sys.files is deprecated. This workflow now reads files from "
        f"`{variable_selector}`; update Service API calls to pass files in "
        f"`inputs.{variable_selector}` instead of `system.files` or top-level `files`."
    )


def _contains_legacy_sys_files_reference(value: Any) -> bool:
    if _is_legacy_sys_files_selector(value):
        return True

    if isinstance(value, str):
        return _LEGACY_FILES_TEMPLATE in value

    if isinstance(value, Mapping):
        return any(_contains_legacy_sys_files_reference(item) for item in value.values())

    if isinstance(value, list):
        return any(_contains_legacy_sys_files_reference(item) for item in value)

    return False


def _contains_file_input_reference(value: Any) -> bool:
    if _is_legacy_sys_files_selector(value) or _is_userinput_files_selector(value):
        return True

    if isinstance(value, str):
        return _LEGACY_FILES_TEMPLATE in value or _USER_INPUT_FILES_TEMPLATE in value

    if isinstance(value, Mapping):
        return any(_contains_file_input_reference(item) for item in value.values())

    if isinstance(value, list):
        return any(_contains_file_input_reference(item) for item in value)

    return False


def _replace_legacy_sys_files_references(value: Any) -> Any:
    if _is_legacy_sys_files_selector(value):
        return list(_USER_INPUT_FILE_SELECTOR)

    if isinstance(value, str):
        return value.replace(_LEGACY_FILES_TEMPLATE, _USER_INPUT_FILES_TEMPLATE)

    if isinstance(value, Mapping):
        return {key: _replace_legacy_sys_files_references(item) for key, item in value.items()}

    if isinstance(value, list):
        return [_replace_legacy_sys_files_references(item) for item in value]

    return value


def _is_legacy_sys_files_selector(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 2
        and value[0] == _LEGACY_SYSTEM_NODE_ID
        and value[1] == _LEGACY_FILES_VARIABLE
    )


def _is_userinput_files_selector(value: Any) -> bool:
    return isinstance(value, list) and value == _USER_INPUT_FILE_SELECTOR


def serialized_graph_may_contain_legacy_sys_files(serialized_graph: str) -> bool:
    """Cheaply reject stored graphs that cannot contain a legacy file reference."""

    return _LEGACY_FILES_TEMPLATE in serialized_graph or ('"sys"' in serialized_graph and '"files"' in serialized_graph)


def _extract_legacy_files(args: Mapping[str, Any]) -> tuple[Any, bool]:
    if "files" in args and args["files"] is not None:
        return args["files"], True

    system = args.get("system")
    if isinstance(system, Mapping) and "files" in system and system["files"] is not None:
        return system["files"], True

    return None, False


def _extract_userinput_files(args: Mapping[str, Any]) -> tuple[Any, bool]:
    inputs = args.get("inputs")
    if isinstance(inputs, Mapping) and inputs.get(_USER_INPUT_FILE_INPUT_KEY) is not None:
        return inputs[_USER_INPUT_FILE_INPUT_KEY], True

    return None, False
