from collections.abc import Callable
from types import SimpleNamespace
from typing import Protocol, cast
from unittest.mock import Mock

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.openapi import app_dsl
from controllers.openapi._contract import op_of
from controllers.openapi._models import (
    AppDslExportQuery,
    AppDslExportResponse,
    AppDslImportPayload,
    AppDslImportResponse,
    Hint,
)
from controllers.openapi.app_dsl import AppDslExportApi, AppDslImportApi, AppDslImportConfirmApi
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import Subject
from extensions.ext_database import db
from machinery.context import RequestContext
from models.model import App, AppMode
from services.app_dsl_service import AppDslService
from services.entities.dsl_entities import Import, ImportStatus
from services.errors.base import NoPermissionError
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
        return SimpleNamespace(unique_hash="graph-only-hash", content_hash="hash-before-edit")

    service = Mock()
    service.get_draft_workflow.side_effect = fake_get_draft_workflow

    monkeypatch.setattr(AppDslService, "export_dsl", fake_export_dsl)
    monkeypatch.setattr(app_dsl, "WorkflowService", lambda: service)
    monkeypatch.setattr(db, "session", lambda: None)

    ctx = Context(cast(Subject, SimpleNamespace()), Mock(), {"app_id": "app-1"})
    ctx._app = App(id="app-1", tenant_id="tenant-1", name="a", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)

    api = AppDslExportApi()
    with app.test_request_context("/openapi/v1/apps/app-1/dsl"):
        response, status = cast(_ExportView, api.get).__handler__(api, ctx, "app-1", query=AppDslExportQuery())

    assert call_order == ["draft_hash", "export"]
    assert response.draft_hash == "hash-before-edit"
    assert status == 200
