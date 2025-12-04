"""
Human Input node entities.
"""

import enum
import re
import uuid
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Annotated, Any, Literal, Optional, Self

from pydantic import BaseModel, Field, field_validator, model_validator

from core.variables.consts import SELECTORS_LENGTH
from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser

_OUTPUT_VARIABLE_PATTERN = re.compile(r"\{\{#\$outputs\.(?P<field_name>[a-zA-Z_][a-zA-Z0-9_]{0,29})#\}\}")


class HumanInputFormStatus(StrEnum):
    """Status of a human input form."""

    WAITING = enum.auto()
    EXPIRED = enum.auto()
    SUBMITTED = enum.auto()
    TIMEOUT = enum.auto()


class DeliveryMethodType(StrEnum):
    """Delivery method types for human input forms."""

    WEBAPP = enum.auto()
    EMAIL = enum.auto()


class ButtonStyle(StrEnum):
    """Button styles for user actions."""

    PRIMARY = enum.auto()
    DEFAULT = enum.auto()
    ACCENT = enum.auto()
    GHOST = enum.auto()


class TimeoutUnit(StrEnum):
    """Timeout unit for form expiration."""

    HOUR = enum.auto()
    DAY = enum.auto()


class FormInputType(StrEnum):
    """Form input types."""

    TEXT_INPUT = enum.auto()
    PARAGRAPH = enum.auto()


class PlaceholderType(StrEnum):
    """Placeholder types for form inputs."""

    VARIABLE = enum.auto()
    CONSTANT = enum.auto()


class EmailRecipientType(StrEnum):
    """Email recipient types."""

    MEMBER = enum.auto()
    EXTERNAL = enum.auto()


class _WebAppDeliveryConfig(BaseModel):
    """Configuration for webapp delivery method."""

    pass  # Empty for webapp delivery


class MemberRecipient(BaseModel):
    """Member recipient for email delivery."""

    type: Literal[EmailRecipientType.MEMBER] = EmailRecipientType.MEMBER
    user_id: str


class ExternalRecipient(BaseModel):
    """External recipient for email delivery."""

    type: Literal[EmailRecipientType.EXTERNAL] = EmailRecipientType.EXTERNAL
    email: str


EmailRecipient = Annotated[MemberRecipient | ExternalRecipient, Field(discriminator="type")]


class EmailRecipients(BaseModel):
    """Email recipients configuration."""

    whole_workspace: bool = False
    items: list[EmailRecipient] = Field(default_factory=list)


class EmailDeliveryConfig(BaseModel):
    """Configuration for email delivery method."""

    recipients: EmailRecipients
    subject: str
    body: str


class _DeliveryMethodBase(BaseModel):
    """Base delivery method configuration."""

    enabled: bool = True
    id: uuid.UUID = Field(default_factory=uuid.uuid4)


class WebAppDeliveryMethod(_DeliveryMethodBase):
    """Webapp delivery method configuration."""

    type: Literal[DeliveryMethodType.WEBAPP] = DeliveryMethodType.WEBAPP
    # The config field is not used currently.
    config: _WebAppDeliveryConfig = Field(default_factory=_WebAppDeliveryConfig)


class EmailDeliveryMethod(_DeliveryMethodBase):
    """Email delivery method configuration."""

    type: Literal[DeliveryMethodType.EMAIL] = DeliveryMethodType.EMAIL
    config: EmailDeliveryConfig


DeliveryChannelConfig = Annotated[WebAppDeliveryMethod | EmailDeliveryMethod, Field(discriminator="type")]


class FormInputPlaceholder(BaseModel):
    """Placeholder configuration for form inputs."""

    # NOTE: Ideally, a discriminated union would be used to model
    # FormInputPlaceholder. However, the UI requires preserving the previous
    # value when switching between `VARIABLE` and `CONSTANT` types. This
    # necessitates retaining all fields, making a discriminated union unsuitable.

    type: PlaceholderType

    # The selector of placeholder variable, used when `type` is `VARIABLE`
    selector: Sequence[str] = Field(default_factory=tuple)  #

    # The value of the placeholder, used when `type` is `CONSTANT`.
    # TODO: How should we express JSON values?
    value: str = ""

    @model_validator(mode="after")
    def _validate_selector(self) -> Self:
        if self.type == PlaceholderType.CONSTANT:
            return self
        if len(self.selector) < SELECTORS_LENGTH:
            raise ValueError(f"the length of selector should be at least {SELECTORS_LENGTH}, selector={self.selector}")
        return self


class FormInput(BaseModel):
    """Form input definition."""

    type: FormInputType
    output_variable_name: str
    placeholder: Optional[FormInputPlaceholder] = None


_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class UserAction(BaseModel):
    """User action configuration."""

    # id is the identifier for this action.
    # It also serves as the identifiers of output handle.
    #
    # The id must be a valid identifier (satisfy the _IDENTIFIER_PATTERN above.)
    id: str
    title: str
    button_style: ButtonStyle = ButtonStyle.DEFAULT

    @field_validator("id")
    @classmethod
    def _validate_id(cls, value: str) -> str:
        if not _IDENTIFIER_PATTERN.match(value):
            raise ValueError(
                f"'{value}' is not a valid identifier. It must start with a letter or underscore, "
                f"and contain only letters, numbers, or underscores."
            )
        return value


class HumanInputNodeData(BaseNodeData):
    """Human Input node data."""

    delivery_methods: list[DeliveryChannelConfig] = Field(default_factory=list)
    form_content: str = ""
    inputs: list[FormInput] = Field(default_factory=list)
    user_actions: list[UserAction] = Field(default_factory=list)
    timeout: int = 36
    timeout_unit: TimeoutUnit = TimeoutUnit.HOUR

    @field_validator("inputs")
    @classmethod
    def _validate_inputs(cls, inputs: list[FormInput]) -> list[FormInput]:
        seen_names: set[str] = set()
        for form_input in inputs:
            name = form_input.output_variable_name
            if name in seen_names:
                raise ValueError(f"duplicated output_variable_name '{name}' in inputs")
            seen_names.add(name)
        return inputs

    @field_validator("user_actions")
    @classmethod
    def _validate_user_actions(cls, user_actions: list[UserAction]) -> list[UserAction]:
        seen_ids: set[str] = set()
        for action in user_actions:
            action_id = action.id
            if action_id in seen_ids:
                raise ValueError(f"duplicated user action id '{action_id}'")
            seen_ids.add(action_id)
        return user_actions

    def is_webapp_enabled(self) -> bool:
        for dm in self.delivery_methods:
            if not dm.enabled:
                continue
            if dm.type == DeliveryMethodType.WEBAPP:
                return True
        return False

    def expiration_time(self, start_time: datetime) -> datetime:
        if self.timeout_unit == TimeoutUnit.HOUR:
            return start_time + timedelta(hours=self.timeout)
        elif self.timeout_unit == TimeoutUnit.DAY:
            return start_time + timedelta(days=self.timeout)
        else:
            raise AssertionError("unknown timeout unit.")

    def outputs_field_names(self) -> Sequence[str]:
        field_names = []
        for match in _OUTPUT_VARIABLE_PATTERN.finditer(self.form_content):
            field_names.append(match.group("field_name"))
        return field_names

    def extract_variable_selector_to_variable_mapping(self, node_id: str) -> Mapping[str, Sequence[str]]:
        variable_selectors = []
        variable_template_parser = VariableTemplateParser(template=self.form_content)
        variable_selectors.extend(variable_template_parser.extract_variable_selectors())
        variable_mappings = {}
        for variable_selector in variable_selectors:
            qualified_variable_mapping_key = f"{node_id}.{variable_selector.variable}"
            variable_mappings[qualified_variable_mapping_key] = variable_selector.value_selector

        for input in self.inputs:
            placeholder = input.placeholder
            if placeholder is None:
                continue
            if placeholder.type == PlaceholderType.CONSTANT:
                continue
            placeholder_key = ".".join(placeholder.selector)
            qualified_variable_mapping_key = f"{node_id}.#{placeholder_key}#"
            variable_mappings[qualified_variable_mapping_key] = placeholder.selector

        return variable_mappings


class FormDefinition(BaseModel):
    form_content: str
    inputs: list[FormInput] = Field(default_factory=list)
    user_actions: list[UserAction] = Field(default_factory=list)
    rendered_content: str

    timeout: int
    timeout_unit: TimeoutUnit

    # this is used to store the values of the placeholders
    placeholder_values: dict[str, Any] = Field(default_factory=dict)
