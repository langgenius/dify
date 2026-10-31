"""Pure environment-variable patch rules shared by draft mutation paths."""

from collections.abc import Sequence

from graphon.variables import VariableBase


def merge_environment_variable_patch(
    current_variables: Sequence[VariableBase],
    environment_variable_upserts: Sequence[VariableBase],
    deleted_environment_variable_ids: Sequence[str],
) -> list[VariableBase]:
    """Merge a per-ID environment-variable patch while preserving untouched server values."""
    upserts_by_id: dict[str, VariableBase] = {}
    for variable in environment_variable_upserts:
        if not variable.id:
            raise ValueError("Patched environment variables require an id.")
        if variable.id in upserts_by_id:
            raise ValueError(f"Duplicate patched environment variable id: {variable.id}")
        upserts_by_id[variable.id] = variable

    deleted_ids = set(deleted_environment_variable_ids)
    if len(deleted_ids) != len(deleted_environment_variable_ids):
        raise ValueError("Deleted environment variable ids must be unique.")
    if "" in deleted_ids:
        raise ValueError("Deleted environment variable ids must not be empty.")
    if conflicting_ids := deleted_ids.intersection(upserts_by_id):
        conflicting_id = min(conflicting_ids)
        raise ValueError(f"Environment variable cannot be upserted and deleted in the same patch: {conflicting_id}")

    existing_ids: set[str] = set()
    merged_variables: list[VariableBase] = []
    for variable in current_variables:
        variable_id = variable.id
        if variable_id:
            existing_ids.add(variable_id)
        if variable_id in deleted_ids:
            continue
        merged_variables.append(upserts_by_id.get(variable_id, variable))

    merged_variables.extend(
        variable for variable_id, variable in upserts_by_id.items() if variable_id not in existing_ids
    )
    names = [variable.name for variable in merged_variables]
    if len(set(names)) != len(names):
        raise ValueError("Environment variable names must be unique.")
    return merged_variables
