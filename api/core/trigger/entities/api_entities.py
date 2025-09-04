from collections.abc import Mapping
from typing import Any, Optional

from pydantic import BaseModel, Field

from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import (
    OAuthSchema,
    SubscriptionSchema,
    TriggerDescription,
    TriggerEntity,
    TriggerParameter,
    TriggerProviderIdentity,
)


class TriggerProviderSubscriptionApiEntity(BaseModel):
    id: str = Field(description="The unique id of the subscription")
    name: str = Field(description="The name of the subscription")
    provider: str = Field(description="The provider id of the subscription")
    credential_type: CredentialType = Field(description="The type of the credential")
    credentials: dict = Field(description="The credentials of the subscription")
    endpoint: str = Field(description="The endpoint of the subscription")
    parameters: dict = Field(description="The parameters of the subscription")
    properties: dict = Field(description="The properties of the subscription")


class TriggerProviderApiEntity(BaseModel):
    identity: TriggerProviderIdentity = Field(description="The identity of the trigger provider")
    credentials_schema: list[ProviderConfig] = Field(description="The credentials schema of the trigger provider")
    oauth_schema: Optional[OAuthSchema] = Field(description="The OAuth schema of the trigger provider")
    subscription_schema: Optional[SubscriptionSchema] = Field(
        description="The subscription schema of the trigger provider"
    )
    triggers: list[TriggerEntity] = Field(description="The triggers of the trigger provider")


class TriggerApiEntity(BaseModel):
    name: str = Field(description="The name of the trigger")
    description: TriggerDescription = Field(description="The description of the trigger")
    parameters: list[TriggerParameter] = Field(description="The parameters of the trigger")
    output_schema: Optional[Mapping[str, Any]] = Field(description="The output schema of the trigger")


class SubscriptionBuilderApiEntity(BaseModel):
    id: str = Field(description="The id of the subscription builder")
    name: str = Field(description="The name of the subscription builder")
    provider: str = Field(description="The provider id of the subscription builder")
    endpoint: str = Field(description="The endpoint id of the subscription builder")
    parameters: Mapping[str, Any] = Field(description="The parameters of the subscription builder")
    properties: Mapping[str, Any] = Field(description="The properties of the subscription builder")
    credentials: Mapping[str, str] = Field(description="The credentials of the subscription builder")
    credential_type: CredentialType = Field(description="The credential type of the subscription builder")


__all__ = ["TriggerApiEntity", "TriggerProviderApiEntity", "TriggerProviderSubscriptionApiEntity"]
