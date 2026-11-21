"""The graph config `Graph.init` accepts, typed: one `NodeConfigDict` per node, plus the editor's edges.

`Graph.init` takes a plain `Mapping[str, Any]` and re-validates the nodes it needs, so callers were left
building untyped dicts and hoping the shape matched. The shapes below are that contract, and callers parse
their raw config once at the boundary (`TypeAdapter(WorkflowGraphConfigDict).validate_python(raw)`) and keep
the typed value.

Invariants:
- Every node entry keys `id` and `data`; `data` is a `BaseNodeData` subclass instance once validated.
- Every edge keys `id`, `source` and `target`; graphon ignores any other key an editor stored on it.
"""

from typing import TypedDict

from pydantic import with_config

from graphon.entities.graph_config import NodeConfigDict

__all__ = ["WorkflowGraphConfigDict", "WorkflowGraphEdgeDict"]


@with_config(extra="allow")
class WorkflowGraphEdgeDict(TypedDict):
    """An edge as the editor stores it.

    Precondition: `source` and `target` name node ids present in the same graph config, resolved later by
    `Graph.init`. Postcondition: graphon reads only `id`, `source`, `target` and `sourceHandle`, so any other
    stored key is carried along untouched instead of being rejected.
    """

    id: str
    source: str
    target: str


@with_config(extra="allow")
class WorkflowGraphConfigDict(TypedDict):
    """A graph config whose nodes already carry typed node data.

    Precondition: each `nodes` entry has an `id` and a `data` the graphon entity for that node type parses.
    Postcondition: `Graph.init(graph_config=cfg, ...)` accepts the value unchanged, because graphon normalises
    `BaseNodeData` instances back to mapping form itself.
    """

    nodes: list[NodeConfigDict]
    edges: list[WorkflowGraphEdgeDict]
