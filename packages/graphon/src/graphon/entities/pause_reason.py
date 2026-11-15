from enum import StrEnum, auto
from typing import Annotated, Literal, cast

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


class PauseReasonType(StrEnum):
    # Legacy value for compatibility purpose, DO NOT USE.

    # LEGACY `human_input_required` pause reasons are normalized
    # into `HitlRequired`, and `form_id` are mapped to `session_id`
    # when deserializing.
    LEGACY_HUMAN_INPUT_REQUIRED = "human_input_required"

    HITL_REQUIRED = auto()
    SCHEDULED_PAUSE = auto()
    EXTERNAL_WAIT = auto()


class HitlRequired(BaseModel):
    model_config = ConfigDict(extra="forbid")

    TYPE: Literal[PauseReasonType.HITL_REQUIRED] = PauseReasonType.HITL_REQUIRED
    session_id: str
    node_id: str
    node_title: str


class SchedulingPause(BaseModel):
    TYPE: Literal[PauseReasonType.SCHEDULED_PAUSE] = PauseReasonType.SCHEDULED_PAUSE

    message: str


class ExternalWaitReason(BaseModel):
    """Opaque host-owned external work awaiting a durable result.

    This reason carries identity only. The host owns I/O, authentication,
    deadlines and result persistence. Resumption re-enters the same frame-local
    node execution, which must read its durable result rather than submit again.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    TYPE: Literal[PauseReasonType.EXTERNAL_WAIT] = PauseReasonType.EXTERNAL_WAIT
    wait_id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)
    node_title: str
    execution_id: str = Field(min_length=1)
    frame_id: str = Field(min_length=1)


class _LegacyHumanInputRequired(BaseModel):
    """
    This model serves as documentation purpose. DO NOT USE.
    """

    TYPE: Literal[PauseReasonType.LEGACY_HUMAN_INPUT_REQUIRED] = (
        PauseReasonType.LEGACY_HUMAN_INPUT_REQUIRED
    )
    form_id: str
    # the following fields are intentionally kept in text form
    # for documentation purpose only.
    #
    # form_content: str
    # inputs: list[FormInputConfig] = Field(default_factory=list[FormInputConfig])
    # actions: list[UserActionConfig] = Field(default_factory=list[UserActionConfig])
    # resolved_default_values: Mapping[str, Any] = Field(default_factory=dict)


def _decode_pause_reason(value: object) -> object:
    if not isinstance(value, dict):
        return value

    payload = cast(dict[str, object], value)

    if payload.get("TYPE") != PauseReasonType.LEGACY_HUMAN_INPUT_REQUIRED:
        return value

    canonical_reason: dict[str, object] = {
        "TYPE": PauseReasonType.HITL_REQUIRED,
    }
    if "form_id" in payload:
        canonical_reason["session_id"] = payload["form_id"]
    if "node_id" in payload:
        canonical_reason["node_id"] = payload["node_id"]
    if "node_title" in payload:
        canonical_reason["node_title"] = payload["node_title"]
    return canonical_reason


type PauseReason = Annotated[
    HitlRequired | SchedulingPause | ExternalWaitReason,
    Field(discriminator="TYPE"),
    BeforeValidator(_decode_pause_reason),
]
