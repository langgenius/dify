"""Unit tests for the /permitted-external-apps routes.

`PermittedExternalAppsListQuery` is strict (`ConfigDict(extra='forbid')`):
cross-tenant tag/workspace_id are unresolvable, so the model must reject them as
422 instead of silently dropping them. Mode/name/page/limit have the same shape
as AppListQuery.

The allow/deny answers live in `test_auth_matrix.py`.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from controllers.openapi.apps_permitted_external import (
    PermittedExternalAppDescribeApi,
    PermittedExternalAppsListQuery,
)
from models.model import App, AppMode


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


def test_query_validates_mode_against_supported_app_type():
    with pytest.raises(ValidationError):
        PermittedExternalAppsListQuery.model_validate({"mode": "not-a-mode"})


def test_query_clamps_limit_at_max():
    with pytest.raises(ValidationError):
        PermittedExternalAppsListQuery.model_validate({"limit": 500})


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
