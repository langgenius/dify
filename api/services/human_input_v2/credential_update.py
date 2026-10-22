"""Typed credential edits; persisted credentials always remain complete values."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Literal

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.credentials import (
    DingTalkCredentials,
    FeishuCredentials,
    IMProviderCredentials,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
    WeComCredentials,
)
from core.human_input_v2.shared import NormalizedEmail
from services.human_input_v2.errors import ReplacementRequiredError


class Unchanged(Enum):
    VALUE = "unchanged"


def updated_value[T](edit: T | Unchanged, current: T) -> T:
    return current if isinstance(edit, Unchanged) else edit


@dataclass(frozen=True, slots=True)
class FeishuCredentialsUpdate:
    app_id: str | Unchanged
    app_secret: str | Unchanged = field(repr=False)
    verification_token: str | None | Unchanged = field(repr=False)
    encrypt_key: str | None | Unchanged = field(repr=False)
    provider: Literal[IMProvider.FEISHU] = field(init=False, default=IMProvider.FEISHU)

    def apply(self, current: FeishuCredentials) -> FeishuCredentials:
        return FeishuCredentials(
            provider=self.provider,
            app_id=updated_value(self.app_id, current.app_id),
            app_secret=updated_value(self.app_secret, current.app_secret),
            verification_token=updated_value(self.verification_token, current.verification_token),
            encrypt_key=updated_value(self.encrypt_key, current.encrypt_key),
        )


@dataclass(frozen=True, slots=True)
class LarkCredentialsUpdate:
    app_id: str | Unchanged
    app_secret: str | Unchanged = field(repr=False)
    verification_token: str | None | Unchanged = field(repr=False)
    encrypt_key: str | None | Unchanged = field(repr=False)
    provider: Literal[IMProvider.LARK] = field(init=False, default=IMProvider.LARK)

    def apply(self, current: LarkCredentials) -> LarkCredentials:
        return LarkCredentials(
            provider=self.provider,
            app_id=updated_value(self.app_id, current.app_id),
            app_secret=updated_value(self.app_secret, current.app_secret),
            verification_token=updated_value(self.verification_token, current.verification_token),
            encrypt_key=updated_value(self.encrypt_key, current.encrypt_key),
        )


@dataclass(frozen=True, slots=True)
class SlackCredentialsUpdate:
    client_id: str | Unchanged
    client_secret: str | Unchanged = field(repr=False)
    signing_secret: str | Unchanged = field(repr=False)
    bot_token: str | Unchanged = field(repr=False)
    app_token: str | None | Unchanged = field(repr=False)
    provider: Literal[IMProvider.SLACK] = field(init=False, default=IMProvider.SLACK)

    def apply(self, current: SlackCredentials) -> SlackCredentials:
        return SlackCredentials(
            provider=self.provider,
            client_id=updated_value(self.client_id, current.client_id),
            client_secret=updated_value(self.client_secret, current.client_secret),
            signing_secret=updated_value(self.signing_secret, current.signing_secret),
            bot_token=updated_value(self.bot_token, current.bot_token),
            app_token=updated_value(self.app_token, current.app_token),
        )


@dataclass(frozen=True, slots=True)
class DingTalkCredentialsUpdate:
    corp_id: str | Unchanged
    client_id: str | Unchanged
    client_secret: str | Unchanged = field(repr=False)
    provider: Literal[IMProvider.DING_TALK] = field(init=False, default=IMProvider.DING_TALK)

    def apply(self, current: DingTalkCredentials) -> DingTalkCredentials:
        return DingTalkCredentials(
            provider=self.provider,
            corp_id=updated_value(self.corp_id, current.corp_id),
            client_id=updated_value(self.client_id, current.client_id),
            client_secret=updated_value(self.client_secret, current.client_secret),
        )


@dataclass(frozen=True, slots=True)
class MSTeamsCredentialsUpdate:
    tenant_id: str | Unchanged
    client_id: str | Unchanged
    client_secret: str | Unchanged = field(repr=False)
    provider: Literal[IMProvider.MS_TEAMS] = field(init=False, default=IMProvider.MS_TEAMS)

    def apply(self, current: MSTeamsCredentials) -> MSTeamsCredentials:
        return MSTeamsCredentials(
            provider=self.provider,
            tenant_id=updated_value(self.tenant_id, current.tenant_id),
            client_id=updated_value(self.client_id, current.client_id),
            client_secret=updated_value(self.client_secret, current.client_secret),
        )


@dataclass(frozen=True, slots=True)
class WeComCredentialsUpdate:
    corp_id: str | Unchanged
    agent_id: str | Unchanged
    secret: str | Unchanged = field(repr=False)
    provider: Literal[IMProvider.WE_COM] = field(init=False, default=IMProvider.WE_COM)

    def apply(self, current: WeComCredentials) -> WeComCredentials:
        return WeComCredentials(
            provider=self.provider,
            corp_id=updated_value(self.corp_id, current.corp_id),
            agent_id=updated_value(self.agent_id, current.agent_id),
            secret=updated_value(self.secret, current.secret),
        )


type IMCredentialsUpdate = (
    FeishuCredentialsUpdate
    | LarkCredentialsUpdate
    | SlackCredentialsUpdate
    | DingTalkCredentialsUpdate
    | MSTeamsCredentialsUpdate
    | WeComCredentialsUpdate
)


def merge_im_credentials(current: IMProviderCredentials, edit: IMCredentialsUpdate) -> IMProviderCredentials:
    match current, edit:
        case FeishuCredentials(), FeishuCredentialsUpdate():
            return edit.apply(current)
        case LarkCredentials(), LarkCredentialsUpdate():
            return edit.apply(current)
        case SlackCredentials(), SlackCredentialsUpdate():
            return edit.apply(current)
        case DingTalkCredentials(), DingTalkCredentialsUpdate():
            return edit.apply(current)
        case MSTeamsCredentials(), MSTeamsCredentialsUpdate():
            return edit.apply(current)
        case WeComCredentials(), WeComCredentialsUpdate():
            return edit.apply(current)
    raise ReplacementRequiredError("IM provider replacement is required")


@dataclass(frozen=True, slots=True)
class ResendCredentialsUpdate:
    sender_email: NormalizedEmail | Unchanged
    sender_name: str | Unchanged
    api_key: str | Unchanged = field(repr=False)
