from ._common import StrictModel

from core.human_input_v2.entities import IMProvider


class ChannelKind(StrEnum):
    EMAIL = "email"
    IM = "im"


class _FeishuLarkCredentialsBase(StrictModel):
    """Shared credential fields for Feishu and Lark integrations."""

    app_id: str = Field(description="Feishu or Lark application identifier.")
    app_secret: str = Field(description="Feishu or Lark application secret.")
    verification_token: str | None = Field(
        default=None, description="Optional callback verification token."
    )
    encrypt_key: str | None = Field(default=None, description="Optional callback encrypt key.")


class FeishuCredentials(_FeishuLarkCredentialsBase):
    """Feishu integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.FEISHU] = Field(description="Discriminator for Feishu integration credentials.")


class LarkCredentials(_FeishuLarkCredentialsBase):
    """Lark integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.LARK] = Field(description="Discriminator for Lark integration credentials.")


class SlackCredentials(StrictModel):
    """Slack integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.SLACK] = Field(description="Discriminator for Slack integration credentials.")
    client_id: str = Field(description="Slack OAuth client identifier.")
    client_secret: str = Field(description="Slack OAuth client secret.")
    signing_secret: str = Field(description="Slack signing secret used to verify callbacks.")
    bot_token: str = Field(
        description="Slack bot token used for API calls and message delivery."
    )
    app_token: str | None = Field(
        description="Slack app-level token used exclusively for Socket Mode. None if socket mode is not utilized."
    )


class DingTalkCredentials(StrictModel):
    """DingTalk integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.DING_TALK] = Field(description="Discriminator for DingTalk integration credentials.")
    corp_id: str = Field(description="DingTalk corporation identifier.")
    client_id: str = Field(description="DingTalk application client identifier.")
    client_secret: str = Field(
        repr=False, description="DingTalk application client secret. This field will be masked in response."
    )


class MSTeamsCredentials(StrictModel):
    """Microsoft Teams integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.MS_TEAMS] = Field(
        description="Discriminator for Microsoft Teams integration credentials."
    )
    tenant_id: str = Field(description="Microsoft Entra tenant identifier.")
    client_id: str = Field(description="Microsoft Teams application client identifier.")
    client_secret: str = Field(
        description="Microsoft Teams application client secret. This field will be masked in response"
    )


class WeComCredentials(StrictModel):
    """WeCom integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.WE_COM] = Field(description="Discriminator for WeCom integration credentials.")
    corp_id: str = Field(description="WeCom corporation identifier.")
    agent_id: str = Field(description="WeCom agent identifier.")
    secret: str = Field(
        repr=False, description="WeCom application secret. This field will be masked in response"
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


class EmailProvider(StrEnum):
    """Email provider supported by organization-level Human Input delivery."""

    RESEND = "resend"


class ResendCredential(_StrictModel):
    provider: Literal[EmailProvider.RESEND] = EmailProvider.RESEND

    api_key: str = Field(
        ...,
        description="Resend API key. "
    )
    sender_email: str = Field(
        ..., description="The email address shown as the sender. Its domain must be verified in Resend."
    )

    sender_name: str = Field(..., description="The sender's name displayed in the recipient's inbox.")


type EmailProviderCredentials = Annotated[ResendCredential, Field(discriminator="provider")]
