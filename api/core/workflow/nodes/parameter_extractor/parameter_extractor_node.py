from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.parameter_extractor.entities import ParameterExtractorNodeData


class ParameterExtractorNode(BaseNode):
    """
    Parameter Extractor Node.
    """
    _node_data_cls = ParameterExtractorNodeData
    _node_type = NodeType.PARAMETER_EXTRACTOR

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run the node.
        """