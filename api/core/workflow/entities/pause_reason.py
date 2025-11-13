from enum import StrEnum, auto
from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, Field


class _PauseReasonType(StrEnum):
    HUMAN_INPUT_REQUIRED = auto()
    SCHEDULED_PAUSE = auto()


class HumanInputRequired(BaseModel):
    TYPE: Literal[_PauseReasonType.HUMAN_INPUT_REQUIRED] = _PauseReasonType.HUMAN_INPUT_REQUIRED


class SchedulingPause(BaseModel):
    TYPE: Literal[_PauseReasonType.SCHEDULED_PAUSE] = _PauseReasonType.SCHEDULED_PAUSE

    message: str


PauseReason: TypeAlias = Annotated[HumanInputRequired | SchedulingPause, Field(discriminator="TYPE")]
