"""Unit tests for PermittedExternalAppsListQuery — the
/permitted-external-apps query validator.

Strict ConfigDict(extra='forbid'): cross-tenant tag/workspace_id are
unresolvable, so the model must reject them as 422 instead of silently
dropping them. Mode/name/page/limit have the same shape as AppListQuery.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from controllers.openapi.apps_permitted_external import (
    PermittedExternalAppDescribeApi,
    PermittedExternalAppsListQuery,
)

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


def test_describe_forwards_request_session_to_response_builder():
    api = PermittedExternalAppDescribeApi()
    method = inspect.unwrap(api.get)
    session = MagicMock()
    app = MagicMock()
    auth_data = SimpleNamespace(app=app)
    query = SimpleNamespace(fields={"info"})
    response = object()

    with patch(
        "controllers.openapi.apps_permitted_external.build_app_describe_response",
        return_value=response,
    ) as build_response:
        result = method(api, session, "app-id", auth_data=auth_data, query=query)

    assert result is response
    build_response.assert_called_once_with(app, query.fields, session=session)
