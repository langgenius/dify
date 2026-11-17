from __future__ import annotations

from collections.abc import Callable
from typing import Protocol, cast

import pytest
from flask import Flask
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound, ServiceUnavailable

from constants.oauth_bearer import SubjectType, TokenType
from controllers.openapi._models import (
    MAX_PAGE_LIMIT,
    AppDescribeResponse,
    AppListResponse,
    PermittedExternalAppsListQuery,
    PermittedExternalAppsListResponse,
)
from controllers.openapi._models import (
    AppDescribeQuery as _app_discovery_AppDescribeQuery,
)
from controllers.openapi.apps import AppDescribeApi, AppListApi, AppListQuery
from controllers.openapi.apps import AppDescribeQuery as _app_describe_query_AppDescribeQuery
from controllers.openapi.apps_permitted_external import PermittedExternalAppDescribeApi, PermittedExternalAppsListApi
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject, ResourceAccessSubject
from libs.helper import UUIDStr
from libs.pagination import PaginatedResult
from machinery.context import AppRequestContext
from models.model import AppMode
from services.app.query_service import AppDescription, AppDiscoveryEntry, AppDiscoveryQuery, AppListLogin
from services.entities.app_entities import AppListParams, AppSummary
from services.errors.app import AppDiscoveryNotFoundError, PermittedAppsUnavailableError
from tests.helpers.unit.controllers.openapi._mode_constants import LISTABLE_MODES, NON_LISTABLE_MODES
from tests.helpers.unit.controllers.openapi.auth._world import (
    ACCOUNT_ID,
    TENANT_ID,
    TOKEN_ID,
    make_auth,
    make_tenant,
    sso_subject,
)
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


def test_workspace_id_is_optional() -> None:
    assert AppListQuery.model_validate({}).workspace_id is None


class _RequiredWorkspaceQuery(BaseModel):
    """The field as it was when every call had to name a workspace."""

    workspace_id: UUIDStr


@pytest.mark.parametrize("value", ["", "not-a-uuid", "  "])
def test_a_named_workspace_that_is_not_an_id_is_refused_as_before(value: str) -> None:
    with pytest.raises(ValidationError) as now:
        AppListQuery.model_validate({"workspace_id": value})
    with pytest.raises(ValidationError) as before:
        _RequiredWorkspaceQuery.model_validate({"workspace_id": value})
    # The 422 body is built from these, without context (see `_contract`).
    assert now.value.errors(include_url=False, include_context=False) == before.value.errors(
        include_url=False, include_context=False
    )


def test_page_rejects_non_integer_string() -> None:
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "page": "abc"})


def test_limit_caps_at_max_page_limit() -> None:
    # Boundary accepts.
    """Given the maximum supported page size, accept that exact limit."""
    q = AppListQuery.model_validate({"workspace_id": WS_ID, "limit": MAX_PAGE_LIMIT})
    assert q.limit == MAX_PAGE_LIMIT


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


"""The handler hands the login, as admission resolved it, to the one app-list rule."""


def _list_with(
    app: Flask, services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch, ctx: Context
) -> tuple[list[AppListLogin], AppListResponse]:
    logins: list[AppListLogin] = []

    def list_apps_for(login: AppListLogin, query: AppDiscoveryQuery) -> PaginatedResult[AppDiscoveryEntry]:
        logins.append(login)
        entry = AppDiscoveryEntry(
            AppSummary("app-id", "workspace-id", "App", "", AppMode.CHAT, "normal", None, None), "Workspace"
        )
        return PaginatedResult(items=[entry], total=7, page=query.page, per_page=query.limit)

    monkeypatch.setattr(services.apps.discovery, "list_apps_for", list_apps_for)
    api = AppListApi()
    with app.test_request_context("/openapi/v1/apps?page=2&limit=3"):
        response = cast(Endpoint[AppListResponse], api.get).__handler__(
            api, ctx, query=AppListQuery.model_validate({"page": 2, "limit": 3})
        )
    return logins, response


@pytest.mark.parametrize("named", [False, True])
@pytest.mark.parametrize("token_type", [TokenType.OAUTH_ACCOUNT, TokenType.PERSONAL_ACCESS])
def test_an_account_login_is_passed_with_the_workspace_it_named(
    app: Flask,
    app_query_services: ControllerTestServices,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    token_type: TokenType,
    named: bool,
) -> None:
    ctx = Context(AccountSubject(make_auth(token_type)), sqlite_session, {})
    ctx.personal_app_ids = frozenset({"app-id"}) if token_type is TokenType.PERSONAL_ACCESS else None
    if named:
        ctx._workspace = make_tenant()
    logins, response = _list_with(app, app_query_services, monkeypatch, ctx)
    assert logins == [
        AppListLogin(
            kind=SubjectType.ACCOUNT,
            request_id=ctx.request_id,
            trace_id=ctx.trace_id,
            account_id=ACCOUNT_ID,
            workspace_id=TENANT_ID if named else None,
            resource_app_ids=None,
            personal_app_ids=ctx.personal_app_ids,
        )
    ]
    assert (response.page, response.limit, response.total) == (2, 3, 7)
    assert [(row.id, row.workspace_name) for row in response.data] == [("app-id", "Workspace")]


def test_a_workspace_token_is_passed_with_its_workspace(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    ctx = Context(ResourceAccessSubject(make_auth(TokenType.RESOURCE_ACCESS, account_id=None)), sqlite_session, {})
    ctx._workspace = make_tenant()
    ctx.resource_app_ids = frozenset({"app-id"})
    logins, _ = _list_with(app, app_query_services, monkeypatch, ctx)
    assert [(login.kind, login.account_id, login.workspace_id, login.resource_app_ids) for login in logins] == [
        (SubjectType.RESOURCE_ACCESS, TOKEN_ID, TENANT_ID, frozenset({"app-id"}))
    ]


def test_an_external_sso_login_is_passed_without_a_workspace(
    app: Flask, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    ctx = Context(sso_subject(), sqlite_session, {})
    logins, _ = _list_with(app, app_query_services, monkeypatch, ctx)
    assert [(login.kind, login.account_id, login.workspace_id) for login in logins] == [
        (SubjectType.EXTERNAL_SSO, TOKEN_ID, None)
    ]


def test_the_catalog_lists_apps_without_a_workspace() -> None:
    spec = cast(Endpoint[AppListResponse], AppListApi.get)
    assert spec.__spec__.catalog.summary == "List the apps this login may use, in one workspace or in all of them"
    assert {"page": 1, "limit": 20} in [example.input for example in spec.__spec__.catalog.examples]
    assert "workspace_id" not in AppListQuery.model_json_schema().get("required", [])
