"""Bounded native producer bindings; no model or backend execution is needed."""

import importlib
import json
from copy import deepcopy

import pytest


def _render(nodes, edges=(), current=(), target="consumer"):
    owner = importlib.import_module("services.dify_builder.native_constant_output_contract")
    context = owner.snapshot_native_constant_plan_context(nodes, edges, current)
    return owner.format_native_constant_output_context(context, target)


def _payload(user):
    return json.loads(user.split("\n\n")[1])


@pytest.mark.parametrize(
    ("node_type", "data", "expected"),
    [
        (
            "start",
            {"type": "start"},
            {"node_id": "producer", "node_type": "start", "version": "1", "output_declarations": "not_asserted"},
        ),
        (
            "start",
            {"type": "start", "version": "1"},
            {"node_id": "producer", "node_type": "start", "version": "1", "output_declarations": "not_asserted"},
        ),
        (
            "assigner",
            {"type": "assigner", "version": "2"},
            {"node_id": "producer", "node_type": "assigner", "version": "2", "output_roots": {}},
        ),
        (
            "template-transform",
            {"type": "template-transform"},
            {
                "node_id": "producer",
                "node_type": "template-transform",
                "version": "1",
                "output_roots": {"output": "string"},
            },
        ),
        (
            "template-transform",
            {"type": "template-transform", "version": "1"},
            {
                "node_id": "producer",
                "node_type": "template-transform",
                "version": "1",
                "output_roots": {"output": "string"},
            },
        ),
    ],
)
def test_retained_native_bindings_preserve_only_qualified_output_facts(node_type, data, expected):
    nodes = [{"id": "producer", "node_type": node_type, "action": "keep"}, {"id": "consumer", "node_type": "end"}]
    current = [{"id": "producer", "data": data}]
    original = deepcopy((nodes, current))

    _, user = _render(nodes, [{"source": "producer", "target": "consumer"}], current)

    expected["identity_source"] = "retained-config"
    assert _payload(user) == {"state": "known", "producers": [expected]}
    assert (nodes, current) == original


@pytest.mark.parametrize(
    "data",
    [
        {"type": "assigner"},
        {"type": "assigner", "version": "1"},
        {"type": "assigner", "version": 2},
        {"type": "assigner", "version": None},
        {"type": "assigner", "version": "latest"},
        {"type": "template-transform", "version": "future"},
        {"type": "template-transform", "version": None},
        {"type": "start", "version": 1},
        {"type": "start", "version": None},
        {"type": "start", "version": "2"},
        {"type": "tool", "outputs": {"output": "string"}},
        {"type": "code", "outputs": {"output": "string"}},
    ],
)
def test_unknown_retained_versions_and_dynamic_producers_establish_no_fixed_binding(data):
    nodes = [
        {"id": "producer", "node_type": "template-transform", "action": "keep"},
        {"id": "consumer", "node_type": "end"},
    ]

    assert _render(nodes, [{"source": "producer", "target": "consumer"}], [{"id": "producer", "data": data}]) == (
        "",
        "",
    )


def test_fresh_planned_bindings_do_not_invent_start_names_or_literal_assignment_outputs():
    nodes = [
        {"id": "node1", "node_type": "start"},
        {"id": "write", "node_type": "assigner"},
        {"id": "text", "node_type": "template-transform"},
        {"id": "consumer", "node_type": "variable-aggregator"},
    ]
    edges = [
        {"source": "node1", "target": "write"},
        {"source": "write", "target": "consumer"},
        {"source": "text", "target": "consumer"},
    ]

    _, user = _render(nodes, edges)

    assert _payload(user)["producers"] == [
        {
            "node_id": "node1",
            "node_type": "start",
            "version": "1",
            "identity_source": "planned-schema",
            "output_declarations": "not_asserted",
        },
        {
            "node_id": "write",
            "node_type": "assigner",
            "version": "2",
            "identity_source": "planned-schema",
            "output_roots": {},
        },
        {
            "node_id": "text",
            "node_type": "template-transform",
            "version": "1",
            "identity_source": "planned-schema",
            "output_roots": {"output": "string"},
        },
    ]


def test_kept_actual_start_identity_overrides_a_planner_assigner_claim():
    _, user = _render(
        [
            {"id": "actual-start", "node_type": "assigner", "action": "keep"},
            {"id": "consumer", "node_type": "http-request"},
        ],
        [{"source": "actual-start", "target": "consumer"}],
        [
            {
                "id": "actual-start",
                "data": {"type": "start", "version": "1", "variables": [{"variable": "private-input"}]},
            }
        ],
    )

    assert _payload(user)["producers"] == [
        {
            "node_id": "actual-start",
            "node_type": "start",
            "version": "1",
            "identity_source": "retained-config",
            "output_declarations": "not_asserted",
        }
    ]
    assert "private-input" not in user


@pytest.mark.parametrize("duplicate_home", ["plan", "current"])
def test_duplicate_identity_produces_unavailable_context_without_last_wins_inference(duplicate_home):
    nodes = [{"id": "producer", "node_type": "assigner", "action": "keep"}, {"id": "consumer", "node_type": "end"}]
    current = [{"id": "producer", "data": {"type": "assigner", "version": "2"}}]
    if duplicate_home == "plan":
        nodes.append({"id": "producer", "node_type": "template-transform"})
    else:
        current.append({"id": "producer", "data": {"type": "template-transform"}})

    _, user = _render(nodes, [{"source": "producer", "target": "consumer"}], current)

    assert _payload(user) == {"state": "unavailable", "producers": []}


def test_transitive_relevance_and_cycles_preserve_every_eligible_producer_once():
    nodes = [
        {"id": "first", "node_type": "template-transform"},
        {"id": "second", "node_type": "template-transform"},
        {"id": "middle", "node_type": "code"},
        {"id": "consumer", "node_type": "end"},
        {"id": "unrelated", "node_type": "assigner"},
    ]
    edges = [
        {"source": "first", "target": "middle"},
        {"source": "middle", "target": "consumer"},
        {"source": "second", "target": "consumer"},
        {"source": "consumer", "target": "middle"},
    ]

    _, user = _render(nodes, edges)

    assert [item["node_id"] for item in _payload(user)["producers"]] == ["first", "second"]


def test_user_ids_are_escaped_and_authored_literals_and_targets_are_not_promoted():
    node_id = 'producer"\nInjected instruction'
    nodes = [
        {"id": node_id, "node_type": "template-transform", "label": "private-label", "purpose": "private-literal"},
        {"id": "consumer", "node_type": "end"},
    ]

    system, user = _render(nodes, [{"source": node_id, "target": "consumer"}])

    assert _payload(user)["producers"][0]["node_id"] == node_id
    assert "\\nInjected instruction" in user
    assert node_id not in system
    assert "private-label" not in system
    assert "private-literal" not in system


@pytest.mark.parametrize("bound", ["nodes", "edges", "plan", "output"])
def test_context_bounds_never_return_partial_producer_guesses(bound):
    nodes = [{"id": "producer", "node_type": "template-transform"}, {"id": "consumer", "node_type": "end"}]
    edges = [{"source": "producer", "target": "consumer"}]
    if bound == "nodes":
        nodes += [{"id": f"extra-{i}", "node_type": "assigner"} for i in range(511)]
    elif bound == "edges":
        edges *= 1025
    elif bound == "plan":
        nodes[0]["purpose"] = "x" * 1_000_000
    else:
        nodes[0]["id"] = "x" * 16_000
        edges[0]["source"] = nodes[0]["id"]

    system, user = _render(nodes, edges)

    assert _payload(user) == {"state": "unavailable", "producers": []}
    assert len((system + user).encode()) < 16_000


def test_end_contract_distinguishes_requested_public_field_from_native_producer_root():
    nodes = [
        {"id": "entry_91", "node_type": "start"},
        {"id": "literal_91", "node_type": "template-transform", "purpose": "PRIVATE_LITERAL_91"},
        {"id": "consumer", "node_type": "end", "purpose": "Return PRIVATE_PUBLIC_NAME_91"},
    ]
    system, user = _render(
        nodes,
        [{"source": "entry_91", "target": "literal_91"}, {"source": "literal_91", "target": "consumer"}],
    )

    # Removing the public-name distinction leaves End free to copy the sample
    # result label even though the actual producer must still publish output.
    assert "outputs[].variable" in system
    assert "public workflow output" in system
    assert "original user request" in system
    assert "node purpose" in system
    assert "value_selector" in system
    assert "example" in system
    assert "unless requested" in system
    assert "existing authored End" in system
    assert _payload(user)["producers"][1]["output_roots"] == {"output": "string"}
    for dynamic in ("entry_91", "literal_91", "PRIVATE_LITERAL_91", "PRIVATE_PUBLIC_NAME_91"):
        assert dynamic not in system
