"""Prepare configured file defaults for app execution.

On this branch, upload files are resolved by tenant only (see ``factories.file_factory``), so files the app
author configured as defaults are reachable without an execution-local access grant.
"""

from collections.abc import Mapping, Sequence
from typing import Any

from dify_graph.variables.input_entities import VariableEntity, VariableEntityType


def _normalize_file_default(value: Any) -> Any:
    if isinstance(value, list):
        return [_normalize_file_default(item) for item in value]
    if isinstance(value, dict) and "transferMethod" in value:
        # The editor persists FileEntity values, whereas the file factory accepts API mappings.
        return {
            "type": value.get("supportFileType"),
            "transfer_method": value.get("transferMethod"),
            "url": value.get("url") or "",
            "upload_file_id": value.get("uploadedId") or "",
        }
    return value


def apply_file_input_defaults(
    user_inputs: Mapping[str, Any] | None, variables: Sequence[VariableEntity]
) -> dict[str, Any]:
    """Copy inputs (None means omitted) and fill missing file values from configured defaults."""
    inputs = dict(user_inputs or {})
    # Fill omitted file inputs before required validation; explicit values (including '' and []) win.
    for variable in variables:
        if (
            variable.type in {VariableEntityType.FILE, VariableEntityType.FILE_LIST}
            and inputs.get(variable.variable) is None
            and variable.default
        ):
            inputs[variable.variable] = _normalize_file_default(variable.default)
    return inputs
