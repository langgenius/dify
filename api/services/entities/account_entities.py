"""Framework-neutral contracts shared by account use cases."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Literal


@dataclass(frozen=True, slots=True)
class AccountSnapshot:
    """Account data with independent profile and Builder lifecycle timestamps.

    A missing first workspace time means no owned creation or legacy Builder
    baseline is recorded. Invitation initialization remains a separate lifecycle.
    """

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
    first_workspace_created_at: datetime | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class AccountProfile(AccountSnapshot):
    """Profile membership flags describe existing tenants, including archived ones.

    Ownership implies membership. These flags do not grant workspace access and
    do not replace the durable first workspace creation time.
    """

    has_owned_tenant: bool
    has_tenant: bool

    @classmethod
    def from_account(cls, account: AccountSnapshot, *, has_owned_tenant: bool, has_tenant: bool) -> AccountProfile:
        """Extend an Account snapshot with membership facts from the same read."""
        return cls(
            id=account.id,
            name=account.name,
            email=account.email,
            avatar=account.avatar,
            is_password_set=account.is_password_set,
            interface_language=account.interface_language,
            interface_theme=account.interface_theme,
            timezone=account.timezone,
            last_login_at=account.last_login_at,
            last_login_ip=account.last_login_ip,
            status=account.status,
            initialized_at=account.initialized_at,
            created_at=account.created_at,
            first_workspace_created_at=account.first_workspace_created_at,
            has_owned_tenant=has_owned_tenant,
            has_tenant=has_tenant,
        )


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
class AccountAuthenticationSnapshot:
    id: str
    email: str
    status: str
    password_hash: str | None
    password_salt: str | None


@dataclass(frozen=True, slots=True)
class AccountPasswordDigest:
    password_hash: str
    password_salt: str


@dataclass(frozen=True, slots=True)
class ForgotPasswordVerificationToken:
    email: str
    code: str
    account_id: str | None = None

    def promote(self) -> ForgotPasswordResetToken:
        return ForgotPasswordResetToken(email=self.email, code=self.code, account_id=self.account_id)


@dataclass(frozen=True, slots=True)
class ForgotPasswordResetToken:
    email: str
    code: str
    account_id: str | None = None


type ForgotPasswordToken = ForgotPasswordVerificationToken | ForgotPasswordResetToken


@dataclass(frozen=True, slots=True)
class ForgotPasswordVerification:
    email: str
    token: str


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


class AccountEmailRegistrationPhase(StrEnum):
    REGISTER = "register"


@dataclass(frozen=True, slots=True)
class AccountEmailRegistrationToken:
    email: str
    code: str
    phase: AccountEmailRegistrationPhase | None = None


@dataclass(frozen=True, slots=True)
class AccountEmailRegistrationVerification:
    email: str
    token: str


@dataclass(frozen=True, slots=True)
class AccountSessionTokens:
    access_token: str
    refresh_token: str
    csrf_token: str


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
class AccountEducationEligible:
    token: str
    status: Literal["eligible"] = "eligible"


@dataclass(frozen=True, slots=True)
class AccountEducationNotEligible:
    status: Literal["not_eligible"] = "not_eligible"


type AccountEducationVerification = AccountEducationEligible | AccountEducationNotEligible


@dataclass(frozen=True, slots=True)
class AccountEducationActivation:
    message: str


@dataclass(frozen=True, slots=True)
class AccountEducationStatus:
    result: bool
    is_student: bool
    expire_at: datetime
    allow_refresh: bool


@dataclass(frozen=True, slots=True)
class AccountEducationAutocomplete:
    data: tuple[str, ...]
    curr_page: int
    has_next: bool
