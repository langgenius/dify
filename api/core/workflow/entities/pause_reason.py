from enum import StrEnum, auto
from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, Field


class PauseReasonType(StrEnum):
    HUMAN_INPUT_REQUIRED = auto()
    SCHEDULED_PAUSE = auto()


class HumanInputRequired(BaseModel):
    TYPE: Literal[PauseReasonType.HUMAN_INPUT_REQUIRED] = PauseReasonType.HUMAN_INPUT_REQUIRED

    form_id: str
    # The identifier of the human input node causing the pause.
    node_id: str


class SchedulingPause(BaseModel):
    TYPE: Literal[PauseReasonType.SCHEDULED_PAUSE] = PauseReasonType.SCHEDULED_PAUSE

    message: str


PauseReason: TypeAlias = Annotated[HumanInputRequired | SchedulingPause, Field(discriminator="TYPE")]
