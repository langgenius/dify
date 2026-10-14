"""Workspace management and listing use cases with application-owned ports."""

from collections.abc import Iterator, Mapping, Sequence
from typing import Protocol

from enums import CloudPlan
from machinery.context import RequestContext
from services.errors.file import UnsupportedFileTypeError
from services.errors.workspace import WorkspaceArchivedError, WorkspaceNotFoundError
from services.workspace.contracts import (
    EffectiveCreditPool,
    WorkspaceCustomConfig,
    WorkspaceCustomConfigChanges,
    WorkspaceFeatures,
    WorkspacePage,
    WorkspacePermission,
    WorkspaceRecord,
    WorkspaceSnapshot,
    WorkspaceSummary,
)


class WorkspaceStore(Protocol):
    def get(self, workspace_id: str) -> WorkspaceSnapshot | None: ...

    def get_many(self, workspace_ids: Sequence[str]) -> tuple[WorkspaceSnapshot, ...]: ...

    def list_memberships(self, account_id: str) -> tuple[WorkspaceSnapshot, ...]: ...

    def find_membership(self, account_id: str, workspace_id: str) -> WorkspaceSnapshot | None: ...

    def list_member_ids(self, workspace_id: str, *, offset: int, limit: int) -> tuple[str, ...]: ...

    def list_all(self, *, page: int, limit: int) -> WorkspacePage: ...

    def get_for_account(self, workspace_id: str, account_id: str) -> WorkspaceSnapshot | None: ...

    def switch(self, *, account_id: str, workspace_id: str) -> WorkspaceSnapshot: ...

    def rename(self, *, workspace_id: str, account_id: str, name: str) -> WorkspaceSnapshot: ...

    def update_custom_config(
        self, *, workspace_id: str, account_id: str, changes: WorkspaceCustomConfig
    ) -> WorkspaceSnapshot: ...


class WorkspaceFeatureGateway(Protocol):
    def get_features(self, workspace_id: str) -> WorkspaceFeatures: ...

    def get_effective_credit_pool(self, workspace_id: str) -> EffectiveCreditPool: ...

    def logo_url(self, workspace_id: str) -> str: ...

    def get_permission(self, workspace_id: str) -> WorkspacePermission: ...


class WorkspaceLogoGateway(Protocol):
    def upload(self, context: RequestContext, *, filename: str, content: bytes, mimetype: str) -> str: ...


class WorkspaceService:
    def __init__(
        self, *, workspaces: WorkspaceStore, features: WorkspaceFeatureGateway, logos: WorkspaceLogoGateway
    ) -> None:
        self._workspaces = workspaces
        self._features = features
        self._logos = logos

    def get(self, workspace_id: str) -> WorkspaceSnapshot | None:
        return self._workspaces.get(workspace_id)

    def get_many(self, workspace_ids: Sequence[str]) -> tuple[WorkspaceSnapshot, ...]:
        return self._workspaces.get_many(workspace_ids)

    def list_memberships(self, account_id: str) -> tuple[WorkspaceSnapshot, ...]:
        return self._workspaces.list_memberships(account_id)

    def find_membership(self, account_id: str, workspace_id: str) -> WorkspaceSnapshot | None:
        return self._workspaces.find_membership(account_id, workspace_id)

    def switch_membership(self, account_id: str, workspace_id: str) -> WorkspaceSnapshot:
        return self._workspaces.switch(account_id=account_id, workspace_id=workspace_id)

    def iter_member_account_id_batches(self, workspace_id: str, batch_size: int) -> Iterator[tuple[str, ...]]:
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        offset = 0
        while account_ids := self._workspaces.list_member_ids(workspace_id, offset=offset, limit=batch_size):
            yield account_ids
            offset += len(account_ids)

    def list_all(self, *, page: int, limit: int) -> WorkspacePage:
        return self._workspaces.list_all(page=page, limit=limit)

    def _current(self, context: RequestContext) -> WorkspaceSnapshot:
        workspace = self._workspaces.get_for_account(context.active_workspace_id, context.account_id)
        if workspace is None:
            raise WorkspaceNotFoundError()
        return workspace

    def current_summary(self, context: RequestContext) -> dict[str, object]:
        workspace = self._current(context)
        if workspace.status == "archive":
            raise WorkspaceArchivedError()
        credits = self.get_effective_credit_pool(workspace.id)
        return {
            "id": workspace.id,
            "name": workspace.name,
            "role": workspace.role,
            "plan": credits.plan,
            "credits": credits.remaining_credits,
        }

    def get_effective_credit_pool(self, workspace_id: str) -> EffectiveCreditPool:
        return self._features.get_effective_credit_pool(workspace_id)

    def switch(self, context: RequestContext, workspace_id: str) -> dict[str, object]:
        workspace = self._workspaces.switch(account_id=context.account_id, workspace_id=workspace_id)
        return self._tenant_info(workspace)

    def custom_config(self, context: RequestContext) -> WorkspaceCustomConfig:
        return self._public_config(self._current(context))

    def update_custom_config(self, context: RequestContext, changes: WorkspaceCustomConfigChanges) -> dict[str, object]:
        current = self._current(context).custom_config
        config = WorkspaceCustomConfig(
            remove_webapp_brand=changes.remove_webapp_brand
            if changes.remove_webapp_brand is not None
            else current.remove_webapp_brand,
            replace_webapp_logo=changes.replace_webapp_logo
            if changes.replace_webapp_logo is not None
            else current.replace_webapp_logo,
        )
        workspace = self._workspaces.update_custom_config(
            workspace_id=context.active_workspace_id, account_id=context.account_id, changes=config
        )
        return self._tenant_info(workspace)

    def rename(self, context: RequestContext, name: str) -> dict[str, object]:
        workspace = self._workspaces.rename(
            workspace_id=context.active_workspace_id, account_id=context.account_id, name=name
        )
        return self._tenant_info(workspace)

    def upload_logo(self, context: RequestContext, *, filename: str, content: bytes, mimetype: str) -> str:
        if filename.split(".")[-1].lower() not in {"svg", "png"}:
            raise UnsupportedFileTypeError()
        return self._logos.upload(context, filename=filename, content=content, mimetype=mimetype)

    def permission(self, context: RequestContext) -> WorkspacePermission:
        return self._features.get_permission(context.active_workspace_id)

    def _public_config(self, workspace: WorkspaceSnapshot) -> WorkspaceCustomConfig:
        return WorkspaceCustomConfig(
            remove_webapp_brand=workspace.custom_config.remove_webapp_brand,
            replace_webapp_logo=self._features.logo_url(workspace.id)
            if workspace.custom_config.replace_webapp_logo
            else None,
        )

    def _tenant_info(self, workspace: WorkspaceSnapshot) -> dict[str, object]:
        # Repository writes have committed and closed before Feature/Billing I/O.
        features = self._features.get_features(workspace.id)
        credits = features.credits
        info: dict[str, object] = {
            "id": workspace.id,
            "name": workspace.name,
            "status": workspace.status,
            "created_at": workspace.created_at,
            "role": workspace.role,
            "plan": credits.plan,
            "trial_end_reason": None,
        }
        # Preserve the existing workspace-wide privileged-member check.
        if features.can_replace_logo and workspace.has_privileged_member:
            info["custom_config"] = self._public_config(workspace)
        if credits.plan is not None:
            info["next_credit_reset_date"] = credits.next_credit_reset_date
            if credits.quota_limit is not None:
                info["trial_credits"] = credits.quota_limit
                info["trial_credits_used"] = credits.quota_used
                if credits.exhausted_at is not None:
                    info["trial_credits_exhausted_at"] = credits.exhausted_at
        return info


class WorkspacePlanGateway(Protocol):
    def resolve_many(self, workspace_ids: Sequence[str]) -> Mapping[str, str]: ...


class WorkspaceQuery(Protocol):
    def list_for_account(self, account_id: str) -> Sequence[WorkspaceRecord]: ...


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
