"""Unit tests for AppListQuery — the /apps query-param validator.

Runs against the model directly, not the HTTP layer. Pins:
- defaults match the plan (page=1, limit=20).
- workspace_id is required.
- numeric bounds enforced (page >= 1, limit in [1, MAX_PAGE_LIMIT]).
- mode validates against the AppMode enum.
- name and tag have length caps.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from controllers.openapi._models import MAX_PAGE_LIMIT
from controllers.openapi.apps import AppListQuery


def test_defaults():
    q = AppListQuery.model_validate({"workspace_id": "ws-1"})
    assert q.workspace_id == "ws-1"
    assert q.page == 1
    assert q.limit == 20
    assert q.mode is None
    assert q.name is None
    assert q.tag is None


def test_workspace_id_required():
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({})


def test_page_must_be_positive():
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": "ws-1", "page": 0})
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": "ws-1", "page": -1})


def test_page_rejects_non_integer_string():
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": "ws-1", "page": "abc"})


def test_limit_must_be_positive():
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": "ws-1", "limit": 0})
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": "ws-1", "limit": -1})


def test_limit_caps_at_max_page_limit():
    # Boundary accepts.
    q = AppListQuery.model_validate({"workspace_id": "ws-1", "limit": MAX_PAGE_LIMIT})
    assert q.limit == MAX_PAGE_LIMIT

    # Just over rejects.
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": "ws-1", "limit": MAX_PAGE_LIMIT + 1})


def test_mode_whitelisted_against_app_mode():
    # Valid mode passes.
    q = AppListQuery.model_validate({"workspace_id": "ws-1", "mode": "chat"})
    assert q.mode is not None
    assert q.mode.value == "chat"

    # Invalid mode rejects.
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": "ws-1", "mode": "not-a-mode"})


def test_name_length_capped():
    AppListQuery.model_validate({"workspace_id": "ws-1", "name": "x" * 200})
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": "ws-1", "name": "x" * 201})


def test_tag_length_capped():
    AppListQuery.model_validate({"workspace_id": "ws-1", "tag": "x" * 100})
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": "ws-1", "tag": "x" * 101})


def test_all_fields_accept_valid_values():
    """Pin the happy-path acceptance for every field in one place."""
    q = AppListQuery.model_validate(
        {
            "workspace_id": "ws-1",
            "page": 5,
            "limit": 50,
            "mode": "workflow",
            "name": "search",
            "tag": "prod",
        }
    )
    assert q.workspace_id == "ws-1"
    assert q.page == 5
    assert q.limit == 50
    assert q.mode is not None
    assert q.mode.value == "workflow"
    assert q.name == "search"
    assert q.tag == "prod"
