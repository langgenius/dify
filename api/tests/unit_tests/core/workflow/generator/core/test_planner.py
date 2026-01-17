# api/tests/unit_tests/core/workflow/generator/core/test_planner.py
import pytest
from unittest.mock import MagicMock
from core.workflow.generator.core.planner import (
    Planner,
    PlannerOutput,
    ExecutionStep,
)


def test_planner_output_structure():
    output = PlannerOutput(
        intent="generate",
        analysis={
            "user_goal": "Fetch and analyze webpage",
            "required_capabilities": ["http_fetch", "text_analysis"],
            "complexity": "medium",
        },
        execution_plan=[
            ExecutionStep(
                step=1,
                action="Get user URL input",
                node_type="start",
                inputs=[],
                outputs=["url"],
            ),
            ExecutionStep(
                step=2,
                action="Fetch webpage",
                node_type="http-request",
                inputs=["url"],
                outputs=["body"],
            ),
        ],
        tool_selection={
            "required": ["http-request", "llm"],
            "optional": [],
        },
    )
    assert output.intent == "generate"
    assert len(output.execution_plan) == 2
    assert output.execution_plan[0].node_type == "start"


def test_planner_output_off_topic():
    output = PlannerOutput(
        intent="off_topic",
        message="I can only help with workflow creation.",
        suggestions=["Try asking about workflow automation"],
    )
    assert output.intent == "off_topic"
    assert len(output.suggestions) > 0


def test_planner_filters_tools():
    """Test that planner correctly filters available tools."""
    planner = Planner(model_instance=MagicMock())

    available_tools = [
        {"tool_key": "google/search", "is_team_authorization": True},
        {"tool_key": "slack/send", "is_team_authorization": False},
    ]

    # Filter to only configured tools
    configured = planner.filter_configured_tools(available_tools)
    assert len(configured) == 1
    assert configured[0]["tool_key"] == "google/search"
