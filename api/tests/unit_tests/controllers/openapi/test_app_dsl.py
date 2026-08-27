from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from werkzeug.exceptions import Forbidden

from controllers.openapi import app_dsl as app_dsl_module
from controllers.openapi._models import AppDslImportPayload
from controllers.openapi.app_dsl import AppDslImportApi, AppDslImportConfirmApi
from services.errors.account import NoPermissionError


@pytest.mark.parametrize(
    ("view", "write"),
    [
        (AppDslImportApi.post, False),
        (AppDslImportConfirmApi.post, False),
    ],
    ids=["import", "import_confirm"],
)
def test_import_routes_leave_the_transaction_to_their_own_session(view, write: bool):
    """Neither import route carried `@with_session` before it moved onto
    `@endpoint`: each opens its own `Session` and commits or rolls it back on
    the import's own outcome. `write=False` keeps the router's session — the
    one the requirements read through — out of that decision, exactly as before.
    """
    assert view.__spec__.write is write


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
            api.post.__handler__(api, SimpleNamespace(caller=Mock()), **kwargs)

    assert isinstance(exc_info.value.__cause__, NoPermissionError)
