"""Shared test-data prompt context and fixture admission for Builder handlers."""

import json

from core.dify_builder.contract import decode_testdata_http_fixtures
from core.dify_builder.models import DifyBuilderContext, Turn
from services.dify_builder.application.execution_policy import HttpFixtureSetV1
from services.dify_builder.application.ports import DifyPort


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


def mock_input_business_context(context: DifyBuilderContext) -> str:
    """Project task prose only; exclude graphs, execution state and model configuration."""
    return json.dumps(
        {
            "goal": context.goal_text,
            "confirmed_requirements": context.requirements,
            "approved_plan": {
                "title": context.plan_title,
                "input_summary": context.plan_input_summary,
                "output_summary": context.plan_output_summary,
                "items": context.plan_items,
            },
        },
        ensure_ascii=False,
    )
