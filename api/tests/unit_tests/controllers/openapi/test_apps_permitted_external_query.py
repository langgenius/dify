"""Unit tests for the /permitted-external-apps routes.

`PermittedExternalAppsListQuery` is strict (`ConfigDict(extra='forbid')`):
cross-tenant tag/workspace_id are unresolvable, so the model must reject them as
422 instead of silently dropping them. Mode/name/page/limit have the same shape
as AppListQuery.

The allow/deny answers live in `test_auth_matrix.py`; what is pinned here is what
each route declares — the transaction boundary, and which of the two carries
`CheckAppAccess`.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from controllers.openapi.apps_permitted_external import (
    PermittedExternalAppDescribeApi,
    PermittedExternalAppsListApi,
    PermittedExternalAppsListQuery,
)
from controllers.openapi.auth.requirements import CheckAppAccess
from models.model import App, AppMode

from ._mode_constants import NON_LISTABLE_MODES


def test_query_defaults_match_apps_list():
    q = PermittedExternalAppsListQuery.model_validate({})
    assert q.page == 1
    assert q.limit == 20
    assert q.mode is None
    assert q.name is None


def test_query_rejects_workspace_id():
    """workspace_id is meaningless for /permitted-external-apps (cross-tenant);
    rejecting it forces CLI authors to drop the param rather than send it
    silently."""
    with pytest.raises(ValidationError):
        PermittedExternalAppsListQuery.model_validate({"workspace_id": "ws-1"})


def test_query_rejects_tag():
    """Tags are tenant-scoped; cross-tenant tag resolution is undefined."""
    with pytest.raises(ValidationError):
        PermittedExternalAppsListQuery.model_validate({"tag": "prod"})


def test_query_validates_mode_against_supported_app_type():
    with pytest.raises(ValidationError):
        PermittedExternalAppsListQuery.model_validate({"mode": "not-a-mode"})


@pytest.mark.parametrize("mode", NON_LISTABLE_MODES)
def test_query_rejects_non_listable_app_modes(mode: str):
    """Non-app runtime modes and roster-owned agent are not listable here."""
    with pytest.raises(ValidationError):
        PermittedExternalAppsListQuery.model_validate({"mode": mode})


def test_query_clamps_limit_at_max():
    with pytest.raises(ValidationError):
        PermittedExternalAppsListQuery.model_validate({"limit": 500})


def test_query_accepts_valid_mode():
    """Pin the happy path: AppMode values pass."""
    q = PermittedExternalAppsListQuery.model_validate({"mode": "chat"})
    assert q.mode is not None
    assert q.mode.value == "chat"


@pytest.mark.parametrize(
    ("view", "write"),
    [(PermittedExternalAppsListApi.get, False), (PermittedExternalAppDescribeApi.get, False)],
    ids=["list", "describe"],
)
def test_transaction_boundary_matches_the_pre_migration_decorator(view, write: bool):
    """Both reads carried `@with_session(write=False)` before they moved onto
    `@endpoint`. The allow/deny matrix cannot see this — it observes admission
    before the view body runs.
    """
    assert view.__spec__.write is write


def test_describe_requires_webapp_access():
    """SSO-only and app-scoped, but not run-scoped — and the web-app ACL and the
    private-app check are gated on the app and its access mode, neither on the run
    scope. Omitting `CheckAppAccess` here would silently drop both.
    """
    requirements = PermittedExternalAppDescribeApi.get.__spec__.requirements
    assert any(isinstance(requirement, CheckAppAccess) for requirement in requirements)


def test_list_does_not_require_webapp_access():
    """No `app_id` in the path, so there is no app to run an ACL against."""
    requirements = PermittedExternalAppsListApi.get.__spec__.requirements
    assert not any(isinstance(requirement, CheckAppAccess) for requirement in requirements)


def test_describe_forwards_request_session_to_response_builder(unbound_session: Session):
    api = PermittedExternalAppDescribeApi()
    app = App(
        id="app-id",
        tenant_id="tenant-1",
        name="Permitted app",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
    )
    ctx = SimpleNamespace(app=app, session=unbound_session)
    query = SimpleNamespace(fields={"info"})
    response = object()

    with patch(
        "controllers.openapi.apps_permitted_external.build_app_describe_response",
        return_value=response,
    ) as build_response:
        result = api.get.__handler__(api, ctx, "app-id", query=query)

    assert result is response
    build_response.assert_called_once_with(app, query.fields, session=unbound_session)
