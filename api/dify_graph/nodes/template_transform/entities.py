from dify_graph.nodes.base import BaseNodeData
from dify_graph.nodes.base.entities import VariableSelector


class TemplateTransformNodeData(BaseNodeData):
    """
    Template Transform Node Data.
    """

    variables: list[VariableSelector]
    template: str
