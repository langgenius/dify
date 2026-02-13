from enum import StrEnum, auto
from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, Field


class PauseReasonType(StrEnum):
    HUMAN_INPUT_REQUIRED = auto()
    SCHEDULED_PAUSE = auto()
    TOOL_CALL_PENDING = auto()


class HumanInputRequired(BaseModel):
    TYPE: Literal[PauseReasonType.HUMAN_INPUT_REQUIRED] = PauseReasonType.HUMAN_INPUT_REQUIRED

    form_id: str
    # The identifier of the human input node causing the pause.
    node_id: str


class SchedulingPause(BaseModel):
    TYPE: Literal[PauseReasonType.SCHEDULED_PAUSE] = PauseReasonType.SCHEDULED_PAUSE

    message: str


class ToolCallPending(BaseModel):
    TYPE: Literal[PauseReasonType.TOOL_CALL_PENDING] = PauseReasonType.TOOL_CALL_PENDING

    node_id: str
    tool_calls: list[dict]
    round: int


PauseReason: TypeAlias = Annotated[
    HumanInputRequired | SchedulingPause | ToolCallPending, Field(discriminator="TYPE")
]
