from datetime import datetime
from unittest.mock import Mock

from services.workspace_member_query_service import (
    WorkspaceMemberRole,
    WorkspaceMemberRoleSubject,
)
from services.workspace_query_service import WorkspaceQueryService, WorkspaceRecord


def test_list_for_account_with_roles_preserves_all_authoritative_roles() -> None:
    account_id = "account-1"
    records = [
        WorkspaceRecord(
            id="workspace-1",
            name="Workspace",
            status="normal",
            created_at=datetime(2026, 1, 1),
            last_opened_at=None,
            legacy_role="normal",
            current=True,
        )
    ]
    expected_roles = (
        WorkspaceMemberRole(id="workspace.admin", name="Admin"),
        WorkspaceMemberRole(id="workspace.reviewer", name="Reviewer"),
    )
    workspaces = Mock()
    workspaces.list_for_account.return_value = records
    roles = Mock()
    roles.resolve_many.return_value = {account_id: expected_roles}
    service = WorkspaceQueryService(workspaces=workspaces, plans=Mock(), roles=roles)

    result = service.list_for_account_with_roles(account_id)

    assert result[0].roles == expected_roles
    assert result[0].current is True
    roles.resolve_many.assert_called_once_with(
        "workspace-1",
        account_id,
        [WorkspaceMemberRoleSubject(account_id=account_id, legacy_role="normal")],
    )


def test_get_for_account_with_roles_skips_role_lookup_when_membership_is_missing() -> None:
    workspaces = Mock()
    workspaces.list_for_account.return_value = []
    roles = Mock()
    service = WorkspaceQueryService(workspaces=workspaces, plans=Mock(), roles=roles)

    assert service.get_for_account_with_roles("account-1", "missing") is None
    roles.resolve_many.assert_not_called()
