"""Unit tests for compact planner and per-node builder prompt helpers."""

import json

from core.workflow.generator.prompts.node_builder_prompts import (
    format_mode_section,
    format_parallel_plan,
    format_start_inputs_section,
    get_node_builder_system_prompt,
)
from core.workflow.generator.prompts.node_builder_prompts import (
    format_tool_catalogue_section as format_node_tool_catalogue_section,
)
from core.workflow.generator.prompts.planner_prompts import (
    PLANNER_SYSTEM_PROMPT,
    format_existing_graph_section,
    format_ideal_output_section,
)
from core.workflow.generator.prompts.planner_prompts import (
    format_tool_catalogue_section as format_planner_tool_catalogue_section,
)


class TestPlannerSystemPrompt:
    def test_documents_the_mode_output_field(self):
        """Auto-mode resolution rides on the planner echoing its mode choice."""
        assert '"mode": "workflow | advanced-chat"' in PLANNER_SYSTEM_PROMPT
        assert "When the ``# Mode`` section says auto, YOU decide" in PLANNER_SYSTEM_PROMPT

    def test_prioritizes_installed_tools_and_requires_structured_selection(self):
        assert "INSTALLED-TOOL-FIRST" in PLANNER_SYSTEM_PROMPT
        assert 'you MUST use a "tool" node' in PLANNER_SYSTEM_PROMPT
        assert '"tool": {"provider_id": "<provider>", "tool_name": "<tool>"}' in PLANNER_SYSTEM_PROMPT


class TestFormatIdealOutputSection:
    def test_returns_empty_string_for_blank_input(self):
        assert format_ideal_output_section("") == ""
        assert format_ideal_output_section("   \n\t  ") == ""

    def test_wraps_content_in_a_labelled_section(self):
        out = format_ideal_output_section("A short summary.")

        assert out.startswith("# Ideal output")
        assert "A short summary." in out
        assert out.endswith("\n\n")


class TestToolCatalogueSections:
    def test_planner_returns_empty_when_catalogue_is_blank(self):
        assert format_planner_tool_catalogue_section("") == ""
        assert format_planner_tool_catalogue_section("   ") == ""

    def test_planner_includes_catalogue(self):
        out = format_planner_tool_catalogue_section("- google/search — Search.")

        assert "# Relevant installed tools" in out
        assert "dynamically selected" in out.lower()
        assert "- google/search — Search." in out

    def test_node_builder_returns_empty_when_catalogue_is_blank(self):
        assert format_node_tool_catalogue_section("") == ""

    def test_node_builder_requires_exact_provider_and_tool_ids(self):
        out = format_node_tool_catalogue_section("- google/search — Search.")

        assert "exact" in out.lower()
        assert "provider_id" in out
        assert "tool_name" in out
        assert "- google/search — Search." in out


class TestNodeBuilderPrompt:
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

    def test_common_node_prompts_stay_small(self):
        sizes = [len(get_node_builder_system_prompt(node_type)) for node_type in ("start", "llm", "end")]

        assert max(sizes) < 3000

    def test_unknown_node_type_gets_minimal_fallback(self):
        prompt = get_node_builder_system_prompt("future-node")

        assert "future-node" in prompt
        assert "minimum valid config fields" in prompt


class TestNodeBuilderUserSections:
    def test_formats_start_inputs(self):
        out = format_start_inputs_section(
            [{"variable": "url", "label": "URL", "type": "text-input"}, {"variable": "", "label": "Ignored"}]
        )

        assert "variable='url'" in out
        assert "type='text-input'" in out
        assert "Ignored" not in out

    def test_empty_start_inputs_are_omitted(self):
        assert format_start_inputs_section([]) == ""

    def test_parallel_plan_is_compact_and_preserves_topology(self):
        rendered = format_parallel_plan(
            [{"id": "node1", "node_type": "start"}, {"id": "node2", "node_type": "end"}],
            [{"source": "node1", "target": "node2"}],
        )

        assert " " not in rendered
        assert json.loads(rendered)["edges"] == [{"source": "node1", "target": "node2"}]
        assert "start_inputs" not in json.loads(rendered)

    def test_parallel_plan_carries_declared_start_inputs(self):
        rendered = format_parallel_plan(
            [{"id": "node1", "node_type": "start"}],
            [],
            [{"variable": "url", "label": "URL", "type": "text-input"}],
        )

        assert json.loads(rendered)["start_inputs"] == [{"variable": "url", "label": "URL", "type": "text-input"}]


class TestModeSection:
    def test_advanced_chat_documents_system_variables(self):
        out = format_mode_section("advanced-chat")

        assert "sys.query" in out
        assert '["sys", "query"]' in out
        assert "do NOT invent start-node variables" in out

    def test_workflow_mode_forbids_system_variables(self):
        out = format_mode_section("workflow")

        assert "NO automatic system variables" in out


class TestExistingGraphSection:
    def test_edge_lines_surface_branch_source_handles(self):
        out = format_existing_graph_section(
            {
                "nodes": [{"id": "node1", "data": {"type": "if-else", "title": "Branch"}}],
                "edges": [
                    {"source": "node1", "target": "node2", "sourceHandle": "case-uuid-1"},
                    {"source": "node2", "target": "node3", "sourceHandle": "source"},
                ],
            }
        )

        assert "- node1 -> node2 (source_handle='case-uuid-1')" in out
        assert "- node2 -> node3\n" in out
        assert "copy its source_handle verbatim" in out

    def test_create_mode_renders_nothing(self):
        assert format_existing_graph_section(None) == ""


class TestNodeBuilderHandleContract:
    """ESQ1-303: the planner names a branch's outgoing handles (rule 12, one LLM
    call) and the node builder chooses the case / class / action ids (another
    call). Nothing told the builder the planner had already chosen. It sees the
    planned edges -- ``format_parallel_plan`` embeds ``edges`` with their
    ``source_handle`` -- so its snippets now make those handles the contract."""

    def test_if_else_snippet_binds_case_ids_to_the_planned_source_handles(self):
        prompt = get_node_builder_system_prompt("if-else")

        assert "source_handle" in prompt
        assert "case_id" in prompt
        assert '"false"' in prompt  # ELSE is implicit and must never be declared as a case
        assert "never" in prompt.lower() or "must not" in prompt.lower()

    def test_question_classifier_snippet_binds_class_ids_to_the_planned_source_handles(self):
        prompt = get_node_builder_system_prompt("question-classifier")

        assert "source_handle" in prompt
        assert "classes" in prompt

    def test_human_input_snippet_binds_action_ids_to_the_planned_source_handles(self):
        prompt = get_node_builder_system_prompt("human-input")

        assert "source_handle" in prompt
        assert "user_actions" in prompt

    def test_the_planned_edges_reach_the_builder_with_their_handles(self):
        out = format_parallel_plan(
            [{"id": "node2", "label": "Check", "node_type": "if-else", "purpose": "x"}],
            [{"source": "node2", "target": "node3", "source_handle": "score_equals_60"}],
        )

        assert '"source_handle":"score_equals_60"' in out


class TestNodeSnippetContracts:
    """Task 4: the generator prompt must not contradict the engine's node-data
    schemas. Each case below was live-verified against a graphon entity (see
    docs/superpowers/triage/generator-blockers-2026-09-22/FINDINGS.md Blocker A)."""

    def test_parameter_extractor_query_is_one_selector_not_an_array_of_selectors(self):
        """graphon ParameterExtractorNodeData.query: list[str] -- ONE selector,
        not an array of selector arrays."""
        prompt = get_node_builder_system_prompt("parameter-extractor")

        assert '"query": ["<src>", "<var>"]' in prompt
        assert "[[" not in prompt

    def test_if_else_enumerates_the_engines_comparison_operators_verbatim(self):
        """graphon utils.condition.entities.SupportedComparisonOperator -- the
        number comparisons are the unicode >= <= != forms only."""
        prompt = get_node_builder_system_prompt("if-else")

        for operator in (
            "contains",
            "not contains",
            "start with",
            "end with",
            "is not",
            "empty",
            "not empty",
            "in",
            "not in",
            "all of",
            "null",
            "not null",
            "exists",
            "not exists",
            "≥",
            "≤",
            "≠",
        ):
            assert operator in prompt
        # The unicode forms are listed as the only valid operators...
        assert '"≥"' in prompt
        assert '"≤"' in prompt
        assert '"≠"' in prompt
        # ...and the ASCII digraphs are called out as wrong, not silently omitted.
        assert "never" in prompt.lower()
        assert '">="' in prompt
        assert '"<="' in prompt
        assert '"!="' in prompt

    def test_template_transform_marks_variables_required_with_empty_list_form(self):
        """graphon TemplateTransformNodeData.variables has no default -- it is
        required even for a template that references no variables."""
        prompt = get_node_builder_system_prompt("template-transform")

        assert "REQUIRED" in prompt
        assert '"variables": []' in prompt

    def test_llm_documents_structured_output_as_a_three_segment_reference(self):
        """graphon LLM node._build_run_outputs (node.py ~719-737) ALWAYS sets
        text/reasoning_content/usage/finish_reason; only structured_output and
        files are conditional. The prompt must not tell the generator "text"
        is the only output -- that would block legitimate
        {{#node.reasoning_content#}} / {{#node.usage#}} references, the FE's
        own LLM_OUTPUT_STRUCT (constants.ts:142-155). structured_output is
        addressed with a 3-segment selector, never a flat <node>.<field>."""
        prompt = get_node_builder_system_prompt("llm")

        assert "structured_output_enabled" in prompt
        assert "{{#<node>.structured_output.<field>#}}" in prompt
        assert '"text"' in prompt
        assert '"reasoning_content"' in prompt
        assert '"usage"' in prompt
        assert "only output" not in prompt.lower()

    def test_list_operator_restates_the_same_unicode_comparison_operators(self):
        """Each node build sees only its own snippet (get_node_builder_system_prompt
        embeds exactly one _NODE_SNIPPETS entry), so list-operator's
        if-else-shaped ``conditions`` never see the if-else entry's operator
        rule -- it must be restated here or a filter can still emit ">="."""
        prompt = get_node_builder_system_prompt("list-operator")

        assert "≥" in prompt
        assert "≤" in prompt
        assert "≠" in prompt
        assert "never" in prompt.lower()

    def test_list_operator_enumerates_the_filter_operators_the_engine_has(self):
        """A filter's ``comparison_operator`` is graphon's ``FilterOperator``
        (``nodes/list_operator/entities.py:10-28``), a SMALLER set than the
        if-else ``Condition`` operators the snippet used to point at. Pointing
        at the if-else shape let the generator emit ``"all of"`` / ``"null"`` /
        ``"not null"`` / ``"exists"`` / ``"not exists"`` on a filter, which
        ``FilterCondition`` rejects, so the workflow is refused at
        ``Graph.init`` and never runs."""
        prompt = get_node_builder_system_prompt("list-operator")

        # The 16 FilterOperator values, verbatim.
        for operator in (
            "contains",
            "start with",
            "end with",
            "is",
            "in",
            "empty",
            "not contains",
            "is not",
            "not in",
            "not empty",
            "=",
            "≠",
            "<",
            ">",
            "≥",
            "≤",
        ):
            assert f'"{operator}"' in prompt, operator

        # The five the if-else condition has and a filter does not.
        for absent in ("all of", "null", "not null", "exists", "not exists"):
            assert absent not in prompt, absent
