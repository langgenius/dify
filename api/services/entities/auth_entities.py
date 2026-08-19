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


class ChangeEmailPhase(StrEnum):
    """Change-email token state machine.

    Allowed transitions:

    `OLD_EMAIL -> OLD_EMAIL_VERIFIED -> NEW_EMAIL -> NEW_EMAIL_VERIFIED`

    The flow starts by sending a code to the current email address. Only a
    token in `OLD_EMAIL_VERIFIED` may request the new-email code, and only a
    token in `NEW_EMAIL_VERIFIED` may perform the final email reset.
    """

    OLD_EMAIL = "old_email"
    OLD_EMAIL_VERIFIED = "old_email_verified"
    NEW_EMAIL = "new_email"
    NEW_EMAIL_VERIFIED = "new_email_verified"


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

    The full progression is:

    `old_email -> old_email_verified -> new_email -> new_email_verified`

    Every state is bound to the initiating `account_id` so the change-email
    flow cannot be replayed across accounts.
    """

    token_type: Literal["change_email"] = "change_email"
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
    """States whose `email` must still be the account's current address."""

    @model_validator(mode="after")
    def validate_old_address_binding(self) -> "_ChangeEmailOldAddressMixin":
        if self.email.lower() != self.old_email.lower():
            raise ValueError("old-email token payload must bind email to old_email")
        return self


class ChangeEmailOldEmailToken(_ChangeEmailOldAddressMixin):
    """Phase-1 token minted when sending a code to the old email address.

    This token proves only that the flow started for the current account. It
    must not unlock the new-email send step or the final reset step until the
    old-email verification code has been checked.
    """

    email_change_phase: Literal[ChangeEmailPhase.OLD_EMAIL] = ChangeEmailPhase.OLD_EMAIL

    def promote(self) -> "ChangeEmailOldEmailVerifiedToken":
        """Advance to the state that is allowed to request the new-email code."""
        return ChangeEmailOldEmailVerifiedToken(
            **self.model_dump(exclude={"email_change_phase"}),
            email_change_phase=ChangeEmailPhase.OLD_EMAIL_VERIFIED,
        )


class ChangeEmailOldEmailVerifiedToken(_ChangeEmailOldAddressMixin):
    """Token returned after the old email verification code succeeds.

    The token used to request a new-email code must come from this state. This
    blocks the GHSA-4q3w-q5mc-45rq bypass where a phase-1 token was replayed to
    skip the old-email verification step.
    """

    email_change_phase: Literal[ChangeEmailPhase.OLD_EMAIL_VERIFIED] = ChangeEmailPhase.OLD_EMAIL_VERIFIED


class ChangeEmailNewEmailToken(ChangeEmailTokenBase):
    """Token minted when sending a code to the target new email address.

    At this point the account binding is already fixed, but the new address has
    not been verified yet, so the token may only be promoted by a successful
    new-email verification code check.
    """

    email_change_phase: Literal[ChangeEmailPhase.NEW_EMAIL] = ChangeEmailPhase.NEW_EMAIL

    def promote(self) -> "ChangeEmailNewEmailVerifiedToken":
        """Advance to the only state that may perform the final email reset."""
        return ChangeEmailNewEmailVerifiedToken(
            **self.model_dump(exclude={"email_change_phase"}),
            email_change_phase=ChangeEmailPhase.NEW_EMAIL_VERIFIED,
        )


class ChangeEmailNewEmailVerifiedToken(ChangeEmailTokenBase):
    """Final verified token for the change-email flow.

    Only this state may change the account email, and the reset endpoint must
    additionally require that the request's `new_email` matches this token's
    `email` so a verified token for address A cannot be replayed for address B.
    """

    email_change_phase: Literal[ChangeEmailPhase.NEW_EMAIL_VERIFIED] = ChangeEmailPhase.NEW_EMAIL_VERIFIED


# Tokens that can still advance by verifying a code.
ChangeEmailPendingTokenData = Annotated[
    ChangeEmailOldEmailToken | ChangeEmailNewEmailToken,
    Field(discriminator="email_change_phase"),
]

# Tokens that already completed a verification step.
ChangeEmailVerifiedTokenData = Annotated[
    ChangeEmailOldEmailVerifiedToken | ChangeEmailNewEmailVerifiedToken,
    Field(discriminator="email_change_phase"),
]

# Complete change-email token state machine.
ChangeEmailTokenData = Annotated[
    ChangeEmailOldEmailToken
    | ChangeEmailOldEmailVerifiedToken
    | ChangeEmailNewEmailToken
    | ChangeEmailNewEmailVerifiedToken,
    Field(discriminator="email_change_phase"),
]
