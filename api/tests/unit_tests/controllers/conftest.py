"""Explicit App service composition for controller tests that use app queries."""

import os
from collections.abc import Callable
from dataclasses import dataclass
from functools import cache

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
from tests.unit_tests.config_override import config_overrides_context


@pytest.fixture(scope="session")
def _console_spec_loader(tmp_path_factory: pytest.TempPathFactory) -> Callable[[], str]:
    """Export once on demand; consumers parse independent copies of the JSON."""

    @cache
    def load() -> str:
        from configs import dify_config
        from dev.generate_swagger_specs import generate_specs

        output_dir = tmp_path_factory.mktemp("controller-specs")
        # The exporter sets generation-only defaults. Restore them even if the
        # first consumer has different per-test config or generation fails.
        original_config = dify_config.model_dump(
            include={"SECRET_KEY", "STORAGE_TYPE", "STORAGE_LOCAL_PATH", "SWAGGER_UI_ENABLED"}
        )
        with config_overrides_context(**original_config), pytest.MonkeyPatch.context() as monkeypatch:
            for name, default in (
                ("SECRET_KEY", "spec-export"),
                ("STORAGE_TYPE", "local"),
                ("STORAGE_LOCAL_PATH", "/tmp/dify-storage"),
            ):
                monkeypatch.setenv(name, os.environ.get(name, default))
            written_paths = generate_specs(output_dir)
        console_path = output_dir / "console-openapi.json"
        assert console_path in written_paths
        return console_path.read_text(encoding="utf-8")

    return load


@pytest.fixture
def exported_console_json(_console_spec_loader: Callable[[], str]) -> str:
    return _console_spec_loader()


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
