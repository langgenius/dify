"""Unit tests for compact planner and per-node builder prompt helpers."""

import json
import re

import pytest

from core.workflow.generator.prompts.builder_prompts import _NODE_SNIPPETS
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
from core.workflow.node_factory import validate_node_config


class TestPlannerSystemPrompt:
    def test_documents_the_mode_output_field(self) -> None:
        """Auto-mode resolution rides on the planner echoing its mode choice."""
        assert '"mode": "workflow | advanced-chat"' in PLANNER_SYSTEM_PROMPT
        assert "When the ``# Mode`` section says auto, YOU decide" in PLANNER_SYSTEM_PROMPT

    def test_prioritizes_installed_tools_and_requires_structured_selection(self) -> None:
        assert "INSTALLED-TOOL-FIRST" in PLANNER_SYSTEM_PROMPT
        assert 'you MUST use a "tool" node' in PLANNER_SYSTEM_PROMPT
        assert (
            '"tool": {"provider_id": "<provider>", "tool_name": "<tool>", "provider_type": "<type>"}'
            in PLANNER_SYSTEM_PROMPT
        )

    def test_declares_each_producers_output_names(self) -> None:
        """B1 root cause: node configs are generated in isolated parallel calls
        that share the plan but not the producers' chosen output names, so a
        consumer references ``node3.deck`` against a code node that declared
        ``slides_json``. The plan must name them -- and only for the node types
        that choose their own names; every other type has fixed outputs."""
        assert "node_outputs" in PLANNER_SYSTEM_PROMPT
        assert '"node_outputs": {"<producer node id>": ["<output name>"]}' in PLANNER_SYSTEM_PROMPT

        # ESQ1-300: the planner's output budget runs out from the end, and a
        # truncated node list or edge list destroys the plan outright while a
        # truncated declaration only costs the contract. Spend these tokens last.
        schema = PLANNER_SYSTEM_PROMPT.partition("# Output schema")[2]
        assert schema.index('"node_outputs"') > schema.index('"edges"') > schema.index('"nodes"')

        rule = PLANNER_SYSTEM_PROMPT[PLANNER_SYSTEM_PROMPT.index("node_outputs") :][:900]
        for producer in ('"code"', '"parameter-extractor"', '"human-input"', '"llm"'):
            assert producer in rule
        assert "ONLY the names declared here" in rule


class TestFormatIdealOutputSection:
    def test_returns_empty_string_for_blank_input(self) -> None:
        assert format_ideal_output_section("") == ""
        assert format_ideal_output_section("   \n\t  ") == ""

    def test_wraps_content_in_a_labelled_section(self) -> None:
        out = format_ideal_output_section("A short summary.")

        assert out.startswith("# Ideal output")
        assert "A short summary." in out
        assert out.endswith("\n\n")


class TestToolCatalogueSections:
    def test_planner_returns_empty_when_catalogue_is_blank(self) -> None:
        assert format_planner_tool_catalogue_section("") == ""
        assert format_planner_tool_catalogue_section("   ") == ""

    def test_planner_includes_catalogue(self) -> None:
        out = format_planner_tool_catalogue_section("- google/search — Search.")

        assert "# Relevant installed tools" in out
        assert "dynamically selected" in out.lower()
        assert "- google/search — Search." in out

    def test_node_builder_returns_empty_when_catalogue_is_blank(self) -> None:
        assert format_node_tool_catalogue_section("") == ""

    def test_node_builder_requires_exact_provider_and_tool_ids(self) -> None:
        out = format_node_tool_catalogue_section("- google/search — Search.")

        assert "exact" in out.lower()
        assert "provider_id" in out
        assert "tool_name" in out
        assert "- google/search — Search." in out


class TestNodeBuilderPrompt:
    def test_only_includes_target_node_schema_and_compact_output_contract(self) -> None:
        prompt = get_node_builder_system_prompt("llm")

        assert '"config"' in prompt
        assert "- llm:" in prompt
        assert "- if-else:" not in prompt
        assert '"viewport":' not in prompt
        assert '"positionAbsolute":' not in prompt

    def test_supports_main_human_input_and_assigner_contracts(self) -> None:
        human_input = get_node_builder_system_prompt("human-input")
        assigner = get_node_builder_system_prompt("assigner")

        assert "delivery_methods" in human_input
        assert "user_actions" in human_input
        assert '"version": "2"' in assigner
        assert "variable_selector" in assigner

    def test_common_node_prompts_stay_small(self) -> None:
        sizes = [len(get_node_builder_system_prompt(node_type)) for node_type in ("start", "llm", "end")]

        assert max(sizes) < 3000

    def test_unknown_node_type_gets_minimal_fallback(self) -> None:
        prompt = get_node_builder_system_prompt("future-node")

        assert "future-node" in prompt
        assert "minimum valid config fields" in prompt


class TestNodeBuilderUserSections:
    def test_formats_start_inputs(self) -> None:
        out = format_start_inputs_section(
            [{"variable": "url", "label": "URL", "type": "text-input"}, {"variable": "", "label": "Ignored"}]
        )

        assert "variable='url'" in out
        assert "type='text-input'" in out
        assert "Ignored" not in out

    def test_empty_start_inputs_are_omitted(self) -> None:
        assert format_start_inputs_section([]) == ""

    def test_parallel_plan_is_compact_and_preserves_topology(self) -> None:
        rendered = format_parallel_plan(
            [{"id": "node1", "node_type": "start"}, {"id": "node2", "node_type": "end"}],
            [{"source": "node1", "target": "node2"}],
        )

        assert " " not in rendered
        assert json.loads(rendered)["edges"] == [{"source": "node1", "target": "node2"}]
        assert "start_inputs" not in json.loads(rendered)

    def test_parallel_plan_carries_declared_start_inputs(self) -> None:
        rendered = format_parallel_plan(
            [{"id": "node1", "node_type": "start"}],
            [],
            [{"variable": "url", "label": "URL", "type": "text-input"}],
        )

        assert json.loads(rendered)["start_inputs"] == [{"variable": "url", "label": "URL", "type": "text-input"}]

    def test_parallel_plan_never_carries_declared_node_outputs(self) -> None:
        """The declarations must NOT ride in the shared payload.

        Serialising the planner's raw ``{"<id>": ["<name>"]}`` would hand every
        consumer an llm producer's schema fields FLAT — the one reference form
        the engine cannot resolve — right underneath the section that renders
        the same node correctly. ``format_node_outputs_section`` already lists
        every declared node, type-aware, so the payload has nothing to add."""
        rendered = format_parallel_plan(
            [{"id": "node2", "node_type": "code"}],
            [{"source": "node1", "target": "node2"}],
            [{"variable": "url", "label": "URL", "type": "text-input"}],
        )

        assert "node_outputs" not in rendered
        assert set(json.loads(rendered)) == {"nodes", "edges", "start_inputs"}
        with pytest.raises(TypeError):
            format_parallel_plan([], [], None, {"node2": ["slides_json"]})  # type: ignore[call-arg]


class TestModeSection:
    def test_advanced_chat_documents_system_variables(self) -> None:
        out = format_mode_section("advanced-chat")

        assert "sys.query" in out
        assert '["sys", "query"]' in out
        assert "do NOT invent start-node variables" in out

    def test_workflow_mode_forbids_system_variables(self) -> None:
        out = format_mode_section("workflow")

        assert "NO automatic system variables" in out


class TestExistingGraphSection:
    def test_edge_lines_surface_branch_source_handles(self) -> None:
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

    def test_create_mode_renders_nothing(self) -> None:
        assert format_existing_graph_section(None) == ""


class TestNodeBuilderHandleContract:
    """ESQ1-303: the planner names a branch's outgoing handles (rule 12, one LLM
    call) and the node builder chooses the case / class / action ids (another
    call). Nothing told the builder the planner had already chosen. It sees the
    planned edges -- ``format_parallel_plan`` embeds ``edges`` with their
    ``source_handle`` -- so its snippets now make those handles the contract."""

    def test_the_planned_edges_reach_the_builder_with_their_handles(self) -> None:
        out = format_parallel_plan(
            [{"id": "node2", "label": "Check", "node_type": "if-else", "purpose": "x"}],
            [{"source": "node2", "target": "node3", "source_handle": "score_equals_60"}],
        )

        assert '"source_handle":"score_equals_60"' in out


type _JSONValue = None | bool | int | float | str | list["_JSONValue"] | dict[str, "_JSONValue"]


def _extract_example_json(snippet: str) -> dict[str, _JSONValue]:
    """Return the one JSON object embedded in a ``_NODE_SNIPPETS`` entry,
    with trailing ``#`` comments stripped.

    A snippet is prose around exactly one ``{...}`` example (see every entry
    of ``_NODE_SNIPPETS``): find the first ``{``, then scan for its matching
    ``}``, tracking quote state so neither a ``#`` inside a JSON string (the
    llm/tool/answer snippets embed literal ``{{#node.var#}}`` placeholder
    syntax in their example text) nor a brace inside a JSON string is mistaken
    for a comment marker or a structural character. Comments are dropped only
    when they appear outside a string. Raises ``ValueError``/``JSONDecodeError``
    -- not silently, and not by skipping -- when a snippet has no balanced
    object or the object is not valid JSON once comments are stripped, so a
    malformed snippet fails this test instead of vanishing from it.
    """
    depth = 0
    in_string = False
    escape = False
    start_seen = False
    chars: list[str] = []
    index = 0
    length = len(snippet)
    while index < length:
        char = snippet[index]
        if not start_seen:
            if char == "{":
                start_seen = True
                depth = 1
                chars.append(char)
            index += 1
            continue
        if in_string:
            chars.append(char)
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            in_string = True
            chars.append(char)
            index += 1
            continue
        if char == "#":
            while index < length and snippet[index] != "\n":
                index += 1
            continue
        if char == "{":
            depth += 1
            chars.append(char)
            index += 1
            continue
        if char == "}":
            depth -= 1
            chars.append(char)
            index += 1
            if depth == 0:
                return json.loads("".join(chars))
            continue
        chars.append(char)
        index += 1
    raise ValueError("snippet has no balanced {...} example to validate")


# A JSON string value that IS ENTIRELY a "<...>" token, e.g. "<src>" or
# "<provider>" -- not a placeholder embedded in a larger sentence, like the
# llm snippet's example user-prompt text, which stays prose because the
# schema only cares that the field is a string.
_WHOLE_PLACEHOLDER_RE = re.compile(r"^<([^<>]+)>$")


def _stand_in_for(placeholder_body: str) -> str:
    """A synthetic, schema-valid string for one "<...>" placeholder body.

    Every placeholder in ``_NODE_SNIPPETS`` occupies a plain ``str`` field
    (value_selector entries, model provider/name, instruction text, ...), so
    any non-empty string satisfies the engine's type; this only needs to be
    deterministic and collision-free against the sibling "n1" node id used to
    wrap the example, not semantically meaningful.
    """
    slug = re.sub(r"[^a-z0-9]+", "_", placeholder_body.lower()).strip("_")
    return f"stand-in-{slug or 'value'}"


def _substitute_placeholders(value: _JSONValue) -> _JSONValue:
    """Recursively replace whole "<...>" placeholder strings with stand-ins.

    Lists and dicts (value_selector arrays, the ``model`` object, ...) are
    walked; a string is replaced only when the ENTIRE value matches
    ``_WHOLE_PLACEHOLDER_RE`` -- a placeholder mentioned inside free-form
    prompt/instruction text is left untouched, since that text is itself the
    valid value under test (see ``_extract_example_json``'s docstring).
    """
    if isinstance(value, str):
        match = _WHOLE_PLACEHOLDER_RE.match(value)
        return _stand_in_for(match.group(1)) if match else value
    if isinstance(value, list):
        return [_substitute_placeholders(item) for item in value]
    if isinstance(value, dict):
        return {key: _substitute_placeholders(item) for key, item in value.items()}
    return value


def _node_config_for_snippet(node_type: str) -> dict[str, _JSONValue]:
    """Wrap one ``_NODE_SNIPPETS`` example as a node config, exactly the shape
    ``core.workflow.node_factory.validate_node_config`` (== ``Graph.init``'s
    node-data validation, == ``services/dify_builder/preflight.py``'s check)
    takes."""
    example = {
        key: _substitute_placeholders(value) for key, value in _extract_example_json(_NODE_SNIPPETS[node_type]).items()
    }
    return {"id": "n1", "data": {"type": node_type, "title": "T", **example}}


class TestNodeSnippetsValidateAgainstTheEngine:
    """Task 5 (docs/superpowers/triage/generator-blockers-2026-09-22/FINDINGS.md,
    Cross-cutting section): "the single highest-value test" the investigation
    found missing -- every _NODE_SNIPPETS example, wrapped as a node config,
    must pass validate_node_config, the same call
    services/dify_builder/preflight.py makes. Before Task 4 (commit
    4deede53b5), this test failed on parameter-extractor: the snippet's
    ``"query": [["<src>", "<var>"]]`` is an array of value_selector arrays,
    but graphon's ParameterExtractorNodeData.query is ``list[str]`` -- ONE
    selector. It only passes with Task 4's fix (``"query": ["<src>", "<var>"]``)
    applied."""

    def test_every_snippet_is_exercised(self) -> None:
        # Guards the parametrize below against silently collapsing to zero
        # cases (an empty _NODE_SNIPPETS would make it pass by vacuum).
        assert _NODE_SNIPPETS, "expected at least one _NODE_SNIPPETS entry to validate standalone"

    @pytest.mark.parametrize("node_type", sorted(_NODE_SNIPPETS))
    def test_snippet_validates_against_the_engine(self, node_type: str) -> None:
        # Raises ValueError prefixed "node 'n1' (<type>): ..." (see
        # validate_node_config's docstring) on any schema mismatch; letting it
        # propagate here IS the test -- no try/except that could hide a
        # regression as a pass.
        validate_node_config(_node_config_for_snippet(node_type))
