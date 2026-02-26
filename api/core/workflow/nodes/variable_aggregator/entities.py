from pydantic import BaseModel

from core.variables.types import SegmentType
from core.workflow.nodes.base import BaseNodeData


class AdvancedSettings(BaseModel):
    """
    Advanced setting.
    """

    group_enabled: bool

    class Group(BaseModel):
        """
        Group.
        """

        output_type: SegmentType
        variables: list[list[str]]
        group_name: str

    groups: list[Group]


class VariableAggregatorNodeData(BaseNodeData):
    """
    Variable Aggregator Node Data.
    """

    output_type: str
    variables: list[list[str]]
    advanced_settings: AdvancedSettings | None = None
