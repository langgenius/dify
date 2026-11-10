"""Shared transport validation for Account settings."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.json_schema import SkipJsonSchema

from constants.languages import supported_language
from libs.helper import EmailStr, timezone
from services.entities.account_entities import AccountProfileChanges


class ChangeEmailSendPayload(BaseModel):
    email: EmailStr
    language: str | None = None
    phase: str | None = None
    token: str | None = None


class ChangeEmailValidityPayload(BaseModel):
    email: EmailStr
    code: str
    token: str


class ChangeEmailResetPayload(BaseModel):
    new_email: EmailStr
    token: str


class CheckEmailUniquePayload(BaseModel):
    email: EmailStr


class AccountProfilePatchPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=3, max_length=30)] | SkipJsonSchema[None] = None
    avatar: str | SkipJsonSchema[None] = None
    interface_language: str | SkipJsonSchema[None] = None
    interface_theme: Literal["light", "dark"] | SkipJsonSchema[None] = None
    timezone: str | SkipJsonSchema[None] = None

    @field_validator("*", mode="before")
    @classmethod
    def reject_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Account profile fields cannot be null")
        return value

    @field_validator("interface_language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        return supported_language(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return timezone(value)

    def to_changes(self) -> AccountProfileChanges:
        """Map validated optional fields to a partial update; omitted fields stay unchanged."""
        return AccountProfileChanges(
            name=self.name,
            avatar=self.avatar,
            interface_language=self.interface_language,
            interface_theme=self.interface_theme,
            timezone=self.timezone,
        )
