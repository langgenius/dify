"""Framework-neutral values shared by Console authentication use cases."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from services.entities.account_entities import AccountPasswordDigest


class EmailCodeChallengeStatus(StrEnum):
    VERIFIED = "verified"
    INVALID_TOKEN = "invalid_token"
    EMAIL_MISMATCH = "email_mismatch"
    INVALID_CODE = "invalid_code"
    EXHAUSTED = "exhausted"


class RefreshAccountStatus(StrEnum):
    READY = "ready"
    NOT_FOUND = "not_found"
    BANNED = "banned"


@dataclass(frozen=True, slots=True)
class LoginAccountSnapshot:
    id: str
    email: str
    status: str
    password_hash: str | None
    password_salt: str | None


@dataclass(frozen=True, slots=True)
class LoginInvitation:
    email: str


@dataclass(frozen=True, slots=True)
class PasswordLoginCompletion:
    account_id: str
    password: AccountPasswordDigest | None
    activate_pending_account: bool
    initialized_at: datetime | None

    def __post_init__(self) -> None:
        if self.activate_pending_account != (self.initialized_at is not None):
            raise ValueError("pending-account activation requires an initialization timestamp")


@dataclass(frozen=True, slots=True)
class AccountSessionPreparation:
    logged_in_at: datetime
    ip_address: str
    activate_pending_account: bool


@dataclass(frozen=True, slots=True)
class AuthTokenPair:
    access_token: str
    refresh_token: str
    csrf_token: str


@dataclass(frozen=True, slots=True)
class PasswordLoginCommand:
    email: str
    password: str
    invite_token: str | None
    ip_address: str


@dataclass(frozen=True, slots=True)
class EmailCodeSendCommand:
    email: str
    language: str | None
    turnstile_token: str | None
    ip_address: str


@dataclass(frozen=True, slots=True)
class EmailCodeLoginCommand:
    email: str
    code: str
    token: str
    turnstile_token: str | None
    language: str | None
    timezone: str | None
    ip_address: str


@dataclass(frozen=True, slots=True)
class PasswordLoginResult:
    token_pair: AuthTokenPair | None
    workspace_found: bool
