"""Builder's first-phase node boundary, shared by candidates and draft writes.

Judge proposed native operations rather than the historical graph's contents.
Existing Agent/HITL nodes can receive otherwise permitted repairs; Retrieval
configuration stays frozen until its resource integration is implemented.
This policy neither changes the native runtime nor authorizes Agent bindings.
"""

import copy
from collections.abc import Mapping
from typing import Any

from core.dify_builder.models import Graph, MutationIntent
from core.workflow.nodes.agent_v2.discriminator import is_dify_agent_node_data
from graphon.enums import BuiltinNodeTypes
from services.dify_builder import graph_ops

_UNAVAILABLE_ADDITIONS = frozenset(
    {BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, BuiltinNodeTypes.HUMAN_INPUT, BuiltinNodeTypes.AGENT}
)


def _node_data(graph: Graph, node_id: str) -> Mapping[str, Any]:
    for node in graph.get("nodes") or []:
        if isinstance(node, Mapping) and node.get("id") == node_id:
            data = node.get("data")
            return data if isinstance(data, Mapping) else {}
    return {}


def proposal_policy_rejections(graph: Graph, intents: list[MutationIntent]) -> list[str]:
    """Reasons the entire proposal must be refused, without echoing config values.

    Use the same native helpers and original-graph replay predicate as the dry
    run and write owner. Evaluate operations in sequence, so type conversions
    and the native Agent v2 discriminator cannot disguise an unavailable new
    node. Malformed operations remain the structural validator's responsibility
    and never advance this working copy. No intents or source data are changed,
    and no unrelated valid operations are silently removed from a mixed batch.
    """
    working = copy.deepcopy(graph)
    already_present = graph_ops.already_present_predicate(graph, intents)
    reasons: list[str] = []
    for intent in intents:
        if already_present(intent):
            continue
        try:
            graph_ops.validate_intent_args(intent)
            after, changed = graph_ops.APPLY_FNS[intent.op](working, **intent.args)
        except Exception:
            # Existing structural/native validation explains malformed proposals.
            continue
        if intent.op in ("create_node", "insert_between"):
            node_type = intent.args["node_type"]
            if node_type in _UNAVAILABLE_ADDITIONS:
                reasons.append(f"{intent.op}: adding {node_type!r} nodes is unavailable in Builder's first phase")
        elif intent.op == "set_node_config":
            node_id = changed[0]
            before_data = _node_data(working, node_id)
            after_data = _node_data(after, node_id)
            before_type, after_type = before_data.get("type"), after_data.get("type")
            if before_type == BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL and before_data != after_data:
                reasons.append(
                    f"set_node_config: changing knowledge-retrieval configuration on node {node_id!r} "
                    "is unavailable in Builder's first phase"
                )
            elif isinstance(after_type, str) and after_type in _UNAVAILABLE_ADDITIONS and before_type != after_type:
                reasons.append(
                    f"set_node_config: converting node {node_id!r} to {after_type!r} "
                    "is unavailable in Builder's first phase"
                )
            elif is_dify_agent_node_data(after_data) and not is_dify_agent_node_data(before_data):
                reasons.append(
                    f"set_node_config: converting node {node_id!r} to New Agent "
                    "is unavailable in Builder's first phase until published-resource binding is implemented"
                )
        working = after
    return reasons
