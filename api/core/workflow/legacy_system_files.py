"""Compatibility helpers for workflows that still reference deprecated `sys.files`.

TODO: Remove this module after all persisted Workflow and Advanced Chat graphs
have been migrated from the deprecated system file variable to `userinput.files`.
"""

from __future__ import annotations

import copy
import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

_LEGACY_SYSTEM_NODE_ID = "sys"
_USER_INPUT_NODE_ID = "userinput"
_LEGACY_FILES_VARIABLE = "files"
_LEGACY_FILE_SELECTOR = [_LEGACY_SYSTEM_NODE_ID, _LEGACY_FILES_VARIABLE]
_USER_INPUT_FILE_SELECTOR = [_USER_INPUT_NODE_ID, _LEGACY_FILES_VARIABLE]
_USER_INPUT_FILE_INPUT_KEY = ".".join(_USER_INPUT_FILE_SELECTOR)
_LEGACY_FILES_TEMPLATE = "{{#sys.files#}}"
_USER_INPUT_FILES_TEMPLATE = "{{#userinput.files#}}"
_LEGACY_FILES_TEMPLATE_PATTERN = re.compile(r"\{\{#sys\.files#\}\}")
_USER_INPUT_FILES_TEMPLATE_PATTERN = re.compile(r"\{\{#userinput\.files#\}\}")


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
    """Return a graph where legacy file-system references point to `userinput.files`."""

    return migrate_legacy_sys_files_graph_with_result(graph, features=features).graph


def migrate_legacy_sys_files_graph_with_result(
    graph: Mapping[str, Any],
    *,
    features: Mapping[str, Any] | None = None,
) -> LegacySysFilesGraphMigrationResult:
    """Return the migrated graph and whether any legacy reference was rewritten."""

    _ = features
    graph_copy = dict(graph)
    nodes = graph_copy.get("nodes")
    if not isinstance(nodes, list):
        return LegacySysFilesGraphMigrationResult(graph=graph_copy, changed=False)

    # Legacy references are stored in node data. Restricting both search and replacement to `nodes`
    # avoids recursively scanning graph-level metadata and edges for every workflow load.
    if not _may_contain_legacy_sys_files_reference(nodes) or not _contains_legacy_sys_files_reference(nodes):
        return LegacySysFilesGraphMigrationResult(graph=graph_copy, changed=False)

    nodes_copy = copy.deepcopy(nodes)
    graph_copy["nodes"] = _replace_legacy_sys_files_references(nodes_copy)
    return LegacySysFilesGraphMigrationResult(graph=graph_copy, changed=True)


def resolve_legacy_sys_files_compat_variable(graph: Mapping[str, Any]) -> LegacySysFilesCompatVariable | None:
    """Resolve the target variable used by the `sys.files` compatibility layer."""

    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return None
    has_legacy_reference = _may_contain_legacy_sys_files_reference(nodes) and _contains_legacy_sys_files_reference(
        nodes
    )
    has_userinput_reference = _may_contain_userinput_files_reference(nodes) and _contains_userinput_files_reference(
        nodes
    )
    if not (has_legacy_reference or has_userinput_reference):
        return None
    return LegacySysFilesCompatVariable(start_node_id=_USER_INPUT_NODE_ID, variable_name=_LEGACY_FILES_VARIABLE)


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

    compat_variable = resolve_legacy_sys_files_compat_variable(graph)
    if compat_variable is None:
        return dict(args), None

    normalized_args = dict(args)
    files_from_input, input_files_used = _extract_userinput_files(args)
    if input_files_used:
        normalized_args.setdefault("files", files_from_input)
        return normalized_args, None

    files, legacy_files_used = _extract_legacy_files(args)
    if not legacy_files_used:
        return normalized_args, None

    normalized_args.setdefault("files", files)

    raw_inputs = normalized_args.get("inputs")
    inputs = dict(raw_inputs) if isinstance(raw_inputs, Mapping) else {}
    inputs.setdefault(_USER_INPUT_FILE_INPUT_KEY, files)
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
    variable_selector = ".".join((compat_variable.start_node_id, compat_variable.variable_name))
    return (
        "sys.files is deprecated. This workflow now reads files from "
        f"`{variable_selector}`; update Service API calls to pass files in "
        f"`inputs.{variable_selector}` instead of `system.files` or top-level `files`."
    )


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


def _contains_userinput_files_reference(value: Any) -> bool:
    if _is_userinput_files_selector(value):
        return True

    if isinstance(value, str):
        return bool(_USER_INPUT_FILES_TEMPLATE_PATTERN.search(value))

    if isinstance(value, Mapping):
        return any(_contains_userinput_files_reference(item) for item in value.values())

    if isinstance(value, list):
        return any(_contains_userinput_files_reference(item) for item in value)

    return False


def _replace_legacy_sys_files_references(value: Any) -> Any:
    if _is_legacy_sys_files_selector(value):
        return list(_USER_INPUT_FILE_SELECTOR)

    if isinstance(value, str):
        return _LEGACY_FILES_TEMPLATE_PATTERN.sub(_USER_INPUT_FILES_TEMPLATE, value)

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


def _may_contain_legacy_sys_files_reference(value: list[Any]) -> bool:
    serialized_value = _serialize_for_fast_reference_search(value)
    if serialized_value is None:
        return True
    return _LEGACY_FILES_TEMPLATE in serialized_value or '["sys","files"]' in serialized_value


def _may_contain_userinput_files_reference(value: list[Any]) -> bool:
    serialized_value = _serialize_for_fast_reference_search(value)
    if serialized_value is None:
        return True
    return _USER_INPUT_FILES_TEMPLATE in serialized_value or '["userinput","files"]' in serialized_value


def _serialize_for_fast_reference_search(value: list[Any]) -> str | None:
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return None


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
