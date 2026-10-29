"""Read-only app previews, independent of trial execution and account quotas."""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from services.app_definition_query_service import AppDefinitionUnavailableError, AppSiteConfiguration


@dataclass(frozen=True, slots=True)
class AppPreviewRef:
    app_id: str
    tenant_id: str


@dataclass(frozen=True, slots=True)
class AppPreviewSite:
    configuration: AppSiteConfiguration
    owner_status: str | None


@dataclass(frozen=True, slots=True)
class AppPreviewDataset:
    id: str
    name: str
    description: str | None
    permission: str | None
    data_source_type: str | None
    indexing_technique: str | None
    created_by: str | None
    created_at: datetime | None


class AppPreviewQuery(Protocol):
    def get_agent_composer(self, *, app: AppPreviewRef) -> Mapping[str, object] | None: ...

    def get_app(self, *, app_id: str) -> AppPreviewRef | None: ...

    def get_site(self, *, app: AppPreviewRef) -> AppPreviewSite | None: ...

    def get_datasets(self, *, app: AppPreviewRef, ids: Sequence[str]) -> tuple[AppPreviewDataset, ...] | None: ...


class AppPreviewUnavailableError(LookupError):
    """The app is not in the preview catalog or is no longer available."""


class AppPreviewSiteUnavailableError(LookupError):
    """The admitted app no longer has an available site."""


class AppPreviewOwnerUnavailableError(LookupError):
    """The site owner is missing or archived."""


class AppPreviewQueryService:
    def get_agent_composer(self, *, app: AppPreviewRef) -> Mapping[str, object]:
        preview = self._apps.get_agent_composer(app=app)
        if preview is None:
            raise AppDefinitionUnavailableError("Agent preview is unavailable")
        return preview

    def __init__(self, *, apps: AppPreviewQuery, is_previewable: Callable[[str], bool]) -> None:
        self._apps: AppPreviewQuery = apps
        self._is_previewable: Callable[[str], bool] = is_previewable

    def get_access(self, *, app_id: str) -> AppPreviewRef:
        # Catalog membership can involve remote I/O. Resolve it before opening
        # the app query session, without imposing trial execution admission.
        if not self._is_previewable(app_id):
            raise AppPreviewUnavailableError(f"App {app_id} is not available for preview")
        app = self._apps.get_app(app_id=app_id)
        if app is None:
            raise AppPreviewUnavailableError(f"App {app_id} is not available for preview")
        return app

    def get_site(self, *, app: AppPreviewRef) -> AppSiteConfiguration:
        site = self._apps.get_site(app=app)
        if site is None:
            raise AppPreviewSiteUnavailableError(f"Site for app {app.app_id} is unavailable")
        if site.owner_status is None or site.owner_status == "archive":
            raise AppPreviewOwnerUnavailableError(f"Owner of app {app.app_id} is unavailable")
        return site.configuration

    def get_datasets(self, *, app: AppPreviewRef, ids: Sequence[str]) -> tuple[AppPreviewDataset, ...]:
        datasets = self._apps.get_datasets(app=app, ids=ids)
        if datasets is None:
            raise AppPreviewUnavailableError(f"App {app.app_id} is no longer available in tenant {app.tenant_id}")
        return datasets
