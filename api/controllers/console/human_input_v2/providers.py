"""Canonical Console v2 provider credential DTOs and owner mappings."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator

from core.human_input_v2.email_channel import ResendCandidate
from core.human_input_v2.entities import EmailProviderType, IMProvider
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    LarkIMIntegrationCredentials,
)
from core.human_input_v2.im_provider import (
    DingTalkIMIntegrationCredentials,
    MSTeamsIMIntegrationCredentials,
    SlackIMIntegrationCredentials,
    WeComIMIntegrationCredentials,
)
from core.human_input_v2.shared import NormalizedEmail
from libs.helper import EmailStr

from ._common import StrictModel

type _RequiredSecret = Annotated[SecretStr, Field(min_length=1)]
type _OptionalSecret = Annotated[SecretStr, Field(min_length=1)] | None

_SLACK_BOT_TOKEN_PREFIX = "xoxb-"
_SLACK_APP_TOKEN_PREFIX = "xapp-"


def _secret_value(secret: SecretStr) -> str:
    return secret.get_secret_value()


def _optional_secret_value(secret: SecretStr | None) -> str | None:
    return secret.get_secret_value() if secret is not None else None


class _SecretValidationMixin:
    @field_validator("*", mode="after", check_fields=False)
    @classmethod
    def reject_blank_secrets(cls, value: object) -> object:
        if isinstance(value, SecretStr) and not value.get_secret_value().strip():
            raise ValueError("secret must not be blank")
        return value


class _FeishuLarkCredentialsBase(_SecretValidationMixin, StrictModel):
    app_id: str = Field(min_length=1, description="Feishu or Lark application identifier.")
    app_secret: _RequiredSecret = Field(description="Feishu or Lark application secret.")
    verification_token: _OptionalSecret = Field(default=None, description="Optional callback verification token.")
    encrypt_key: _OptionalSecret = Field(default=None, description="Optional callback encryption key.")


class FeishuCredentials(_FeishuLarkCredentialsBase):
    provider: Literal[IMProvider.FEISHU] = Field(description="Feishu credential discriminator.")

    def to_owner_credentials(self) -> FeishuIMIntegrationCredentials:
        return FeishuIMIntegrationCredentials(
            provider=self.provider,
            app_id=self.app_id,
            app_secret=_secret_value(self.app_secret),
            verification_token=_optional_secret_value(self.verification_token),
            encrypt_key=_optional_secret_value(self.encrypt_key),
        )


class LarkCredentials(_FeishuLarkCredentialsBase):
    provider: Literal[IMProvider.LARK] = Field(description="Lark credential discriminator.")

    def to_owner_credentials(self) -> LarkIMIntegrationCredentials:
        return LarkIMIntegrationCredentials(
            provider=self.provider,
            app_id=self.app_id,
            app_secret=_secret_value(self.app_secret),
            verification_token=_optional_secret_value(self.verification_token),
            encrypt_key=_optional_secret_value(self.encrypt_key),
        )


class SlackCredentials(_SecretValidationMixin, StrictModel):
    provider: Literal[IMProvider.SLACK] = Field(description="Slack credential discriminator.")
    client_id: str = Field(min_length=1, description="Slack OAuth client identifier.")
    client_secret: _RequiredSecret = Field(description="Slack OAuth client secret.")
    signing_secret: _RequiredSecret = Field(description="Slack callback signing secret.")
    bot_token: _RequiredSecret = Field(description="Slack bot API token.")
    app_token: _OptionalSecret = Field(
        default=None,
        description="Optional Slack app-level token required only for Socket Mode.",
    )

    @field_validator("bot_token")
    @classmethod
    def require_bot_token_prefix(cls, token: SecretStr) -> SecretStr:
        if not token.get_secret_value().startswith(_SLACK_BOT_TOKEN_PREFIX):
            raise ValueError("Slack bot token must start with xoxb-")
        return token

    @field_validator("app_token")
    @classmethod
    def require_app_token_prefix(cls, token: SecretStr | None) -> SecretStr | None:
        if token is not None and not token.get_secret_value().startswith(_SLACK_APP_TOKEN_PREFIX):
            raise ValueError("Slack app token must start with xapp-")
        return token

    def to_owner_credentials(self) -> SlackIMIntegrationCredentials:
        return SlackIMIntegrationCredentials(
            provider=self.provider,
            client_id=self.client_id,
            client_secret=_secret_value(self.client_secret),
            signing_secret=_secret_value(self.signing_secret),
            bot_token=_secret_value(self.bot_token),
            app_token=_optional_secret_value(self.app_token),
        )


class DingTalkCredentials(_SecretValidationMixin, StrictModel):
    provider: Literal[IMProvider.DING_TALK] = Field(description="DingTalk credential discriminator.")
    corp_id: str = Field(min_length=1, description="DingTalk corporation identifier.")
    client_id: str = Field(min_length=1, description="DingTalk application client identifier.")
    client_secret: _RequiredSecret = Field(description="DingTalk application client secret.")

    def to_owner_credentials(self) -> DingTalkIMIntegrationCredentials:
        return DingTalkIMIntegrationCredentials(
            provider=self.provider,
            corp_id=self.corp_id,
            client_id=self.client_id,
            client_secret=_secret_value(self.client_secret),
        )


class MSTeamsCredentials(_SecretValidationMixin, StrictModel):
    provider: Literal[IMProvider.MS_TEAMS] = Field(description="Microsoft Teams credential discriminator.")
    tenant_id: str = Field(min_length=1, description="Microsoft Entra tenant identifier.")
    client_id: str = Field(min_length=1, description="Microsoft Teams application client identifier.")
    client_secret: _RequiredSecret = Field(description="Microsoft Teams application client secret.")

    def to_owner_credentials(self) -> MSTeamsIMIntegrationCredentials:
        return MSTeamsIMIntegrationCredentials(
            provider=self.provider,
            tenant_id=self.tenant_id,
            client_id=self.client_id,
            client_secret=_secret_value(self.client_secret),
        )


class WeComCredentials(_SecretValidationMixin, StrictModel):
    provider: Literal[IMProvider.WE_COM] = Field(description="WeCom credential discriminator.")
    corp_id: str = Field(min_length=1, description="WeCom corporation identifier.")
    agent_id: str = Field(min_length=1, description="WeCom application agent identifier.")
    secret: _RequiredSecret = Field(description="WeCom application secret.")

    def to_owner_credentials(self) -> WeComIMIntegrationCredentials:
        return WeComIMIntegrationCredentials(
            provider=self.provider,
            corp_id=self.corp_id,
            agent_id=self.agent_id,
            secret=_secret_value(self.secret),
        )


type IMProviderCredentials = Annotated[
    FeishuCredentials
    | LarkCredentials
    | SlackCredentials
    | DingTalkCredentials
    | MSTeamsCredentials
    | WeComCredentials,
    Field(discriminator="provider"),
]


class ResendCredentials(_SecretValidationMixin, StrictModel):
    provider: Literal[EmailProviderType.RESEND] = EmailProviderType.RESEND
    sender_email: EmailStr = Field(
        ..., description="The email address shown as the sender. Its domain must be verified in Resend."
    )
    sender_name: str = Field(min_length=1, max_length=255)
    api_key: _RequiredSecret = Field(description="Resend API key.")

    def to_owner_candidate(self) -> ResendCandidate:
        return ResendCandidate(
            sender_email=NormalizedEmail(self.sender_email),
            sender_name=self.sender_name,
            api_key=_secret_value(self.api_key),
        )


type EmailProviderCredentials = Annotated[ResendCredentials, Field(discriminator="provider")]


__all__ = [
    "DingTalkCredentials",
    "EmailProviderCredentials",
    "FeishuCredentials",
    "IMProviderCredentials",
    "LarkCredentials",
    "MSTeamsCredentials",
    "ResendCredentials",
    "SlackCredentials",
    "WeComCredentials",
]
