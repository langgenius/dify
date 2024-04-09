from core.app.app_config.entities import VariableEntity
from core.workflow.entities.base_node_data_entities import BaseNodeData


class StartNodeData(BaseNodeData):
    """
    Start Node Data
    """
    variables: list[VariableEntity] = []
