from typing import Optional

from pydantic import BaseModel

from core.workflow.nodes.base import BaseNodeData


class MqNodeData(BaseNodeData):
    """
    Mq Node Data.
    """

    class Case(BaseModel):
        """
        Case entity representing a single logical condition group
        """

        channel: str
        message: str

    channel: Optional[str] = "abc"
    message: Optional[str] = "message"
