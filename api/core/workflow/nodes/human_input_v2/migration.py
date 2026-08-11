"""Pure legacy Human Input node-data conversion.

This module owns only deterministic value conversion. Database access,
workspace scoping, Contact state, and transport response mapping belong to the
application and adapter layers.
"""

from __future__ import annotations

import enum
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated, Literal, Self
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, RootModel, field_validator, model_validator

from core.human_input import ButtonStyle
from core.human_input_v2.shared.values import NormalizedEmail
from core.workflow.nodes.human_input.entities import (
    FormInputConfig,
    ParagraphInputConfig,
    StringSource,
    UserActionConfig,
)
from core.workflow.nodes.human_input.enums import FormInputType, TimeoutUnit, ValueSourceType
from graphon.entities.base_node_data import DefaultValue, DefaultValueType, RetryConfig
from graphon.enums import ErrorStrategy

from .entities import (
    HUMAN_INPUT_NODE_TYPE,
    AllWorkspaceContacts,
    Channel,
    DebugModeConfig,
    HumanInputNodeData,
    Initiator,
    MessageTemplateConfig,
    OnetimeEmail,
    RecipientConfig,
)


class LegacyDeliveryMethodType(enum.StrEnum):
    """Delivery method variants defined by the historical HITL v1 backend."""

    WEBAPP = "webapp"
    EMAIL = "email"


class LegacyEmailRecipientType(enum.StrEnum):
    MEMBER = "member"
    EXTERNAL = "external"


class LegacyFormInputType(enum.StrEnum):
    TEXT_INPUT = "text_input"
    PARAGRAPH = "paragraph"


class LegacyPlaceholderType(enum.StrEnum):
    VARIABLE = "variable"
    CONSTANT = "constant"


class LegacyTimeoutUnit(enum.StrEnum):
    HOUR = "hour"
    DAY = "day"


type LegacyDefaultPayload = (
    str | int | float | bool | None | list[LegacyDefaultPayload] | dict[str, LegacyDefaultPayload]
)


class LegacyDefaultValuePayload(RootModel[LegacyDefaultPayload]):
    """Typed value object preserving the historical unrestricted JSON payload."""


class LegacyDefaultValue(BaseModel):
    """Historical BaseNodeData fallback with its original type/value contract."""

    value: LegacyDefaultValuePayload = Field(default_factory=lambda: LegacyDefaultValuePayload(None))
    type: DefaultValueType
    key: str

    @staticmethod
    def _parse_json_payload(value: str) -> LegacyDefaultPayload:
        try:
            return LegacyDefaultValuePayload.model_validate_json(value).root
        except ValueError as error:
            raise ValueError(f"invalid JSON default value: {value}") from error

    @staticmethod
    def _convert_number(value: str) -> float:
        try:
            return float(value)
        except ValueError as error:
            raise ValueError(f"cannot convert default value to number: {value}") from error

    @model_validator(mode="after")
    def validate_value_type(self) -> Self:
        value = self.value.root
        match self.type:
            case DefaultValueType.STRING:
                if not isinstance(value, str):
                    raise ValueError("string default value must be a string")
            case DefaultValueType.NUMBER:
                if isinstance(value, str):
                    value = self._convert_number(value)
                elif not isinstance(value, int | float):
                    raise ValueError("number default value must be a number")
            case DefaultValueType.OBJECT:
                if isinstance(value, str):
                    value = self._parse_json_payload(value)
                if not isinstance(value, dict):
                    raise ValueError("object default value must be an object")
            case DefaultValueType.ARRAY_NUMBER:
                if isinstance(value, str):
                    value = self._parse_json_payload(value)
                if not isinstance(value, list):
                    raise ValueError("array[number] default value must be an array")
                if any(not isinstance(element, int | float) for element in value):
                    raise ValueError("array[number] default value must contain only numbers")
            case DefaultValueType.ARRAY_STRING:
                if isinstance(value, str):
                    value = self._parse_json_payload(value)
                if not isinstance(value, list):
                    raise ValueError("array[string] default value must be an array")
                if any(not isinstance(element, str) for element in value):
                    raise ValueError("array[string] default value must contain only strings")
            case DefaultValueType.ARRAY_OBJECT:
                if isinstance(value, str):
                    value = self._parse_json_payload(value)
                if not isinstance(value, list):
                    raise ValueError("array[object] default value must be an array")
                if any(not isinstance(element, dict) for element in value):
                    raise ValueError("array[object] default value must contain only objects")
            case DefaultValueType.ARRAY_FILES:
                pass
        self.value = LegacyDefaultValuePayload(value)
        return self


@dataclass(frozen=True, slots=True)
class ResolvedMemberEmail:
    member_id: str
    email: NormalizedEmail


@dataclass(frozen=True, slots=True)
class MemberEmailSnapshot:
    """Immutable request-local workspace member Email snapshot."""

    entries: tuple[ResolvedMemberEmail, ...] = ()

    def email_for(self, member_id: str) -> NormalizedEmail | None:
        for entry in self.entries:
            if entry.member_id == member_id:
                return entry.email
        return None


class LegacyWebAppDeliveryConfig(BaseModel):
    """Historical WebApp delivery config, intentionally empty."""


class LegacyMemberRecipient(BaseModel):
    type: Literal[LegacyEmailRecipientType.MEMBER] = LegacyEmailRecipientType.MEMBER
    user_id: str


class LegacyExternalRecipient(BaseModel):
    type: Literal[LegacyEmailRecipientType.EXTERNAL] = LegacyEmailRecipientType.EXTERNAL
    email: str


LegacyEmailRecipient = Annotated[
    LegacyMemberRecipient | LegacyExternalRecipient,
    Field(discriminator="type"),
]


class LegacyEmailRecipients(BaseModel):
    whole_workspace: bool = False
    items: list[LegacyEmailRecipient] = Field(default_factory=list)


class LegacyEmailDeliveryConfig(BaseModel):
    recipients: LegacyEmailRecipients
    subject: str
    body: str
    debug_mode: bool = False


class _LegacyDeliveryMethodBase(BaseModel):
    enabled: bool = True
    id: UUID = Field(default_factory=uuid4)


class LegacyWebAppDeliveryMethod(_LegacyDeliveryMethodBase):
    type: Literal[LegacyDeliveryMethodType.WEBAPP] = LegacyDeliveryMethodType.WEBAPP
    config: LegacyWebAppDeliveryConfig = Field(default_factory=LegacyWebAppDeliveryConfig)


class LegacyEmailDeliveryMethod(_LegacyDeliveryMethodBase):
    type: Literal[LegacyDeliveryMethodType.EMAIL] = LegacyDeliveryMethodType.EMAIL
    config: LegacyEmailDeliveryConfig


LegacyDeliveryChannelConfig = Annotated[
    LegacyWebAppDeliveryMethod | LegacyEmailDeliveryMethod,
    Field(discriminator="type"),
]


class LegacyFormInputDefault(BaseModel):
    """Historical form default keeps both selector and constant value."""

    type: LegacyPlaceholderType
    selector: Sequence[str] = Field(default_factory=tuple)
    value: str = ""

    @model_validator(mode="after")
    def validate_variable_selector(self) -> Self:
        if self.type == LegacyPlaceholderType.CONSTANT:
            return self
        if len(self.selector) < 2:
            raise ValueError(f"the length of selector should be at least 2, selector={self.selector}")
        return self


class LegacyFormInput(BaseModel):
    type: LegacyFormInputType
    output_variable_name: str
    default: LegacyFormInputDefault | None = None


_HISTORICAL_USER_ACTION_ID_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class LegacyUserAction(BaseModel):
    id: str = Field(max_length=20)
    title: str = Field(max_length=20)
    button_style: ButtonStyle = ButtonStyle.DEFAULT

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        # Historical v1 used Python re.match, whose `$` accepts a final line feed.
        if not _HISTORICAL_USER_ACTION_ID_PATTERN.match(value):
            raise ValueError(
                f"'{value}' is not a valid identifier. It must start with a letter or underscore, "
                f"and contain only letters, numbers, or underscores."
            )
        return value


class LegacyHumanInputNodeData(BaseModel):
    """Canonical Human Input v1 node data from the historical backend contract."""

    title: str
    desc: str | None = None

    version: str = "1"
    error_strategy: ErrorStrategy | None = None
    default_value: list[LegacyDefaultValue] | None = None
    retry_config: RetryConfig = Field(default_factory=RetryConfig)

    delivery_methods: list[LegacyDeliveryChannelConfig] = Field(default_factory=list)
    form_content: str = ""
    inputs: list[LegacyFormInput] = Field(default_factory=list)
    user_actions: list[LegacyUserAction] = Field(default_factory=list)
    timeout: int = 36
    timeout_unit: LegacyTimeoutUnit = LegacyTimeoutUnit.HOUR

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: str) -> str:
        if value != "1":
            raise ValueError('version must be "1"')
        return value

    @field_validator("inputs")
    @classmethod
    def validate_unique_inputs(cls, inputs: list[LegacyFormInput]) -> list[LegacyFormInput]:
        names = [form_input.output_variable_name for form_input in inputs]
        if len(names) != len(set(names)):
            raise ValueError("duplicated output_variable_name in inputs")
        return inputs

    @field_validator("user_actions")
    @classmethod
    def validate_unique_actions(cls, actions: list[LegacyUserAction]) -> list[LegacyUserAction]:
        action_ids = [action.id for action in actions]
        if len(action_ids) != len(set(action_ids)):
            raise ValueError("duplicated user action id")
        return actions


@dataclass(frozen=True, slots=True)
class NodeMigrationBlocker:
    code: MigrationBlockerCode
    method_id: str | None = None
    value: str | None = None
    method_index: int | None = None
    recipient_index: int | None = None


@dataclass(frozen=True, slots=True)
class NodeMigrationConversion:
    node_data: HumanInputNodeData | None
    blockers: tuple[NodeMigrationBlocker, ...]


class MigrationBlockerCode(enum.StrEnum):
    INVALID_DEFAULT_VALUE = "invalid-default-value"
    CONFIGURED_DISABLED_METHOD = "configured-disabled-method"
    UNSUPPORTED_DELIVERY_METHOD = "unsupported-delivery-method"
    INVALID_EMAIL_CONFIGURATION = "invalid-email-configuration"
    INVALID_EMAIL = "invalid-email"
    UNRESOLVED_MEMBER = "unresolved-member"
    CONFLICTING_EMAIL_TEMPLATES = "conflicting-email-templates"
    MISSING_RECIPIENTS = "missing-recipients"


@dataclass(frozen=True, slots=True)
class LegacyDeliveryParseIssue:
    """One transport/preflight issue that did not become canonical v1 data."""

    code: MigrationBlockerCode
    method_position: int | None = None
    method_id: str | None = None
    value: str | None = None
    recipient_position: int | None = None


@dataclass(frozen=True, slots=True)
class LegacyNodeDataPreflight:
    """Canonical v1 value plus typed issues from the transport boundary."""

    node_data: LegacyHumanInputNodeData
    method_positions: tuple[int, ...]
    recipient_positions: tuple[tuple[int, ...], ...]
    issues: tuple[LegacyDeliveryParseIssue, ...]


def _disabled_method_has_material_configuration(method: LegacyDeliveryChannelConfig) -> bool:
    if isinstance(method, LegacyWebAppDeliveryMethod):
        return False
    config = method.config
    return bool(
        config.recipients.items
        or config.recipients.whole_workspace
        or config.subject
        or config.body
        or config.debug_mode
    )


def _invalid_template_field(config: LegacyEmailDeliveryConfig) -> str | None:
    if not config.subject.strip():
        return "subject"
    if not config.body.strip():
        return "body"
    return None


def _validated_email_template(config: LegacyEmailDeliveryConfig) -> tuple[str, str] | None:
    if not config.subject.strip():
        return None
    if not config.body.strip():
        return None
    return config.subject, config.body


def _convert_form_input_type(
    legacy_type: LegacyFormInputType,
) -> Literal[FormInputType.PARAGRAPH]:
    """Map both historical string inputs to v2's sole string input model."""

    if legacy_type in {LegacyFormInputType.TEXT_INPUT, LegacyFormInputType.PARAGRAPH}:
        return FormInputType.PARAGRAPH
    raise AssertionError(f"unsupported historical form input type: {legacy_type}")


def _convert_form_inputs(inputs: list[LegacyFormInput]) -> list[FormInputConfig]:
    converted_inputs: list[FormInputConfig] = []
    for form_input in inputs:
        default = form_input.default
        converted_default = None
        if default is not None:
            converted_default = StringSource(
                type=ValueSourceType(default.type.value),
                selector=default.selector,
                value=default.value,
            )
        converted_inputs.append(
            ParagraphInputConfig(
                type=_convert_form_input_type(form_input.type),
                output_variable_name=form_input.output_variable_name,
                default=converted_default,
            )
        )
    return converted_inputs


def _convert_user_actions(actions: list[LegacyUserAction]) -> list[UserActionConfig]:
    return [UserActionConfig(id=action.id, title=action.title, button_style=action.button_style) for action in actions]


def _convert_default_values(default_values: list[LegacyDefaultValue] | None) -> list[DefaultValue] | None:
    if default_values is None:
        return None
    return [
        DefaultValue(key=default_value.key, type=default_value.type, value=default_value.value.root)
        for default_value in default_values
    ]


def convert_legacy_human_input_node_data(
    legacy_node_data: LegacyHumanInputNodeData,
    member_emails: MemberEmailSnapshot,
) -> NodeMigrationConversion:
    """Convert one legacy node against a caller-owned immutable Email snapshot."""

    recipients: list[RecipientConfig] = []
    blockers: list[NodeMigrationBlocker] = []
    seen_emails: set[str] = set()
    has_initiator = False
    has_workspace_marker = False
    email_debug_enabled = False
    email_template: tuple[str, str] | None = None
    conflicting_template: tuple[str, int] | None = None
    subject = ""
    body = ""
    for method_index, method in enumerate(legacy_node_data.delivery_methods):
        method_id = str(method.id)
        if not method.enabled:
            if _disabled_method_has_material_configuration(method):
                blockers.append(
                    NodeMigrationBlocker(
                        MigrationBlockerCode.CONFIGURED_DISABLED_METHOD,
                        method_id,
                        method.type.value,
                        method_index=method_index,
                    )
                )
            continue
        if isinstance(method, LegacyWebAppDeliveryMethod):
            if not has_initiator:
                recipients.append(Initiator())
                has_initiator = True
            continue
        current_template = _validated_email_template(method.config)
        if current_template is None:
            blockers.append(
                NodeMigrationBlocker(
                    MigrationBlockerCode.INVALID_EMAIL_CONFIGURATION,
                    method_id,
                    _invalid_template_field(method.config),
                    method_index=method_index,
                )
            )
        else:
            if email_template is None:
                subject, body = current_template
                email_template = current_template
            elif current_template != email_template and conflicting_template is None:
                conflicting_template = method_id, method_index
        email_debug_enabled = email_debug_enabled or method.config.debug_mode
        email_recipients = method.config.recipients
        for recipient_index, source in enumerate(email_recipients.items):
            if isinstance(source, LegacyExternalRecipient):
                try:
                    normalized_email = str(NormalizedEmail(source.email))
                except ValueError:
                    blockers.append(
                        NodeMigrationBlocker(
                            MigrationBlockerCode.INVALID_EMAIL,
                            method_id,
                            source.email,
                            method_index=method_index,
                            recipient_index=recipient_index,
                        )
                    )
                    continue
            else:
                member_id = source.user_id
                member_email = member_emails.email_for(member_id)
                if member_email is None:
                    blockers.append(
                        NodeMigrationBlocker(
                            MigrationBlockerCode.UNRESOLVED_MEMBER,
                            method_id,
                            member_id,
                            method_index=method_index,
                            recipient_index=recipient_index,
                        )
                    )
                    continue
                normalized_email = str(member_email)
            if normalized_email in seen_emails:
                continue
            recipients.append(OnetimeEmail(email=normalized_email))
            seen_emails.add(normalized_email)
        if email_recipients.whole_workspace and not has_workspace_marker:
            recipients.append(AllWorkspaceContacts())
            has_workspace_marker = True

    if conflicting_template is not None:
        conflicting_template_method_id, conflicting_template_method_index = conflicting_template
        blockers.append(
            NodeMigrationBlocker(
                MigrationBlockerCode.CONFLICTING_EMAIL_TEMPLATES,
                conflicting_template_method_id,
                method_index=conflicting_template_method_index,
            )
        )
    if not recipients:
        blockers.append(NodeMigrationBlocker(MigrationBlockerCode.MISSING_RECIPIENTS))
    if blockers:
        return NodeMigrationConversion(node_data=None, blockers=tuple(blockers))

    node_data = HumanInputNodeData(
        type=HUMAN_INPUT_NODE_TYPE,
        title=legacy_node_data.title,
        desc=legacy_node_data.desc,
        error_strategy=legacy_node_data.error_strategy,
        default_value=_convert_default_values(legacy_node_data.default_value),
        retry_config=legacy_node_data.retry_config,
        recipients_spec=recipients,
        message_template=MessageTemplateConfig(subject=subject, body=body),
        debug_mode=DebugModeConfig(
            enabled=email_debug_enabled,
            channels=(Channel.EMAIL,) if email_debug_enabled else (),
        ),
        form_content=legacy_node_data.form_content,
        inputs=_convert_form_inputs(legacy_node_data.inputs),
        user_actions=_convert_user_actions(legacy_node_data.user_actions),
        timeout=legacy_node_data.timeout,
        timeout_unit=TimeoutUnit(legacy_node_data.timeout_unit.value),
    )
    return NodeMigrationConversion(node_data=node_data, blockers=())
