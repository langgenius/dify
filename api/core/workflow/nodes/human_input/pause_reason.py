from collections.abc import Mapping
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

from graphon.entities.pause_reason import PauseReasonType, SchedulingPause

from .entities import FormInputConfig, UserActionConfig


class DifyHITLEventType(StrEnum):
    """Dify HITL event type.
    only used for discriminated union tag.

    """

    # Ideally this should be a string constaint. However, we cannot put
    # string constant into Literal type cosntructor. We have to warp it as a
    # string enumeration.
    HUMAN_INPUT_REQUIRED = PauseReasonType.LEGACY_HUMAN_INPUT_REQUIRED.value


class HumanInputRequired(BaseModel):
    TYPE: Literal[DifyHITLEventType.HUMAN_INPUT_REQUIRED] = DifyHITLEventType.HUMAN_INPUT_REQUIRED
    form_id: str
    form_content: str
    inputs: list[FormInputConfig] = Field(default_factory=list[FormInputConfig])
    actions: list[UserActionConfig] = Field(default_factory=list[UserActionConfig])
    node_id: str
    node_title: str

    # The `resolved_default_values` stores the resolved values of variable
    # defaults. It's a mapping from `output_variable_name` to their
    # resolved values.
    #
    # For example, the form contains an input with output variable name `name`
    # and placeholder type `VARIABLE`, its selector is ["start", "name"].
    # When the HumanInputNode is executed, the corresponding value of
    # variable `start.name` in the variable pool is `John`.
    # Thus, the resolved value of the output variable `name` is `John`. The
    # `resolved_default_values` is `{"name": "John"}`.
    #
    # Only form inputs with default value type `VARIABLE` will be resolved
    # and stored in `resolved_default_values`.
    resolved_default_values: Mapping[str, Any] = Field(default_factory=dict)


type PauseReason = HumanInputRequired | SchedulingPause
