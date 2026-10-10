"""Exercise composed DSL export with real rows and workflow selectors."""

from dataclasses import replace
from uuid import uuid4

import pytest
import yaml
from flask import has_app_context
from sqlalchemy.orm import Session

from extensions.application_services.app import AppServices
from machinery.context import AppRequestContext
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.app_dsl_service import DependenciesAnalysisService
from services.entities.app_entities import AppExportOptions
from services.errors.app import AppDiscoveryNotFoundError, IsDraftWorkflowError, WorkflowNotFoundError


@pytest.fixture(autouse=True)
def _provide_app_context() -> None:
    """Override the suite's Flask context so export uses only injected dependencies."""
    assert not has_app_context()


@pytest.fixture(params=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def exported_app(sqlite_session: Session, request: pytest.FixtureRequest) -> AppRequestContext:
    app_id, tenant_id = str(uuid4()), str(uuid4())
    sqlite_session.add(
        App(
            id=app_id,
            tenant_id=tenant_id,
            name="Exported",
            mode=request.param,
            enable_api=True,
            enable_site=False,
        )
    )
    sqlite_session.commit()
    return AppRequestContext(tenant_id=tenant_id, app_id=app_id)


def test_export_scopes_openapi_but_allows_trusted_inner_apps(
    sqlite_session: Session,
    app_services: AppServices,
    exported_app: AppRequestContext,
) -> None:
    with pytest.raises(AppDiscoveryNotFoundError):
        app_services.exports.export_app(replace(exported_app, tenant_id=str(uuid4())), AppExportOptions())
    with pytest.raises(WorkflowNotFoundError):
        app_services.exports.export_app(exported_app, AppExportOptions())
    app = sqlite_session.get(App, exported_app.app_id)
    assert app is not None
    app.enable_api = False
    sqlite_session.commit()
    with pytest.raises(AppDiscoveryNotFoundError):
        app_services.exports.export_app(exported_app, AppExportOptions())
    with pytest.raises(WorkflowNotFoundError):
        app_services.exports.export_for_inner(exported_app.app_id, AppExportOptions())


@pytest.mark.parametrize("surface", ["openapi", "inner"])
@pytest.mark.parametrize("selector", ["published", "default_draft", "draft", "foreign", "foreign_tenant", "missing"])
def test_selected_workflow_ownership_and_publication(
    sqlite_session: Session,
    app_services: AppServices,
    exported_app: AppRequestContext,
    selector: str,
    surface: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workflow_id = str(uuid4())
    if selector != "missing":
        sqlite_session.add(
            Workflow(
                id=workflow_id,
                tenant_id=str(uuid4()) if selector == "foreign_tenant" else exported_app.tenant_id,
                app_id=str(uuid4()) if selector == "foreign" else exported_app.app_id,
                type=WorkflowType.WORKFLOW,
                version=Workflow.VERSION_DRAFT if selector in {"draft", "default_draft"} else "published",
                graph='{"nodes": [], "edges": []}',
                features="{}",
                created_by="account-id",
            )
        )
        sqlite_session.commit()
    options = AppExportOptions(workflow_id=None if selector == "default_draft" else workflow_id)
    if surface == "inner":
        app = sqlite_session.get(App, exported_app.app_id)
        assert app is not None
        app.enable_api = False
        sqlite_session.commit()

    def export() -> str:
        if surface == "inner":
            return app_services.exports.export_for_inner(exported_app.app_id, options)
        return app_services.exports.export_app(exported_app, options)

    if selector in {"published", "default_draft"}:
        monkeypatch.setattr(DependenciesAnalysisService, "generate_dependencies", lambda **_kwargs: [])
        data = yaml.safe_load(export())
        assert data["app"]["name"] == "Exported"
        assert data["workflow"]["graph"] == {"nodes": [], "edges": []}
    else:
        error = IsDraftWorkflowError if selector == "draft" else WorkflowNotFoundError
        with pytest.raises(error):
            export()
