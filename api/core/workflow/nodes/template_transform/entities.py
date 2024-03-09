from typing import Literal, Union

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector


class TemplateTransformNodeData(BaseNodeData):
    """
    Code Node Data.
    """
    variables: list[VariableSelector]
    template: str