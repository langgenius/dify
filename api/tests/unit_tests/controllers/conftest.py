"""Application dependencies shared by controller tests."""

import sys
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import create_autospec

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
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
from services.credentials.query import CredentialQuery
from services.data_source.provider_service import DatasourceProviderService
from services.tag_application_service import TagApplicationService
from services.webapp_access_query_service import WebAppAccessQueryService


@pytest.fixture(autouse=True)
def datasource_application_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = SimpleNamespace(
        data_sources=SimpleNamespace(providers=create_autospec(DatasourceProviderService, instance=True, spec_set=True))
    )
    for name in (
        "controllers.console.datasets.rag_pipeline.rag_pipeline_workflow",
        "controllers.console.datasets.rag_pipeline.datasource_content_preview",
        "controllers.console.datasets.website",
    ):
        module = sys.modules.get(name)
        if module is not None:
            monkeypatch.setattr(module, "application_services", lambda: registry)


@dataclass(frozen=True)
class PipelineKnowledgeStub:
    pipeline_generator: PipelineGenerator


@dataclass(frozen=True)
class PipelineDataSourceStub:
    providers: DatasourceProviderService


@dataclass(frozen=True)
class PipelineApplicationStub:
    knowledge: PipelineKnowledgeStub
    credential_queries: CredentialQuery
    data_sources: PipelineDataSourceStub


@pytest.fixture
def pipeline_application(monkeypatch: pytest.MonkeyPatch) -> PipelineGenerator:
    from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as console_workflow
    from controllers.service_api.dataset.rag_pipeline import rag_pipeline_workflow as service_api_workflow

    generator = create_autospec(PipelineGenerator, instance=True, spec_set=True)
    registry = PipelineApplicationStub(
        knowledge=PipelineKnowledgeStub(pipeline_generator=generator),
        credential_queries=create_autospec(CredentialQuery, instance=True, spec_set=True),
        data_sources=PipelineDataSourceStub(
            providers=create_autospec(DatasourceProviderService, instance=True, spec_set=True)
        ),
    )
    monkeypatch.setattr(console_workflow, "application_services", lambda: registry)
    monkeypatch.setattr(service_api_workflow, "application_services", lambda: registry)
    return generator


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
