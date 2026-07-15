"""
Unit tests for the planner / builder prompt format helpers.

These helpers are pure string-shaping functions that wrap conditional sections
into the LLM prompts. We assert they (1) emit empty strings when the source
data is empty so the prompt stays tight, (2) include the relevant header text
when data is present, and (3) round-trip the raw catalogue text unchanged.
"""

from core.workflow.generator.prompts.builder_prompts import (
    BUILDER_SYSTEM_PROMPT_ADVANCED_CHAT,
    BUILDER_SYSTEM_PROMPT_WORKFLOW,
    compact_graph_for_builder,
    format_builder_existing_graph_section,
    format_builder_tool_catalogue_section,
    format_plan_block,
    get_builder_system_prompt,
)
from core.workflow.generator.prompts.node_builder_prompts import get_node_builder_system_prompt
from core.workflow.generator.prompts.planner_prompts import (
    format_ideal_output_section,
    format_tool_catalogue_section,
)


class TestFormatIdealOutputSection:
    def test_returns_empty_string_for_blank_input(self):
        assert format_ideal_output_section("") == ""
        assert format_ideal_output_section("   \n\t  ") == ""

    def test_wraps_content_in_a_labelled_section(self):
        out = format_ideal_output_section("A short summary.")
        assert out.startswith("# Ideal output")
        assert "A short summary." in out
        assert out.endswith("\n\n")


class TestPlannerCatalogueSection:
    def test_returns_empty_when_catalogue_is_blank(self):
        # No installed tools — the planner shouldn't see an "Available tools"
        # heading at all; an empty string keeps the prompt tight.
        assert format_tool_catalogue_section("") == ""
        assert format_tool_catalogue_section("   ") == ""

    def test_emits_a_planner_facing_header_with_the_catalogue(self):
        out = format_tool_catalogue_section("- google/search — Search.")
        assert "# Available tools" in out
        assert "planner" in out.lower()
        assert "- google/search — Search." in out


class TestBuilderCatalogueSection:
    def test_returns_empty_when_catalogue_is_blank(self):
        assert format_builder_tool_catalogue_section("") == ""

    def test_includes_strict_provider_tool_guidance(self):
        out = format_builder_tool_catalogue_section("- google/search — Search.")
        # The builder must be told to use the *exact* identifiers — hallucinated
        # tools fail at sync time.
        assert "exact" in out.lower()
        assert "provider_id" in out
        assert "tool_name" in out
        assert "- google/search — Search." in out


class TestFormatPlanBlock:
    def test_renders_one_line_per_node(self):
        out = format_plan_block(
            [
                {"label": "Start", "node_type": "start", "purpose": "Take input"},
                {"label": "Summarize", "node_type": "llm", "purpose": "Summarize"},
            ]
        )
        lines = out.split("\n")
        # Two nodes → 4 lines (each entry takes id-line + purpose-line).
        assert any(line.startswith("1.") and "node1" in line for line in lines)
        assert any(line.startswith("2.") and "node2" in line for line in lines)
        assert "purpose: Take input" in out
        assert "purpose: Summarize" in out

    def test_handles_missing_fields_gracefully(self):
        out = format_plan_block([{"node_type": "llm"}])
        # Missing label/purpose must not raise — they degrade to empty strings.
        assert "node1" in out
        assert "type=llm" in out


class TestGetBuilderSystemPrompt:
    def test_returns_workflow_prompt_for_workflow_mode(self):
        # The two prompts are structurally similar but differ in their
        # mode-specific rules block.
        prompt = get_builder_system_prompt("workflow")
        assert prompt is BUILDER_SYSTEM_PROMPT_WORKFLOW
        assert 'exactly one "end" node' in prompt

    def test_returns_advanced_chat_prompt_for_advanced_chat_mode(self):
        prompt = get_builder_system_prompt("advanced-chat")
        assert prompt is BUILDER_SYSTEM_PROMPT_ADVANCED_CHAT
        assert 'exactly one "answer" node' in prompt

    def test_scopes_cheatsheet_to_planned_node_types(self):
        # When the runner pins the plan's node-type set, the builder prompt
        # carries ONLY those types' schemas — no schema for unrelated nodes.
        prompt = get_builder_system_prompt("workflow", {"start", "llm", "end"})
        assert "- start:" in prompt
        assert "- llm:" in prompt
        assert "- if-else:" not in prompt
        assert "- tool" not in prompt
        assert "## Containers" not in prompt
        # Still a valid, mode-correct prompt.
        assert 'exactly one "end" node' in prompt

    def test_scoped_prompt_pulls_in_containers_for_iteration(self):
        prompt = get_builder_system_prompt("workflow", {"start", "iteration", "llm", "end"})
        assert "## Containers" in prompt

    def test_scoped_prompt_is_smaller_than_full(self):
        # The whole point of dynamic assembly: a small plan ships a smaller
        # builder prompt than the full cheatsheet.
        scoped = get_builder_system_prompt("workflow", {"start", "llm", "end"})
        assert len(scoped) < len(BUILDER_SYSTEM_PROMPT_WORKFLOW)

    def test_documents_multi_retrieval_fan_in(self):
        prompt = get_builder_system_prompt(
            "workflow",
            {"start", "knowledge-retrieval", "llm", "end"},
        )

        assert "context.variable_selector accepts only one selector" in prompt
        assert 'value_selector: ["node2", "result"]' in prompt
        assert 'value_selector: ["node3", "result"]' in prompt
        assert "edge from EACH retrieval node to the template" in prompt
        assert 'template\'s ``["<template-node-id>", "output"]``' in prompt


class TestGetNodeBuilderSystemPrompt:
    def test_only_includes_target_node_schema_and_compact_output_contract(self):
        prompt = get_node_builder_system_prompt("llm")

        assert '"config"' in prompt
        assert "- llm:" in prompt
        assert "- if-else:" not in prompt
        assert '"viewport":' not in prompt
        assert '"positionAbsolute":' not in prompt

    def test_supports_main_human_input_and_assigner_contracts(self):
        human_input = get_node_builder_system_prompt("human-input")
        assigner = get_node_builder_system_prompt("assigner")

        assert "delivery_methods" in human_input
        assert "user_actions" in human_input
        assert '"version": "2"' in assigner
        assert "variable_selector" in assigner

    def test_common_flow_critical_path_prompt_is_under_thirty_percent_of_legacy(self):
        node_types = {"start", "llm", "end"}
        legacy = get_builder_system_prompt("workflow", node_types)
        parallel_critical_path = max(len(get_node_builder_system_prompt(node_type)) for node_type in node_types)

        assert parallel_critical_path < len(legacy) * 0.3


class TestBuildNodeConfigCheatsheet:
    def test_none_returns_full_cheatsheet(self):
        from core.workflow.generator.prompts.builder_prompts import (
            NODE_CONFIG_CHEATSHEET,
            build_node_config_cheatsheet,
        )

        full = build_node_config_cheatsheet(None)
        assert full == NODE_CONFIG_CHEATSHEET
        # Full cheatsheet documents every node type + containers.
        assert "- tool" in full
        assert "- if-else:" in full
        assert "## Containers" in full

    def test_always_includes_start_even_when_omitted(self):
        # Every workflow has a start node; the assembler force-includes it so
        # the builder can always declare input variables.
        from core.workflow.generator.prompts.builder_prompts import build_node_config_cheatsheet

        out = build_node_config_cheatsheet({"llm", "end"})
        assert "- start:" in out

    def test_start_snippet_documents_file_upload_schema(self):
        # The bug this fixes: a file start variable needs allowed_file_types,
        # which the builder never knew about. The snippet must now teach it.
        from core.workflow.generator.prompts.builder_prompts import build_node_config_cheatsheet

        out = build_node_config_cheatsheet({"start", "document-extractor", "llm", "end"})
        assert "allowed_file_types" in out
        assert "allowed_file_upload_methods" in out
        assert "supported file types" in out  # the exact Studio error wording


class TestFormatPlanBlockParentHints:
    def test_resolves_parent_label_to_node_id(self):
        # The planner emits parent="Per Item" as a hint; the builder needs the
        # resolved id ("node-N") to set parentId on the inner node.
        from core.workflow.generator.prompts.builder_prompts import format_plan_block

        out = format_plan_block(
            [
                {"label": "Start", "node_type": "start", "purpose": "x"},
                {"label": "Per Item", "node_type": "iteration", "purpose": "iterate"},
                {"label": "Sum Item", "node_type": "llm", "purpose": "summarize one", "parent": "Per Item"},
            ]
        )
        # The inner line should mention parent=node2 (the iteration node).
        assert "parent=node2" in out
        # Top-level nodes must not have a parent clause.
        first_line = out.splitlines()[0]
        assert "parent=" not in first_line

    def test_omits_parent_clause_when_label_is_unknown(self):
        # A typo / unknown parent label should degrade to quoting the raw
        # label string rather than fabricating a node id.
        from core.workflow.generator.prompts.builder_prompts import format_plan_block

        out = format_plan_block(
            [
                {"label": "Start", "node_type": "start", "purpose": "x"},
                {"label": "Step", "node_type": "code", "purpose": "x", "parent": "Ghost Container"},
            ]
        )
        assert "parent='Ghost Container'" in out


class TestCompactGraphForBuilder:
    """
    The refine-mode existing-graph JSON is the single biggest token sink in
    the pipeline — and the builder echoes untouched nodes back, doubling the
    cost. The compactor must drop canvas noise (recomputed in postprocess)
    while keeping everything the builder genuinely has to preserve.
    """

    @staticmethod
    def _graph() -> dict:
        return {
            "nodes": [
                {
                    "id": "node1",
                    "type": "custom",
                    "position": {"x": 80, "y": 282},
                    "positionAbsolute": {"x": 80, "y": 282},
                    "width": 244,
                    "height": 100,
                    "sourcePosition": "right",
                    "targetPosition": "left",
                    "selected": True,
                    "data": {"type": "start", "title": "Start", "variables": []},
                },
                {
                    "id": "iter1",
                    "type": "custom",
                    "position": {"x": 400, "y": 282},
                    "width": 808,
                    "height": 204,
                    "data": {"type": "iteration", "title": "Per Item", "start_node_id": "iter1start"},
                },
                {
                    "id": "iter1start",
                    "type": "custom-iteration-start",
                    "parentId": "iter1",
                    "position": {"x": 60, "y": 78},
                    "positionAbsolute": {"x": 460, "y": 360},
                    "data": {"type": "iteration-start", "title": ""},
                },
            ],
            "edges": [
                {
                    "id": "node1-source-iter1-target",
                    "source": "node1",
                    "target": "iter1",
                    "sourceHandle": "source",
                    "targetHandle": "target",
                    "type": "custom",
                    "zIndex": 0,
                    "data": {"sourceType": "start", "targetType": "iteration", "isInIteration": False},
                }
            ],
            "viewport": {"x": 0, "y": 0, "zoom": 0.7},
        }

    def test_drops_canvas_noise_from_top_level_nodes(self):
        compact = compact_graph_for_builder(self._graph())
        start = next(n for n in compact["nodes"] if n["id"] == "node1")
        for key in ("position", "positionAbsolute", "width", "height", "sourcePosition", "targetPosition", "selected"):
            assert key not in start
        # Semantics survive.
        assert start["data"]["type"] == "start"
        assert start["type"] == "custom"

    def test_keeps_container_size_but_not_position(self):
        compact = compact_graph_for_builder(self._graph())
        container = next(n for n in compact["nodes"] if n["id"] == "iter1")
        assert container["width"] == 808
        assert container["height"] == 204
        assert "position" not in container

    def test_keeps_child_relative_position(self):
        compact = compact_graph_for_builder(self._graph())
        child = next(n for n in compact["nodes"] if n["id"] == "iter1start")
        assert child["position"] == {"x": 60, "y": 78}
        assert child["parentId"] == "iter1"
        assert child["type"] == "custom-iteration-start"
        assert "positionAbsolute" not in child

    def test_edges_keep_only_topology_fields(self):
        compact = compact_graph_for_builder(self._graph())
        assert compact["edges"] == [
            {"source": "node1", "target": "iter1", "sourceHandle": "source", "targetHandle": "target"}
        ]

    def test_viewport_is_dropped(self):
        assert "viewport" not in compact_graph_for_builder(self._graph())

    def test_existing_graph_section_embeds_the_compact_graph(self):
        section = format_builder_existing_graph_section(self._graph())
        assert "Existing graph to refine" in section
        assert "positionAbsolute" not in section
        assert '"start_node_id":"iter1start"' in section

    def test_existing_graph_section_empty_for_create_mode(self):
        assert format_builder_existing_graph_section(None) == ""
