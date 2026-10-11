"""Framework-neutral contracts for the Console OAuth authorization server."""

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum


class OAuthGrantType(StrEnum):
    AUTHORIZATION_CODE = "authorization_code"
    REFRESH_TOKEN = "refresh_token"


class OAuthProviderAccountStatus(StrEnum):
    PENDING = "pending"
    UNINITIALIZED = "uninitialized"
    ACTIVE = "active"
    BANNED = "banned"
    CLOSED = "closed"


@dataclass(frozen=True, slots=True)
class OAuthProviderAppRecord:
    app_icon: str
    client_id: str
    client_secret: str
    app_label: Mapping[str, object]
    redirect_uris: tuple[str, ...]
    scope: str
    auto_authorize: bool


@dataclass(frozen=True, slots=True)
class OAuthProviderAppPresentation:
    app_icon: str
    app_label: Mapping[str, object]
    scope: str
    auto_authorize: bool


@dataclass(frozen=True, slots=True)
class OAuthAuthorizationCode:
    code: str


@dataclass(frozen=True, slots=True)
class OAuthTokenSet:
    access_token: str
    token_type: str
    expires_in: int
    refresh_token: str


@dataclass(frozen=True, slots=True)
class OAuthProviderAccount:
    id: str
    name: str
    email: str
    avatar: str | None
    interface_language: str | None
    timezone: str | None


@dataclass(frozen=True, slots=True)
class OAuthProviderAccountRecord:
    id: str
    name: str
    email: str
    avatar: str | None
    interface_language: str | None
    timezone: str | None
    status: OAuthProviderAccountStatus
