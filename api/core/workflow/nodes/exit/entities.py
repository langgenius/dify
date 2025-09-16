from pydantic import Field

from core.workflow.entities.variable_entities import VariableSelector
from core.workflow.nodes.base import BaseNodeData


class ExitNodeData(BaseNodeData):
    """
    EXIT Node Data.
    """

    outputs: list[VariableSelector] = Field(default_factory=list)
