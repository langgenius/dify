from collections.abc import Sequence

from pydantic import Field

from core.app.app_config.entities import VariableEntity
from core.workflow.entities.base_node_data_entities import BaseNodeData


class StartNodeData(BaseNodeData):
    """
    Start Node Data
    """

    variables: Sequence[VariableEntity] = Field(default_factory=list)
