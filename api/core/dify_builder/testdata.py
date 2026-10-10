"""Shared fixture admission seam for authorized Builder test-data handlers."""

from core.dify_builder.contract import decode_testdata_http_fixtures
from core.dify_builder.execution_policy import HttpFixtureSetV1
from core.dify_builder.models import Turn
from core.dify_builder.ports import DifyPort


def stamp_testdata_http_fixtures(dify: DifyPort, *, app_id: str, turn: Turn) -> HttpFixtureSetV1 | None:
    """Decode public fixtures and stamp against the exact submitted revision.

    Absence leaves historical input-only behavior intact. The existing port
    owns authorization, current raw metadata admission and revision lineage.
    """
    action = turn.action
    fixtures = decode_testdata_http_fixtures(action.payload if action is not None else {})
    if fixtures is None:
        return None
    return dify.stamp_http_fixtures(
        app_id,
        turn.actor,
        base_app_revision=action.base_app_revision if action is not None else "",
        fixtures=fixtures,
    )
