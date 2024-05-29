

from typing import Literal, Optional

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData


class AdvancedSetting(BaseModel):
    """
    Advanced setting.
    """
    group_enabled: bool

    class Group(BaseModel):
        """
        Group.
        """
        output_type: Literal['string', 'number', 'array', 'object']
        variables: list[list[str]]
        group_name: str

    groups: list[Group]

class VariableAssignerNodeData(BaseNodeData):
    """
    Knowledge retrieval Node Data.
    """
    type: str = 'variable-assigner'
    output_type: str
    variables: list[list[str]]
    advanced_setting: Optional[AdvancedSetting]