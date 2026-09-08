import base64
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from werkzeug.exceptions import BadRequest, Forbidden

from controllers.openapi import app_dsl as app_dsl_module
from controllers.openapi._models import AppDslExportQuery, AppDslImportPayload
from controllers.openapi.app_dsl import AppDslExportApi, AppDslImportApi, AppDslImportConfirmApi
from services.errors.account import NoPermissionError


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
            unwrap(api.post)(api, auth_data=SimpleNamespace(caller=Mock()), **kwargs)

    assert isinstance(exc_info.value.__cause__, NoPermissionError)


@pytest.mark.parametrize("bundle", [None, b"PK\x03\x04bundle"])
def test_export_workflow_tools_returns_zip_or_yaml(monkeypatch: pytest.MonkeyPatch, bundle: bytes | None) -> None:
    session = Mock()
    account = Mock()
    app_model = Mock()
    bundle_service = Mock()
    bundle_service.export_bundle.return_value = bundle
    monkeypatch.setattr(app_dsl_module, "WorkflowDslBundleService", Mock(return_value=bundle_service))
    dsl_service = Mock()
    dsl_service.export_dsl.return_value = "app: {}"
    monkeypatch.setattr(app_dsl_module, "AppDslService", dsl_service)
    monkeypatch.setattr(app_dsl_module, "db", SimpleNamespace(session=Mock(return_value=session)))
    api = AppDslExportApi()
    query = AppDslExportQuery(include_workflow_tools=True, include_secret=True)

    response, status = unwrap(api.get)(
        api, "app-1", auth_data=SimpleNamespace(caller=account, app=app_model), query=query
    )

    assert status == 200
    assert response.format == ("zip" if bundle is not None else "yaml")
    assert response.data == (base64.b64encode(bundle).decode("ascii") if bundle is not None else "app: {}")
    bundle_service.export_bundle.assert_called_once_with(
        app_model=app_model, account=account, include_secret=True, workflow_id=None
    )
    assert dsl_service.export_dsl.called is (bundle is None)


def test_bundle_import_payload_requires_base64_content() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="yaml_content is required"):
        AppDslImportPayload(mode="bundle-content")
    payload = AppDslImportPayload(mode="bundle-content", yaml_content="UEsDBA==")
    assert payload.mode == "bundle-content"


@pytest.mark.parametrize(
    ("error", "response_error"), [(NoPermissionError("denied"), Forbidden), (ValueError("invalid bundle"), BadRequest)]
)
def test_bundle_export_maps_errors(
    monkeypatch: pytest.MonkeyPatch, error: Exception, response_error: type[Exception]
) -> None:
    bundle_service = Mock()
    bundle_service.export_bundle.side_effect = error
    monkeypatch.setattr(app_dsl_module, "WorkflowDslBundleService", Mock(return_value=bundle_service))
    monkeypatch.setattr(app_dsl_module, "db", SimpleNamespace(session=Mock()))
    api = AppDslExportApi()
    with pytest.raises(response_error, match=str(error)):
        unwrap(api.get)(
            api,
            "app-1",
            auth_data=SimpleNamespace(caller=Mock(), app=Mock()),
            query=AppDslExportQuery(include_workflow_tools=True),
        )
