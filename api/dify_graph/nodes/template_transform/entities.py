from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.enums import NodeType
from dify_graph.nodes.base.entities import VariableSelector


class TemplateTransformNodeData(BaseNodeData):
    """
    Template Transform Node Data.
    """

    type: NodeType = NodeType.TEMPLATE_TRANSFORM
    variables: list[VariableSelector]
    template: str
