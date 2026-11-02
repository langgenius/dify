"""Prepare encrypted draft values before entering the write transaction."""

from collections.abc import Sequence

from graphon.variables import VariableBase
from models.workflow import Workflow
from services.workflow.contracts import PreparedEnvironmentVariables, WorkflowSnapshot
from services.workflow.variable_policy import merge_environment_variable_patch


def environment_patch_is_mergeable(source: WorkflowSnapshot, current: WorkflowSnapshot, touched_ids: set[str]) -> bool:
    """Compare touched values outside transactions, including decrypted secrets."""
    if source.id != current.id:
        return False
    original = Workflow(tenant_id=source.tenant_id, _environment_variables=source.environment_variables or "{}")
    latest = Workflow(tenant_id=current.tenant_id, _environment_variables=current.environment_variables or "{}")
    before = {variable.id: variable for variable in original.environment_variables if variable.id in touched_ids}
    after = {variable.id: variable for variable in latest.environment_variables if variable.id in touched_ids}
    return before == after


def prepare_environment_variables(
    *,
    tenant_id: str,
    source: WorkflowSnapshot | None,
    variables: Sequence[VariableBase],
    deleted_ids: Sequence[str] | None = None,
) -> PreparedEnvironmentVariables:
    """Reuse the model's mask and encryption codec on an unattached value holder.

    The caller must finish its snapshot read before this operation. A deletion
    list selects a per-ID patch; None means replacement of the collection.
    """
    stored = source.environment_variables if source is not None else None
    workflow = Workflow(tenant_id=tenant_id, _environment_variables=stored or "{}")
    if deleted_ids is not None:
        variables = merge_environment_variable_patch(workflow.environment_variables, variables, deleted_ids)
    workflow.environment_variables = variables
    return PreparedEnvironmentVariables(
        source.id if source is not None else None, stored, workflow._environment_variables
    )
