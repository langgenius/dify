from __future__ import annotations

from datetime import datetime

from flask_restx import fields
from pydantic import computed_field, field_validator

from fields.base import ResponseModel
from libs.helper import build_avatar_url, to_timestamp

simple_account_fields = {
    "id": fields.String,
    "name": fields.String,
    "email": fields.String,
}


class SimpleAccount(ResponseModel):
    id: str
    name: str
    email: str


class _AccountAvatar(ResponseModel):
    avatar: str | None = None

    @computed_field(return_type=str | None)  # type: ignore[prop-decorator]
    @property
    def avatar_url(self) -> str | None:
        return build_avatar_url(self.avatar)


class Account(_AccountAvatar):
    id: str
    name: str
    email: str
    is_password_set: bool
    interface_language: str | None = None
    interface_theme: str | None = None
    timezone: str | None = None
    last_login_at: int | None = None
    last_login_ip: str | None = None
    created_at: int | None = None

    @field_validator("last_login_at", "created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AccountWithRole(_AccountAvatar):
    id: str
    name: str
    email: str
    last_login_at: int | None = None
    last_active_at: int | None = None
    created_at: int | None = None
    role: str
    status: str

    @field_validator("last_login_at", "last_active_at", "created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AccountWithRoleList(ResponseModel):
    accounts: list[AccountWithRole]
