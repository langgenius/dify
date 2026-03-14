"""Node mapping for workflow execution.

`core.workflow` owns the trigger node implementations, while the remaining node
implementations still live under `dify_graph`. This module imports the
core-owned node packages first, then asks the shared `Node` registry to load the
rest of the workflow nodes from `dify_graph`.
"""

import importlib
import pkgutil
from collections.abc import Mapping

from dify_graph.enums import NodeType
from dify_graph.nodes.base.node import Node

LATEST_VERSION = "latest"


def _register_core_workflow_nodes() -> None:
    import core.workflow.nodes as workflow_nodes_pkg

    for _, modname, _ in pkgutil.walk_packages(workflow_nodes_pkg.__path__, workflow_nodes_pkg.__name__ + "."):
        if modname == "core.workflow.nodes.node_mapping":
            continue
        importlib.import_module(modname)


_register_core_workflow_nodes()

NODE_TYPE_CLASSES_MAPPING: Mapping[NodeType, Mapping[str, type[Node]]] = Node.get_node_type_classes_mapping()
