from collections.abc import Callable
from types import SimpleNamespace
from typing import Protocol, cast
from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from werkzeug.exceptions import Forbidden

from controllers.openapi import app_dsl as app_dsl_module
from controllers.openapi._contract import op_of
from controllers.openapi._models import AppDslImportPayload, Hint
from controllers.openapi.app_dsl import AppDslImportApi, AppDslImportConfirmApi
from controllers.openapi.auth.spec import EndpointSpec
from models import Account
from services.app_dsl_service import Import
from services.entities.dsl_entities import ImportStatus
from services.errors.account import NoPermissionError


class _EndpointView(Protocol):
    """Structural stand-in for a `view` carrying the attributes `@endpoint` attaches."""

    __spec__: EndpointSpec
    __handler__: Callable[..., object]


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
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    api: AppDslImportApi | AppDslImportConfirmApi,
    kwargs: dict[str, object],
) -> None:
    service = Mock()
    service.import_app.side_effect = NoPermissionError("denied")
    service.confirm_import.side_effect = NoPermissionError("denied")
    monkeypatch.setattr(app_dsl_module, "AppDslService", Mock(return_value=service))
    monkeypatch.setattr(app_dsl_module, "db", SimpleNamespace(engine=sqlite_engine))

    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"):
        with pytest.raises(Forbidden, match="denied") as exc_info:
            cast(_EndpointView, api.post).__handler__(api, SimpleNamespace(account=Mock(spec=Account)), **kwargs)

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
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, result: Import, status: int, hints: list[Hint]
) -> None:
    service = Mock()
    service.import_app.return_value = result
    monkeypatch.setattr(app_dsl_module, "AppDslService", Mock(return_value=service))
    monkeypatch.setattr(app_dsl_module, "db", SimpleNamespace(engine=sqlite_engine))

    api = AppDslImportApi()
    with app.test_request_context("/openapi/v1/workspaces/workspace-1/apps/imports", method="POST"):
        response, code = cast(_EndpointView, api.post).__handler__(
            api,
            SimpleNamespace(account=Mock(spec=Account)),
            workspace_id="workspace-1",
            body=AppDslImportPayload(mode="yaml-content", yaml_content="app: {}"),
        )

    assert (code, response.hints) == (status, hints)
