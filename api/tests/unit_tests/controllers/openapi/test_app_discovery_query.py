"""Validation contract for ``GET /openapi/v1/apps/discovery``."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from controllers.openapi._models import MAX_PAGE_LIMIT, AppDiscoveryQuery

WORKSPACE_ID = "00000000-0000-0000-0000-000000000001"


def test_discovery_query_defaults() -> None:
    query = AppDiscoveryQuery.model_validate({"workspace_id": WORKSPACE_ID})

    assert query.workspace_id == WORKSPACE_ID
    assert query.page == 1
    assert query.limit == 20


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"workspace_id": WORKSPACE_ID, "page": 0},
        {"workspace_id": WORKSPACE_ID, "limit": 0},
        {"workspace_id": WORKSPACE_ID, "limit": MAX_PAGE_LIMIT + 1},
        {"workspace_id": WORKSPACE_ID, "unexpected": "value"},
    ],
)
def test_discovery_query_rejects_invalid_inputs(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        AppDiscoveryQuery.model_validate(payload)
