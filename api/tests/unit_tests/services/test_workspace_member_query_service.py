from collections.abc import Mapping, Sequence
from datetime import datetime

import pytest

from machinery.context import RequestContext
from services.workspace_member_query_service import (
    WorkspaceInvitationRecord,
    WorkspaceMemberQueryService,
    WorkspaceMemberRecord,
    WorkspaceMemberRole,
    WorkspaceMemberRoleSubject,
    WorkspaceMemberSummary,
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
    def __init__(
        self,
        records: Sequence[WorkspaceMemberRecord],
        invited_accounts: Sequence[WorkspaceMemberRecord] = (),
    ) -> None:
        self.records = tuple(records)
        self.invited_accounts = tuple(invited_accounts)
        self.workspace_ids: list[str] = []
        self.invitations: list[tuple[WorkspaceInvitationRecord, ...]] = []

    def list_for_workspace(self, workspace_id: str) -> Sequence[WorkspaceMemberRecord]:
        self.workspace_ids.append(workspace_id)
        return self.records

    def list_invited_accounts(
        self, invitations: Sequence[WorkspaceInvitationRecord]
    ) -> Sequence[WorkspaceMemberRecord]:
        self.invitations.append(tuple(invitations))
        return self.invited_accounts


class RecordingInvitationQuery:
    def __init__(self, invitations: Sequence[WorkspaceInvitationRecord] = ()) -> None:
        self.invitations = tuple(invitations)
        self.workspace_ids: list[str] = []
        self.invalidated: list[tuple[str, str]] = []

    def list_for_workspace(self, workspace_id: str) -> Sequence[WorkspaceInvitationRecord]:
        self.workspace_ids.append(workspace_id)
        return self.invitations

    def invalidate_member_invitation(self, workspace_id: str, account_id: str) -> None:
        self.invalidated.append((workspace_id, account_id))


class RecordingRoleResolver:
    def __init__(self, roles: Mapping[str, Sequence[WorkspaceMemberRole]]) -> None:
        self.roles = roles
        self.calls: list[tuple[str, str, tuple[WorkspaceMemberRoleSubject, ...]]] = []

    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        subjects: Sequence[WorkspaceMemberRoleSubject],
    ) -> Mapping[str, Sequence[WorkspaceMemberRole]]:
        self.calls.append((workspace_id, actor_account_id, tuple(subjects)))
        return self.roles


class FailingRoleResolver:
    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        subjects: Sequence[WorkspaceMemberRoleSubject],
    ) -> Mapping[str, Sequence[WorkspaceMemberRole]]:
        del workspace_id, actor_account_id, subjects
        raise RoleResolutionError


class RoleResolutionError(Exception):
    pass


def test_list_current_projects_members_and_merges_roles_by_account_id() -> None:
    active = make_member("active", legacy_role="owner")
    pending = make_member("pending", status="pending", legacy_role="admin")
    members = RecordingMemberQuery([active], [pending])
    invitations = RecordingInvitationQuery(
        [
            WorkspaceInvitationRecord(account_id="active", email="active@example.com", legacy_role="normal"),
            WorkspaceInvitationRecord(account_id="pending", email="pending@example.com", legacy_role="admin"),
            WorkspaceInvitationRecord(account_id="missing", email="missing@example.com", legacy_role="normal"),
        ]
    )
    roles = RecordingRoleResolver(
        {
            active.id: [
                WorkspaceMemberRole(id="workspace.owner", name="Owner"),
                WorkspaceMemberRole(id="workspace.editor", name="Editor"),
            ]
        }
    )
    service = WorkspaceMemberQueryService(members=members, invitations=invitations, roles=roles)

    result = service.list_current(make_context())

    by_id = {member.id: member for member in result}
    assert set(by_id) == {"active", "pending"}
    assert by_id["active"] == WorkspaceMemberSummary(
        id=active.id,
        name=active.name,
        email=active.email,
        avatar=active.avatar,
        last_login_at=active.last_login_at,
        last_active_at=active.last_active_at,
        created_at=active.created_at,
        role=active.legacy_role,
        roles=(
            WorkspaceMemberRole(id="workspace.owner", name="Owner"),
            WorkspaceMemberRole(id="workspace.editor", name="Editor"),
        ),
        status=active.status,
    )
    assert by_id["pending"].status == "pending"
    assert by_id["pending"].roles == ()
    assert members.workspace_ids == ["workspace-1"]
    assert roles.calls == [
        (
            "workspace-1",
            "actor-1",
            (WorkspaceMemberRoleSubject(account_id=active.id, legacy_role=active.legacy_role),),
        )
    ]
    assert members.invitations == [
        (
            WorkspaceInvitationRecord(account_id="pending", email="pending@example.com", legacy_role="admin"),
            WorkspaceInvitationRecord(account_id="missing", email="missing@example.com", legacy_role="normal"),
        )
    ]
    assert invitations.workspace_ids == ["workspace-1"]
    assert invitations.invalidated == [
        ("workspace-1", "active"),
        ("workspace-1", "missing"),
    ]


def test_list_current_rejects_missing_workspace_before_calling_ports() -> None:
    members = RecordingMemberQuery([])
    roles = RecordingRoleResolver({})
    invitations = RecordingInvitationQuery()
    service = WorkspaceMemberQueryService(members=members, invitations=invitations, roles=roles)

    with pytest.raises(RuntimeError, match="Console account admission did not resolve an active workspace"):
        service.list_current(make_context(workspace_id=None))

    assert members.workspace_ids == []
    assert invitations.workspace_ids == []
    assert roles.calls == []


def test_list_current_propagates_role_resolution_failure() -> None:
    members = RecordingMemberQuery([make_member("member-1")])
    service = WorkspaceMemberQueryService(
        members=members,
        invitations=RecordingInvitationQuery(),
        roles=FailingRoleResolver(),
    )

    with pytest.raises(RoleResolutionError):
        service.list_current(make_context())
