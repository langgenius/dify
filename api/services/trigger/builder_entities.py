"""Temporary trigger builder state and its application-facing creation methods."""

from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from core.trigger.entities.entities import Subscription


class RequestLog(BaseModel):
    id: str = Field(..., description="The id of the request log")
    endpoint: str = Field(..., description="The endpoint of the request log")
    request: dict[str, Any] = Field(..., description="The request of the request log")
    response: dict[str, Any] = Field(..., description="The response of the request log")
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
    credentials: Mapping[str, Any] = Field(..., description="The credentials of the subscription builder")
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
    credentials: Mapping[str, Any] | None = Field(
        default=None, description="The credentials of the subscription builder"
    )
    credential_type: str | None = Field(default=None, description="The credential type of the subscription builder")
    credential_expires_at: int | None = Field(
        default=None, description="The credential expires at of the subscription builder"
    )
    expires_at: int | None = Field(default=None, description="The expires at of the subscription builder")

    def update(self, subscription_builder: SubscriptionBuilder) -> None:
        if self.name is not None:
            subscription_builder.name = self.name
        if self.parameters is not None:
            subscription_builder.parameters = self.parameters
        if self.properties is not None:
            subscription_builder.properties = self.properties
        if self.credentials is not None:
            subscription_builder.credentials = self.credentials
        if self.credential_type is not None:
            subscription_builder.credential_type = self.credential_type
        if self.credential_expires_at is not None:
            subscription_builder.credential_expires_at = self.credential_expires_at
        if self.expires_at is not None:
            subscription_builder.expires_at = self.expires_at


class TriggerEventData(BaseModel):
    """Event data dispatched to trigger sessions."""

    subscription_id: str
    events: list[str]
    request_id: str
    timestamp: float

    model_config = ConfigDict(arbitrary_types_allowed=True)


class TriggerCreationMethod(StrEnum):
    OAUTH = "OAUTH"
    APIKEY = "APIKEY"
    MANUAL = "MANUAL"
