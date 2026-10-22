"""Console credential edit DTOs; omission is never a retention instruction."""

from typing import Annotated, Literal

from pydantic import Field, SecretStr, ValidationInfo, field_validator

from core.human_input_v2.entities import EmailProviderType, IMProvider
from core.human_input_v2.shared import NormalizedEmail
from libs.helper import EmailStr
from services.human_input_v2.credential_update import (
    DingTalkCredentialsUpdate,
    FeishuCredentialsUpdate,
    LarkCredentialsUpdate,
    MSTeamsCredentialsUpdate,
    ResendCredentialsUpdate,
    SlackCredentialsUpdate,
    Unchanged,
    WeComCredentialsUpdate,
)

from ._common import StrictModel
from .providers import (
    _SLACK_APP_TOKEN_PREFIX,
    _SLACK_BOT_TOKEN_PREFIX,
    _OptionalSecret,
    _RequiredSecret,
    _SecretValidationMixin,
)

type _Identifier = Annotated[str, Field(min_length=1, pattern=r"\S")]
type _UUIDString = Annotated[
    str, Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
]


class UnchangedInput(StrictModel):
    """Retain the addressed saved field; valid only for updates and saved tests."""

    type: Literal["unchanged"]


def _updated_value[T](edit: T | UnchangedInput) -> T | Unchanged:
    return Unchanged.VALUE if isinstance(edit, UnchangedInput) else edit


def _secret_update(edit: SecretStr | UnchangedInput) -> str | Unchanged:
    return Unchanged.VALUE if isinstance(edit, UnchangedInput) else edit.get_secret_value()


def _optional_secret_update(edit: SecretStr | None | UnchangedInput) -> str | None | Unchanged:
    return None if edit is None else _secret_update(edit)


class FeishuCredentialsUpdateInput(_SecretValidationMixin, StrictModel):
    provider: Literal[IMProvider.FEISHU]
    app_id: _Identifier | UnchangedInput
    app_secret: _RequiredSecret | UnchangedInput
    verification_token: _OptionalSecret | UnchangedInput
    encrypt_key: _OptionalSecret | UnchangedInput

    def to_owner_update(self) -> FeishuCredentialsUpdate:
        return FeishuCredentialsUpdate(
            app_id=_updated_value(self.app_id),
            app_secret=_secret_update(self.app_secret),
            verification_token=_optional_secret_update(self.verification_token),
            encrypt_key=_optional_secret_update(self.encrypt_key),
        )


class LarkCredentialsUpdateInput(_SecretValidationMixin, StrictModel):
    provider: Literal[IMProvider.LARK]
    app_id: _Identifier | UnchangedInput
    app_secret: _RequiredSecret | UnchangedInput
    verification_token: _OptionalSecret | UnchangedInput
    encrypt_key: _OptionalSecret | UnchangedInput

    def to_owner_update(self) -> LarkCredentialsUpdate:
        return LarkCredentialsUpdate(
            app_id=_updated_value(self.app_id),
            app_secret=_secret_update(self.app_secret),
            verification_token=_optional_secret_update(self.verification_token),
            encrypt_key=_optional_secret_update(self.encrypt_key),
        )


class SlackCredentialsUpdateInput(_SecretValidationMixin, StrictModel):
    provider: Literal[IMProvider.SLACK]
    client_id: _Identifier | UnchangedInput
    client_secret: _RequiredSecret | UnchangedInput
    signing_secret: _RequiredSecret | UnchangedInput
    bot_token: _RequiredSecret | UnchangedInput
    app_token: _OptionalSecret | UnchangedInput

    @field_validator("bot_token", "app_token")
    @classmethod
    def require_token_prefix(
        cls, token: SecretStr | None | UnchangedInput, info: ValidationInfo
    ) -> SecretStr | None | UnchangedInput:
        if isinstance(token, SecretStr):
            prefix = _SLACK_BOT_TOKEN_PREFIX if info.field_name == "bot_token" else _SLACK_APP_TOKEN_PREFIX
            if not token.get_secret_value().startswith(prefix):
                raise ValueError(f"Slack token must start with {prefix}")
        return token

    def to_owner_update(self) -> SlackCredentialsUpdate:
        return SlackCredentialsUpdate(
            client_id=_updated_value(self.client_id),
            client_secret=_secret_update(self.client_secret),
            signing_secret=_secret_update(self.signing_secret),
            bot_token=_secret_update(self.bot_token),
            app_token=_optional_secret_update(self.app_token),
        )


class DingTalkCredentialsUpdateInput(_SecretValidationMixin, StrictModel):
    provider: Literal[IMProvider.DING_TALK]
    corp_id: _Identifier | UnchangedInput
    client_id: _Identifier | UnchangedInput
    client_secret: _RequiredSecret | UnchangedInput

    def to_owner_update(self) -> DingTalkCredentialsUpdate:
        return DingTalkCredentialsUpdate(
            corp_id=_updated_value(self.corp_id),
            client_id=_updated_value(self.client_id),
            client_secret=_secret_update(self.client_secret),
        )


class MSTeamsCredentialsUpdateInput(_SecretValidationMixin, StrictModel):
    provider: Literal[IMProvider.MS_TEAMS]
    tenant_id: _UUIDString | UnchangedInput
    client_id: _UUIDString | UnchangedInput
    client_secret: _RequiredSecret | UnchangedInput

    def to_owner_update(self) -> MSTeamsCredentialsUpdate:
        return MSTeamsCredentialsUpdate(
            tenant_id=_updated_value(self.tenant_id),
            client_id=_updated_value(self.client_id),
            client_secret=_secret_update(self.client_secret),
        )


class WeComCredentialsUpdateInput(_SecretValidationMixin, StrictModel):
    provider: Literal[IMProvider.WE_COM]
    corp_id: _Identifier | UnchangedInput
    agent_id: str | UnchangedInput
    secret: _RequiredSecret | UnchangedInput

    def to_owner_update(self) -> WeComCredentialsUpdate:
        return WeComCredentialsUpdate(
            corp_id=_updated_value(self.corp_id),
            agent_id=_updated_value(self.agent_id),
            secret=_secret_update(self.secret),
        )


type IMProviderCredentialsUpdateInput = Annotated[
    FeishuCredentialsUpdateInput
    | LarkCredentialsUpdateInput
    | SlackCredentialsUpdateInput
    | DingTalkCredentialsUpdateInput
    | MSTeamsCredentialsUpdateInput
    | WeComCredentialsUpdateInput,
    Field(discriminator="provider"),
]


class ResendCredentialsUpdateInput(_SecretValidationMixin, StrictModel):
    provider: Literal[EmailProviderType.RESEND]
    sender_email: EmailStr | UnchangedInput
    sender_name: Annotated[str, Field(min_length=1, max_length=255)] | UnchangedInput
    api_key: _RequiredSecret | UnchangedInput

    def to_owner_update(self) -> ResendCredentialsUpdate:
        return ResendCredentialsUpdate(
            sender_email=(
                Unchanged.VALUE if isinstance(self.sender_email, UnchangedInput) else NormalizedEmail(self.sender_email)
            ),
            sender_name=_updated_value(self.sender_name),
            api_key=_secret_update(self.api_key),
        )


type EmailProviderCredentialsUpdateInput = Annotated[ResendCredentialsUpdateInput, Field(discriminator="provider")]
