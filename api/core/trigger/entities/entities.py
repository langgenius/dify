from collections.abc import Mapping
from datetime import datetime
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
    multiple: bool | None = Field(
        default=False,
        description="Whether the parameter is multiple select, only valid for select or dynamic-select type",
    )
    default: Union[int, float, str, list, None] = None
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
    icon_dark: Optional[str] = Field(default=None, description="The dark icon of the trigger provider")
    tags: list[str] = Field(default_factory=list, description="The tags of the trigger provider")


class TriggerIdentity(BaseModel):
    """
    The identity of the trigger
    """

    author: str = Field(..., description="The author of the trigger")
    name: str = Field(..., description="The name of the trigger")
    label: I18nObject = Field(..., description="The label of the trigger")
    provider: Optional[str] = Field(default=None, description="The provider of the trigger")


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

    parameters_schema: list[TriggerParameter] | None = Field(
        default_factory=list,
        description="The parameters schema required to create a subscription",
    )

    properties_schema: list[ProviderConfig] | None = Field(
        default_factory=list,
        description="The configuration schema stored in the subscription entity",
    )

    def get_default_parameters(self) -> Mapping[str, Any]:
        """Get the default parameters from the parameters schema"""
        if not self.parameters_schema:
            return {}
        return {param.name: param.default for param in self.parameters_schema if param.default}

    def get_default_properties(self) -> Mapping[str, Any]:
        """Get the default properties from the properties schema"""
        if not self.properties_schema:
            return {}
        return {prop.name: prop.default for prop in self.properties_schema if prop.default}


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

    expires_at: int = Field(
        ..., description="The timestamp when the subscription will expire, this for refresh the subscription"
    )

    endpoint: str = Field(..., description="The webhook endpoint URL allocated by Dify for receiving events")
    properties: Mapping[str, Any] = Field(
        ..., description="Subscription data containing all properties and provider-specific information"
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


class RequestLog(BaseModel):
    id: str = Field(..., description="The id of the request log")
    endpoint: str = Field(..., description="The endpoint of the request log")
    request: dict = Field(..., description="The request of the request log")
    response: dict = Field(..., description="The response of the request log")
    created_at: datetime = Field(..., description="The created at of the request log")


class SubscriptionBuilder(BaseModel):
    id: str = Field(..., description="The id of the subscription builder")
    name: str | None = Field(default=None, description="The name of the subscription builder")
    tenant_id: str = Field(..., description="The tenant id of the subscription builder")
    user_id: str = Field(..., description="The user id of the subscription builder")
    provider_id: str = Field(..., description="The provider id of the subscription builder")
    endpoint_id: str = Field(..., description="The endpoint id of the subscription builder")
    parameters: Mapping[str, Any] = Field(..., description="The parameters of the subscription builder")
    properties: Mapping[str, Any] = Field(..., description="The properties of the subscription builder")
    credentials: Mapping[str, str] = Field(..., description="The credentials of the subscription builder")
    credential_type: str | None = Field(default=None, description="The credential type of the subscription builder")
    credential_expires_at: int | None = Field(
        default=None, description="The credential expires at of the subscription builder"
    )
    expires_at: int = Field(..., description="The expires at of the subscription builder")

    def to_subscription(self) -> Subscription:
        return Subscription(
            expires_at=self.expires_at,
            endpoint=self.endpoint_id,
            properties=self.properties,
        )


class SubscriptionBuilderUpdater(BaseModel):
    name: str | None = Field(default=None, description="The name of the subscription builder")
    parameters: Mapping[str, Any] | None = Field(default=None, description="The parameters of the subscription builder")
    properties: Mapping[str, Any] | None = Field(default=None, description="The properties of the subscription builder")
    credentials: Mapping[str, str] | None = Field(
        default=None, description="The credentials of the subscription builder"
    )
    credential_type: str | None = Field(default=None, description="The credential type of the subscription builder")
    credential_expires_at: int | None = Field(
        default=None, description="The credential expires at of the subscription builder"
    )
    expires_at: int | None = Field(default=None, description="The expires at of the subscription builder")

    def update(self, subscription_builder: SubscriptionBuilder) -> None:
        if self.name:
            subscription_builder.name = self.name
        if self.parameters:
            subscription_builder.parameters = self.parameters
        if self.properties:
            subscription_builder.properties = self.properties
        if self.credentials:
            subscription_builder.credentials = self.credentials
        if self.credential_type:
            subscription_builder.credential_type = self.credential_type
        if self.credential_expires_at:
            subscription_builder.credential_expires_at = self.credential_expires_at
        if self.expires_at:
            subscription_builder.expires_at = self.expires_at


# Export all entities
__all__ = [
    "OAuthSchema",
    "RequestLog",
    "Subscription",
    "SubscriptionBuilder",
    "TriggerDescription",
    "TriggerEntity",
    "TriggerIdentity",
    "TriggerParameter",
    "TriggerParameterType",
    "TriggerProviderEntity",
    "TriggerProviderIdentity",
    "Unsubscription",
]
