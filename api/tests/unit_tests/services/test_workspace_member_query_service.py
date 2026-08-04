from collections.abc import Mapping, Sequence
from datetime import datetime

import pytest
from machinery.context import RequestContext
from services.workspace_member_query_service import (
    CurrentWorkspaceRequiredError,
    WorkspaceMemberQueryService,
    WorkspaceMemberRecord,
    WorkspaceMemberRole,
)


def make_context(*, workspace_id: str | None = "workspace-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="actor-1",
        active_workspace_id=workspace_id,
    )


def make_member(
    member_id: str,
    *,
    status: str = "active",
    legacy_role: str = "normal",
) -> WorkspaceMemberRecord:
    created_at = datetime(2026, 1, 1)
    return WorkspaceMemberRecord(
        id=member_id,
        name=f"Member {member_id}",
        email=f"{member_id}@example.com",
        avatar=None,
        last_login_at=None,
        last_active_at=created_at,
        created_at=created_at,
        status=status,
        legacy_role=legacy_role,
    )


class RecordingMemberQuery:
    def __init__(self, records: Sequence[WorkspaceMemberRecord]) -> None:
        self.records = tuple(records)
        self.workspace_ids: list[str] = []

    def list_for_workspace(self, workspace_id: str) -> Sequence[WorkspaceMemberRecord]:
        self.workspace_ids.append(workspace_id)
        return self.records


class RecordingRoleGateway:
    def __init__(self, roles: Mapping[str, Sequence[WorkspaceMemberRole]]) -> None:
        self.roles = roles
        self.calls: list[tuple[str, str, tuple[WorkspaceMemberRecord, ...]]] = []

    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        members: Sequence[WorkspaceMemberRecord],
    ) -> Mapping[str, Sequence[WorkspaceMemberRole]]:
        self.calls.append((workspace_id, actor_account_id, tuple(members)))
        return self.roles


class FailingRoleGateway:
    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        members: Sequence[WorkspaceMemberRecord],
    ) -> Mapping[str, Sequence[WorkspaceMemberRole]]:
        del workspace_id, actor_account_id, members
        raise RoleResolutionError


class RoleResolutionError(Exception):
    pass


def test_list_current_projects_members_and_merges_roles_by_account_id() -> None:
    active = make_member("active", legacy_role="owner")
    pending = make_member("pending", status="pending")
    members = RecordingMemberQuery([active, pending])
    roles = RecordingRoleGateway(
        {
            active.id: [
                WorkspaceMemberRole(id="workspace.owner", name="Owner"),
                WorkspaceMemberRole(id="workspace.editor", name="Editor"),
            ]
        }
    )
    service = WorkspaceMemberQueryService(members=members, roles=roles)

    result = service.list_current(make_context())

    by_id = {member.id: member for member in result}
    assert set(by_id) == {"active", "pending"}
    assert by_id["active"].role == "owner"
    assert by_id["active"].roles == (
        WorkspaceMemberRole(id="workspace.owner", name="Owner"),
        WorkspaceMemberRole(id="workspace.editor", name="Editor"),
    )
    assert by_id["pending"].status == "pending"
    assert by_id["pending"].roles == ()
    assert members.workspace_ids == ["workspace-1"]
    assert roles.calls == [("workspace-1", "actor-1", (active, pending))]


def test_list_current_rejects_missing_workspace_before_calling_ports() -> None:
    members = RecordingMemberQuery([])
    roles = RecordingRoleGateway({})
    service = WorkspaceMemberQueryService(members=members, roles=roles)

    with pytest.raises(CurrentWorkspaceRequiredError, match="No current tenant"):
        service.list_current(make_context(workspace_id=None))

    assert members.workspace_ids == []
    assert roles.calls == []


def test_list_current_propagates_role_resolution_failure() -> None:
    members = RecordingMemberQuery([make_member("member-1")])
    service = WorkspaceMemberQueryService(members=members, roles=FailingRoleGateway())

    with pytest.raises(RoleResolutionError):
        service.list_current(make_context())
