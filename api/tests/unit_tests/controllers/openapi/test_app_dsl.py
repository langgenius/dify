from collections.abc import Callable, Mapping
from contextlib import nullcontext
from types import SimpleNamespace
from typing import Protocol, cast
from unittest.mock import Mock

import pytest
import yaml
from flask import Flask
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.openapi import app_dsl
from controllers.openapi._contract import op_of
from controllers.openapi._errors import DslInvalid
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
from controllers.openapi.auth.subjects import Subject
from machinery.context import RequestContext
from models.model import App, AppMode
from services.app.console_service import ConsoleAppNotFoundError
from services.app_dsl_service import AppDslService
from services.entities.dsl_entities import Import, ImportStatus
from services.errors.base import NoPermissionError
from services.workflow import dsl_import, graph_check
from services.workflow.graph_check import IssueCode, IssueSeverity
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
        with pytest.raises(Forbidden, match="denied") as exc_info:
            cast(_EndpointView, api.post).__handler__(api, context, **kwargs)

    assert isinstance(exc_info.value.__cause__, NoPermissionError)


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


def test_export_reads_draft_hash_before_building_dsl(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """The hash must describe the draft as of before the export, not after: an edit that
    commits in between would otherwise make a later import silently overwrite it."""
    call_order: list[str] = []

    def fake_export_dsl(**_kwargs: object) -> str:
        call_order.append("export")
        return "app: {}"

    def fake_get_draft_workflow(**_kwargs: object) -> SimpleNamespace:
        call_order.append("draft_hash")
        return SimpleNamespace(token="hash-before-edit")

    service = Mock()
    service.get_draft_workflow.side_effect = fake_get_draft_workflow

    monkeypatch.setattr(AppDslService, "export_dsl", fake_export_dsl)
    monkeypatch.setattr(app_dsl, "WorkflowService", lambda: service)
    monkeypatch.setattr(app_dsl, "draft_token", lambda draft: draft.token)

    ctx = Context(cast(Subject, SimpleNamespace()), Mock(), {"app_id": "app-1"})
    ctx._app = App(id="app-1", tenant_id="tenant-1", name="a", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)

    api = AppDslExportApi()
    with app.test_request_context("/openapi/v1/apps/app-1/dsl"):
        response, status = cast(_ExportView, api.get).__handler__(api, ctx, "app-1", query=AppDslExportQuery())

    assert call_order == ["draft_hash", "export"]
    assert response.draft_hash == "hash-before-edit"
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


class _Credentials:
    def __init__(self, problem: str | None) -> None:
        self._problem = problem

    def validate_node_credentials(self, *_args: object, **_kwargs: object) -> None:
        if self._problem:
            raise ValueError(self._problem)


@pytest.fixture
def credentials(monkeypatch: pytest.MonkeyPatch) -> Callable[[str | None], None]:
    monkeypatch.setattr(dsl_import, "session_factory", SimpleNamespace(create_session=nullcontext))

    def set_problem(problem: str | None) -> None:
        monkeypatch.setattr(graph_check, "WorkflowService", lambda: _Credentials(problem))

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
    import_app = Mock()
    monkeypatch.setattr(app_query_services.apps.imports, "import_app", import_app)

    api = AppDslImportApi()
    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"):
        with pytest.raises(DslInvalid) as exc_info:
            cast(_EndpointView, api.post).__handler__(
                api,
                _CONTEXT,
                workspace_id="workspace-1",
                body=AppDslImportPayload(mode="yaml-content", yaml_content=_dsl("workflow", _START, _ANSWER)),
            )

    import_app.assert_not_called()
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
def test_check_uses_the_overwritten_apps_mode(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dsl_import, "require_console_app", lambda *_args: SimpleNamespace(mode=AppMode.ADVANCED_CHAT))

    response = _check(app, DslCheckPayload(yaml_content=_dsl("workflow", _START, _END), app_id="app-1"))

    assert response.valid is False
    assert [(row.code, row.node_id) for row in response.issues] == [(IssueCode.MODE_INCOMPATIBLE, "end")]


@pytest.mark.usefixtures("credentials")
def test_check_answers_404_for_an_app_outside_the_workspace(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    def missing(*_args: object) -> None:
        raise ConsoleAppNotFoundError("App not found")

    monkeypatch.setattr(dsl_import, "require_console_app", missing)

    with pytest.raises(NotFound):
        _check(app, DslCheckPayload(yaml_content=_dsl("workflow", _START), app_id="app-1"))


@pytest.mark.parametrize("yaml_content", [_dsl("chat"), _dsl("future-mode"), "app: [", "- a list"])
@pytest.mark.usefixtures("app_query_services", "credentials")
def test_check_refuses_dsls_it_cannot_read(app: Flask, yaml_content: str) -> None:
    with pytest.raises(BadRequest):
        _check(app, DslCheckPayload(yaml_content=yaml_content))
