from core.dify_builder.changes import describe_changed_nodes, describe_proposed_nodes
from core.dify_builder.models import ChangedNode, MutationIntent


def test_changed_nodes_preserve_deleted_names_and_deduplicate_in_order():
    before = {
        "nodes": [{"id": "removed", "data": {"title": "Old answer"}}, {"id": "renamed", "data": {"title": "Old"}}]
    }
    after = {"nodes": [{"id": "renamed", "data": {"title": "New answer"}}]}

    assert describe_changed_nodes(["renamed", "removed", "renamed", "unknown"], before, after) == [
        ChangedNode(node_id="renamed", title="New answer"),
        ChangedNode(node_id="removed", title="Old answer"),
        ChangedNode(node_id="unknown"),
    ]


def test_proposed_nodes_include_connection_endpoints_and_explicit_new_nodes():
    graph = {"nodes": [{"id": "source", "data": {"title": "Start"}}, {"id": "target", "data": {"title": "Answer"}}]}
    intents = [
        MutationIntent(op="set_node_config", args={"node_id": "source", "path": "title", "value": "Start"}),
        MutationIntent(op="connect", args={"from_node": "source", "to_node": "target"}),
        MutationIntent(op="delete_node", args={"node_id": "target"}),
        MutationIntent(
            op="insert_between",
            args={
                "edge": {"source": "source", "target": "target"},
                "node_id": "gate",
                "node_type": "code",
                "config": {"title": "Review gate"},
            },
        ),
        MutationIntent(op="create_node", args={"node_type": "llm", "config": {}}),
    ]

    assert describe_proposed_nodes(intents, graph) == [
        ChangedNode(node_id="source", title="Start"),
        ChangedNode(node_id="target", title="Answer"),
        ChangedNode(node_id="gate", title="Review gate"),
    ]
