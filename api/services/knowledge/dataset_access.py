"""Dataset access use case, read model, errors, and consumer-owned ports."""

from typing import NamedTuple, Protocol

from machinery.context import RequestContext

_OWNER_ROLE = "owner"
_ONLY_ME = "only_me"
_ALL_TEAM_MEMBERS = "all_team_members"
_PARTIAL_MEMBERS = "partial_members"


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
    def __init__(self) -> None:
        super().__init__("You do not have permission to access this dataset")


def can_access_dataset(snapshot: DatasetAccessSnapshot, *, actor_id: str, workspace_role: str | None) -> bool:
    """Evaluate legacy dataset visibility without database or framework access."""

    dataset = snapshot.dataset
    if workspace_role == _OWNER_ROLE or dataset.maintainer_id == actor_id:
        return True
    if dataset.permission == _ALL_TEAM_MEMBERS:
        return True
    if dataset.permission == _PARTIAL_MEMBERS:
        return snapshot.actor_has_partial_access
    if dataset.permission == _ONLY_ME:
        return False
    return False


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
        if not self._legacy_permissions_enabled:
            return AccessibleDataset(id=snapshot.dataset.id, workspace_id=snapshot.dataset.workspace_id)

        workspace_role = self._workspace_roles.get_legacy_role(
            workspace_id=context.active_workspace_id,
            account_id=context.account_id,
        )
        if can_access_dataset(snapshot, actor_id=context.account_id, workspace_role=workspace_role):
            return AccessibleDataset(id=snapshot.dataset.id, workspace_id=snapshot.dataset.workspace_id)
        raise DatasetAccessDeniedError()


class DatasetAccess(Protocol):
    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset: ...

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset: ...
