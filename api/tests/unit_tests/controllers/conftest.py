"""Application dependencies shared by controller tests."""

import sys
from collections.abc import Iterator
from dataclasses import dataclass
from unittest.mock import create_autospec

import pytest
from flask import Flask, Response, request_finished
from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.app import AppServices
from extensions.application_services.tools import ToolServices, build_tool_services
from extensions.ext_application_services import (
    _batch_get_enterprise_webapp_access_modes,
    _batch_get_enterprise_webapp_user_permissions,
)
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.app.console_service import ConsoleAppService
from services.app.export_service import AppExportService
from services.app.import_service import AppImportService
from services.app.query_service import AppDiscoveryService
from services.credentials.query import CredentialQuery
from services.data_source.provider_service import DatasourceProviderService
from services.enterprise.enterprise_service import EnterpriseService
from services.rag_pipeline.execution_service import RagPipelineExecutionService
from services.tag_application_service import TagApplicationService
from services.webapp_access_adapters import EnterpriseWebAppAccessPolicyGateway
from services.webapp_access_query_service import WebAppAccessQueryService
from services.workflow.dsl_import import DslImportService
from services.workflow.execution.adapters.pipeline.pipeline_generator import PipelineGenerator
from services.workflow.variable_contracts import WorkflowExecutionVariables
from tests.unit_tests.controllers.error_contract import check_response, track_external_apis

track_external_apis()


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "allow_error_contract_violations: the test serves contract-violating error responses on purpose",
    )


@pytest.fixture(autouse=True)
def error_response_contract(request: pytest.FixtureRequest) -> Iterator[None]:
    """Fail a test whose served error responses contradict the documented error contract."""
    if request.node.get_closest_marker("allow_error_contract_violations"):
        yield
        return
    violations: list[str] = []

    def receiver(sender: Flask, response: Response, **_: object) -> None:
        check_response(sender, response, violations)

    request_finished.connect(receiver)
    try:
        yield
    finally:
        request_finished.disconnect(receiver)
    if violations:
        pytest.fail("error responses contradict the documented contract:\n" + "\n".join(violations))


@pytest.fixture(autouse=True)
def datasource_application_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    workflow_variables: WorkflowExecutionVariables,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    registry = DatasourceApplicationStub(
        tools=build_tool_services(sqlite_session_factory),
        workflow_variables=workflow_variables,
        knowledge=PipelineKnowledgeStub(
            pipeline_generator=create_autospec(PipelineGenerator, instance=True, spec_set=True),
            pipeline_execution=create_autospec(RagPipelineExecutionService, instance=True, spec_set=True),
        ),
        data_sources=PipelineDataSourceStub(
            providers=create_autospec(DatasourceProviderService, instance=True, spec_set=True)
        ),
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
    pipeline_execution: RagPipelineExecutionService


@dataclass(frozen=True)
class PipelineDataSourceStub:
    providers: DatasourceProviderService


@dataclass(frozen=True)
class DatasourceApplicationStub:
    tools: ToolServices
    data_sources: PipelineDataSourceStub
    workflow_variables: WorkflowExecutionVariables
    knowledge: PipelineKnowledgeStub


@dataclass(frozen=True)
class PipelineApplicationStub:
    tools: ToolServices
    workflow_variables: WorkflowExecutionVariables
    knowledge: PipelineKnowledgeStub
    credential_queries: CredentialQuery
    data_sources: PipelineDataSourceStub


@pytest.fixture
def pipeline_application(
    monkeypatch: pytest.MonkeyPatch,
    workflow_variables: WorkflowExecutionVariables,
    sqlite_session_factory: sessionmaker[Session],
) -> PipelineGenerator:
    from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as console_workflow
    from controllers.service_api.dataset.rag_pipeline import rag_pipeline_workflow as service_api_workflow

    generator = create_autospec(PipelineGenerator, instance=True, spec_set=True)
    registry = PipelineApplicationStub(
        tools=build_tool_services(sqlite_session_factory),
        workflow_variables=workflow_variables,
        knowledge=PipelineKnowledgeStub(
            pipeline_generator=generator,
            pipeline_execution=create_autospec(RagPipelineExecutionService, instance=True, spec_set=True),
        ),
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
    exports: AppExportService
    dsl_imports: DslImportService
    discovery: AppDiscoveryService


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
    services = ControllerTestServices(
        tags=application_tags,
        apps=AppQueryTestServices(
            console=app_services.console,
            imports=app_services.imports,
            exports=app_services.exports,
            dsl_imports=app_services.dsl_imports,
            discovery=app_services.discovery,
        ),
        webapp_access=WebAppAccessQueryService(
            access=WebAppAccessQueryRepository(session_factory=sqlite_session_factory),
            webapp_auth_enabled=True,
            policy=EnterpriseWebAppAccessPolicyGateway(webapp_auth=EnterpriseService.WebAppAuth),
            get_access_modes=_batch_get_enterprise_webapp_access_modes,
            get_user_permissions=_batch_get_enterprise_webapp_user_permissions,
        ),
    )
    monkeypatch.setitem(app.extensions, "application_services", services)
    return services
