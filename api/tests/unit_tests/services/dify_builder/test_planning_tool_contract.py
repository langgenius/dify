"""Keep public action declarations intact at the planning model boundary."""

from services.dify_builder.agent import build
from services.dify_builder.agent.resources import ResourceRef


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
