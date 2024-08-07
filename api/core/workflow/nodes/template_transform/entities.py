

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector


class TemplateTransformNodeData(BaseNodeData):
    """
    Code Node Data.
    """
    variables: list[VariableSelector]
    template: str