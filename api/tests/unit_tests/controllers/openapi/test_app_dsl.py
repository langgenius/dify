from collections.abc import Callable
from typing import Protocol, cast

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.openapi._models import AppDslImportPayload
from controllers.openapi.app_dsl import AppDslImportApi, AppDslImportConfirmApi
from controllers.openapi.auth.spec import EndpointSpec
from machinery.context import RequestContext
from services.errors.account import NoPermissionError
from tests.unit_tests.controllers.conftest import ControllerTestServices


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
