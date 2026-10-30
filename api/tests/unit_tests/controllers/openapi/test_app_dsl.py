import json
import zipfile
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from io import BytesIO
from typing import BinaryIO, Protocol, cast
from uuid import uuid4

import pytest
import yaml
from flask import Flask, Response, request
from flask_restx import Resource
from pydantic import ValidationError
from sqlalchemy import Engine, delete, func, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import BadRequest, NotFound

from configs import dify_config
from controllers.common.errors import ForbiddenError, NotFoundError
from controllers.openapi import app_dsl
from controllers.openapi._contract import accepts, op_of
from controllers.openapi._errors import (
    AppPackageInvalid,
    AppPackageTooLarge,
    DraftChanged,
    DraftNotFound,
    DslInvalid,
    InvalidFilePart,
    OpenApiError,
    OpenApiErrorCode,
    OpenApiErrorFormatter,
    VersionNotFound,
)
from controllers.openapi._models import (
    AppDslExportQuery,
    AppDslExportResponse,
    AppDslImportPayload,
    AppDslImportResponse,
    AppPackageExportQuery,
    AppPackageImportPayload,
    DslCheckPayload,
    DslCheckResponse,
    Hint,
)
from controllers.openapi._upload import UploadPart, UploadParts
from controllers.openapi.app_dsl import (
    _PACKAGE_UPLOAD,
    AppDslCheckApi,
    AppDslExportApi,
    AppDslImportApi,
    AppDslImportConfirmApi,
    AppPackageExportApi,
    AppPackageImportApi,
)
from controllers.openapi.auth.spec import EndpointSpec
from libs.external_api import ExternalApi
from machinery.context import AppRequestContext, RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import WorkflowAgentBindingType
from models.model import App, AppMode
from models.skill import AgentSkillBinding, Skill
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowType
from repositories.app.export_repository import AppExportRepository
from services.agent.errors import InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError
from services.agent.roster_package_entities import RosterAgentPackageExport
from services.app.console_service import ConsoleAppNotFoundError
from services.app.export_service import AppExportService
from services.app_dsl_service import AppDslService
from services.app_package_service import AppPackageService
from services.entities.app_entities import AppExportOptions
from services.entities.dsl_entities import DraftGuardedImportParams, Import, ImportMode, ImportStatus
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
from tests.helpers.unit.model_factories import make_account, make_app, make_tenant, make_workflow
from tests.unit_tests.controllers.conftest import ControllerTestServices
from tests.unit_tests.services.test_app_package_service import (
    _add_roster_node,
    _bind_second_workspace_skill,
    _bindings_by_node,
    _bundle_any_app,
    _package_storage,
    _skill_section,
    _source,
)


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
        _features="{}",
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
    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"):
        with pytest.raises(DslInvalid) as exc_info:
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

    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"):
        with pytest.raises(DraftChanged) as exc_info:
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
    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"):
        with pytest.raises(DslInvalid) as exc_info:
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
                _features="{}",
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


class _PackageView(Protocol):
    __handler__: Callable[..., Response]


_WORKFLOW_ID = "6f1c2a52-0d43-4f7e-9a3b-1c2d3e4f5a6b"


def _export_package(app: Flask, query: AppPackageExportQuery) -> Response:
    api = AppPackageExportApi()
    with app.test_request_context("/openapi/v1/apps/app-1/package"):
        return cast(_PackageView, api.get).__handler__(api, _CONTEXT, "app-1", query=query)


def _stub_package_export(
    monkeypatch: pytest.MonkeyPatch, app_query_services: ControllerTestServices
) -> tuple[list[AppExportOptions], RosterAgentPackageExport]:
    seen: list[AppExportOptions] = []
    package = RosterAgentPackageExport(archive=BytesIO(b"zip-bytes"), filename="release-summary.ifpkg", size=9)

    def export(context: RequestContext, _app_id: str, options: AppExportOptions) -> RosterAgentPackageExport:
        assert context == _CONTEXT
        seen.append(options)
        return package

    monkeypatch.setattr(app_query_services.apps.console, "export", export)
    return seen, package


@pytest.mark.parametrize("view", [AppPackageExportApi.get, AppPackageImportApi.post])
def test_package_routes_run_in_the_workspace_context(view: Callable[..., object]) -> None:
    assert cast(_EndpointView, view).__spec__.context == "workspace"


def test_package_export_sends_the_ifpkg_as_an_attachment(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen, _package = _stub_package_export(monkeypatch, app_query_services)

    response = _export_package(app, AppPackageExportQuery())

    assert response.mimetype == "application/zip"
    assert "release-summary.ifpkg" in response.headers["Content-Disposition"]
    assert (seen[0].format, seen[0].preserve_agent_bindings) == ("ifpkg", True)


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        (AppPackageExportQuery(preserve_agent_bindings=False), {"preserve_agent_bindings": False}),
        (AppPackageExportQuery(workflow_id=_WORKFLOW_ID), {"workflow_id": _WORKFLOW_ID}),
        (AppPackageExportQuery(include_secret=True), {"include_secret": True}),
    ],
)
def test_package_export_passes_the_query_through(
    app: Flask,
    app_query_services: ControllerTestServices,
    monkeypatch: pytest.MonkeyPatch,
    query: AppPackageExportQuery,
    expected: dict[str, object],
) -> None:
    seen, _package = _stub_package_export(monkeypatch, app_query_services)

    _export_package(app, query)

    assert expected.items() <= asdict(seen[0]).items()


def test_package_export_closes_the_package_when_sending_fails(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch
) -> None:
    _seen, package = _stub_package_export(monkeypatch, app_query_services)

    def fail(*_args: object, **_kwargs: object) -> Response:
        raise OSError("disk gone")

    monkeypatch.setattr(app_dsl, "send_file", fail)

    with pytest.raises(OSError, match="disk gone"):
        _export_package(app, AppPackageExportQuery())

    assert package.archive.closed


@pytest.mark.parametrize(
    ("workflow_id", "raised", "expected"),
    [
        (_WORKFLOW_ID, WorkflowNotFoundError("no version"), VersionNotFound),
        (_WORKFLOW_ID, IsDraftWorkflowError("draft"), VersionNotFound),
        (None, WorkflowNotFoundError("no draft"), DraftNotFound),
        (None, ConsoleAppNotFoundError("app not found"), NotFound),
    ],
)
def test_package_export_answers_a_missing_version_with_the_openapi_error(
    app: Flask,
    app_query_services: ControllerTestServices,
    monkeypatch: pytest.MonkeyPatch,
    workflow_id: str | None,
    raised: Exception,
    expected: type[Exception],
) -> None:
    def export(*_args: object) -> RosterAgentPackageExport:
        raise raised

    monkeypatch.setattr(app_query_services.apps.console, "export", export)

    with pytest.raises(expected):
        _export_package(app, AppPackageExportQuery(workflow_id=workflow_id))


_OVERWRITTEN_APP_ID = "7a1c2a52-0d43-4f7e-9a3b-1c2d3e4f5a6b"
_COMPLETED = Import(id="import-1", status=ImportStatus.COMPLETED, app_id="app-1")


def _part(data: bytes, filename: str = "app.ifpkg") -> FileStorage:
    return FileStorage(stream=BytesIO(data), filename=filename)


def _folder(files: Mapping[str, bytes]) -> UploadParts:
    return {path: _part(data, path.rsplit("/", 1)[-1]) for path, data in files.items()}


def _import_package(
    app: Flask, body: AppPackageImportPayload, *, context: RequestContext = _CONTEXT
) -> tuple[AppDslImportResponse, int]:
    api = AppPackageImportApi()
    workspace_id = context.active_workspace_id
    with app.test_request_context(f"/openapi/v1/workspaces/{workspace_id}/apps/packages", method="POST"):
        return cast(_EndpointView, api.post).__handler__(api, context, workspace_id=workspace_id, body=body)


@dataclass(frozen=True)
class _PackageImportCall:
    params: DraftGuardedImportParams
    source: BinaryIO
    content: bytes
    preserve_agent_bindings: bool
    prepare_dsl: Callable[[str], str]


def _recorded_package_import(
    monkeypatch: pytest.MonkeyPatch,
    services: ControllerTestServices,
    outcome: Import | Exception = _COMPLETED,
) -> list[_PackageImportCall]:
    calls: list[_PackageImportCall] = []

    def import_app(
        context: RequestContext,
        params: DraftGuardedImportParams,
        *,
        source: BinaryIO,
        preserve_agent_bindings: bool,
        prepare_dsl: Callable[[str], str],
    ) -> Import:
        assert context == _CONTEXT
        calls.append(_PackageImportCall(params, source, source.read(), preserve_agent_bindings, prepare_dsl))
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(services.apps.console, "import_app", import_app)
    return calls


@pytest.mark.parametrize("filename", ["app.ifpkg", "app.zip"])
def test_package_import_reads_a_file_part_as_the_package(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch, filename: str
) -> None:
    calls = _recorded_package_import(monkeypatch, app_query_services)

    _response, status = _import_package(
        app, AppPackageImportPayload(package=_part(b"ifpkg-bytes", filename), name="Renamed")
    )

    [call] = calls
    assert (status, call.content, call.preserve_agent_bindings) == (200, b"ifpkg-bytes", True)
    assert (call.params.mode, call.params.name, call.params.app_id) == (ImportMode.YAML_CONTENT, "Renamed", None)


def test_package_import_builds_a_folder_into_the_package(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _recorded_package_import(monkeypatch, app_query_services)
    files = {"manifest.yaml": b"m", "app.yaml": b"a", "agents/a_000001/soul.yaml": b"s", ".DS_Store": b"junk"}

    _import_package(
        app,
        AppPackageImportPayload(package=_folder(files), app_id=_OVERWRITTEN_APP_ID, draft_hash="exported"),
    )

    [call] = calls
    with zipfile.ZipFile(BytesIO(call.content)) as archive:
        assert archive.namelist() == ["agents/a_000001/soul.yaml", "app.yaml", "manifest.yaml"]
    assert (call.params.app_id, call.params.draft_hash, call.preserve_agent_bindings) == (
        _OVERWRITTEN_APP_ID,
        "exported",
        True,
    )
    assert call.source.closed


@pytest.mark.parametrize(
    ("package", "max_entries", "outcome", "expected", "code", "error_code", "mentions"),
    [
        pytest.param(
            {"app.yaml": b"a", "agents/../../escape.yaml": b"x"},
            2,
            _COMPLETED,
            AppPackageInvalid,
            400,
            OpenApiErrorCode.APP_PACKAGE_INVALID,
            "agents/../../escape.yaml",
            id="unsafe-path",
        ),
        pytest.param(
            {"app.yaml": b"a", "manifest.yaml": b"m"},
            1,
            _COMPLETED,
            AppPackageTooLarge,
            413,
            OpenApiErrorCode.REQUEST_TOO_LARGE,
            "The package folder has more than 1 files",
            id="too-many-entries",
        ),
        pytest.param(
            {"app.yaml": b"a"},
            1,
            InvalidRosterAgentPackageError("member hash mismatch"),
            AppPackageInvalid,
            400,
            OpenApiErrorCode.APP_PACKAGE_INVALID,
            "member hash mismatch",
            id="reader-refuses",
        ),
        pytest.param(
            {"app.yaml": b"a"},
            1,
            RosterAgentPackageTooLargeError("App package exceeds the size limit"),
            AppPackageTooLarge,
            413,
            OpenApiErrorCode.REQUEST_TOO_LARGE,
            "App package exceeds the size limit",
            id="reader-too-large",
        ),
    ],
)
def test_package_import_rejections(
    app: Flask,
    app_query_services: ControllerTestServices,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    package: Mapping[str, bytes],
    max_entries: int,
    outcome: Import | Exception,
    expected: type[OpenApiError],
    code: int,
    error_code: OpenApiErrorCode,
    mentions: str,
) -> None:
    config_overrides(AGENT_PACKAGE_MAX_ENTRIES=max_entries)
    _recorded_package_import(monkeypatch, app_query_services, outcome)

    with pytest.raises(expected) as exc_info:
        _import_package(app, AppPackageImportPayload(package=_folder(package)))

    body = OpenApiErrorFormatter().finalize(exc_info.value, {"message": exc_info.value.description}, code)
    assert (body["status"], body["code"]) == (code, error_code)
    assert mentions in str(body)


def test_package_import_permission_denial_maps_to_forbidden(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch
) -> None:
    _recorded_package_import(monkeypatch, app_query_services, NoPermissionError("denied"))

    with pytest.raises(ForbiddenError, match="denied") as exc_info:
        _import_package(app, AppPackageImportPayload(package=_part(b"ifpkg-bytes")))

    assert isinstance(exc_info.value.__cause__, NoPermissionError)
    assert exc_info.value.code == 403


def test_package_import_refuses_a_path_sent_twice(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _recorded_package_import(monkeypatch, app_query_services)
    twice: UploadParts = {"app.yaml": [_part(b"a"), _part(b"b")]}

    with pytest.raises(InvalidFilePart, match="app.yaml") as exc_info:
        _import_package(app, AppPackageImportPayload(package=twice))

    assert (exc_info.value.code, calls) == (422, [])


@pytest.mark.parametrize(
    ("fields", "loc"),
    [
        pytest.param({}, ("package",), id="no-package"),
        pytest.param({"package": _part(b"x"), "draft_hash": "exported"}, (), id="draft-hash-without-app-id"),
        pytest.param({"package": _part(b"x"), "app_id": "not-a-uuid"}, ("app_id",), id="non-uuid-app-id"),
        pytest.param({"package": _part(b"x"), "mode": "yaml-url"}, ("mode",), id="unknown-field"),
    ],
)
def test_package_import_payload_rejects_bad_input(fields: dict[str, object], loc: tuple[str, ...]) -> None:
    with pytest.raises(ValidationError) as exc_info:
        AppPackageImportPayload.model_validate(fields)

    assert [error["loc"] for error in exc_info.value.errors()] == [loc]


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        pytest.param({"package": (BytesIO(b"zip"), "app.ifpkg")}, FileStorage, id="file"),
        pytest.param(
            {"package[app.yaml]": (BytesIO(b"a"), "app.yaml"), "package[agents/x.md]": (BytesIO(b"x"), "x.md")},
            dict,
            id="folder",
        ),
    ],
)
def test_package_import_parses_a_file_or_a_folder_from_multipart(
    app: Flask, data: dict[str, object], expected: type
) -> None:
    @accepts(body=AppPackageImportPayload)
    def handler(*, body: AppPackageImportPayload) -> UploadPart | UploadParts:
        return body.package

    with app.test_request_context("/x", method="POST", data=data, content_type="multipart/form-data"):
        assert isinstance(handler(), expected)


@pytest.mark.usefixtures("credentials")
def test_package_import_prepare_runs_the_yaml_checks(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    sqlite_session.add(
        App(
            id=_OVERWRITTEN_APP_ID,
            tenant_id="workspace-1",
            name="a",
            mode=AppMode.WORKFLOW,
            enable_site=True,
            enable_api=True,
        )
    )
    sqlite_session.commit()
    calls = _recorded_package_import(monkeypatch, app_query_services)
    _import_package(app, AppPackageImportPayload(package=_part(b"x"), app_id=_OVERWRITTEN_APP_ID))
    _import_package(app, AppPackageImportPayload(package=_part(b"x"), app_id=_OVERWRITTEN_APP_ID, draft_hash="stale"))
    [unguarded, stale] = calls

    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/packages", method="POST"):
        with pytest.raises(DslInvalid) as exc_info:
            unguarded.prepare_dsl(_dsl("workflow", _START, _ANSWER))
        with pytest.raises(DraftChanged):
            stale.prepare_dsl(_dsl("workflow", _START, _END))

    assert [(h.op, h.input["app_id"]) for h in exc_info.value.hints or []] == [
        (op_of(AppDslCheckApi.post), _OVERWRITTEN_APP_ID)
    ]


@pytest.mark.parametrize(
    ("result", "status", "hint_ops"),
    [
        pytest.param(
            Import(id="import-1", status=ImportStatus.PENDING), 202, [op_of(AppDslImportConfirmApi.post)], id="pending"
        ),
        pytest.param(Import(id="import-2", status=ImportStatus.COMPLETED, app_id="app-2"), 200, [], id="completed"),
        pytest.param(Import(id="import-3", status=ImportStatus.FAILED, error="bad"), 400, [], id="failed"),
    ],
)
def test_package_import_hints_a_confirm_only_while_pending(
    app: Flask,
    app_query_services: ControllerTestServices,
    monkeypatch: pytest.MonkeyPatch,
    result: Import,
    status: int,
    hint_ops: list[str],
) -> None:
    _recorded_package_import(monkeypatch, app_query_services, result)

    response, code = _import_package(app, AppPackageImportPayload(package=_part(b"x")))

    assert (code, [h.op for h in response.hints]) == (status, hint_ops)


@pytest.mark.parametrize(
    ("raised", "expected"),
    [(NoPermissionError("denied"), ForbiddenError), (DraftChangedError(), DraftChanged)],
)
def test_package_import_maps_service_refusals(
    app: Flask,
    app_query_services: ControllerTestServices,
    monkeypatch: pytest.MonkeyPatch,
    raised: Exception,
    expected: type[Exception],
) -> None:
    _recorded_package_import(monkeypatch, app_query_services, raised)

    with pytest.raises(expected):
        _import_package(app, AppPackageImportPayload(package=_part(b"x")))


def test_package_upload_cap_counts_entries_and_fields(config_overrides: Callable[..., None]) -> None:
    assert _PACKAGE_UPLOAD.parts() == dify_config.AGENT_PACKAGE_MAX_ENTRIES + 7
    config_overrides(AGENT_PACKAGE_MAX_ENTRIES=3)
    assert _PACKAGE_UPLOAD.parts() == 10


_TOOL_PROVIDER_ID = "8b1c2a52-0d43-4f7e-9a3b-1c2d3e4f5a6b"


def _add_workflow_tool(session: Session, app: App) -> None:
    """A published workflow App exposed as a Workflow Tool, called by a tool node in ``app``'s draft."""
    tool_app = make_app(app_id=str(uuid4()), tenant_id=app.tenant_id, mode=AppMode.WORKFLOW, name="Summarize")
    published = make_workflow(
        app_id=tool_app.id,
        tenant_id=app.tenant_id,
        version="2026-01-01 00:00:00",
        graph={"nodes": [_START, _END], "edges": []},
    )
    provider = WorkflowToolProvider(
        name="summarize",
        label="Summarize",
        icon='{"background": "#FFEAD5", "content": "S"}',
        app_id=tool_app.id,
        version=published.version,
        user_id="account-1",
        tenant_id=app.tenant_id,
        description="Summarize a document",
    )
    provider.id = _TOOL_PROVIDER_ID
    draft = _draft(session, app.id)
    graph = draft.graph_dict
    graph["nodes"].append(
        {
            "id": "node-4",
            "data": {
                "type": "tool",
                "title": "Summarize",
                "provider_id": _TOOL_PROVIDER_ID,
                "provider_type": "workflow",
                "provider_name": _TOOL_PROVIDER_ID,
                "tool_name": "summarize",
                "tool_label": "Summarize",
                "tool_configurations": {},
                "tool_parameters": {},
            },
        }
    )
    draft.graph = json.dumps(graph)
    session.add_all([tool_app, published, provider])
    session.commit()


def _draft(session: Session, app_id: str) -> Workflow:
    return session.scalars(
        select(Workflow).where(Workflow.app_id == app_id, Workflow.version == Workflow.VERSION_DRAFT)
    ).one()


def _owner_context(session: Session, tenant_id: str) -> RequestContext:
    """A request from the owner of the workspace that ``tenant_id`` names."""
    tenant = make_tenant(tenant_id=tenant_id)
    account = make_account(tenant=tenant)
    session.add_all(
        [
            tenant,
            account,
            TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, current=True, role=TenantAccountRole.OWNER),
        ]
    )
    session.commit()
    return RequestContext("request-1", None, account.id, tenant.id)


def _export_folder(source: App) -> tuple[bytes, UploadParts]:
    """Export ``source`` keeping its links, as the archive and as the unpacked folder's parts."""
    with AppPackageService().export_app(
        may_bundle=_bundle_any_app, app_model=source, preserve_agent_bindings=True
    ) as exported:
        content = exported.archive.read()
    with zipfile.ZipFile(BytesIO(content)) as archive:
        return content, {name: _part(archive.read(name), name) for name in archive.namelist()}


@pytest.mark.usefixtures("app_query_services", "credentials")
def test_package_import_round_trips_an_unpacked_export_onto_its_app(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_engine: Engine,
) -> None:
    """Export an App with inline Agents, a skill, a workspace skill, a roster node and a Workflow Tool through
    the real package service, unzip it into folder parts, and import them over the same App through the real
    console import. Only the storage backend, dependency analysis and the credential check are stubbed.
    """
    storage = _package_storage(monkeypatch, sqlite_engine)
    monkeypatch.setattr(
        "services.app_dsl_service.WorkflowAgentRetirementService.retire_unowned", lambda **_kwargs: None
    )
    source = _source(sqlite_session, storage, app_id=_OVERWRITTEN_APP_ID)
    _add_roster_node(sqlite_session, source)
    _add_workflow_tool(sqlite_session, source)
    context = _owner_context(sqlite_session, source.tenant_id)
    source_graph = _draft(sqlite_session, source.id).graph_dict
    draft_hash = current_draft_token(source.tenant_id, source.id)
    exported, folder = _export_folder(source)

    response, status = _import_package(
        app, AppPackageImportPayload(package=folder, app_id=source.id, draft_hash=draft_hash), context=context
    )

    assert {"w_000001.ifpkg", "s_000003.zip"} <= folder.keys()
    assert (status, response.status, response.app_id) == (200, ImportStatus.COMPLETED, source.id), response.error
    sqlite_session.expire_all()
    imported_graph = _draft(sqlite_session, source.id).graph_dict
    imported_nodes = {node["id"]: node["data"] for node in imported_graph["nodes"]}
    assert imported_graph["edges"] == source_graph["edges"]
    assert imported_nodes.keys() == {node["id"] for node in source_graph["nodes"]}
    # The import adds each Agent node's binding and the node defaults; it keeps every value the source had.
    for node in source_graph["nodes"]:
        assert node["data"].items() <= imported_nodes[node["id"]].items()
    rows = _bindings_by_node(sqlite_session, source.id)
    assert (rows["node-3"].binding_type, rows["node-3"].agent_id) == (
        WorkflowAgentBindingType.ROSTER_AGENT,
        "roster-agent-1",
    )
    assert {rows["node-1"].binding_type, rows["node-2"].binding_type} == {WorkflowAgentBindingType.INLINE_AGENT}
    assert sqlite_session.scalar(select(func.count()).select_from(WorkflowToolProvider)) == 1
    # The inline Agent stays linked to the same workspace skill rather than holding a copy of it.
    skill_links = sqlite_session.scalars(
        select(AgentSkillBinding.skill_id).where(AgentSkillBinding.agent_id == rows["node-1"].agent_id)
    ).all()
    assert skill_links == ["source-workspace-skill"]
    reexported, _folder = _export_folder(source)
    assert _skill_section(reexported) == _skill_section(exported)
    assert _skill_section(reexported)[2] == ["research"]


@pytest.mark.usefixtures("app_query_services", "credentials")
def test_package_import_refuses_links_to_missing_skills_before_any_write(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_engine: Engine,
) -> None:
    storage = _package_storage(monkeypatch, sqlite_engine)
    source = _source(sqlite_session, storage, app_id=_OVERWRITTEN_APP_ID)
    _bind_second_workspace_skill(sqlite_session, storage)
    _add_workflow_tool(sqlite_session, source)
    context = _owner_context(sqlite_session, source.tenant_id)
    source_graph = _draft(sqlite_session, source.id).graph_dict
    _exported, folder = _export_folder(source)
    sqlite_session.execute(delete(Skill))
    sqlite_session.commit()
    apps = sqlite_session.scalar(select(func.count()).select_from(App))

    with pytest.raises(AppPackageInvalid) as exc_info:
        _import_package(app, AppPackageImportPayload(package=folder, app_id=source.id), context=context)

    assert storage.saved == []
    assert sqlite_session.scalar(select(func.count()).select_from(App)) == apps
    sqlite_session.expire_all()
    assert _draft(sqlite_session, source.id).graph_dict == source_graph
    body = OpenApiErrorFormatter().finalize(exc_info.value, {"message": exc_info.value.description}, 400)
    assert (body["status"], body["code"]) == (400, OpenApiErrorCode.APP_PACKAGE_INVALID)
    assert body["hint"] == (
        "Import each missing skill into the Skill Hub first, "
        "or export the app with preserve_agent_bindings=false to bundle a copy."
    )
    assert body["details"] == [
        {
            "type": "workspace_skill_not_found",
            "loc": ["workspace_skills", name],
            "msg": f'Workspace Skill "{name}" is not in this workspace.',
        }
        for name in ("second", "workspace")
    ]
