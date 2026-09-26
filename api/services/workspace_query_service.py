"""Application service for listing workspaces visible to a Console account."""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import NamedTuple, Protocol

from enums import CloudPlan
from machinery.context import RequestContext


class WorkspacePlanGateway(Protocol):
    def resolve_many(self, workspace_ids: Sequence[str]) -> Mapping[str, str]: ...


class WorkspaceRecord(NamedTuple):
    id: str
    name: str | None
    status: str
    created_at: datetime
    last_opened_at: datetime | None


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


class WorkspaceQueryService:
    def __init__(
        self,
        *,
        workspaces: WorkspaceQuery,
        plans: WorkspacePlanGateway,
    ) -> None:
        self._workspaces = workspaces
        self._plans = plans

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
