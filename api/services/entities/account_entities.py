"""Framework-neutral contracts for Console account use cases."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


@dataclass(frozen=True, slots=True)
class AccountSnapshot:
    id: str
    name: str
    email: str
    avatar: str | None
    is_password_set: bool
    interface_language: str | None
    interface_theme: str | None
    timezone: str | None
    last_login_at: datetime | None
    last_login_ip: str | None
    status: str
    initialized_at: datetime | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class AccountProfileChanges:
    name: str | None = None
    avatar: str | None = None
    interface_language: str | None = None
    interface_theme: str | None = None
    timezone: str | None = None

    def has_changes(self) -> bool:
        return any(
            value is not None
            for value in (
                self.name,
                self.avatar,
                self.interface_language,
                self.interface_theme,
                self.timezone,
            )
        )


@dataclass(frozen=True, slots=True)
class AccountCredentials:
    password_hash: str | None
    password_salt: str | None


@dataclass(frozen=True, slots=True)
class AccountPasswordDigest:
    password_hash: str
    password_salt: str


@dataclass(frozen=True, slots=True)
class AccountIntegrationSnapshot:
    provider: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class AccountIntegrationStatus:
    provider: str
    created_at: datetime | None
    is_bound: bool


@dataclass(frozen=True, slots=True)
class AccountInitialization:
    interface_language: str
    interface_theme: str
    timezone: str
    initialized_at: datetime


class AccountInitializationStatus(StrEnum):
    INITIALIZED = "initialized"
    ACCOUNT_NOT_FOUND = "account_not_found"
    ALREADY_INITIALIZED = "already_initialized"
    INVALID_INVITATION = "invalid_invitation"


@dataclass(frozen=True, slots=True)
class AccountInitializationResult:
    status: AccountInitializationStatus
    account: AccountSnapshot | None = None


@dataclass(frozen=True, slots=True)
class AccountDeletionChallenge:
    token: str
    code: str


@dataclass(frozen=True, slots=True)
class ChangeEmailVerification:
    email: str
    token: str


class AccountEmailResetStatus(StrEnum):
    UPDATED = "updated"
    ACCOUNT_NOT_FOUND = "account_not_found"
    EMAIL_CHANGED = "email_changed"
    EMAIL_IN_USE = "email_in_use"


@dataclass(frozen=True, slots=True)
class AccountEmailResetResult:
    status: AccountEmailResetStatus
    account: AccountSnapshot | None = None


class AccountChangeEmailPhase(StrEnum):
    OLD_EMAIL = "old_email"
    OLD_EMAIL_VERIFIED = "old_email_verified"
    NEW_EMAIL = "new_email"
    NEW_EMAIL_VERIFIED = "new_email_verified"


@dataclass(frozen=True, slots=True)
class AccountChangeEmailToken:
    account_id: str
    email: str
    old_email: str
    code: str

    def is_bound_to_account(self, account_id: str) -> bool:
        return self.account_id == account_id


@dataclass(frozen=True, slots=True)
class AccountChangeEmailOldEmailToken(AccountChangeEmailToken):
    phase = AccountChangeEmailPhase.OLD_EMAIL

    def promote(self) -> AccountChangeEmailOldEmailVerifiedToken:
        return AccountChangeEmailOldEmailVerifiedToken(
            account_id=self.account_id,
            email=self.email,
            old_email=self.old_email,
            code=self.code,
        )


@dataclass(frozen=True, slots=True)
class AccountChangeEmailOldEmailVerifiedToken(AccountChangeEmailToken):
    phase = AccountChangeEmailPhase.OLD_EMAIL_VERIFIED


@dataclass(frozen=True, slots=True)
class AccountChangeEmailNewEmailToken(AccountChangeEmailToken):
    phase = AccountChangeEmailPhase.NEW_EMAIL

    def promote(self) -> AccountChangeEmailNewEmailVerifiedToken:
        return AccountChangeEmailNewEmailVerifiedToken(
            account_id=self.account_id,
            email=self.email,
            old_email=self.old_email,
            code=self.code,
        )


@dataclass(frozen=True, slots=True)
class AccountChangeEmailNewEmailVerifiedToken(AccountChangeEmailToken):
    phase = AccountChangeEmailPhase.NEW_EMAIL_VERIFIED


type AccountChangeEmailTokenData = (
    AccountChangeEmailOldEmailToken
    | AccountChangeEmailOldEmailVerifiedToken
    | AccountChangeEmailNewEmailToken
    | AccountChangeEmailNewEmailVerifiedToken
)


@dataclass(frozen=True, slots=True)
class AccountEducationVerification:
    token: str | None


@dataclass(frozen=True, slots=True)
class AccountEducationStatus:
    result: bool | None
    is_student: bool | None
    expire_at: datetime | None
    allow_refresh: bool | None


@dataclass(frozen=True, slots=True)
class AccountEducationAutocomplete:
    data: tuple[str, ...]
    curr_page: int | None
    has_next: bool | None
