from collections.abc import Mapping
from enum import StrEnum, auto
from typing import Annotated, Any, Literal, TypeAlias

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
    display_in_ui: bool = False
    node_id: str
    node_title: str

    # The `resolved_default_values` stores the resolved values of variable defaults. It's a mapping from
    # `output_variable_name` to their resolved values.
    #
    # For example, The form contains a input with output variable name `name` and placeholder type `VARIABLE`, its
    # selector is ["start", "name"]. While the HumanInputNode is executed, the correspond value of variable
    # `start.name` in variable pool is `John`. Thus, the resolved value of the output variable `name` is `John`. The
    # `resolved_default_values` is `{"name": "John"}`.
    #
    # Only form inputs with default value type `VARIABLE` will be resolved and stored in `resolved_default_values`.
    resolved_default_values: Mapping[str, Any] = Field(default_factory=dict)

    # The `form_token` is the token used to submit the form via UI surfaces. It corresponds to
    # `HumanInputFormRecipient.access_token`.
    #
    # This field is `None` if webapp delivery is not set and not
    # in orchestrating mode.
    form_token: str | None = None


class SchedulingPause(BaseModel):
    TYPE: Literal[PauseReasonType.SCHEDULED_PAUSE] = PauseReasonType.SCHEDULED_PAUSE

    message: str


PauseReason: TypeAlias = Annotated[HumanInputRequired | SchedulingPause, Field(discriminator="TYPE")]
