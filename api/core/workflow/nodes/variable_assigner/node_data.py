from collections.abc import Sequence
from enum import Enum
from typing import Optional

from core.workflow.entities.base_node_data_entities import BaseNodeData


class WriteMode(str, Enum):
    OVER_WRITE = 'over-write'
    APPEND = 'append'
    CLEAR = 'clear'


class VariableAssignerData(BaseNodeData):
    title: str = 'Variable Assigner'
    desc: Optional[str] = 'Assign a value to a variable'
    assigned_variable_selector: Sequence[str]
    write_mode: WriteMode
    input_variable_selector: Sequence[str]
