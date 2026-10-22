"""Keep public action declarations intact at the planning model boundary."""

from typing import cast

import pytest

from core.workflow.generator.tool_catalogue import ToolCatalogueEntry
from graphon.model_runtime.entities.message_entities import PromptMessage
from services.dify_builder.agent import build
from services.dify_builder.agent.resources import ResourceRef, _tool_ref
from tests.unit_tests.services.dify_builder.test_build_cognition import _FakeInstance, _plan_reply


def test_planner_and_discovery_receive_the_actual_action_parameters() -> None:
    tool = ResourceRef(
        id="langgenius/google/google/google_search",
        label="Google Search",
        meta="Search the web",
        readiness="missing_config",
        parameter_contract=[
            {"name": "query", "type": "string", "form": "llm", "required": True},
            {"name": "language_code", "type": "string", "form": "llm", "required": False},
        ],
    )

    for rendered in (
        build._planner_tool_section([tool]),
        build._discovery_line(tool.id, "plugin", tool),
    ):
        assert '"name": "query"' in rendered
        assert '"name": "language_code"' in rendered
        assert '"required": true' in rendered
        assert "safe_search" not in rendered
        assert "missing_config" in rendered


def test_unknown_parameter_contract_is_distinct_from_a_no_parameter_action() -> None:
    unknown = ResourceRef(id="provider/unknown", label="Unknown")
    no_parameters = ResourceRef(id="provider/ping", label="Ping", parameter_contract=[])

    assert "Action parameter declarations: unknown" in build._planner_tool_section([unknown])
    assert "Action parameter declarations: []" in build._planner_tool_section([no_parameters])


@pytest.mark.parametrize(
    ("declaration", "expected_state"),
    [({}, "unknown"), ({"output_schema": {}}, "absent"), ({"output_schema": {"type": "object"}}, "declared")],
)
def test_inventory_exposes_output_schema_availability_to_the_high_level_planner(
    declaration: dict[str, object], expected_state: str
) -> None:
    entry = cast(
        ToolCatalogueEntry,
        {"provider_name": "fixture/decoder/decoder", "tool_name": "decode", **declaration},
    )
    resource = _tool_ref(entry, set())

    assert f"Action output schema: {expected_state}" in build._planner_tool_section([resource])


def test_high_level_plan_receives_tool_channels_before_committing_consumer_steps() -> None:
    entry = cast(
        ToolCatalogueEntry,
        {"provider_name": "fixture/decoder/decoder", "tool_name": "decode", "output_schema": {}},
    )
    model = _FakeInstance([_plan_reply(["tool node decodes content", "code node validates the decoded records"])])

    plan = build.propose_plan_v1(model, {}, tools=[_tool_ref(entry, set())], goal_text="Count paid records only.")

    assert plan is not None
    messages = cast(list[PromptMessage], model.calls[0][0])
    system = messages[0].get_text_content()
    assert "Action output schema: absent" in system
    assert "json is a collection of JSON messages" in system
    assert "do not commit a downstream step to a guessed output channel" in system
