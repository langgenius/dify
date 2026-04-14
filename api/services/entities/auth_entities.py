from enum import StrEnum, auto

from pydantic import BaseModel, Field, field_validator

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
