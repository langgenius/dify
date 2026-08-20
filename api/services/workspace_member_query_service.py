"""Application service for listing members of the active Console workspace."""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import NamedTuple, Protocol

from machinery.context import RequestContext


class WorkspaceMemberRole(NamedTuple):
    id: str
    name: str


class WorkspaceMemberRecord(NamedTuple):
    id: str
    name: str
    email: str
    avatar: str | None
    last_login_at: datetime | None
    last_active_at: datetime
    created_at: datetime
    status: str
    legacy_role: str


class WorkspaceInvitationRecord(NamedTuple):
    account_id: str
    email: str
    legacy_role: str


class WorkspaceInvitationQuery(Protocol):
    def list_for_workspace(self, workspace_id: str) -> Sequence[WorkspaceInvitationRecord]: ...

    def invalidate_member_invitation(self, workspace_id: str, account_id: str) -> None: ...


class WorkspaceMemberQuery(Protocol):
    def list_for_workspace(self, workspace_id: str) -> Sequence[WorkspaceMemberRecord]: ...

    def list_invited_accounts(
        self, invitations: Sequence[WorkspaceInvitationRecord]
    ) -> Sequence[WorkspaceMemberRecord]: ...


class WorkspaceMemberRoleSubject(NamedTuple):
    account_id: str
    legacy_role: str


class WorkspaceMemberRoleResolver(Protocol):
    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        subjects: Sequence[WorkspaceMemberRoleSubject],
    ) -> Mapping[str, Sequence[WorkspaceMemberRole]]: ...


class WorkspaceMemberSummary(NamedTuple):
    id: str
    name: str
    email: str
    avatar: str | None
    last_login_at: datetime | None
    last_active_at: datetime
    created_at: datetime
    role: str
    roles: tuple[WorkspaceMemberRole, ...]
    status: str


class WorkspaceMemberQueryService:
    def __init__(
        self,
        *,
        members: WorkspaceMemberQuery,
        invitations: WorkspaceInvitationQuery,
        roles: WorkspaceMemberRoleResolver,
    ) -> None:
        self._members = members
        self._invitations = invitations
        self._roles = roles

    def list_for_workspace(
        self,
        workspace_id: str,
        actor_account_id: str,
    ) -> tuple[WorkspaceMemberSummary, ...]:
        members = tuple(self._members.list_for_workspace(workspace_id))
        member_ids = {member.id for member in members}
        invitations = []
        for invitation in self._invitations.list_for_workspace(workspace_id):
            if invitation.account_id in member_ids:
                self._invitations.invalidate_member_invitation(workspace_id, invitation.account_id)
            else:
                invitations.append(invitation)
        invited_accounts = tuple(self._members.list_invited_accounts(invitations))
        invited_account_ids = {account.id for account in invited_accounts}
        for invitation in invitations:
            if invitation.account_id not in invited_account_ids:
                self._invitations.invalidate_member_invitation(workspace_id, invitation.account_id)
        role_subjects = tuple(
            WorkspaceMemberRoleSubject(account_id=member.id, legacy_role=member.legacy_role) for member in members
        )

        # The repository closes its read Session before role resolution
        # performs enterprise I/O.
        roles_by_member = self._roles.resolve_many(workspace_id, actor_account_id, role_subjects)

        return tuple(
            WorkspaceMemberSummary(
                id=record.id,
                name=record.name,
                email=record.email,
                avatar=record.avatar,
                last_login_at=record.last_login_at,
                last_active_at=record.last_active_at,
                created_at=record.created_at,
                role=record.legacy_role,
                roles=tuple(roles_by_member.get(record.id, ())),
                status=record.status,
            )
            for record in (*members, *invited_accounts)
        )

    def list_current(self, context: RequestContext) -> tuple[WorkspaceMemberSummary, ...]:
        workspace_id = context.active_workspace_id
        if workspace_id is None:
            raise RuntimeError("Console account admission did not resolve an active workspace")

        return self.list_for_workspace(workspace_id, context.account_id)
