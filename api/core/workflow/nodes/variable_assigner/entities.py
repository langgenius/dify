from typing import Any, Literal, Optional, Union

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector


class VariableAssignerNodeData(BaseNodeData):
    """
    Knowledge retrieval Node Data.
    """
    title: str
    desc: str
    type: str = 'variable-assigner'
    output_type: str
    variables: list[str]
