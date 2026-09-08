"""Manage workspace installations and paginate apps visible to an account."""

from collections.abc import Sequence, Set
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from pydantic import BaseModel

from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef


class InstalledAppCursor(BaseModel):
    is_pinned: bool
    last_used_at: datetime | None
    installed_app_id: str


@dataclass(frozen=True, slots=True)
class InstalledAppInfo:
    id: str
    name: str
    description: str
    mode: str
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    use_icon_as_answer_icon: bool


@dataclass(frozen=True, slots=True)
class InstalledAppRecord:
    id: str
    app: InstalledAppInfo
    app_owner_tenant_id: str
    is_pinned: bool
    last_used_at: datetime | None

    def cursor(self) -> InstalledAppCursor:
        return InstalledAppCursor(
            is_pinned=self.is_pinned,
            last_used_at=self.last_used_at,
            installed_app_id=self.id,
        )


@dataclass(frozen=True, slots=True)
class InstalledAppPage:
    data: tuple[InstalledAppRecord, ...]
    has_more: bool
    next_cursor: InstalledAppCursor | None
    editable: bool


@dataclass(frozen=True, slots=True)
class InstalledAppDetail:
    installation: InstalledAppRecord
    editable: bool


class InstalledAppOwnedByWorkspaceError(ValueError):
    """A workspace cannot uninstall an app it owns."""


class InstalledAppStore(Protocol):
    def get_candidates(
        self,
        *,
        tenant_id: str,
        cursor: InstalledAppCursor | None,
        limit: int,
        app_id: str | None,
        name: str | None,
    ) -> tuple[InstalledAppRecord, ...]: ...

    def get_published(self, *, installed_app: InstalledAppRef) -> InstalledAppRecord | None: ...

    def uninstall(self, *, installed_app: InstalledAppRef) -> None: ...

    def set_pinned(self, *, installed_app: InstalledAppRef, is_pinned: bool) -> None: ...


class InstalledAppVisibilityQuery(Protocol):
    def __call__(self, *, user_id: str, app_ids: Sequence[str]) -> Set[str]: ...


class WorkspaceRoleLookup(Protocol):
    def __call__(self, *, account_id: str, tenant_id: str) -> str | None: ...


class InstalledAppService:
    def __init__(
        self,
        *,
        installed_apps: InstalledAppStore,
        get_workspace_role: WorkspaceRoleLookup,
        get_visible_app_ids: InstalledAppVisibilityQuery | None,
    ) -> None:
        self._installed_apps: InstalledAppStore = installed_apps
        self._get_workspace_role: WorkspaceRoleLookup = get_workspace_role
        self._get_visible_app_ids: InstalledAppVisibilityQuery | None = get_visible_app_ids

    def get_visible_page(
        self,
        *,
        tenant_id: str,
        user_id: str,
        cursor: InstalledAppCursor | None,
        limit: int,
        app_id: str | None,
        name: str | None,
    ) -> InstalledAppPage:
        """Scan ordered candidates until one page of authorized apps is complete."""
        scan_size = limit * 2 if self._get_visible_app_ids is not None else limit + 1
        visible_rows: list[InstalledAppRecord] = []
        scan_cursor = cursor
        has_more = False
        last_consumed_app: InstalledAppRecord | None = None

        while True:
            # Candidate records are detached and the repository Session is closed
            # before the optional Enterprise request.
            candidate_rows = self._installed_apps.get_candidates(
                tenant_id=tenant_id,
                cursor=scan_cursor,
                limit=scan_size,
                app_id=app_id,
                name=name,
            )
            if not candidate_rows:
                break

            authorized_app_ids: Set[str] = {row.app.id for row in candidate_rows}
            if self._get_visible_app_ids is not None:
                authorized_app_ids = self._get_visible_app_ids(
                    user_id=user_id, app_ids=[row.app.id for row in candidate_rows]
                )

            for row in candidate_rows:
                if row.app.id not in authorized_app_ids:
                    last_consumed_app = row
                    continue
                if len(visible_rows) == limit:
                    has_more = True
                    break
                visible_rows.append(row)
                last_consumed_app = row
            if has_more:
                break

            if len(candidate_rows) < scan_size:
                break
            scan_cursor = candidate_rows[-1].cursor()

        next_cursor = last_consumed_app.cursor() if has_more and last_consumed_app is not None else None
        role = self._get_workspace_role(account_id=user_id, tenant_id=tenant_id)
        return InstalledAppPage(
            data=tuple(visible_rows), has_more=has_more, next_cursor=next_cursor, editable=role in {"owner", "admin"}
        )

    def get_detail(self, *, installed_app: InstalledAppRef, account_id: str) -> InstalledAppDetail:
        installation = self._installed_apps.get_published(installed_app=installed_app)
        if installation is None:
            raise InstalledAppNotFoundError(f"Installed app {installed_app.id} is not published or no longer exists")
        role = self._get_workspace_role(account_id=account_id, tenant_id=installed_app.tenant_id)
        return InstalledAppDetail(installation=installation, editable=role in {"owner", "admin"})

    def uninstall(self, *, installed_app: InstalledAppRef) -> None:
        self._installed_apps.uninstall(installed_app=installed_app)

    def set_pinned(self, *, installed_app: InstalledAppRef, is_pinned: bool | None) -> None:
        if is_pinned is not None:
            self._installed_apps.set_pinned(installed_app=installed_app, is_pinned=is_pinned)
