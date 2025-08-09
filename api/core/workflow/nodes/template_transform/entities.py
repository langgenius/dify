from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.base.entities import VariableSelector


class TemplateTransformNodeData(BaseNodeData):
    """
    Template Transform Node Data.
    """

    variables: list[VariableSelector]
    template: str
