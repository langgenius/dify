from __future__ import annotations

from collections.abc import Callable
from typing import Protocol, cast

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import NotFound, ServiceUnavailable

from controllers.openapi._models import (
    MAX_PAGE_LIMIT,
    AppDescribeResponse,
    PermittedExternalAppsListQuery,
    PermittedExternalAppsListResponse,
)
from controllers.openapi._models import (
    AppDescribeQuery as _app_discovery_AppDescribeQuery,
)
from controllers.openapi.apps import AppDescribeApi, AppListQuery
from controllers.openapi.apps import AppDescribeQuery as _app_describe_query_AppDescribeQuery
from controllers.openapi.apps_permitted_external import PermittedExternalAppDescribeApi, PermittedExternalAppsListApi
from machinery.context import AppRequestContext
from models.model import AppMode
from services.app.query_service import AppDescription
from services.app_service import AppListParams
from services.entities.app_entities import AppSummary
from services.errors.app import AppDiscoveryNotFoundError, PermittedAppsUnavailableError
from tests.helpers.unit.controllers.openapi._mode_constants import LISTABLE_MODES, NON_LISTABLE_MODES
from tests.unit_tests.controllers.conftest import ControllerTestServices

"""Unit tests for AppDescribeQuery (`?fields=` allow-list)."""


def test_no_fields_returns_none() -> None:
    q = _app_describe_query_AppDescribeQuery.model_validate({})
    assert q.fields is None


def test_empty_string_returns_none() -> None:
    q = _app_describe_query_AppDescribeQuery.model_validate({"fields": ""})
    assert q.fields is None


def test_single_field() -> None:
    q = _app_describe_query_AppDescribeQuery.model_validate({"fields": "info"})
    assert q.fields == {"info"}


def test_comma_list() -> None:
    q = _app_describe_query_AppDescribeQuery.model_validate({"fields": "info,parameters"})
    assert q.fields == {"info", "parameters"}


def test_whitespace_tolerant() -> None:
    q = _app_describe_query_AppDescribeQuery.model_validate({"fields": " info , input_schema "})
    assert q.fields == {"info", "input_schema"}


def test_unknown_member_rejected() -> None:
    with pytest.raises(ValidationError):
        _app_describe_query_AppDescribeQuery.model_validate({"fields": "garbage"})


def test_unknown_among_known_rejected() -> None:
    with pytest.raises(ValidationError):
        _app_describe_query_AppDescribeQuery.model_validate({"fields": "info,garbage"})


def test_extra_param_forbidden() -> None:
    with pytest.raises(ValidationError):
        _app_describe_query_AppDescribeQuery.model_validate({"fields": "info", "page": "1"})


"""Transport mappings over stable admitted contexts."""


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
            api, context, "app-id", query=_app_discovery_AppDescribeQuery.model_validate({"fields": "info"})
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
        cast(Endpoint[AppDescribeResponse], api.get).__handler__(
            api, context, "app-id", query=_app_discovery_AppDescribeQuery()
        )


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


"""Unit tests for AppListQuery — the /apps query-param validator.

Runs against the model directly, not the HTTP layer. Pins:
- defaults match the plan (page=1, limit=20).
- workspace_id is required.
- numeric bounds enforced (page >= 1, limit in [1, MAX_PAGE_LIMIT]).
- mode validates against the SupportedAppType enum (listable app types only).
- name has a length cap.
"""


WS_ID = "00000000-0000-0000-0000-000000000001"


def test_defaults() -> None:
    q = AppListQuery.model_validate({"workspace_id": WS_ID})
    assert q.workspace_id == WS_ID
    assert q.page == 1
    assert q.limit == 20
    assert q.mode is None
    assert q.name is None


def test_workspace_id_required() -> None:
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({})


def test_page_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "page": 0})
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "page": -1})


def test_page_rejects_non_integer_string() -> None:
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "page": "abc"})


def test_limit_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "limit": 0})
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "limit": -1})


def test_limit_caps_at_max_page_limit() -> None:
    # Boundary accepts.
    q = AppListQuery.model_validate({"workspace_id": WS_ID, "limit": MAX_PAGE_LIMIT})
    assert q.limit == MAX_PAGE_LIMIT

    # Just over rejects.
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "limit": MAX_PAGE_LIMIT + 1})


@pytest.mark.parametrize("mode", LISTABLE_MODES)
def test_mode_accepts_listable_app_types(mode: str) -> None:
    q = AppListQuery.model_validate({"workspace_id": WS_ID, "mode": mode})
    assert q.mode is not None
    assert q.mode.value == mode


def test_mode_rejects_unknown_value() -> None:
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "mode": "not-a-mode"})


@pytest.mark.parametrize("mode", NON_LISTABLE_MODES)
def test_mode_rejects_non_listable_app_modes(mode: str) -> None:
    """rag-pipeline (a knowledge Pipeline), channel (unused) and agent (roster-owned)
    are AppMode members but not standalone listable apps — the `app` face rejects them."""
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "mode": mode})


def test_name_length_capped() -> None:
    AppListQuery.model_validate({"workspace_id": WS_ID, "name": "x" * 200})
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "name": "x" * 201})


def test_all_fields_accept_valid_values() -> None:
    """Pin the happy-path acceptance for every field in one place."""
    q = AppListQuery.model_validate(
        {
            "workspace_id": WS_ID,
            "page": 5,
            "limit": 50,
            "mode": "workflow",
            "name": "search",
        }
    )
    assert q.workspace_id == WS_ID
    assert q.page == 5
    assert q.limit == 50
    assert q.mode is not None
    assert q.mode.value == "workflow"
    assert q.name == "search"


def test_max_page_limit_is_accepted_by_the_app_service() -> None:
    # The catalog advertises MAX_PAGE_LIMIT; the service model must not reject it.
    assert AppListParams(limit=MAX_PAGE_LIMIT).limit == MAX_PAGE_LIMIT
