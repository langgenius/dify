from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector


class AnswerNodeData(BaseNodeData):
    """
    Answer Node Data.
    """
    variables: list[VariableSelector] = []
    answer: str
