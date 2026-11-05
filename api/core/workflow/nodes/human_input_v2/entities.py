import enum
import typing
from collections.abc import Sequence
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Discriminator, Field, field_validator

from core.human_input_v2.entities import DebugChannel
from core.workflow.human_input_adapter import EmailDeliveryConfig
from core.workflow.nodes.human_input.entities import (
    FormInputConfig,
    TimeoutUnit,
    UserActionConfig,
    extract_output_variable_names,
    validate_unique_action_ids,
    validate_unique_input_names,
)
from graphon.entities.base_node_data import BaseNodeData


class RecipientType(enum.StrEnum):
    CONTACT = enum.auto()
    DYNAMIC_EMAIL = enum.auto()
    ONETIME_EMAIL = enum.auto()
    INITIATOR = enum.auto()
    ALL_WORKSPACE_CONTACTS = enum.auto()


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


class AllWorkspaceContacts(BaseModel):
    """Migration marker preserving legacy whole-workspace recipient intent.

    Runtime expansion is deliberately owned by the recipient resolver rather
    than the node-data migration helper.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal[RecipientType.ALL_WORKSPACE_CONTACTS] = RecipientType.ALL_WORKSPACE_CONTACTS


RecipientConfig = Annotated[
    Contact | DynamicEmail | OnetimeEmail | Initiator | AllWorkspaceContacts,
    Discriminator("type"),
]


def holds_one_request_url(body: str) -> bool:
    """Whether the body carries the Request URL placeholder exactly once, as every delivery needs."""
    return body.count(EmailDeliveryConfig.URL_PLACEHOLDER) == 1


class RequestUrlCountError(ValueError):
    """A message body without the Request URL placeholder exactly once, naming it and the count found."""

    def __init__(self, body: str) -> None:
        super().__init__(
            f"The message body must contain the Request URL {EmailDeliveryConfig.URL_PLACEHOLDER} exactly once, "
            f"found {body.count(EmailDeliveryConfig.URL_PLACEHOLDER)}: it becomes the link to the form"
        )


def _body_validator(body: str) -> str:
    if not holds_one_request_url(body):
        raise RequestUrlCountError(body)
    return body


class MessageTemplateConfig(BaseModel):
    subject: str
    body: Annotated[
        str,
        AfterValidator(_body_validator),
        Field(
            description=(
                f"Must hold the Request URL placeholder {EmailDeliveryConfig.URL_PLACEHOLDER} exactly once: "
                "it becomes the link to the form"
            )
        ),
    ]


class DebugModeConfig(BaseModel):
    enabled: bool = False
    channels: Sequence[DebugChannel]


HUMAN_INPUT_NODE_TYPE: typing.Final[Literal["human-input"]] = "human-input"
HUMAN_INPUT_V2_VERSION: typing.Final = "2"


def _version_validator(version: str) -> str:
    if version != HUMAN_INPUT_V2_VERSION:
        raise ValueError(f"Human Input v2 requires version='{HUMAN_INPUT_V2_VERSION}'")
    return version


class HumanInputNodeData(BaseNodeData):
    """Human Input node data."""

    model_config = ConfigDict(extra="ignore", frozen=True, strict=True, validate_default=True)

    # BaseNodeData exposes the discriminator as a class variable, while the
    # concrete Pydantic model must validate and serialize an exact wire value.
    type: Literal["human-input"] = HUMAN_INPUT_NODE_TYPE  # pyrefly: ignore[bad-override]
    title: str = ""  # pyrefly: ignore[bad-override]
    version: Annotated[str, AfterValidator(_version_validator)] = HUMAN_INPUT_V2_VERSION  # pyrefly: ignore[bad-override]

    recipients_spec: list[RecipientConfig]

    message_template: MessageTemplateConfig
    debug_mode: DebugModeConfig

    form_content: str = ""
    inputs: list[FormInputConfig] = Field(default_factory=list[FormInputConfig])
    user_actions: list[UserActionConfig] = Field(default_factory=list[UserActionConfig])
    timeout: int = 36
    timeout_unit: TimeoutUnit = Field(default=TimeoutUnit.HOUR, strict=False)

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
