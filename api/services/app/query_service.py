"""App discovery and access checks over materialized data."""

from collections.abc import Sequence
from typing import Protocol

from libs.pagination import PaginatedResult
from services.entities.app_entities import AppListParams, AppRecord, AppSummary


class AppQueryStore(Protocol):
    def find_visible_app(self, app_id: str, tenant_id: str) -> AppSummary | None: ...

    def find_visible_apps(self, app_ids: Sequence[str]) -> list[AppSummary]: ...

    def query_apps(self, user_id: str, tenant_id: str, params: AppListParams) -> PaginatedResult[AppSummary] | None: ...

    def related_apps(self, tenant_id: str, app_ids: Sequence[str]) -> list[AppRecord]: ...


class AppQueryService:
    def __init__(self, *, apps: AppQueryStore) -> None:
        self._apps = apps

    def get_visible_app_by_id(self, app_id: str, tenant_id: str) -> AppSummary | None:
        return self._apps.find_visible_app(app_id, tenant_id)

    def find_visible_apps_by_ids(self, app_ids: Sequence[str]) -> list[AppSummary]:
        return self._apps.find_visible_apps(app_ids)

    def get_paginate_apps(
        self, user_id: str, tenant_id: str, params: AppListParams
    ) -> PaginatedResult[AppSummary] | None:
        return self._apps.query_apps(user_id, tenant_id, params)

    def related_apps(self, tenant_id: str, app_ids: Sequence[str]) -> list[AppRecord]:
        return self._apps.related_apps(tenant_id, app_ids)
