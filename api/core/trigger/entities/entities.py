from collections.abc import Mapping
from enum import StrEnum
from typing import Any, Optional, Union

from pydantic import BaseModel, Field

from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.parameters import PluginParameterAutoGenerate, PluginParameterOption, PluginParameterTemplate
from core.tools.entities.common_entities import I18nObject


class TriggerParameterType(StrEnum):
    """The type of the parameter"""

    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    SELECT = "select"
    FILE = "file"
    FILES = "files"
    MODEL_SELECTOR = "model-selector"
    APP_SELECTOR = "app-selector"
    OBJECT = "object"
    ARRAY = "array"
    DYNAMIC_SELECT = "dynamic-select"


class TriggerParameter(BaseModel):
    """
    The parameter of the trigger
    """

    name: str = Field(..., description="The name of the parameter")
    label: I18nObject = Field(..., description="The label presented to the user")
    type: TriggerParameterType = Field(..., description="The type of the parameter")
    auto_generate: Optional[PluginParameterAutoGenerate] = Field(
        default=None, description="The auto generate of the parameter"
    )
    template: Optional[PluginParameterTemplate] = Field(default=None, description="The template of the parameter")
    scope: Optional[str] = None
    required: Optional[bool] = False
    default: Union[int, float, str, None] = None
    min: Union[float, int, None] = None
    max: Union[float, int, None] = None
    precision: Optional[int] = None
    options: Optional[list[PluginParameterOption]] = None
    description: Optional[I18nObject] = None


class TriggerProviderIdentity(BaseModel):
    """
    The identity of the trigger provider
    """

    author: str = Field(..., description="The author of the trigger provider")
    name: str = Field(..., description="The name of the trigger provider")
    label: I18nObject = Field(..., description="The label of the trigger provider")
    description: I18nObject = Field(..., description="The description of the trigger provider")
    icon: Optional[str] = Field(default=None, description="The icon of the trigger provider")
    tags: list[str] = Field(default_factory=list, description="The tags of the trigger provider")


class TriggerIdentity(BaseModel):
    """
    The identity of the trigger
    """

    author: str = Field(..., description="The author of the trigger")
    name: str = Field(..., description="The name of the trigger")
    label: I18nObject = Field(..., description="The label of the trigger")
    provider: str = Field(..., description="The provider of the trigger")


class TriggerDescription(BaseModel):
    """
    The description of the trigger
    """

    human: I18nObject = Field(..., description="Human readable description")
    llm: I18nObject = Field(..., description="LLM readable description")


class TriggerEntity(BaseModel):
    """
    The configuration of a trigger
    """

    identity: TriggerIdentity = Field(..., description="The identity of the trigger")
    parameters: list[TriggerParameter] = Field(default=[], description="The parameters of the trigger")
    description: TriggerDescription = Field(..., description="The description of the trigger")
    output_schema: Optional[Mapping[str, Any]] = Field(
        default=None, description="The output schema that this trigger produces"
    )


class OAuthSchema(BaseModel):
    client_schema: list[ProviderConfig] = Field(default_factory=list, description="The schema of the OAuth client")
    credentials_schema: list[ProviderConfig] = Field(
        default_factory=list, description="The schema of the OAuth credentials"
    )

class SubscriptionSchema(BaseModel):
    """
    The subscription schema of the trigger provider
    """

    parameters_schema: list[ProviderConfig] | None = Field(
        default_factory=list,
        description="The parameters schema required to create a subscription",
    )

    properties_schema: list[ProviderConfig] | None = Field(
        default_factory=list,
        description="The configuration schema stored in the subscription entity",
    )

class TriggerProviderEntity(BaseModel):
    """
    The configuration of a trigger provider
    """

    identity: TriggerProviderIdentity = Field(..., description="The identity of the trigger provider")
    credentials_schema: list[ProviderConfig] = Field(
        default_factory=list,
        description="The credentials schema of the trigger provider",
    )
    oauth_schema: Optional[OAuthSchema] = Field(
        default=None,
        description="The OAuth schema of the trigger provider if OAuth is supported",
    )
    subscription_schema: SubscriptionSchema = Field(
        description="The subscription schema for trigger(webhook, polling, etc.) subscription parameters",
    )
    triggers: list[TriggerEntity] = Field(default=[], description="The triggers of the trigger provider")


class Subscription(BaseModel):
    """
    Result of a successful trigger subscription operation.

    Contains all information needed to manage the subscription lifecycle.
    """

    expire_at: int = Field(
        ..., description="The timestamp when the subscription will expire, this for refresh the subscription"
    )

    metadata: dict[str, Any] = Field(
        ..., description="Metadata about the subscription in the external service, defined in subscription_schema"
    )


class Unsubscription(BaseModel):
    """
    Result of a trigger unsubscription operation.

    Provides detailed information about the unsubscription attempt,
    including success status and error details if failed.
    """

    success: bool = Field(..., description="Whether the unsubscription was successful")

    message: Optional[str] = Field(
        None,
        description="Human-readable message about the operation result. "
        "Success message for successful operations, "
        "detailed error information for failures.",
    )


# Export all entities
__all__ = [
    "OAuthSchema",
    "Subscription",
    "TriggerDescription",
    "TriggerEntity",
    "TriggerIdentity",
    "TriggerParameter",
    "TriggerParameterType",
    "TriggerProviderEntity",
    "TriggerProviderIdentity",
    "Unsubscription",
]
