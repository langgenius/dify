from enum import StrEnum, auto
from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, Field

from core.workflow.nodes.human_input.entities import FormInput, UserAction


class PauseReasonType(StrEnum):
    HUMAN_INPUT_REQUIRED = auto()
    SCHEDULED_PAUSE = auto()


class HumanInputRequired(BaseModel):
    TYPE: Literal[PauseReasonType.HUMAN_INPUT_REQUIRED] = PauseReasonType.HUMAN_INPUT_REQUIRED
    form_id: str
    form_content: str
    inputs: list[FormInput] = Field(default_factory=list)
    actions: list[UserAction] = Field(default_factory=list)
    node_id: str
    node_title: str
    web_app_form_token: str | None = None


class SchedulingPause(BaseModel):
    TYPE: Literal[PauseReasonType.SCHEDULED_PAUSE] = PauseReasonType.SCHEDULED_PAUSE

    message: str


PauseReason: TypeAlias = Annotated[HumanInputRequired | SchedulingPause, Field(discriminator="TYPE")]
