"""
Human Input node entities.
"""

import re
import uuid
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from typing import Annotated, Any, ClassVar, Literal, Self

from pydantic import BaseModel, Field, field_validator, model_validator

from core.variables.consts import SELECTORS_LENGTH
from core.workflow.nodes.base import BaseNodeData
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser
from core.workflow.runtime import VariablePool

from .enums import ButtonStyle, DeliveryMethodType, EmailRecipientType, FormInputType, PlaceholderType, TimeoutUnit

_OUTPUT_VARIABLE_PATTERN = re.compile(r"\{\{#\$output\.(?P<field_name>[a-zA-Z_][a-zA-Z0-9_]{0,29})#\}\}")


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

    # When true, recipients are the union of all workspace members and external items.
    # Member items are ignored because they are already covered by the workspace scope.
    # De-duplication is applied by email, with member recipients taking precedence.
    whole_workspace: bool = False
    items: list[EmailRecipient] = Field(default_factory=list)


class EmailDeliveryConfig(BaseModel):
    """Configuration for email delivery method."""

    URL_PLACEHOLDER: ClassVar[str] = "{{#url#}}"

    recipients: EmailRecipients

    # the subject of email
    subject: str

    # Body is the content of email.It may contain the speical placeholder `{{#url#}}`, which
    # represent the url to submit the form.
    #
    # It may also reference the output variable of the previous node with the syntax
    # `{{#<node_id>.<field_name>#}}`.
    body: str
    debug_mode: bool = False

    def with_debug_recipient(self, user_id: str) -> "EmailDeliveryConfig":
        if not user_id:
            debug_recipients = EmailRecipients(whole_workspace=False, items=[])
            return self.model_copy(update={"recipients": debug_recipients})
        debug_recipients = EmailRecipients(whole_workspace=False, items=[MemberRecipient(user_id=user_id)])
        return self.model_copy(update={"recipients": debug_recipients})

    @classmethod
    def replace_url_placeholder(cls, body: str, url: str | None) -> str:
        """Replace the url placeholder with provided value."""
        return body.replace(cls.URL_PLACEHOLDER, url or "")

    @classmethod
    def render_body_template(
        cls,
        *,
        body: str,
        url: str | None,
        variable_pool: VariablePool | None = None,
    ) -> str:
        """Render email body by replacing placeholders with runtime values."""
        templated_body = cls.replace_url_placeholder(body, url)
        if variable_pool is None:
            return templated_body
        return variable_pool.convert_template(templated_body).text


class _DeliveryMethodBase(BaseModel):
    """Base delivery method configuration."""

    enabled: bool = True
    id: uuid.UUID = Field(default_factory=uuid.uuid4)

    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        return ()


class WebAppDeliveryMethod(_DeliveryMethodBase):
    """Webapp delivery method configuration."""

    type: Literal[DeliveryMethodType.WEBAPP] = DeliveryMethodType.WEBAPP
    # The config field is not used currently.
    config: _WebAppDeliveryConfig = Field(default_factory=_WebAppDeliveryConfig)


class EmailDeliveryMethod(_DeliveryMethodBase):
    """Email delivery method configuration."""

    type: Literal[DeliveryMethodType.EMAIL] = DeliveryMethodType.EMAIL
    config: EmailDeliveryConfig

    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        variable_template_parser = VariableTemplateParser(template=self.config.body)
        selectors: list[Sequence[str]] = []
        for variable_selector in variable_template_parser.extract_variable_selectors():
            value_selector = list(variable_selector.value_selector)
            if len(value_selector) < SELECTORS_LENGTH:
                continue
            selectors.append(value_selector[:SELECTORS_LENGTH])
        return selectors


DeliveryChannelConfig = Annotated[WebAppDeliveryMethod | EmailDeliveryMethod, Field(discriminator="type")]


def apply_debug_email_recipient(
    method: DeliveryChannelConfig,
    *,
    enabled: bool,
    user_id: str,
) -> DeliveryChannelConfig:
    if not enabled:
        return method
    if not isinstance(method, EmailDeliveryMethod):
        return method
    if not method.config.debug_mode:
        return method
    debug_config = method.config.with_debug_recipient(user_id or "")
    return method.model_copy(update={"config": debug_config})


class FormInputDefault(BaseModel):
    """Default configuration for form inputs."""

    # NOTE: Ideally, a discriminated union would be used to model
    # FormInputDefault. However, the UI requires preserving the previous
    # value when switching between `VARIABLE` and `CONSTANT` types. This
    # necessitates retaining all fields, making a discriminated union unsuitable.

    type: PlaceholderType

    # The selector of default variable, used when `type` is `VARIABLE`.
    selector: Sequence[str] = Field(default_factory=tuple)  #

    # The value of the default, used when `type` is `CONSTANT`.
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
    default: FormInputDefault | None = None


_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class UserAction(BaseModel):
    """User action configuration."""

    # id is the identifier for this action.
    # It also serves as the identifiers of output handle.
    #
    # The id must be a valid identifier (satisfy the _IDENTIFIER_PATTERN above.)
    id: str = Field(max_length=20)
    title: str = Field(max_length=20)
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
        variable_mappings: dict[str, Sequence[str]] = {}

        def _add_variable_selectors(selectors: Sequence[Sequence[str]]) -> None:
            for selector in selectors:
                if len(selector) < SELECTORS_LENGTH:
                    continue
                qualified_variable_mapping_key = f"{node_id}.#{'.'.join(selector[:SELECTORS_LENGTH])}#"
                variable_mappings[qualified_variable_mapping_key] = list(selector[:SELECTORS_LENGTH])

        form_template_parser = VariableTemplateParser(template=self.form_content)
        _add_variable_selectors(
            [selector.value_selector for selector in form_template_parser.extract_variable_selectors()]
        )
        for delivery_method in self.delivery_methods:
            if not delivery_method.enabled:
                continue
            _add_variable_selectors(delivery_method.extract_variable_selectors())

        for input in self.inputs:
            default_value = input.default
            if default_value is None:
                continue
            if default_value.type == PlaceholderType.CONSTANT:
                continue
            default_value_key = ".".join(default_value.selector)
            qualified_variable_mapping_key = f"{node_id}.#{default_value_key}#"
            variable_mappings[qualified_variable_mapping_key] = default_value.selector

        return variable_mappings

    def find_action_text(self, action_id: str) -> str:
        """
        Resolve action display text by id.
        """
        for action in self.user_actions:
            if action.id == action_id:
                return action.title
        return action_id


class FormDefinition(BaseModel):
    form_content: str
    inputs: list[FormInput] = Field(default_factory=list)
    user_actions: list[UserAction] = Field(default_factory=list)
    rendered_content: str
    expiration_time: datetime

    # this is used to store the resolved default values
    default_values: dict[str, Any] = Field(default_factory=dict)

    # node_title records the title of the HumanInput node.
    node_title: str | None = None

    # display_in_ui controls whether the form should be displayed in UI surfaces.
    display_in_ui: bool | None = None


class HumanInputSubmissionValidationError(ValueError):
    pass


def validate_human_input_submission(
    *,
    inputs: Sequence[FormInput],
    user_actions: Sequence[UserAction],
    selected_action_id: str,
    form_data: Mapping[str, Any],
) -> None:
    available_actions = {action.id for action in user_actions}
    if selected_action_id not in available_actions:
        raise HumanInputSubmissionValidationError(f"Invalid action: {selected_action_id}")

    provided_inputs = set(form_data.keys())
    missing_inputs = [
        form_input.output_variable_name
        for form_input in inputs
        if form_input.output_variable_name not in provided_inputs
    ]

    if missing_inputs:
        missing_list = ", ".join(missing_inputs)
        raise HumanInputSubmissionValidationError(f"Missing required inputs: {missing_list}")
