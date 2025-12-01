from enum import StrEnum, auto
from typing import Annotated, Any, ClassVar, TypeAlias

from pydantic import BaseModel, Discriminator, Tag


class _PauseReasonType(StrEnum):
    HUMAN_INPUT_REQUIRED = auto()
    SCHEDULED_PAUSE = auto()


class _PauseReasonBase(BaseModel):
    TYPE: ClassVar[_PauseReasonType]


class HumanInputRequired(_PauseReasonBase):
    TYPE = _PauseReasonType.HUMAN_INPUT_REQUIRED


class SchedulingPause(_PauseReasonBase):
    TYPE = _PauseReasonType.SCHEDULED_PAUSE

    message: str


def _get_pause_reason_discriminator(v: Any) -> _PauseReasonType | None:
    if isinstance(v, _PauseReasonBase):
        return v.TYPE
    elif isinstance(v, dict):
        reason_type_str = v.get("TYPE")
        if reason_type_str is None:
            return None
        try:
            reason_type = _PauseReasonType(reason_type_str)
        except ValueError:
            return None
        return reason_type
    else:
        # return None if the discriminator value isn't found
        return None


PauseReason: TypeAlias = Annotated[
    (
        Annotated[HumanInputRequired, Tag(_PauseReasonType.HUMAN_INPUT_REQUIRED)]
        | Annotated[SchedulingPause, Tag(_PauseReasonType.SCHEDULED_PAUSE)]
    ),
    Discriminator(_get_pause_reason_discriminator),
]
