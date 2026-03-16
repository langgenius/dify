from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.enums import BuiltinNodeTypes, NodeType
from dify_graph.nodes.base.entities import VariableSelector


class TemplateTransformNodeData(BaseNodeData):
    """
    Template Transform Node Data.
    """

    type: NodeType = BuiltinNodeTypes.TEMPLATE_TRANSFORM
    variables: list[VariableSelector]
    template: str
