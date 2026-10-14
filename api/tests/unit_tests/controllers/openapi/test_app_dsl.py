from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol, cast
from uuid import uuid4

import pytest
from flask import Flask, request
from flask_restx import Resource
from sqlalchemy.orm import Session, sessionmaker

from controllers.common.errors import ForbiddenError
from controllers.openapi._contract import op_of
from controllers.openapi._errors import OpenApiErrorFormatter
from controllers.openapi._models import (
    AppDslExportQuery,
    AppDslExportResponse,
    AppDslImportPayload,
    AppDslImportResponse,
    Hint,
)
from controllers.openapi.app_dsl import AppDslExportApi, AppDslImportApi, AppDslImportConfirmApi
from controllers.openapi.auth.spec import EndpointSpec
from libs.external_api import ExternalApi
from machinery.context import AppRequestContext, RequestContext
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from repositories.app.export_repository import AppExportRepository
from services.app.export_service import AppExportService
from services.app_dsl_service import AppDslService
from services.entities.dsl_entities import Import, ImportStatus
from services.errors.base import NoPermissionError
from tests.unit_tests.controllers.conftest import ControllerTestServices


class _EndpointView(Protocol):
    """Structural stand-in for a `view` carrying the attributes `@endpoint` attaches."""

    __spec__: EndpointSpec
    __handler__: Callable[..., tuple[AppDslImportResponse, int]]


class _ExportEndpoint(Protocol):
    __handler__: Callable[..., tuple[AppDslExportResponse, int]]


@dataclass(frozen=True)
class ExportAppServices:
    exports: AppExportService


@dataclass(frozen=True)
class ExportServices:
    apps: ExportAppServices


@pytest.mark.parametrize(
    ("missing", "status", "error_code"),
    [
        ("app", 404, "not_found"),
        ("draft", 404, "not_found"),
        ("version", 404, "not_found"),
        ("draft_version", 400, "bad_request"),
    ],
)
def test_export_errors_have_canonical_http_responses(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    missing: str,
    status: int,
    error_code: str,
) -> None:
    """Exercise the admitted handler, real export reads and HTTP error formatter."""
    app_id, tenant_id, workflow_id = str(uuid4()), str(uuid4()), str(uuid4())
    if missing != "app":
        sqlite_session.add(
            App(
                id=app_id,
                tenant_id=tenant_id,
                name="Exported workflow",
                mode=AppMode.WORKFLOW,
                enable_api=True,
                enable_site=False,
            )
        )
    if missing in {"version", "draft_version"}:
        # A draft exists, but an explicitly requested version must not fall back to it.
        sqlite_session.add(
            Workflow(
                id=workflow_id if missing == "draft_version" else str(uuid4()),
                tenant_id=tenant_id,
                app_id=app_id,
                type=WorkflowType.WORKFLOW,
                version=Workflow.VERSION_DRAFT,
                graph='{"nodes": [], "edges": []}',
                features="{}",
                created_by="account-id",
            )
        )
    sqlite_session.commit()

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.extensions["application_services"] = ExportServices(
        apps=ExportAppServices(
            exports=AppExportService(
                apps=AppExportRepository(session_factory=sqlite_session_factory),
                serialize=AppDslService.serialize_export_data,
            )
        )
    )
    api = ExternalApi(app, error_body_formatter=OpenApiErrorFormatter())

    class AdmittedExport(Resource):
        def get(self, app_id: str) -> tuple[AppDslExportResponse, int]:
            return cast(_ExportEndpoint, AppDslExportApi.get).__handler__(
                AppDslExportApi(),
                AppRequestContext(tenant_id=tenant_id, app_id=app_id),
                app_id,
                query=AppDslExportQuery.model_validate(request.args.to_dict(flat=True)),
            )

    api.add_resource(AdmittedExport, "/apps/<string:app_id>/dsl")
    response = app.test_client().get(
        f"/apps/{app_id}/dsl",
        query_string={"workflow_id": workflow_id} if missing in {"version", "draft_version"} else {},
    )

    messages = {
        "app": "app not found",
        "draft": "Missing draft workflow configuration, please check.",
        "version": f"Workflow version not found. Workflow ID: {workflow_id}.",
        "draft_version": (
            f"Cannot use draft workflow version. Workflow ID: {workflow_id}. "
            "Please use a published workflow version or leave workflow_id empty."
        ),
    }
    assert response.status_code == status
    assert response.get_json() == {"code": error_code, "message": messages[missing], "status": status}


@pytest.mark.parametrize(
    ("api", "kwargs"),
    [
        (
            AppDslImportApi(),
            {
                "workspace_id": "workspace-1",
                "body": AppDslImportPayload(mode="yaml-content", yaml_content="app: {}"),
            },
        ),
        (
            AppDslImportConfirmApi(),
            {"workspace_id": "workspace-1", "import_id": "import-1"},
        ),
    ],
)
def test_permission_denial_maps_to_forbidden(
    app_query_services: ControllerTestServices,
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    api: AppDslImportApi | AppDslImportConfirmApi,
    kwargs: dict[str, object],
) -> None:
    def denied(*_args: object, **_kwargs: object) -> None:
        raise NoPermissionError("denied")

    monkeypatch.setattr(app_query_services.apps.imports, "import_app", denied)
    monkeypatch.setattr(app_query_services.apps.imports, "confirm_import", denied)
    context = RequestContext("request-1", None, "account-1", "workspace-1")

    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"):
        with pytest.raises(ForbiddenError, match="denied") as exc_info:
            cast(_EndpointView, api.post).__handler__(api, context, **kwargs)

    assert isinstance(exc_info.value.__cause__, NoPermissionError)
    assert exc_info.value.code == 403
    assert exc_info.value.data == {"code": "forbidden", "message": "denied", "status": 403}


@pytest.mark.parametrize(
    ("result", "status", "hints"),
    [
        pytest.param(
            Import(id="import-1", status=ImportStatus.PENDING),
            202,
            [
                Hint(
                    summary="Confirm the pending import",
                    op=op_of(AppDslImportConfirmApi.post),
                    input={"workspace_id": "workspace-1", "import_id": "import-1"},
                )
            ],
            id="pending",
        ),
        pytest.param(Import(id="import-2", status=ImportStatus.COMPLETED, app_id="app-2"), 200, [], id="completed"),
    ],
)
def test_import_hints_a_confirm_only_while_pending(
    app_query_services: ControllerTestServices,
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    result: Import,
    status: int,
    hints: list[Hint],
) -> None:
    monkeypatch.setattr(app_query_services.apps.imports, "import_app", lambda *_args, **_kwargs: result)

    api = AppDslImportApi()
    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"):
        response, code = cast(_EndpointView, api.post).__handler__(
            api,
            RequestContext("request-1", None, "account-1", "workspace-1"),
            workspace_id="workspace-1",
            body=AppDslImportPayload(mode="yaml-content", yaml_content="app: {}"),
        )

    assert (code, response.hints) == (status, hints)
