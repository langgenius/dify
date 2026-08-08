"""Unit tests for AppListQuery — the /apps query-param validator.

Runs against the model directly, not the HTTP layer. Pins:
- defaults match the plan (page=1, limit=20).
- workspace_id is required.
- numeric bounds enforced (page >= 1, limit in [1, MAX_PAGE_LIMIT]).
- mode validates against the SupportedAppType enum (listable app types only).
- name has a length cap.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from controllers.openapi._models import MAX_PAGE_LIMIT
from controllers.openapi.apps import AppListQuery

from ._mode_constants import LISTABLE_MODES, NON_LISTABLE_MODES

WS_ID = "00000000-0000-0000-0000-000000000001"


def test_defaults():
    q = AppListQuery.model_validate({"workspace_id": WS_ID})
    assert q.workspace_id == WS_ID
    assert q.page == 1
    assert q.limit == 20
    assert q.mode is None
    assert q.name is None


def test_workspace_id_required():
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({})


def test_page_must_be_positive():
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "page": 0})
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "page": -1})


def test_page_rejects_non_integer_string():
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "page": "abc"})


def test_limit_must_be_positive():
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "limit": 0})
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "limit": -1})


def test_limit_caps_at_max_page_limit():
    # Boundary accepts.
    q = AppListQuery.model_validate({"workspace_id": WS_ID, "limit": MAX_PAGE_LIMIT})
    assert q.limit == MAX_PAGE_LIMIT

    # Just over rejects.
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "limit": MAX_PAGE_LIMIT + 1})


@pytest.mark.parametrize("mode", LISTABLE_MODES)
def test_mode_accepts_listable_app_types(mode: str):
    q = AppListQuery.model_validate({"workspace_id": WS_ID, "mode": mode})
    assert q.mode is not None
    assert q.mode.value == mode


def test_mode_rejects_unknown_value():
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "mode": "not-a-mode"})


@pytest.mark.parametrize("mode", NON_LISTABLE_MODES)
def test_mode_rejects_non_listable_app_modes(mode: str):
    """rag-pipeline (a knowledge Pipeline), channel (unused) and agent (roster-owned)
    are AppMode members but not standalone listable apps — the `app` face rejects them."""
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "mode": mode})


def test_name_length_capped():
    AppListQuery.model_validate({"workspace_id": WS_ID, "name": "x" * 200})
    with pytest.raises(ValidationError):
        AppListQuery.model_validate({"workspace_id": WS_ID, "name": "x" * 201})


def test_all_fields_accept_valid_values():
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
