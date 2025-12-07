from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, TypeAlias

from models.execution_extra_content import ExecutionContentType


@dataclass(frozen=True, kw_only=True)
class HumanInputContent:
    action_id: str
    action_text: str
    rendered_content: str
    type: ExecutionContentType = field(default=ExecutionContentType.HUMAN_INPUT_RESULT, init=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "action_id": self.action_id,
            "action_text": self.action_text,
            "rendered_content": self.rendered_content,
        }


ExecutionExtraContentDomainModel: TypeAlias = HumanInputContent

__all__ = ["ExecutionExtraContentDomainModel", "HumanInputContent"]
