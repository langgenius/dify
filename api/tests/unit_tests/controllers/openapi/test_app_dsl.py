from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol, cast
from uuid import uuid4

import pytest
import yaml
from flask import Flask, request
from flask_restx import Resource
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import BadRequest, NotFound

from controllers.common.errors import ForbiddenError, NotFoundError
from controllers.openapi import app_dsl
from controllers.openapi._contract import op_of
from controllers.openapi._errors import DraftChanged, DraftNotFound, DslInvalid, OpenApiErrorFormatter, VersionNotFound
from controllers.openapi._models import (
    AppDslExportQuery,
    AppDslExportResponse,
    AppDslImportPayload,
    AppDslImportResponse,
    DslCheckPayload,
    DslCheckResponse,
    Hint,
)
from controllers.openapi.app_dsl import AppDslCheckApi, AppDslExportApi, AppDslImportApi, AppDslImportConfirmApi
from controllers.openapi.auth.spec import EndpointSpec
from libs.external_api import ExternalApi
from machinery.context import AppRequestContext, RequestContext
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from repositories.app.export_repository import AppExportRepository
from services.app.export_service import AppExportService
from services.app_dsl_service import AppDslService
from services.entities.app_entities import AppExportOptions
from services.entities.dsl_entities import DraftGuardedImportParams, Import, ImportStatus
from services.errors.app import (
    AppDiscoveryNotFoundError,
    DraftChangedError,
    IsDraftWorkflowError,
    WorkflowNotFoundError,
)
from services.errors.base import NoPermissionError
from services.workflow import graph_check
from services.workflow.graph_check import IssueCode, IssueSeverity
from services.workflow.graph_diff import current_draft_token, draft_token
from tests.unit_tests.controllers.conftest import ControllerTestServices


class _EndpointView(Protocol):
    """Structural stand-in for a `view` carrying the attributes `@endpoint` attaches."""

    __spec__: EndpointSpec
    __handler__: Callable[..., tuple[AppDslImportResponse, int]]


class _ExportView(Protocol):
    """Same stand-in, typed for the export endpoint's response."""

    __handler__: Callable[..., tuple[AppDslExportResponse, int]]


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

    with (
        app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"),
        pytest.raises(ForbiddenError, match="denied") as exc_info,
    ):
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


_EXPORT_CONTEXT = AppRequestContext(tenant_id="tenant-1", app_id="app-1")


def _export(app: Flask, query: AppDslExportQuery) -> tuple[AppDslExportResponse, int]:
    api = AppDslExportApi()
    with app.test_request_context("/openapi/v1/apps/app-1/dsl"):
        return cast(_ExportView, api.get).__handler__(api, _EXPORT_CONTEXT, "app-1", query=query)


def test_export_reads_draft_hash_before_building_dsl(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """The hash must describe the draft as of before the export, not after: an edit that
    commits in between would otherwise make a later import silently overwrite it."""
    sqlite_session.add(
        App(id="app-1", tenant_id="tenant-1", name="a", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
    )
    draft = Workflow(
        tenant_id="tenant-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph='{"nodes": [], "edges": []}',
        features="{}",
        created_by="account-1",
    )
    sqlite_session.add(draft)
    sqlite_session.commit()
    call_order: list[str] = []

    def read_token(tenant_id: str, app_id: str) -> str | None:
        call_order.append("draft_hash")
        return current_draft_token(tenant_id, app_id)

    def export_app(context: AppRequestContext, _options: AppExportOptions) -> str:
        call_order.append("export")
        assert context == _EXPORT_CONTEXT
        return "app: {}"

    monkeypatch.setattr(app_dsl, "current_draft_token", read_token)
    monkeypatch.setattr(app_query_services.apps.exports, "export_app", export_app)

    response, status = _export(app, AppDslExportQuery())

    assert call_order == ["draft_hash", "export"]
    assert response.draft_hash == draft_token(draft)
    assert status == 200


class _CheckView(Protocol):
    __handler__: Callable[..., tuple[DslCheckResponse, int]]


_CONTEXT = RequestContext("request-1", None, "account-1", "workspace-1")
_START: dict[str, object] = {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}
_END: dict[str, object] = {"id": "end", "data": {"type": "end", "title": "End", "outputs": []}}
_ANSWER: dict[str, object] = {"id": "a", "data": {"type": "answer", "title": "A", "answer": "hi"}}


def _dsl(mode: str, *nodes: Mapping[str, object]) -> str:
    return yaml.safe_dump(
        {"app": {"mode": mode, "name": "x"}, "workflow": {"graph": {"nodes": list(nodes), "edges": []}}}
    )


class _CredentialValidator:
    """The one `WorkflowService` call the check makes, refusing with `problem` when set."""

    def __init__(self, problem: str | None) -> None:
        self._problem = problem

    def validate_node_credentials(self, *_args: object, **_kwargs: object) -> None:
        if self._problem:
            raise ValueError(self._problem)


def _recorded_import(
    monkeypatch: pytest.MonkeyPatch, services: ControllerTestServices, result: Import | None = None
) -> list[DraftGuardedImportParams]:
    calls: list[DraftGuardedImportParams] = []

    def import_app(_context: RequestContext, params: DraftGuardedImportParams) -> Import | None:
        calls.append(params)
        return result

    monkeypatch.setattr(services.apps.imports, "import_app", import_app)
    return calls


@pytest.fixture
def credentials(monkeypatch: pytest.MonkeyPatch) -> Callable[[str | None], None]:
    def set_problem(problem: str | None) -> None:
        monkeypatch.setattr(graph_check, "WorkflowService", lambda: _CredentialValidator(problem))

    set_problem(None)
    return set_problem


def _check(app: Flask, body: DslCheckPayload) -> DslCheckResponse:
    api = AppDslCheckApi()
    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports:check", method="POST"):
        response, status = cast(_CheckView, api.post).__handler__(api, _CONTEXT, workspace_id="workspace-1", body=body)
    assert status == 200
    return response


def test_import_refuses_a_graph_with_errors_and_hints_the_check(
    app_query_services: ControllerTestServices, app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    import_calls = _recorded_import(monkeypatch, app_query_services)

    api = AppDslImportApi()
    with (
        app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"),
        pytest.raises(DslInvalid) as exc_info,
    ):
        cast(_EndpointView, api.post).__handler__(
            api,
            _CONTEXT,
            workspace_id="workspace-1",
            body=AppDslImportPayload(mode="yaml-content", yaml_content=_dsl("workflow", _START, _ANSWER)),
        )

    assert import_calls == []
    assert [(d.type, d.loc) for d in exc_info.value.details or []] == [
        (IssueCode.MODE_INCOMPATIBLE, ["nodes", "a", "data", "type"])
    ]
    assert [h.op for h in exc_info.value.hints or []] == [op_of(AppDslCheckApi.post)]


@pytest.mark.parametrize(
    "yaml_content",
    [
        pytest.param(_dsl("chat"), id="not-a-graph-mode"),
        pytest.param("app: [", id="unparseable"),
        pytest.param(_dsl("future-mode", _ANSWER), id="unknown-mode"),
    ],
)
def test_import_leaves_dsls_the_check_cannot_read_to_the_import(
    app_query_services: ControllerTestServices, app: Flask, monkeypatch: pytest.MonkeyPatch, yaml_content: str
) -> None:
    result = Import(id="import-1", status=ImportStatus.FAILED, error="from the import")
    monkeypatch.setattr(app_query_services.apps.imports, "import_app", lambda *_args, **_kwargs: result)

    api = AppDslImportApi()
    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"):
        response, status = cast(_EndpointView, api.post).__handler__(
            api,
            _CONTEXT,
            workspace_id="workspace-1",
            body=AppDslImportPayload(mode="yaml-content", yaml_content=yaml_content),
        )

    assert (status, response.error) == (400, "from the import")


@pytest.mark.usefixtures("app_query_services")
def test_check_reports_credential_problems_as_warnings(app: Flask, credentials: Callable[[str | None], None]) -> None:
    credentials("no key")

    response = _check(app, DslCheckPayload(yaml_content=_dsl("workflow", _START, _END)))

    assert response.valid is True
    assert {(row.code, row.severity, row.message) for row in response.issues} == {
        (IssueCode.RESOURCE_UNAVAILABLE, IssueSeverity.WARNING, "no key")
    }


@pytest.mark.usefixtures("app_query_services", "credentials")
def test_check_uses_the_overwritten_apps_mode(app: Flask, sqlite_session: Session) -> None:
    sqlite_session.add(
        App(
            id="app-1",
            tenant_id="workspace-1",
            name="a",
            mode=AppMode.ADVANCED_CHAT,
            enable_site=True,
            enable_api=True,
        )
    )
    sqlite_session.commit()

    response = _check(app, DslCheckPayload(yaml_content=_dsl("workflow", _START, _END), app_id="app-1"))

    assert response.valid is False
    assert [(row.code, row.node_id) for row in response.issues] == [(IssueCode.MODE_INCOMPATIBLE, "end")]


@pytest.mark.usefixtures("app_query_services", "credentials")
def test_check_answers_404_for_an_app_outside_the_workspace(app: Flask, sqlite_session: Session) -> None:
    sqlite_session.add(
        App(id="app-1", tenant_id="workspace-2", name="a", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
    )
    sqlite_session.commit()

    with pytest.raises(NotFound):
        _check(app, DslCheckPayload(yaml_content=_dsl("workflow", _START), app_id="app-1"))


@pytest.mark.parametrize("yaml_content", [_dsl("chat"), _dsl("future-mode"), "app: [", "- a list"])
@pytest.mark.usefixtures("app_query_services", "credentials")
def test_check_refuses_dsls_it_cannot_read(app: Flask, yaml_content: str) -> None:
    with pytest.raises(BadRequest):
        _check(app, DslCheckPayload(yaml_content=yaml_content))


@pytest.mark.parametrize(
    ("workflow_id", "raised", "expected"),
    [
        ("6f1c2a52-0d43-4f7e-9a3b-1c2d3e4f5a6b", WorkflowNotFoundError("gone"), VersionNotFound),
        ("6f1c2a52-0d43-4f7e-9a3b-1c2d3e4f5a6b", IsDraftWorkflowError("draft"), VersionNotFound),
        (None, WorkflowNotFoundError("no draft"), DraftNotFound),
        (None, AppDiscoveryNotFoundError("app not found"), NotFoundError),
    ],
)
def test_export_answers_a_missing_workflow_with_the_openapi_error(
    app: Flask,
    app_query_services: ControllerTestServices,
    monkeypatch: pytest.MonkeyPatch,
    workflow_id: str | None,
    raised: Exception,
    expected: type[Exception],
) -> None:
    def export_app(*_args: object) -> str:
        raise raised

    monkeypatch.setattr(app_query_services.apps.exports, "export_app", export_app)

    with pytest.raises(expected):
        _export(app, AppDslExportQuery(workflow_id=workflow_id))


def test_import_hands_the_draft_hash_to_the_save(
    app_query_services: ControllerTestServices, app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(app_query_services.apps.dsl_imports, "prepare", lambda *_args, **_kwargs: "prepared yaml")
    completed = Import(id="import-1", status=ImportStatus.COMPLETED, app_id="app-1")
    import_calls = _recorded_import(monkeypatch, app_query_services, completed)

    api = AppDslImportApi()
    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"):
        cast(_EndpointView, api.post).__handler__(
            api,
            _CONTEXT,
            workspace_id="workspace-1",
            body=AppDslImportPayload(mode="yaml-content", yaml_content="x", app_id="app-1", draft_hash="exported"),
        )

    [params] = import_calls
    assert (params.draft_hash, params.yaml_content, params.app_id) == ("exported", "prepared yaml", "app-1")


@pytest.mark.parametrize(
    ("api", "kwargs"),
    [
        (
            AppDslImportApi(),
            {
                "workspace_id": "workspace-1",
                "body": AppDslImportPayload(
                    mode="yaml-content", yaml_content="x", app_id="app-1", draft_hash="exported"
                ),
            },
        ),
        (AppDslImportConfirmApi(), {"workspace_id": "workspace-1", "import_id": "import-1"}),
    ],
    ids=["import", "confirm"],
)
def test_a_draft_changed_during_the_save_answers_draft_changed(
    app_query_services: ControllerTestServices,
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    api: AppDslImportApi | AppDslImportConfirmApi,
    kwargs: dict[str, object],
) -> None:
    def changed(*_args: object, **_kwargs: object) -> None:
        raise DraftChangedError()

    monkeypatch.setattr(app_query_services.apps.dsl_imports, "prepare", lambda *_args, **_kwargs: "prepared yaml")
    monkeypatch.setattr(app_query_services.apps.imports, "import_app", changed)
    monkeypatch.setattr(app_query_services.apps.imports, "confirm_import", changed)

    with (
        app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"),
        pytest.raises(DraftChanged) as exc_info,
    ):
        cast(_EndpointView, api.post).__handler__(api, _CONTEXT, **kwargs)

    assert exc_info.value.code == 409


def _raw_dsl(graph: object) -> str:
    return yaml.safe_dump({"app": {"mode": "workflow", "name": "x"}, "workflow": {"graph": graph}})


_MALFORMED_GRAPHS = [
    pytest.param({"nodes": [{"id": "a", "data": None}], "edges": []}, id="null-data"),
    pytest.param({"nodes": [{"id": "a", "data": {"type": "start"}}], "edges": 5}, id="scalar-edges"),
    pytest.param({"nodes": [5, "x"], "edges": []}, id="scalar-nodes"),
    pytest.param({"nodes": [{"data": {"type": "start"}}], "edges": []}, id="no-id"),
    pytest.param({"nodes": "start", "edges": []}, id="scalar-node-list"),
]


@pytest.mark.parametrize("graph", _MALFORMED_GRAPHS)
@pytest.mark.usefixtures("app_query_services", "credentials")
def test_check_reports_malformed_graphs_as_issues(app: Flask, graph: object) -> None:
    response = _check(app, DslCheckPayload(yaml_content=_raw_dsl(graph)))

    assert response.valid is False
    assert {row.code for row in response.issues} == {IssueCode.GRAPH_INVALID}


@pytest.mark.parametrize("graph", _MALFORMED_GRAPHS)
@pytest.mark.usefixtures("credentials")
def test_import_refuses_malformed_graphs(
    app_query_services: ControllerTestServices, app: Flask, monkeypatch: pytest.MonkeyPatch, graph: object
) -> None:
    import_calls = _recorded_import(monkeypatch, app_query_services)

    api = AppDslImportApi()
    with (
        app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"),
        pytest.raises(DslInvalid) as exc_info,
    ):
        cast(_EndpointView, api.post).__handler__(
            api,
            _CONTEXT,
            workspace_id="workspace-1",
            body=AppDslImportPayload(mode="yaml-content", yaml_content=_raw_dsl(graph)),
        )

    assert import_calls == []
    assert {d.type for d in exc_info.value.details or []} == {IssueCode.GRAPH_INVALID}


@pytest.mark.parametrize("environment_variables", [5, "KEY", [5], [None]])
@pytest.mark.usefixtures("app_query_services", "credentials")
def test_check_refuses_malformed_environment_variables(app: Flask, environment_variables: object) -> None:
    yaml_content = yaml.safe_dump(
        {
            "app": {"mode": "workflow", "name": "x"},
            "workflow": {"graph": {"nodes": [], "edges": []}, "environment_variables": environment_variables},
        }
    )

    with pytest.raises(BadRequest, match="environment_variables"):
        _check(app, DslCheckPayload(yaml_content=yaml_content))


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
        ("draft", 404, "draft_not_found"),
        ("version", 404, "version_not_found"),
        ("draft_version", 404, "version_not_found"),
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
            return cast(_ExportView, AppDslExportApi.get).__handler__(
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

    assert response.status_code == status
    assert (response.get_json()["code"], response.get_json()["status"]) == (error_code, status)
