from enum import StrEnum, auto
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from libs.helper import EmailStr
from libs.password import valid_password


class LoginFailureReason(StrEnum):
    """Bounded reason codes for failed login audit logs."""

    ACCOUNT_BANNED = auto()
    ACCOUNT_IN_FREEZE = auto()
    ACCOUNT_NOT_FOUND = auto()
    EMAIL_CODE_EMAIL_MISMATCH = auto()
    INVALID_CREDENTIALS = auto()
    INVALID_EMAIL_CODE = auto()
    INVALID_EMAIL_CODE_TOKEN = auto()
    INVALID_INVITATION_EMAIL = auto()
    LOGIN_RATE_LIMITED = auto()


class LoginPayloadBase(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordSendPayload(BaseModel):
    email: EmailStr
    language: str | None = None


class ForgotPasswordCheckPayload(BaseModel):
    email: EmailStr
    code: str
    token: str = Field(min_length=1)


class ForgotPasswordResetPayload(BaseModel):
    token: str = Field(min_length=1)
    new_password: str
    password_confirm: str

    @field_validator("new_password", "password_confirm")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return valid_password(value)


class ChangeEmailTokenBase(BaseModel):
    """Stored change-email token payload.

    The discriminator lives in `email_change_phase`; callers use the concrete
    model type to decide which transitions are legal.
    """

    token_type: Literal["change_email"]
    account_id: str = Field(min_length=1)
    email: EmailStr
    old_email: EmailStr
    code: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")

    def to_token_manager_payload(self) -> dict[str, str]:
        return self.model_dump(exclude={"token_type", "account_id", "email"})

    def is_bound_to_account(self, account_id: str) -> bool:
        return self.account_id == account_id


class _ChangeEmailOldAddressMixin(ChangeEmailTokenBase):
    @model_validator(mode="after")
    def validate_old_address_binding(self) -> "_ChangeEmailOldAddressMixin":
        if self.email.lower() != self.old_email.lower():
            raise ValueError("old-email token payload must bind email to old_email")
        return self


class ChangeEmailOldEmailToken(_ChangeEmailOldAddressMixin):
    email_change_phase: Literal["old_email"] = "old_email"

    def promote(self) -> "ChangeEmailOldEmailVerifiedToken":
        return ChangeEmailOldEmailVerifiedToken(
            **self.model_dump(exclude={"email_change_phase"}),
            email_change_phase="old_email_verified",
        )


class ChangeEmailOldEmailVerifiedToken(_ChangeEmailOldAddressMixin):
    email_change_phase: Literal["old_email_verified"] = "old_email_verified"


class ChangeEmailNewEmailToken(ChangeEmailTokenBase):
    email_change_phase: Literal["new_email"] = "new_email"

    def promote(self) -> "ChangeEmailNewEmailVerifiedToken":
        return ChangeEmailNewEmailVerifiedToken(
            **self.model_dump(exclude={"email_change_phase"}),
            email_change_phase="new_email_verified",
        )


class ChangeEmailNewEmailVerifiedToken(ChangeEmailTokenBase):
    email_change_phase: Literal["new_email_verified"] = "new_email_verified"


ChangeEmailPendingTokenData = Annotated[
    ChangeEmailOldEmailToken | ChangeEmailNewEmailToken,
    Field(discriminator="email_change_phase"),
]

ChangeEmailVerifiedTokenData = Annotated[
    ChangeEmailOldEmailVerifiedToken | ChangeEmailNewEmailVerifiedToken,
    Field(discriminator="email_change_phase"),
]

ChangeEmailTokenData = Annotated[
    ChangeEmailOldEmailToken
    | ChangeEmailOldEmailVerifiedToken
    | ChangeEmailNewEmailToken
    | ChangeEmailNewEmailVerifiedToken,
    Field(discriminator="email_change_phase"),
]
