"""Credential projections exposing identifiers while keeping secrets redacted."""

from typing import Annotated, Literal

from pydantic import Field

from core.human_input_v2.entities import EmailProviderType, IMProvider
from core.human_input_v2.im_integration.adapters.credentials import (
    DingTalkCredentials,
    FeishuCredentials,
    IMProviderCredentials,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
)
from fields.base import ResponseModel


class Redacted(ResponseModel):
    """A configured credential whose stored value is omitted."""

    type: Literal["redacted"] = "redacted"


class FeishuLarkCredentialsResponse(ResponseModel):
    provider: Literal[IMProvider.FEISHU, IMProvider.LARK]
    app_id: str
    app_secret: Redacted
    verification_token: Redacted | None
    encrypt_key: Redacted | None


class SlackCredentialsResponse(ResponseModel):
    provider: Literal[IMProvider.SLACK]
    client_id: str
    client_secret: Redacted
    signing_secret: Redacted
    bot_token: Redacted
    app_token: Redacted | None


class DingTalkCredentialsResponse(ResponseModel):
    provider: Literal[IMProvider.DING_TALK]
    corp_id: str
    client_id: str
    client_secret: Redacted


class MSTeamsCredentialsResponse(ResponseModel):
    provider: Literal[IMProvider.MS_TEAMS]
    tenant_id: str
    client_id: str
    client_secret: Redacted


class WeComCredentialsResponse(ResponseModel):
    provider: Literal[IMProvider.WE_COM]
    corp_id: str
    agent_id: str
    secret: Redacted


type IMProviderCredentialsResponse = Annotated[
    FeishuLarkCredentialsResponse
    | SlackCredentialsResponse
    | DingTalkCredentialsResponse
    | MSTeamsCredentialsResponse
    | WeComCredentialsResponse,
    Field(discriminator="provider"),
]


class ResendCredentialsResponse(ResponseModel):
    provider: Literal[EmailProviderType.RESEND]
    api_key: Redacted


def im_credentials_response(credentials: IMProviderCredentials) -> IMProviderCredentialsResponse:
    if isinstance(credentials, (FeishuCredentials, LarkCredentials)):
        return FeishuLarkCredentialsResponse(
            provider=credentials.provider,
            app_id=credentials.app_id,
            app_secret=Redacted(),
            verification_token=Redacted() if credentials.verification_token is not None else None,
            encrypt_key=Redacted() if credentials.encrypt_key is not None else None,
        )
    if isinstance(credentials, SlackCredentials):
        return SlackCredentialsResponse(
            provider=credentials.provider,
            client_id=credentials.client_id,
            client_secret=Redacted(),
            signing_secret=Redacted(),
            bot_token=Redacted(),
            app_token=Redacted() if credentials.app_token is not None else None,
        )
    if isinstance(credentials, DingTalkCredentials):
        return DingTalkCredentialsResponse(
            provider=credentials.provider,
            corp_id=credentials.corp_id,
            client_id=credentials.client_id,
            client_secret=Redacted(),
        )
    if isinstance(credentials, MSTeamsCredentials):
        return MSTeamsCredentialsResponse(
            provider=credentials.provider,
            tenant_id=credentials.tenant_id,
            client_id=credentials.client_id,
            client_secret=Redacted(),
        )
    return WeComCredentialsResponse(
        provider=credentials.provider,
        corp_id=credentials.corp_id,
        agent_id=credentials.agent_id,
        secret=Redacted(),
    )
