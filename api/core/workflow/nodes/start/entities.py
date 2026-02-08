from collections.abc import Sequence

from pydantic import Field

from core.app.app_config.entities import VariableEntity
from core.workflow.enums import NodeType
from core.workflow.nodes.base import BaseNodeData


class StartNodeData(BaseNodeData):
    """
    Start Node Data
    """

    type: NodeType = NodeType.START
    variables: Sequence[VariableEntity] = Field(default_factory=list)
