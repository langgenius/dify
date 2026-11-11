"""Dataset access use cases, policy functions, and consumer-owned ports."""

from collections.abc import Sequence
from typing import NamedTuple, Protocol

from machinery.context import RequestContext

_OWNER_ROLE = "owner"
_ALL_TEAM_MEMBERS = "all_team_members"
_PARTIAL_MEMBERS = "partial_members"
_DATASET_OPERATOR_ROLE = "dataset_operator"
_DATASET_EDIT_ROLES = frozenset({_OWNER_ROLE, "admin", "editor", _DATASET_OPERATOR_ROLE})


class DatasetAccessRecord(NamedTuple):
    """Dataset state consumed only by the access policy."""

    id: str
    workspace_id: str
    maintainer_id: str | None
    permission: str


class AccessibleDataset(NamedTuple):
    """Minimal result proving that the request may operate on a dataset."""

    id: str
    workspace_id: str


class DatasetAccessSnapshot(NamedTuple):
    """Dataset state plus the requesting account's partial-member grant."""

    dataset: DatasetAccessRecord
    actor_has_partial_access: bool


class DatasetAccessReader(Protocol):
    """Load tenant-scoped dataset state needed by the access policy."""

    def get_access_snapshot(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        actor_id: str,
    ) -> DatasetAccessSnapshot | None: ...


class WorkspaceRoleReader(Protocol):
    """Read the account's legacy role in a workspace."""

    def get_legacy_role(self, *, workspace_id: str, account_id: str) -> str | None: ...


class DatasetAccessError(Exception):
    """Base class for framework-neutral dataset access failures."""


class DatasetNotFoundError(DatasetAccessError):
    def __init__(self) -> None:
        super().__init__("Dataset not found")


class DatasetAccessDeniedError(DatasetAccessError):
    def __init__(self, message: str = "You do not have permission to access this dataset") -> None:
        super().__init__(message)


class DatasetPermissionValidationError(ValueError):
    """A requested legacy permission change violates its input contract."""


def can_access_dataset(snapshot: DatasetAccessSnapshot, *, actor_id: str, workspace_role: str | None) -> bool:
    """Evaluate legacy dataset visibility without database or framework access."""

    if workspace_role is None:
        return False
    dataset = snapshot.dataset
    if workspace_role == _OWNER_ROLE or dataset.maintainer_id == actor_id:
        return True
    if dataset.permission == _ALL_TEAM_MEMBERS:
        return True
    if dataset.permission == _PARTIAL_MEMBERS:
        return snapshot.actor_has_partial_access
    return False


def validate_permission_change(
    *,
    actor_role: str | None,
    current_permission: str,
    current_member_ids: Sequence[str],
    requested_permission: str | None,
    requested_member_ids: Sequence[str] | None,
) -> None:
    """Authorize a legacy dataset permission update without persistence access."""

    if actor_role not in _DATASET_EDIT_ROLES:
        raise DatasetAccessDeniedError("User does not have permission to edit this dataset.")
    if actor_role != _DATASET_OPERATOR_ROLE:
        return
    if current_permission != requested_permission:
        raise DatasetAccessDeniedError("Dataset operators cannot change the dataset permissions.")
    if requested_permission != _PARTIAL_MEMBERS:
        return
    if not requested_member_ids:
        raise DatasetPermissionValidationError("Partial member list is required when setting to partial members.")
    if set(current_member_ids) != set(requested_member_ids):
        raise DatasetPermissionValidationError("Dataset operators cannot change the dataset permissions.")


class DatasetAccessService:
    """Resolve an owned dataset and enforce legacy permissions when configured."""

    def __init__(
        self,
        *,
        datasets: DatasetAccessReader,
        workspace_roles: WorkspaceRoleReader,
        legacy_permissions_enabled: bool,
    ) -> None:
        self._datasets = datasets
        self._workspace_roles = workspace_roles
        self._legacy_permissions_enabled = legacy_permissions_enabled

    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        snapshot = self._datasets.get_access_snapshot(
            workspace_id=context.active_workspace_id,
            dataset_id=dataset_id,
            actor_id=context.account_id,
        )
        if snapshot is None:
            raise DatasetNotFoundError()
        return self.check_access(context, snapshot)

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset:
        """Authorize already-loaded state without querying the dataset again."""
        if snapshot.dataset.workspace_id != context.active_workspace_id:
            raise DatasetAccessDeniedError()
        if context.resource_dataset_ids is not None and snapshot.dataset.id not in context.resource_dataset_ids:
            raise DatasetAccessDeniedError()
        if self._legacy_permissions_enabled:
            workspace_role = self._workspace_roles.get_legacy_role(
                workspace_id=context.active_workspace_id,
                account_id=context.account_id,
            )
            if not can_access_dataset(snapshot, actor_id=context.account_id, workspace_role=workspace_role):
                raise DatasetAccessDeniedError()
        return AccessibleDataset(id=snapshot.dataset.id, workspace_id=snapshot.dataset.workspace_id)


class DatasetAccess(Protocol):
    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset: ...

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset: ...
