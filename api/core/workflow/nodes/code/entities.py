from typing import Literal, Optional

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector


class CodeNodeData(BaseNodeData):
    """
    Code Node Data.
    """
    class Output(BaseModel):
        type: Literal['string', 'number', 'object', 'array[string]', 'array[number]', 'array[object]']
        children: Optional[dict[str, 'Output']]

    variables: list[VariableSelector]
    code_language: Literal['python3', 'javascript']
    code: str
    outputs: dict[str, Output]