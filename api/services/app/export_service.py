"""DSL export for account and trusted inner API callers."""

from collections.abc import Callable
from typing import Protocol

from machinery.context import AppRequestContext
from services.entities.app_entities import AppExportOptions
from services.entities.dsl_entities import AppDslExportData


class AppExportStore(Protocol):
    def load_export_data(self, *, app_id: str, tenant_id: str | None, options: AppExportOptions) -> AppDslExportData:
        """Close the read Session before returning materialized export data.

        A null tenant is reserved for the trusted cross-workspace inner API.
        """
        ...


class AppExportService:
    def __init__(self, *, apps: AppExportStore, serialize: Callable[[AppDslExportData], str]) -> None:
        self._apps = apps
        self._serialize = serialize

    def export_app(self, context: AppRequestContext, options: AppExportOptions) -> str:
        prepared = self._apps.load_export_data(app_id=context.app_id, tenant_id=context.tenant_id, options=options)
        return self._serialize(prepared)

    def export_for_inner(self, app_id: str, options: AppExportOptions) -> str:
        prepared = self._apps.load_export_data(app_id=app_id, tenant_id=None, options=options)
        return self._serialize(prepared)
