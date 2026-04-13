from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, Field

from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.entities.common_entities import I18nObject
from core.trigger.entities.entities import (
    EventIdentity,
    EventParameter,
    SubscriptionConstructor,
    TriggerCreationMethod,
)


class TriggerProviderSubscriptionApiEntity(BaseModel):
    id: str = Field(description="The unique id of the subscription")
    name: str = Field(description="The name of the subscription")
    provider: str = Field(description="The provider id of the subscription")
    credential_type: CredentialType = Field(description="The type of the credential")
    credentials: dict[str, Any] = Field(description="The credentials of the subscription")
    endpoint: str = Field(description="The endpoint of the subscription")
    parameters: dict[str, Any] = Field(description="The parameters of the subscription")
    properties: dict[str, Any] = Field(description="The properties of the subscription")
    workflows_in_use: int = Field(description="The number of workflows using this subscription")


class EventApiEntity(BaseModel):
    name: str = Field(description="The name of the trigger")
    identity: EventIdentity = Field(description="The identity of the trigger")
    description: I18nObject = Field(description="The description of the trigger")
    parameters: list[EventParameter] = Field(description="The parameters of the trigger")
    output_schema: Mapping[str, Any] | None = Field(description="The output schema of the trigger")


class TriggerProviderApiEntity(BaseModel):
    author: str = Field(..., description="The author of the trigger provider")
    name: str = Field(..., description="The name of the trigger provider")
    label: I18nObject = Field(..., description="The label of the trigger provider")
    description: I18nObject = Field(..., description="The description of the trigger provider")
    icon: str | None = Field(default=None, description="The icon of the trigger provider")
    icon_dark: str | None = Field(default=None, description="The dark icon of the trigger provider")
    tags: list[str] = Field(default_factory=list, description="The tags of the trigger provider")

    plugin_id: str | None = Field(default="", description="The plugin id of the tool")
    plugin_unique_identifier: str | None = Field(default="", description="The unique identifier of the tool")

    supported_creation_methods: list[TriggerCreationMethod] = Field(
        default_factory=list,
        description="Supported creation methods for the trigger provider. like 'OAUTH', 'APIKEY', 'MANUAL'.",
    )

    subscription_constructor: SubscriptionConstructor | None = Field(
        default=None, description="The subscription constructor of the trigger provider"
    )

    subscription_schema: list[ProviderConfig] = Field(
        default_factory=list,
        description="The subscription schema of the trigger provider",
    )
    events: list[EventApiEntity] = Field(description="The events of the trigger provider")


class SubscriptionBuilderApiEntity(BaseModel):
    id: str = Field(description="The id of the subscription builder")
    name: str = Field(description="The name of the subscription builder")
    provider: str = Field(description="The provider id of the subscription builder")
    endpoint: str = Field(description="The endpoint id of the subscription builder")
    parameters: Mapping[str, Any] = Field(description="The parameters of the subscription builder")
    properties: Mapping[str, Any] = Field(description="The properties of the subscription builder")
    credentials: Mapping[str, str] = Field(description="The credentials of the subscription builder")
    credential_type: CredentialType = Field(description="The credential type of the subscription builder")


__all__ = ["EventApiEntity", "TriggerProviderApiEntity", "TriggerProviderSubscriptionApiEntity"]
