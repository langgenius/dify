from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from werkzeug.exceptions import Forbidden

from controllers.openapi import app_dsl as app_dsl_module
from controllers.openapi._models import AppDslImportPayload
from controllers.openapi.app_dsl import (
    AppDslCheckDependenciesApi,
    AppDslExportApi,
    AppDslImportApi,
    AppDslImportConfirmApi,
)
from models import Account
from services.errors.account import NoPermissionError


@pytest.mark.parametrize(
    ("view", "write"),
    [
        (AppDslImportApi.post, False),
        (AppDslImportConfirmApi.post, False),
        (AppDslExportApi.get, False),
        (AppDslCheckDependenciesApi.get, False),
    ],
    ids=["import", "import_confirm", "export", "check_dependencies"],
)
def test_dsl_routes_leave_the_transaction_to_their_own_session(view, write: bool):
    """None of the four carried `@with_session` before moving onto `@endpoint`:
    the imports open their own `Session` and commit or roll it back on the
    import's own outcome, and the two reads never had a router-owned
    transaction at all. `write=False` keeps the router's session — the one the
    requirements read through — out of that decision, exactly as before.
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
            api.post.__handler__(api, SimpleNamespace(caller=Mock(spec=Account)), **kwargs)

    assert isinstance(exc_info.value.__cause__, NoPermissionError)
