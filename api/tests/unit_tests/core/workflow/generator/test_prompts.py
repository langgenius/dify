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
    format_builder_tool_catalogue_section,
    format_plan_block,
    get_builder_system_prompt,
)
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
        assert any(line.startswith("1.") and "node-1" in line for line in lines)
        assert any(line.startswith("2.") and "node-2" in line for line in lines)
        assert "purpose: Take input" in out
        assert "purpose: Summarize" in out

    def test_handles_missing_fields_gracefully(self):
        out = format_plan_block([{"node_type": "llm"}])
        # Missing label/purpose must not raise — they degrade to empty strings.
        assert "node-1" in out
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
        # The inner line should mention parent=node-2 (the iteration node).
        assert "parent=node-2" in out
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
