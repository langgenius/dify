"""Application service for listing workspaces visible to a Console account."""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import NamedTuple, Protocol

from enums import CloudPlan
from machinery.context import RequestContext
from services.workspace_member_query_service import (
    WorkspaceMemberRole,
    WorkspaceMemberRoleResolver,
    WorkspaceMemberRoleSubject,
)


class WorkspacePlanGateway(Protocol):
    def resolve_many(self, workspace_ids: Sequence[str]) -> Mapping[str, str]: ...


class WorkspaceRecord(NamedTuple):
    id: str
    name: str | None
    status: str
    created_at: datetime
    last_opened_at: datetime | None
    legacy_role: str = "normal"
    current: bool = False


class WorkspaceQuery(Protocol):
    def list_for_account(self, account_id: str) -> Sequence[WorkspaceRecord]: ...


class WorkspaceSummary(NamedTuple):
    id: str
    name: str | None
    plan: str
    status: str
    created_at: datetime
    last_opened_at: datetime | None
    current: bool


class WorkspaceWithRoles(NamedTuple):
    id: str
    name: str | None
    status: str
    created_at: datetime
    current: bool
    roles: tuple[WorkspaceMemberRole, ...]


class WorkspaceQueryService:
    def __init__(
        self,
        *,
        workspaces: WorkspaceQuery,
        plans: WorkspacePlanGateway,
        roles: WorkspaceMemberRoleResolver,
    ) -> None:
        self._workspaces = workspaces
        self._plans = plans
        self._roles = roles

    def list_for_account(self, context: RequestContext) -> tuple[WorkspaceSummary, ...]:
        records = tuple(self._workspaces.list_for_account(context.account_id))

        # The repository closes its read Session before plan resolution
        # performs Billing/Feature I/O.
        plans = self._plans.resolve_many([record.id for record in records])

        return tuple(
            WorkspaceSummary(
                id=record.id,
                name=record.name,
                plan=plans.get(record.id, CloudPlan.SANDBOX),
                status=record.status,
                created_at=record.created_at,
                last_opened_at=record.last_opened_at,
                current=record.id == context.active_workspace_id,
            )
            for record in records
        )

    def list_for_account_with_roles(self, account_id: str) -> tuple[WorkspaceWithRoles, ...]:
        return tuple(self._with_roles(account_id, record) for record in self._workspaces.list_for_account(account_id))

    def get_for_account_with_roles(self, account_id: str, workspace_id: str) -> WorkspaceWithRoles | None:
        record = next(
            (record for record in self._workspaces.list_for_account(account_id) if record.id == workspace_id),
            None,
        )
        if record is None:
            return None
        return self._with_roles(account_id, record)

    def _with_roles(self, account_id: str, record: WorkspaceRecord) -> WorkspaceWithRoles:
        roles_by_account = self._roles.resolve_many(
            record.id,
            account_id,
            [WorkspaceMemberRoleSubject(account_id=account_id, legacy_role=record.legacy_role)],
        )
        return WorkspaceWithRoles(
            id=record.id,
            name=record.name,
            status=record.status,
            created_at=record.created_at,
            current=record.current,
            roles=tuple(roles_by_account.get(account_id, ())),
        )
