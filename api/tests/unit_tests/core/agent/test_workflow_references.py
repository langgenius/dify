"""Unit tests for core.agent.workflow_references.

Covers the pure helpers that parse frontend ``{{#node.output#}}`` workflow
variable markers: ``extract_workflow_variable_selectors`` (raw selector
extraction), ``extract_workflow_node_output_selectors`` (reserved namespace
filtering plus de-duplication), and
``workflow_previous_node_output_refs_from_selectors`` (materializing persisted
previous-node refs). These helpers do not touch application services, so the
tests pin the parsing and filtering contracts directly.
"""

import pytest

from core.agent.workflow_references import (
    WORKFLOW_NODE_OUTPUT_RESERVED_PREFIXES,
    extract_workflow_node_output_selectors,
    extract_workflow_variable_selectors,
    workflow_previous_node_output_refs_from_selectors,
)

# =========================================================
# extract_workflow_variable_selectors
# =========================================================


def test_extract_variable_selectors_returns_empty_for_empty_prompt() -> None:
    assert extract_workflow_variable_selectors("") == []


def test_extract_variable_selectors_returns_empty_without_markers() -> None:
    assert extract_workflow_variable_selectors("plain text without markers") == []


def test_extract_variable_selectors_parses_single_marker() -> None:
    assert extract_workflow_variable_selectors("{{#node.output#}}") == [("node", "output")]


def test_extract_variable_selectors_parses_multiple_markers() -> None:
    prompt = "before {{#first.value#}} middle {{#second.value#}} after"

    assert extract_workflow_variable_selectors(prompt) == [("first", "value"), ("second", "value")]


def test_extract_variable_selectors_strips_whitespace_around_parts() -> None:
    assert extract_workflow_variable_selectors("{{#  node  .  output  #}}") == [("node", "output")]


def test_extract_variable_selectors_keeps_extra_segments() -> None:
    assert extract_workflow_variable_selectors("{{#node.output.extra#}}") == [("node", "output", "extra")]


def test_extract_variable_selectors_ignores_markers_without_a_dot() -> None:
    assert extract_workflow_variable_selectors("{{#single#}}") == []


def test_extract_variable_selectors_does_not_deduplicate() -> None:
    prompt = "{{#node.output#}} and again {{#node.output#}}"

    assert extract_workflow_variable_selectors(prompt) == [("node", "output"), ("node", "output")]


# =========================================================
# extract_workflow_node_output_selectors
# =========================================================


def test_node_output_selectors_keeps_regular_previous_node() -> None:
    assert extract_workflow_node_output_selectors("{{#node.output#}}") == [("node", "output")]


@pytest.mark.parametrize("prefix", sorted(WORKFLOW_NODE_OUTPUT_RESERVED_PREFIXES))
def test_node_output_selectors_excludes_reserved_prefixes(prefix: str) -> None:
    assert extract_workflow_node_output_selectors(f"{{{{#{prefix}.value#}}}}") == []


def test_node_output_selectors_keeps_non_reserved_neighbors() -> None:
    prompt = "{{#node.output#}}{{#sys.files#}}{{#other.thing#}}"

    assert extract_workflow_node_output_selectors(prompt) == [("node", "output"), ("other", "thing")]


def test_node_output_selectors_deduplicates_preserving_order() -> None:
    prompt = "{{#a.b#}}{{#c.d#}}{{#a.b#}}"

    assert extract_workflow_node_output_selectors(prompt) == [("a", "b"), ("c", "d")]


def test_node_output_selectors_returns_empty_for_empty_prompt() -> None:
    assert extract_workflow_node_output_selectors("") == []


# =========================================================
# workflow_previous_node_output_refs_from_selectors
# =========================================================


def test_previous_node_output_refs_from_selectors_materializes_refs() -> None:
    refs = workflow_previous_node_output_refs_from_selectors([("node", "output")])

    assert len(refs) == 1
    assert refs[0].selector == ["node", "output"]
    assert refs[0].node_id == "node"
    assert refs[0].output == "output"


def test_previous_node_output_refs_from_selectors_keeps_order() -> None:
    refs = workflow_previous_node_output_refs_from_selectors([("first", "a"), ("second", "b")])

    assert [ref.node_id for ref in refs] == ["first", "second"]
    assert [ref.output for ref in refs] == ["a", "b"]


def test_previous_node_output_refs_from_selectors_returns_empty_for_no_selectors() -> None:
    assert workflow_previous_node_output_refs_from_selectors([]) == []


def test_previous_node_output_refs_from_selectors_uses_first_two_segments() -> None:
    refs = workflow_previous_node_output_refs_from_selectors([("node", "output", "extra")])

    assert refs[0].selector == ["node", "output", "extra"]
    assert refs[0].node_id == "node"
    assert refs[0].output == "output"
