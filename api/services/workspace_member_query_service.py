"""Application service for listing members of the active Console workspace."""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import NamedTuple, Protocol

from machinery.context import RequestContext


class CurrentWorkspaceRequiredError(ValueError):
    """Raised when a current-workspace use case has no active workspace."""


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


class WorkspaceMemberQuery(Protocol):
    def list_for_workspace(self, workspace_id: str) -> Sequence[WorkspaceMemberRecord]: ...


class WorkspaceMemberRoleGateway(Protocol):
    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        members: Sequence[WorkspaceMemberRecord],
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
        roles: WorkspaceMemberRoleGateway,
    ) -> None:
        self._members = members
        self._roles = roles

    def list_current(self, context: RequestContext) -> tuple[WorkspaceMemberSummary, ...]:
        workspace_id = context.active_workspace_id
        if workspace_id is None:
            raise CurrentWorkspaceRequiredError("No current tenant")

        records = tuple(self._members.list_for_workspace(workspace_id))

        # The repository closes its read Session before role resolution
        # performs enterprise I/O.
        roles_by_member = self._roles.resolve_many(workspace_id, context.account_id, records)

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
            for record in records
        )
