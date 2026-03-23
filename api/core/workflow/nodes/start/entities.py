from collections.abc import Sequence

from pydantic import Field

from core.workflow.nodes.base import BaseNodeData
from core.workflow.variables.input_entities import VariableEntity


class StartNodeData(BaseNodeData):
    """
    Start Node Data
    """

    variables: Sequence[VariableEntity] = Field(default_factory=list)
