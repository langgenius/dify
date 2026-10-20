"""Unit tests for the /permitted-external-apps routes.

`PermittedExternalAppsListQuery` is strict (`ConfigDict(extra='forbid')`):
cross-tenant tag/workspace_id are unresolvable, so the model must reject them as
422 instead of silently dropping them. Mode/name/page/limit have the same shape
as AppListQuery.

The allow/deny answers live in `test_auth_matrix.py`.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from controllers.openapi.apps_permitted_external import (
    PermittedExternalAppsListQuery,
)


def test_query_defaults_match_apps_list() -> None:
    q = PermittedExternalAppsListQuery.model_validate({})
    assert q.page == 1
    assert q.limit == 20
    assert q.mode is None
    assert q.name is None


def test_query_rejects_workspace_id() -> None:
    """workspace_id is meaningless for /permitted-external-apps (cross-tenant);
    rejecting it forces CLI authors to drop the param rather than send it
    silently."""
    with pytest.raises(ValidationError):
        PermittedExternalAppsListQuery.model_validate({"workspace_id": "ws-1"})


def test_query_validates_mode_against_supported_app_type() -> None:
    with pytest.raises(ValidationError):
        PermittedExternalAppsListQuery.model_validate({"mode": "not-a-mode"})


def test_query_clamps_limit_at_max() -> None:
    with pytest.raises(ValidationError):
        PermittedExternalAppsListQuery.model_validate({"limit": 500})
