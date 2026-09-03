from dataclasses import dataclass

import pytest

from machinery.context import RequestContext
from services.entities.knowledge_entities.records import DatasetAccessSnapshot, DatasetRecord
from services.knowledge.application import (
    DatasetAccessDeniedError,
    DatasetAccessService,
    DatasetNotFoundError,
)


def _context(*, actor_id: str = "actor-1", workspace_id: str = "workspace-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id=actor_id,
        active_workspace_id=workspace_id,
    )


def _snapshot(
    *,
    permission: str,
    maintainer_id: str = "maintainer-1",
    partial_access: bool = False,
) -> DatasetAccessSnapshot:
    return DatasetAccessSnapshot(
        dataset=DatasetRecord(
            id="dataset-1",
            workspace_id="workspace-1",
            maintainer_id=maintainer_id,
            permission=permission,
            data_source_type="notion_import",
            indexing_technique="economy",
            embedding_model=None,
            embedding_model_provider=None,
        ),
        actor_has_partial_access=partial_access,
    )


@dataclass
class DatasetReaderStub:
    snapshot: DatasetAccessSnapshot | None

    def get_access_snapshot(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        actor_id: str,
    ) -> DatasetAccessSnapshot | None:
        assert workspace_id == "workspace-1"
        assert dataset_id == "dataset-1"
        assert actor_id == "actor-1"
        return self.snapshot


@dataclass
class WorkspaceRoleReaderStub:
    role: str | None
    calls: int = 0

    def get_legacy_role(self, *, workspace_id: str, account_id: str) -> str | None:
        assert workspace_id == "workspace-1"
        assert account_id == "actor-1"
        self.calls += 1
        return self.role


@pytest.mark.parametrize(
    ("permission", "role", "maintainer_id", "partial_access"),
    [
        ("only_me", "owner", "maintainer-1", False),
        ("only_me", "normal", "actor-1", False),
        ("all_team_members", "normal", "maintainer-1", False),
        ("partial_members", "normal", "maintainer-1", True),
    ],
)
def test_require_accessible_allows_each_legacy_access_path(
    permission: str,
    role: str,
    maintainer_id: str,
    partial_access: bool,
) -> None:
    roles = WorkspaceRoleReaderStub(role)
    service = DatasetAccessService(
        datasets=DatasetReaderStub(
            _snapshot(
                permission=permission,
                maintainer_id=maintainer_id,
                partial_access=partial_access,
            )
        ),
        workspace_roles=roles,
        legacy_permissions_enabled=True,
    )

    result = service.require_accessible(_context(), "dataset-1")

    assert result.id == "dataset-1"
    assert roles.calls == 1


@pytest.mark.parametrize(
    ("permission", "partial_access"),
    [
        ("only_me", False),
        ("partial_members", False),
        ("unknown", True),
    ],
)
def test_require_accessible_denies_unrecognized_or_ungranted_legacy_access(
    permission: str,
    partial_access: bool,
) -> None:
    service = DatasetAccessService(
        datasets=DatasetReaderStub(_snapshot(permission=permission, partial_access=partial_access)),
        workspace_roles=WorkspaceRoleReaderStub("normal"),
        legacy_permissions_enabled=True,
    )

    with pytest.raises(DatasetAccessDeniedError):
        service.require_accessible(_context(), "dataset-1")


def test_require_accessible_only_enforces_owner_chain_when_legacy_permissions_are_disabled() -> None:
    roles = WorkspaceRoleReaderStub("normal")
    service = DatasetAccessService(
        datasets=DatasetReaderStub(_snapshot(permission="only_me")),
        workspace_roles=roles,
        legacy_permissions_enabled=False,
    )

    assert service.require_accessible(_context(), "dataset-1").id == "dataset-1"
    assert roles.calls == 0


def test_require_accessible_hides_missing_or_cross_workspace_dataset() -> None:
    service = DatasetAccessService(
        datasets=DatasetReaderStub(None),
        workspace_roles=WorkspaceRoleReaderStub("owner"),
        legacy_permissions_enabled=True,
    )

    with pytest.raises(DatasetNotFoundError):
        service.require_accessible(_context(), "dataset-1")
