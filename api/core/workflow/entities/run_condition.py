import hashlib
from typing import Literal, Optional

from pydantic import BaseModel

from core.workflow.utils.condition.entities import Condition


class RunCondition(BaseModel):
    type: Literal["branch_identify", "condition"]
    """condition type"""

    branch_identify: Optional[str] = None
    """branch identify like: sourceHandle, required when type is branch_identify"""

    conditions: Optional[list[Condition]] = None
    """conditions to run the node, required when type is condition"""

    @property
    def hash(self) -> str:
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()
