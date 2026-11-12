"""Prepare configured file defaults and grant execution-local access to them."""

from collections.abc import Mapping, Sequence
from typing import Any

from core.app.file_access import grant_upload_file_access
from factories.file_factory.common import resolve_mapping_file_id
from graphon.file import FileTransferMethod
from graphon.variables.input_entities import VariableEntity, VariableEntityType


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


def grant_file_default_access(variables: Sequence[VariableEntity]) -> None:
    """Grant only files configured by the app author, within the current execution's tenant."""
    file_ids: set[str] = set()
    for variable in variables:
        if variable.type not in {VariableEntityType.FILE, VariableEntityType.FILE_LIST}:
            continue
        default = _normalize_file_default(variable.default)
        mappings = default if isinstance(default, list) else [default]
        for mapping in mappings:
            if not isinstance(mapping, dict) or mapping.get("transfer_method") not in {
                FileTransferMethod.LOCAL_FILE,
                FileTransferMethod.REMOTE_URL,
            }:
                continue
            file_id = resolve_mapping_file_id(mapping, "upload_file_id")
            if file_id:
                file_ids.add(file_id)
    grant_upload_file_access(file_ids)


def apply_file_input_defaults(
    user_inputs: Mapping[str, Any] | None, variables: Sequence[VariableEntity]
) -> dict[str, Any]:
    """Copy inputs (None means omitted), grant defaults, and fill missing file values."""
    inputs = dict(user_inputs or {})
    grant_file_default_access(variables)
    # Fill omitted file inputs before required validation; explicit values win.
    for variable in variables:
        if (
            variable.type in {VariableEntityType.FILE, VariableEntityType.FILE_LIST}
            and inputs.get(variable.variable) is None
            and variable.default
        ):
            inputs[variable.variable] = _normalize_file_default(variable.default)
    return inputs
