"""Project native container ownership into Dify's response metadata."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from graphon.enums import BuiltinNodeTypes
from graphon.graph.scoping import resolve_container_id


@dataclass(frozen=True)
class ContainerAncestry:
    iteration_id: str | None = None
    loop_id: str | None = None


class WorkflowEventAncestry:
    """Resolve nearest typed ancestors without conflating occurrence IDs and node IDs.

    Graphon event.id remains the native occurrence key. container_id is topology;
    traversal frame_id remains the execution frame identity and is never substituted
    with a container node ID.
    """

    def __init__(self, graph_config: Mapping[str, Any]) -> None:
        self._nodes = {node["id"]: node for node in graph_config.get("nodes", []) if node.get("type") != "custom-note"}

    def resolve(self, container_id: str) -> ContainerAncestry:
        iteration_id = loop_id = None
        visited: set[str] = set()
        while container_id:
            if container_id in visited or container_id not in self._nodes:
                raise ValueError("Invalid workflow event container ancestry")
            visited.add(container_id)
            node = self._nodes[container_id]
            node_type = node["data"]["type"]
            if node_type == BuiltinNodeTypes.ITERATION and iteration_id is None:
                iteration_id = container_id
            if node_type == BuiltinNodeTypes.LOOP and loop_id is None:
                loop_id = container_id
            container_id = resolve_container_id(node, nodes_by_id=self._nodes)
        return ContainerAncestry(iteration_id=iteration_id, loop_id=loop_id)
