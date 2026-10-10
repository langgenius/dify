"""Transport mappings over stable admitted contexts."""

from collections.abc import Callable
from typing import Protocol, cast

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound, ServiceUnavailable

from controllers.openapi._models import (
    AppDescribeQuery,
    AppDescribeResponse,
    PermittedExternalAppsListQuery,
    PermittedExternalAppsListResponse,
)
from controllers.openapi.apps import AppDescribeApi
from controllers.openapi.apps_permitted_external import PermittedExternalAppDescribeApi, PermittedExternalAppsListApi
from machinery.context import AppRequestContext
from models.model import AppMode
from services.app.query_service import AppDescription
from services.entities.app_entities import AppSummary
from services.errors.app import AppDiscoveryNotFoundError, PermittedAppsUnavailableError
from tests.unit_tests.controllers.conftest import ControllerTestServices


class Endpoint[T](Protocol):
    __handler__: Callable[..., T]


@pytest.mark.parametrize("api", [AppDescribeApi(), PermittedExternalAppDescribeApi()])
def test_describe_passes_admitted_scope_and_projects_response(
    app: Flask,
    app_query_services: ControllerTestServices,
    monkeypatch: pytest.MonkeyPatch,
    api: AppDescribeApi | PermittedExternalAppDescribeApi,
) -> None:
    context = AppRequestContext(tenant_id="workspace-id", app_id="app-id")
    calls: list[tuple[AppRequestContext, set[str] | None]] = []

    def describe(ctx: AppRequestContext, fields: set[str] | None) -> AppDescription:
        calls.append((ctx, fields))
        return AppDescription(
            AppSummary("app-id", "workspace-id", "App", "", AppMode.CHAT, "normal", None, None), True, None
        )

    monkeypatch.setattr(app_query_services.apps.discovery, "describe", describe)
    with app.test_request_context():
        result = cast(Endpoint[AppDescribeResponse], api.get).__handler__(
            api, context, "app-id", query=AppDescribeQuery.model_validate({"fields": "info"})
        )
    assert calls == [(context, {"info"})]
    assert result.info is not None
    assert result.info.id == "app-id"
    assert result.parameters is None
    assert result.input_schema is None


@pytest.mark.parametrize("api", [AppDescribeApi(), PermittedExternalAppDescribeApi()])
def test_describe_translates_disappearing_app_to_404(
    app: Flask,
    app_query_services: ControllerTestServices,
    monkeypatch: pytest.MonkeyPatch,
    api: AppDescribeApi | PermittedExternalAppDescribeApi,
) -> None:
    def missing(*_args: object) -> AppDescription:
        raise AppDiscoveryNotFoundError("app not found")

    monkeypatch.setattr(app_query_services.apps.discovery, "describe", missing)
    context = AppRequestContext(tenant_id="workspace-id", app_id="app-id")
    with app.test_request_context(), pytest.raises(NotFound, match="app not found"):
        cast(Endpoint[AppDescribeResponse], api.get).__handler__(api, context, "app-id", query=AppDescribeQuery())


def test_external_failure_is_translated_at_http_boundary(
    app: Flask,
    app_query_services: ControllerTestServices,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unavailable(*_args: object) -> None:
        raise PermittedAppsUnavailableError("permitted_apps_unavailable")

    monkeypatch.setattr(app_query_services.apps.discovery, "list_permitted_apps", unavailable)
    api = PermittedExternalAppsListApi()
    with app.test_request_context(), pytest.raises(ServiceUnavailable, match="permitted_apps_unavailable"):
        cast(Endpoint[PermittedExternalAppsListResponse], api.get).__handler__(
            api, query=PermittedExternalAppsListQuery()
        )
