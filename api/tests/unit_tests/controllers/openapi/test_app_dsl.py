from collections.abc import Callable, Mapping
from typing import Protocol, cast
from uuid import uuid4

import pytest
import yaml
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound

from constants.oauth_bearer import TokenType
from controllers.common.errors import ForbiddenError
from controllers.openapi import app_dsl
from controllers.openapi._contract import op_of
from controllers.openapi._errors import DraftChanged, DraftNotFound, DslInvalid, OpenApiError, VersionNotFound
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
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import AccountSubject
from libs.oauth_bearer import AuthContext
from machinery.context import RequestContext
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.app_dsl_service import AppDslService
from services.entities.dsl_entities import DraftGuardedImportParams, Import, ImportStatus
from services.errors.app import DraftChangedError, IsDraftWorkflowError, WorkflowNotFoundError
from services.errors.base import NoPermissionError
from services.workflow import graph_check
from services.workflow.graph_check import IssueCode, IssueSeverity
from services.workflow.graph_diff import draft_token
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


class _DraftReader:
    """The one `WorkflowService` read the export handler makes, recording when it happens."""

    def __init__(self, draft: Workflow | None, call_order: list[str]) -> None:
        self._draft = draft
        self._call_order = call_order

    def get_draft_workflow(self, **_kwargs: object) -> Workflow | None:
        self._call_order.append("draft_hash")
        return self._draft


def _export_context(session: Session) -> Context:
    auth = AuthContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        subject_email="caller@example.com",
        subject_issuer="dify:account",
        account_id=uuid4(),
        client_id="difyctl",
        token_id=uuid4(),
        expires_at=None,
    )
    ctx = Context(AccountSubject(auth), session, {"app_id": "app-1"})
    ctx._app = App(id="app-1", tenant_id="tenant-1", name="a", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
    return ctx


def test_export_reads_draft_hash_before_building_dsl(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """The hash must describe the draft as of before the export, not after: an edit that
    commits in between would otherwise make a later import silently overwrite it."""
    call_order: list[str] = []
    draft = Workflow(
        tenant_id="tenant-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph='{"nodes": [], "edges": []}',
        features="{}",
        created_by="account-1",
    )

    def fake_export_dsl(**_kwargs: object) -> str:
        call_order.append("export")
        return "app: {}"

    monkeypatch.setattr(AppDslService, "export_dsl", fake_export_dsl)
    monkeypatch.setattr(app_dsl, "WorkflowService", lambda: _DraftReader(draft, call_order))

    api = AppDslExportApi()
    with app.test_request_context("/openapi/v1/apps/app-1/dsl"):
        response, status = cast(_ExportView, api.get).__handler__(
            api, _export_context(sqlite_session), "app-1", query=AppDslExportQuery()
        )

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


@pytest.mark.usefixtures("credentials")
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


@pytest.mark.usefixtures("credentials")
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
    ],
)
def test_export_answers_a_missing_workflow_with_the_openapi_error(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    workflow_id: str | None,
    raised: Exception,
    expected: type[OpenApiError],
) -> None:
    def fake_export_dsl(**_kwargs: object) -> str:
        raise raised

    monkeypatch.setattr(AppDslService, "export_dsl", fake_export_dsl)
    monkeypatch.setattr(app_dsl, "WorkflowService", lambda: _DraftReader(None, []))
    ctx = _export_context(sqlite_session)

    api = AppDslExportApi()
    with app.test_request_context("/openapi/v1/apps/app-1/dsl"), pytest.raises(expected):
        cast(_ExportView, api.get).__handler__(api, ctx, "app-1", query=AppDslExportQuery(workflow_id=workflow_id))


def test_import_hands_the_draft_hash_to_the_save(
    app_query_services: ControllerTestServices, app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(app_dsl, "prepare_import", lambda *_args, **_kwargs: "prepared yaml")
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

    monkeypatch.setattr(app_dsl, "prepare_import", lambda *_args, **_kwargs: "prepared yaml")
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
