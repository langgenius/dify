"""Plugin declaration and wire types shared by the SDK and workflow nodes.

Runtime orchestration lives in services.trigger. The plugin SDK and workflow
nodes still consume these types, so moving them into services would invert that
dependency. TODO: Move them to the shared contract owner when the plugin SDK is
migrated, updating SDK, workflow, model and service consumers together.
"""

from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, ValidationInfo, field_validator

from core.entities.provider_entities import ProviderConfig
from core.plugin.entities import OAuthSchema
from core.plugin.entities.parameters import (
    PluginParameterAutoGenerate,
    PluginParameterOption,
    PluginParameterTemplate,
    PluginParameterType,
)
from core.tools.entities.common_entities import I18nObject


class EventParameterType(StrEnum):
    """The type of the parameter"""

    STRING = PluginParameterType.STRING
    NUMBER = PluginParameterType.NUMBER
    BOOLEAN = PluginParameterType.BOOLEAN
    SELECT = PluginParameterType.SELECT
    FILE = PluginParameterType.FILE
    FILES = PluginParameterType.FILES
    MODEL_SELECTOR = PluginParameterType.MODEL_SELECTOR
    APP_SELECTOR = PluginParameterType.APP_SELECTOR
    OBJECT = PluginParameterType.OBJECT
    ARRAY = PluginParameterType.ARRAY
    DYNAMIC_SELECT = PluginParameterType.DYNAMIC_SELECT
    CHECKBOX = PluginParameterType.CHECKBOX


class EventParameter(BaseModel):
    """
    The parameter of the event
    """

    name: str = Field(..., description="The name of the parameter")
    label: I18nObject = Field(..., description="The label presented to the user")
    type: EventParameterType = Field(..., description="The type of the parameter")
    auto_generate: PluginParameterAutoGenerate | None = Field(
        default=None, description="The auto generate of the parameter"
    )
    template: PluginParameterTemplate | None = Field(default=None, description="The template of the parameter")
    scope: str | None = None
    required: bool = False
    multiple: bool = Field(
        default=False,
        description="Whether the parameter is multiple select, only valid for select or dynamic-select type",
    )
    default: int | float | str | list[Any] | None = None
    min: float | int | None = None
    max: float | int | None = None
    precision: int | None = None
    options: list[PluginParameterOption] | None = None
    description: I18nObject | None = None


class TriggerProviderIdentity(BaseModel):
    """
    The identity of the trigger provider
    """

    author: str = Field(..., description="The author of the trigger provider")
    name: str = Field(..., description="The name of the trigger provider")
    label: I18nObject = Field(..., description="The label of the trigger provider")
    description: I18nObject = Field(..., description="The description of the trigger provider")
    icon: str | None = Field(default=None, description="The icon of the trigger provider")
    icon_dark: str | None = Field(default=None, description="The dark icon of the trigger provider")
    tags: list[str] = Field(default_factory=list, description="The tags of the trigger provider")

    @field_validator("tags", mode="before")
    @classmethod
    def validate_tags(cls, v: list[str] | None) -> list[str]:
        return v or []


class EventIdentity(BaseModel):
    """
    The identity of the event
    """

    author: str = Field(..., description="The author of the event")
    name: str = Field(..., description="The name of the event")
    label: I18nObject = Field(..., description="The label of the event")
    provider: str | None = Field(default=None, description="The provider of the event")


class EventEntity(BaseModel):
    """
    The configuration of an event
    """

    identity: EventIdentity = Field(..., description="The identity of the event")
    parameters: list[EventParameter] = Field(
        default_factory=list[EventParameter], description="The parameters of the event"
    )
    description: I18nObject = Field(..., description="The description of the event")
    output_schema: Mapping[str, Any] | None = Field(
        default=None, description="The output schema that this event produces"
    )

    @field_validator("parameters", mode="before")
    @classmethod
    def set_parameters(cls, v, validation_info: ValidationInfo) -> list[EventParameter]:
        return v or []


class SubscriptionConstructor(BaseModel):
    """
    The subscription constructor of the trigger provider
    """

    parameters: list[EventParameter] = Field(
        default_factory=list, description="The parameters schema of the subscription constructor"
    )

    credentials_schema: list[ProviderConfig] = Field(
        default_factory=list,
        description="The credentials schema of the subscription constructor",
    )

    oauth_schema: OAuthSchema | None = Field(
        default=None,
        description="The OAuth schema of the subscription constructor if OAuth is supported",
    )

    def get_default_parameters(self) -> Mapping[str, Any]:
        """Get the default parameters from the parameters schema"""
        if not self.parameters:
            return {}
        return {param.name: param.default for param in self.parameters if param.default}


class TriggerProviderEntity(BaseModel):
    """
    The configuration of a trigger provider
    """

    identity: TriggerProviderIdentity = Field(..., description="The identity of the trigger provider")
    subscription_schema: list[ProviderConfig] = Field(
        default_factory=list,
        description="The configuration schema stored in the subscription entity",
    )
    subscription_constructor: SubscriptionConstructor | None = Field(
        default=None,
        description="The subscription constructor of the trigger provider",
    )
    events: list[EventEntity] = Field(default_factory=list, description="The events of the trigger provider")


class Subscription(BaseModel):
    """
    Result of a successful trigger subscription operation.

    Contains all information needed to manage the subscription lifecycle.
    """

    expires_at: int = Field(
        ..., description="The timestamp when the subscription will expire, this for refresh the subscription"
    )

    endpoint: str = Field(..., description="The webhook endpoint URL allocated by Dify for receiving events")
    parameters: Mapping[str, Any] = Field(
        default_factory=dict, description="The parameters of the subscription constructor"
    )
    properties: Mapping[str, Any] = Field(
        ..., description="Subscription data containing all properties and provider-specific information"
    )


class UnsubscribeResult(BaseModel):
    """
    Result of a trigger unsubscription operation.

    Provides detailed information about the unsubscription attempt,
    including success status and error details if failed.
    """

    success: bool = Field(..., description="Whether the unsubscription was successful")

    message: str | None = Field(
        None,
        description="Human-readable message about the operation result. "
        "Success message for successful operations, "
        "detailed error information for failures.",
    )
