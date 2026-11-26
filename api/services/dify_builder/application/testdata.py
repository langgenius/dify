"""Shared test-data prompt context and fixture admission for Builder handlers."""

import json

from core.dify_builder.models import DifyBuilderContext


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
