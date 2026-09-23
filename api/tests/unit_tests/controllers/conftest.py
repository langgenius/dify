"""Explicit App service composition for controller tests that use app queries."""

from dataclasses import dataclass

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.app import AppServices
from extensions.ext_application_services import (
    _batch_get_enterprise_webapp_access_modes,
    _batch_get_enterprise_webapp_user_permissions,
    _get_enterprise_webapp_access_mode,
    _is_enterprise_webapp_user_allowed,
)
from repositories.app.console_repository import ConsoleAppRepository
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.app.console_service import ConsoleAppService
from services.app.import_service import AppImportService
from services.app.query_service import AppQueryService
from services.tag_application_service import TagApplicationService
from services.webapp_access_query_service import WebAppAccessQueryService


@dataclass
class AppQueryTestServices:
    console: ConsoleAppService
    imports: AppImportService
    queries: AppQueryService


@dataclass(frozen=True)
class ControllerTestServices:
    apps: AppQueryTestServices
    tags: TagApplicationService
    webapp_access: WebAppAccessQueryService


@pytest.fixture
def app_query_services(
    app_services: AppServices,
    application_tags: TagApplicationService,
    app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> ControllerTestServices:
    repository = ConsoleAppRepository(session_factory=sqlite_session_factory)
    services = ControllerTestServices(
        tags=application_tags,
        apps=AppQueryTestServices(
            console=app_services.console,
            imports=app_services.imports,
            queries=AppQueryService(apps=repository),
        ),
        webapp_access=WebAppAccessQueryService(
            access=WebAppAccessQueryRepository(session_factory=sqlite_session_factory),
            webapp_auth_enabled=True,
            access_mode_for_app=_get_enterprise_webapp_access_mode,
            is_user_allowed_for_app=_is_enterprise_webapp_user_allowed,
            get_access_modes=_batch_get_enterprise_webapp_access_modes,
            get_user_permissions=_batch_get_enterprise_webapp_user_permissions,
        ),
    )
    monkeypatch.setitem(app.extensions, "application_services", services)
    return services
