"""Canonical credentials accepted by IM provider adapters."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from core.human_input_v2.entities import IMProvider


class _ProviderCredentials(BaseModel):
    """Strict immutable credentials bound to one provider adapter lifetime."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        strict=True,
        hide_input_in_errors=True,
    )


class _FeishuLarkCredentials(_ProviderCredentials):
    """Shared resolved credentials for Feishu and Lark adapters."""

    app_id: str = Field(min_length=1, description="Provider application identifier.")
    app_secret: str = Field(min_length=1, repr=False, description="Resolved application secret.")
    verification_token: str | None = Field(
        default=None,
        min_length=1,
        repr=False,
        description="Resolved callback verification token.",
    )
    encrypt_key: str | None = Field(
        default=None,
        min_length=1,
        repr=False,
        description="Resolved callback encryption key.",
    )


class FeishuCredentials(_FeishuLarkCredentials):
    """Resolved Feishu credentials bound for one adapter lifetime."""

    provider: Literal[IMProvider.FEISHU] = Field(description="Feishu credential discriminator.")


class LarkCredentials(_FeishuLarkCredentials):
    """Resolved Lark credentials bound for one adapter lifetime."""

    provider: Literal[IMProvider.LARK] = Field(description="Lark credential discriminator.")


class SlackCredentials(_ProviderCredentials):
    """Resolved Slack credentials bound for one adapter lifetime."""

    provider: Literal[IMProvider.SLACK] = Field(description="Slack credential discriminator.")
    client_id: str = Field(min_length=1, description="Slack OAuth client identifier.")
    client_secret: str = Field(min_length=1, repr=False, description="Resolved Slack OAuth client secret.")
    signing_secret: str = Field(min_length=1, repr=False, description="Resolved Slack callback signing secret.")
    bot_token: str = Field(
        min_length=1,
        pattern=r"^xoxb-",
        repr=False,
        description="Resolved Slack bot API token.",
    )
    app_token: str | None = Field(
        default=None,
        min_length=1,
        pattern=r"^xapp-",
        repr=False,
        description="Optional resolved Slack app-level token required only for Socket Mode.",
    )


class DingTalkCredentials(_ProviderCredentials):
    """Resolved DingTalk credentials bound for one adapter lifetime."""

    provider: Literal[IMProvider.DING_TALK] = Field(description="DingTalk credential discriminator.")
    corp_id: str = Field(min_length=1, pattern=r"\S", description="DingTalk corporation identifier.")
    client_id: str = Field(min_length=1, pattern=r"\S", description="DingTalk application client identifier.")
    client_secret: str = Field(
        min_length=1,
        pattern=r"\S",
        repr=False,
        description="Resolved DingTalk application client secret.",
    )


class MSTeamsCredentials(_ProviderCredentials):
    """Resolved Microsoft Teams credentials bound for one adapter lifetime."""

    provider: Literal[IMProvider.MS_TEAMS] = Field(description="Microsoft Teams credential discriminator.")
    tenant_id: str = Field(
        min_length=1,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        description="Microsoft Entra tenant identifier.",
    )
    client_id: str = Field(
        min_length=1,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        description="Microsoft Teams bot application client identifier.",
    )
    client_secret: str = Field(
        min_length=1,
        repr=False,
        description="Resolved Microsoft Teams application client secret.",
    )


class WeComCredentials(_ProviderCredentials):
    """Resolved WeCom credentials bound for one adapter lifetime."""

    provider: Literal[IMProvider.WE_COM] = Field(description="WeCom credential discriminator.")
    corp_id: str = Field(min_length=1, pattern=r"\S", description="WeCom corporation identifier.")
    agent_id: str = Field(
        min_length=1,
        pattern=r"^[1-9][0-9]*$",
        description="WeCom application agent identifier.",
    )
    secret: str = Field(
        min_length=1,
        pattern=r"\S",
        repr=False,
        description="Resolved WeCom application secret.",
    )


type IMProviderCredentials = Annotated[
    (
        FeishuCredentials
        | LarkCredentials
        | SlackCredentials
        | DingTalkCredentials
        | MSTeamsCredentials
        | WeComCredentials
    ),
    Field(discriminator="provider"),
]

IMProviderCredentialsAdapter: TypeAdapter[IMProviderCredentials] = TypeAdapter(IMProviderCredentials)


__all__ = [
    "DingTalkCredentials",
    "FeishuCredentials",
    "IMProviderCredentials",
    "IMProviderCredentialsAdapter",
    "LarkCredentials",
    "MSTeamsCredentials",
    "SlackCredentials",
    "WeComCredentials",
]
