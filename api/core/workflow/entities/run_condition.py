import hashlib
from typing import Literal

from pydantic import BaseModel

from core.workflow.utils.condition.entities import Condition


class RunCondition(BaseModel):
    type: Literal["branch_identify", "condition"]
    """condition type"""

    branch_identify: str | None = None
    """branch identify like: sourceHandle, required when type is branch_identify"""

    conditions: list[Condition] | None = None
    """conditions to run the node, required when type is condition"""

    @property
    def hash(self) -> str:
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()
