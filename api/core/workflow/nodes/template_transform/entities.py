from core.workflow.enums import NodeType
from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.base.entities import VariableSelector


class TemplateTransformNodeData(BaseNodeData):
    """
    Template Transform Node Data.
    """

    type: NodeType = NodeType.TEMPLATE_TRANSFORM
    variables: list[VariableSelector]
    template: str
