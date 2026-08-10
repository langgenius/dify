import enum
import typing
from collections.abc import Sequence
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Discriminator, Field, field_validator

from core.human_input_v2.entities import IMProvider
from core.workflow.nodes.human_input.entities import (
    FormInputConfig,
    TimeoutUnit,
    UserActionConfig,
    extract_output_variable_names,
    validate_unique_action_ids,
    validate_unique_input_names,
    validate_unique_output_variable_slots,
)
from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType


class RecipientType(enum.StrEnum):
    CONTACT = enum.auto()
    DYNAMIC_EMAIL = enum.auto()
    ONETIME_EMAIL = enum.auto()
    INITIATOR = enum.auto()


class Contact(BaseModel):
    type: Literal[RecipientType.CONTACT] = RecipientType.CONTACT

    contact_id: str


class DynamicEmail(BaseModel):
    type: Literal[RecipientType.DYNAMIC_EMAIL] = RecipientType.DYNAMIC_EMAIL

    selector: Sequence[str]


class OnetimeEmail(BaseModel):
    type: Literal[RecipientType.ONETIME_EMAIL] = RecipientType.ONETIME_EMAIL

    email: str


class Initiator(BaseModel):
    type: Literal[RecipientType.INITIATOR] = RecipientType.INITIATOR


RecipientConfig = Annotated[Contact | DynamicEmail | OnetimeEmail | Initiator, Discriminator("type")]


class MessageTemplateConfig(BaseModel):
    subject: str
    body: str


class Channel(enum.StrEnum):
    EMAIL = enum.auto()
    FEISHU = IMProvider.FEISHU.value
    SLACK = IMProvider.SLACK.value
    DING_TALK = IMProvider.DING_TALK.value
    MS_TEAMS = IMProvider.MS_TEAMS.value
    WE_COM = IMProvider.WE_COM.value
    LARK = IMProvider.LARK.value


class DebugModeConfig(BaseModel):
    enabled: bool = False
    channels: Sequence[Channel]


HUMAN_INPUT_V2_VERSION: typing.Final = "2"


def _version_validator(version: str) -> str:
    if version != HUMAN_INPUT_V2_VERSION:
        raise ValueError(f"Human Input v2 requires version='{HUMAN_INPUT_V2_VERSION}'")
    return version


class HumanInputNodeData(BaseNodeData):
    """Human Input node data."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    # The linter suppression below is used to
    # ensure that we could mark node data as frozen.
    type: NodeType = BuiltinNodeTypes.HUMAN_INPUT  # pyrefly: ignore[bad-override]
    title: str = ""  # pyrefly: ignore[bad-override]
    version: Annotated[str, AfterValidator(_version_validator)] = HUMAN_INPUT_V2_VERSION  # pyrefly: ignore[bad-override]

    recipients_spec: list[RecipientConfig]

    message_template: MessageTemplateConfig
    debug_mode: DebugModeConfig

    form_content: str = ""
    inputs: list[FormInputConfig] = Field(default_factory=list[FormInputConfig])
    user_actions: list[UserActionConfig] = Field(default_factory=list[UserActionConfig])
    timeout: int = 36
    timeout_unit: TimeoutUnit = TimeoutUnit.HOUR

    @field_validator("form_content")
    @classmethod
    def _validate_form_content(cls, form_content: str) -> str:
        validate_unique_output_variable_slots(form_content)
        return form_content

    @field_validator("inputs")
    @classmethod
    def _validate_inputs(cls, inputs: list[FormInputConfig]) -> list[FormInputConfig]:
        validate_unique_input_names(inputs)
        return inputs

    @field_validator("user_actions")
    @classmethod
    def _validate_user_actions(cls, user_actions: list[UserActionConfig]) -> list[UserActionConfig]:
        validate_unique_action_ids(user_actions)
        return user_actions

    def output_variable_names(self) -> tuple[str, ...]:
        return extract_output_variable_names(self.form_content)
