

from core.workflow.entities.base_node_data_entities import BaseNodeData


class VariableAssignerNodeData(BaseNodeData):
    """
    Knowledge retrieval Node Data.
    """
    title: str
    desc: str
    type: str = 'variable-assigner'
    output_type: str
    variables: list[str]
