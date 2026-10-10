"""First-phase policy judges actual native operations, preserving historical drafts."""

import copy

import pytest

from core.dify_builder.models import MutationIntent
from services.dify_builder.node_policy import proposal_policy_rejections


def _historical_graph():
    return {
        "nodes": [
            {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
            {
                "id": "r",
                "type": "custom",
                "data": {
                    "type": "knowledge-retrieval",
                    "title": "Knowledge",
                    "dataset_ids": ["kb-1"],
                    "retrieval_mode": "multiple",
                },
            },
            {"id": "a", "type": "custom", "data": {"type": "agent", "title": "Legacy"}},
            {"id": "h", "type": "custom", "data": {"type": "human-input", "title": "Review"}},
            {
                "id": "v2",
                "type": "custom",
                "data": {"type": "agent", "title": "New Agent", "version": "2", "agent_node_kind": "dify_agent"},
            },
        ],
        "edges": [],
    }


@pytest.mark.parametrize("node_id", ["s", "a", "h", "v2"])
def test_historical_nodes_allow_otherwise_permitted_repairs_without_mutating_source(node_id):
    graph = _historical_graph()
    intent = MutationIntent(op="set_node_config", args={"node_id": node_id, "path": "title", "value": "Repaired"})
    original = copy.deepcopy(graph)

    assert proposal_policy_rejections(graph, [intent]) == []
    assert graph == original


@pytest.mark.parametrize("node_type", ["knowledge-retrieval", "human-input", "agent"])
def test_existing_create_replay_is_still_a_noop(node_type):
    graph = _historical_graph()
    node_id = {"knowledge-retrieval": "r", "human-input": "h", "agent": "a"}[node_type]
    intent = MutationIntent(op="create_node", args={"node_id": node_id, "node_type": node_type, "config": {}})

    assert proposal_policy_rejections(graph, [intent]) == []


def test_delete_then_recreate_existing_forbidden_id_is_a_new_addition():
    graph = _historical_graph()
    intents = [
        MutationIntent(op="delete_node", args={"node_id": "a"}),
        MutationIntent(op="create_node", args={"node_id": "a", "node_type": "agent", "config": {}}),
    ]

    assert proposal_policy_rejections(graph, intents)


def test_retrieval_unchanged_binding_and_agent_discriminator_fields_are_permitted():
    graph = _historical_graph()
    intents = [
        MutationIntent(op="set_node_config", args={"node_id": "r", "path": "dataset_ids", "value": ["kb-1"]}),
        MutationIntent(op="set_node_config", args={"node_id": "v2", "path": "version", "value": "2"}),
        MutationIntent(op="set_node_config", args={"node_id": "v2", "path": "agent_node_kind", "value": "dify_agent"}),
    ]

    assert proposal_policy_rejections(graph, intents) == []


def test_malformed_proposals_leave_rejection_to_existing_native_validation():
    graph = _historical_graph()
    malformed = [
        MutationIntent(op="set_node_config", args={"node_id": "r", "path": "dataset_ids"}),
        MutationIntent(op="create_node", args={"node_type": "agent", "config": None}),
        MutationIntent(op="set_node_config", args={"node_id": "absent", "path": "type", "value": "agent"}),
    ]

    assert proposal_policy_rejections(graph, malformed) == []


def test_rejections_identify_operation_without_echoing_config_values():
    intents = [MutationIntent(op="create_node", args={"node_type": "agent", "config": {"api_key": "live-secret"}})]

    reasons = proposal_policy_rejections({"nodes": [], "edges": []}, intents)

    assert reasons
    assert "create_node" in reasons[0]
    assert "agent" in reasons[0]
    assert "live-secret" not in "\n".join(reasons)


@pytest.mark.parametrize("value", [["agent"], {"type": "agent"}])
def test_non_string_type_conversion_remains_a_native_validation_problem(value):
    intent = MutationIntent(op="set_node_config", args={"node_id": "s", "path": "type", "value": value})

    assert proposal_policy_rejections(_historical_graph(), [intent]) == []
