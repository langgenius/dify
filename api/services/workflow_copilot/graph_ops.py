"""Pure, client-side graph mutation helpers.

Dify's ``sync_draft_workflow`` has no server-side patch primitive: it always
replaces the whole draft graph. The adapter (``dify_port.py``) therefore
reads the current graph, applies mutations like ``apply_set_node_config``
locally, and writes the whole mutated graph back. These helpers do the local
mutation only — no DB, no services, no I/O.
"""

import copy
from typing import Any

from core.workflow_copilot.models import Graph


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
