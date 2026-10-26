"""Own the read Session for app lookup and DSL export materialization."""

from typing import override

from sqlalchemy.orm import Session, sessionmaker

from models.model import App
from repositories.app.console_repository import ConsoleAppRepository
from services.app.export_service import AppExportStore
from services.app_dsl_service import AppDslService
from services.entities.app_entities import AppExportOptions
from services.entities.dsl_entities import AppDslExportData
from services.errors.app import AppDiscoveryNotFoundError


class AppExportRepository(AppExportStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def load_export_data(self, *, app_id: str, tenant_id: str | None, options: AppExportOptions) -> AppDslExportData:
        """Read all DSL data before serialization performs external plugin I/O.

        The trusted inner API passes no tenant and can export across workspaces,
        including apps hidden from OpenAPI. Account callers require both tenant
        ownership and OpenAPI visibility.
        """
        with self._session_factory() as session:
            app = (
                session.get(App, app_id)
                if tenant_id is None
                else ConsoleAppRepository.get_visible_app_by_id(app_id, session, tenant_id=tenant_id)
            )
            if app is None:
                raise AppDiscoveryNotFoundError("app not found")
            return AppDslService.load_export_data(
                app_model=app,
                session=session,
                include_secret=options.include_secret,
                workflow_id=options.workflow_id,
                version_id=options.version_id,
            )
