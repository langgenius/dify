"""Pure, client-side graph mutation helpers.

Dify's ``sync_draft_workflow`` has no server-side patch primitive: it always
replaces the whole draft graph. The adapter (``dify_port.py``) therefore
reads the current graph, applies mutations like ``apply_set_node_config``
locally, and writes the whole mutated graph back. These helpers do the local
mutation only — no DB, no services, no I/O.
"""

import copy
from typing import Any

from core.workflow_copilot.models import Graph, MutationIntent

MUTATION_ARG_KEYS: dict[str, tuple[str, ...]] = {
    "set_node_config": ("node_id", "path", "value"),
    "create_node": ("node_type", "config"),
    "delete_node": ("node_id",),
    "connect": ("from_node", "to_node"),
    "insert_between": ("edge", "node_type", "config"),
}


def validate_intent_args(intent: MutationIntent) -> None:
    """Raise ``ValueError`` if ``intent.args`` is missing a required key for
    ``intent.op``, or if ``intent.op`` isn't one of ``MUTATION_ARG_KEYS``'s
    five recognized verbs. Optional keys (marked ``?`` on ``MutationIntent``)
    are not checked here -- each ``apply_*`` function defaults them itself.
    """
    required = MUTATION_ARG_KEYS.get(intent.op)
    if required is None:
        raise ValueError(f"unknown mutation op: {intent.op!r}")
    missing = [key for key in required if key not in intent.args]
    if missing:
        raise ValueError(f"missing required arg(s) {missing} for op {intent.op!r}")


def apply_set_node_config(graph: Graph, node_id: str, path: str, value: Any) -> tuple[Graph, list[str]]:
    """Set ``node["data"][path] = value`` for the node whose ``id == node_id``.

    The placeholder agent emits intents shaped ``{node_id, path, value}``
    (e.g. ``path="code"`` to rewrite a Code node's ``data["code"]``); this is
    the mutation that consumes them.

    Returns a ``(new_graph, changed_node_ids)`` tuple. ``graph`` is
    deep-copied first and never mutated. Raises ``ValueError`` if no node in
    ``graph["nodes"]`` has a matching ``id``.
    """
    new_graph = copy.deepcopy(graph)

    for node in new_graph.get("nodes", []):
        if node.get("id") == node_id:
            node.setdefault("data", {})[path] = value
            return new_graph, [node_id]

    raise ValueError(f"node not found: {node_id}")
