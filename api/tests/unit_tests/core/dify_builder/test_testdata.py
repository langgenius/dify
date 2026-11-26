"""The shared handler seam preserves absence, immutable fixtures and lineage."""

import importlib

from core.dify_builder.models import Turn
from services.dify_builder.application.execution_policy import (
    HttpFixtureSetV1,
)
from services.dify_builder.application.ports import DifyPort


def stamp(dify: DifyPort, turn: Turn) -> HttpFixtureSetV1 | None:
    return importlib.import_module("services.dify_builder.application.testdata").stamp_testdata_http_fixtures(
        dify, app_id="app", turn=turn
    )


def sample(**overrides: object) -> dict[str, object]:
    return {"node_id": "http", "status_code": 201, "content_type": "text/plain", "body": "private", **overrides}
