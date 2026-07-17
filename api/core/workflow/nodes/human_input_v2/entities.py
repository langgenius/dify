import enum
from collections.abc import Sequence
from typing import Annotated, Literal

from pydantic import BaseModel, Discriminator, Field

from core.workflow.nodes.human_input.entities import FormInputConfig, TimeoutUnit, UserActionConfig
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


class IMProvider(enum.StrEnum):
    FEISHU = enum.auto()
    SLACK = enum.auto()
    DING_TALK = enum.auto()
    MS_TEAMS = enum.auto()
    WE_COM = enum.auto()
    LARK = enum.auto()


class DebugChannel(enum.StrEnum):
    EMAIL = enum.auto()
    FEISHU = IMProvider.FEISHU.value
    SLACK = IMProvider.SLACK.value
    DING_TALK = IMProvider.DING_TALK.value
    MS_TEAMS = IMProvider.MS_TEAMS.value
    WE_COM = IMProvider.WE_COM.value
    LARK = IMProvider.LARK.value


class DebugModeConfig(BaseModel):
    enabled: bool = False
    channels: Sequence[DebugChannel]


class HumanInputNodeData(BaseNodeData):
    """Human Input node data."""

    type: NodeType = BuiltinNodeTypes.HUMAN_INPUT

    recipients_spec: list[RecipientConfig]

    message_template: MessageTemplateConfig
    debug_mode: DebugModeConfig

    form_content: str = ""
    inputs: list[FormInputConfig] = Field(default_factory=list[FormInputConfig])
    user_actions: list[UserActionConfig] = Field(default_factory=list[UserActionConfig])
    timeout: int = 36
    timeout_unit: TimeoutUnit = TimeoutUnit.HOUR
