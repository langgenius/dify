from typing import TYPE_CHECKING, Any

from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeType
from core.workflow.graph import Node, NodeFactory

from .node_mapping import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams, GraphRuntimeState


class DifyNodeFactory(NodeFactory):
    """
    Default implementation of NodeFactory that uses the traditional node mapping.

    This factory creates nodes by looking up their types in NODE_TYPE_CLASSES_MAPPING
    and instantiating the appropriate node class.
    """

    def __init__(
        self,
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
    ) -> None:
        self.graph_init_params = graph_init_params
        self.graph_runtime_state = graph_runtime_state

    def create_node(
        self,
        node_config: dict[str, Any],
    ) -> Node:
        """
        Create a Node instance from node configuration data using the traditional mapping.

        :param node_config: node configuration dictionary containing type and other data
        :return: initialized Node instance
        :raises ValueError: if node type is unknown or configuration is invalid
        """
        # Get node_id from config
        node_id = node_config.get("id")
        if not node_id:
            raise ValueError("Node config missing id")

        # Get node type from config
        node_data = node_config.get("data", {})
        node_type_str = node_data.get("type")
        if not node_type_str:
            raise ValueError(f"Node {node_id} missing type information")

        try:
            node_type = NodeType(node_type_str)
        except ValueError:
            raise ValueError(f"Unknown node type: {node_type_str}")

        # Get node class
        node_mapping = NODE_TYPE_CLASSES_MAPPING.get(node_type)
        if not node_mapping:
            raise ValueError(f"No class mapping found for node type: {node_type}")

        node_class = node_mapping.get(LATEST_VERSION)
        if not node_class:
            raise ValueError(f"No latest version class found for node type: {node_type}")

        # Create node instance
        node_instance = node_class(
            id=node_id,
            config=node_config,
            graph_init_params=self.graph_init_params,
            graph_runtime_state=self.graph_runtime_state,
        )

        # Initialize node with provided data
        node_data = node_config.get("data", {})
        node_instance.init_node_data(node_data)

        # If node has fail branch, change execution type to branch
        if node_instance.error_strategy == ErrorStrategy.FAIL_BRANCH:
            node_instance.execution_type = NodeExecutionType.BRANCH

        return node_instance
