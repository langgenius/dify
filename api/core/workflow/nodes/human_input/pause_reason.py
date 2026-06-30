from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, Field

from graphon.entities.pause_reason import PauseReasonType, SchedulingPause

from .entities import FormInputConfig, UserActionConfig

try:
    _LEGACY_HUMAN_INPUT_REQUIRED = PauseReasonType.LEGACY_HUMAN_INPUT_REQUIRED
except AttributeError:
    _LEGACY_HUMAN_INPUT_REQUIRED = PauseReasonType.HUMAN_INPUT_REQUIRED

HUMAN_INPUT_REQUIRED_REASON_TYPE = _LEGACY_HUMAN_INPUT_REQUIRED


class HumanInputRequired(BaseModel):
    TYPE: Literal[HUMAN_INPUT_REQUIRED_REASON_TYPE] = HUMAN_INPUT_REQUIRED_REASON_TYPE
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
