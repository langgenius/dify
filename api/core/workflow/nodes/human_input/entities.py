"""
Human Input node entities.
"""

from enum import StrEnum
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field, model_validator

from core.workflow.nodes.base import BaseNodeData


class DeliveryMethodType(StrEnum):
    """Delivery method types for human input forms."""

    WEBAPP = "webapp"
    EMAIL = "email"


class ButtonStyle(StrEnum):
    """Button styles for user actions."""

    PRIMARY = "primary"
    DEFAULT = "default"
    ACCENT = "accent"
    GHOST = "ghost"


class TimeoutUnit(StrEnum):
    """Timeout unit for form expiration."""

    HOUR = "hour"
    DAY = "day"


class FormInputType(StrEnum):
    """Form input types."""

    TEXT_INPUT = "text-input"
    PARAGRAPH = "paragraph"


class PlaceholderType(StrEnum):
    """Placeholder types for form inputs."""

    VARIABLE = "variable"
    CONSTANT = "constant"


class RecipientType(StrEnum):
    """Email recipient types."""

    MEMBER = "member"
    EXTERNAL = "external"


class WebAppDeliveryConfig(BaseModel):
    """Configuration for webapp delivery method."""

    pass  # Empty for webapp delivery


class MemberRecipient(BaseModel):
    """Member recipient for email delivery."""

    type: Literal[RecipientType.MEMBER]
    user_id: str


class ExternalRecipient(BaseModel):
    """External recipient for email delivery."""

    type: Literal[RecipientType.EXTERNAL]
    email: str


Recipient = Union[MemberRecipient, ExternalRecipient]


class EmailRecipients(BaseModel):
    """Email recipients configuration."""

    whole_workspace: bool = False
    items: list[Recipient] = Field(default_factory=list)


class EmailDeliveryConfig(BaseModel):
    """Configuration for email delivery method."""

    recipients: EmailRecipients
    subject: str
    body: str


DeliveryConfig = Union[WebAppDeliveryConfig, EmailDeliveryConfig]


class DeliveryMethod(BaseModel):
    """Delivery method configuration."""

    type: DeliveryMethodType
    enabled: bool = True
    config: Optional[DeliveryConfig] = None

    @model_validator(mode="after")
    def validate_config_type(self):
        """Validate that config matches the delivery method type."""
        if self.config is None:
            return self

        if self.type == DeliveryMethodType.EMAIL:
            if isinstance(self.config, dict):
                # Try to parse as EmailDeliveryConfig - this will raise validation errors
                try:
                    self.config = EmailDeliveryConfig.model_validate(self.config)
                except Exception as e:
                    # Re-raise with more specific context
                    raise ValueError(f"Invalid email delivery configuration: {str(e)}")
            elif not isinstance(self.config, EmailDeliveryConfig):
                raise ValueError("Config must be EmailDeliveryConfig for email delivery method")
        elif self.type == DeliveryMethodType.WEBAPP:
            if isinstance(self.config, dict):
                # Try to parse as WebAppDeliveryConfig
                try:
                    self.config = WebAppDeliveryConfig.model_validate(self.config)
                except Exception as e:
                    raise ValueError(f"Invalid webapp delivery configuration: {str(e)}")
            elif not isinstance(self.config, WebAppDeliveryConfig):
                raise ValueError("Config must be WebAppDeliveryConfig for webapp delivery method")

        return self


class FormInputPlaceholder(BaseModel):
    """Placeholder configuration for form inputs."""

    type: PlaceholderType
    selector: list[str] = Field(default_factory=list)  # Used when type is VARIABLE
    value: str = ""  # Used when type is CONSTANT


class FormInput(BaseModel):
    """Form input definition."""

    type: FormInputType
    output_variable_name: str
    placeholder: Optional[FormInputPlaceholder] = None


class UserAction(BaseModel):
    """User action configuration."""

    id: str
    title: str
    button_style: ButtonStyle = ButtonStyle.DEFAULT


class HumanInputNodeData(BaseNodeData):
    """Human Input node data."""

    delivery_methods: list[DeliveryMethod] = Field(default_factory=list)
    form_content: str = ""
    inputs: list[FormInput] = Field(default_factory=list)
    user_actions: list[UserAction] = Field(default_factory=list)
    timeout: int = 36
    timeout_unit: TimeoutUnit = TimeoutUnit.HOUR


class HumanInputRequired(BaseModel):
    """Event data for human input required."""

    form_id: str
    node_id: str
    form_content: str
    inputs: list[FormInput]
    web_app_form_token: Optional[str] = None


class WorkflowSuspended(BaseModel):
    """Event data for workflow suspended."""

    suspended_at_node_ids: list[str]


class PauseTypeHumanInput(BaseModel):
    """Pause type for human input."""

    type: Literal["human_input"]
    form_id: str


class PauseTypeBreakpoint(BaseModel):
    """Pause type for breakpoint (debugging)."""

    type: Literal["breakpoint"]


PauseType = Union[PauseTypeHumanInput, PauseTypeBreakpoint]


class PausedNode(BaseModel):
    """Information about a paused node."""

    node_id: str
    node_title: str
    pause_type: PauseType


class WorkflowPauseDetails(BaseModel):
    """Details about workflow pause."""

    paused_at: str  # ISO datetime
    paused_nodes: list[PausedNode]


class FormSubmissionRequest(BaseModel):
    """Form submission request data."""

    inputs: dict[str, str]  # mapping of output_variable_name to user input
    action: str  # UserAction id


class FormGetResponse(BaseModel):
    """Response for form get API."""

    site: Optional[dict[str, Any]] = None  # Site information for webapp
    form_content: str
    inputs: list[FormInput]


class FormSubmissionResponse(BaseModel):
    """Response for successful form submission."""

    pass  # Empty response for success


class FormErrorResponse(BaseModel):
    """Response for form submission errors."""

    error_code: str
    description: str


class ResumeWaitResponse(BaseModel):
    """Response for resume wait API."""

    status: Literal["paused", "running", "ended"]
