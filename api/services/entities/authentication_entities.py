"""Framework-neutral contracts shared by authentication use cases."""

from dataclasses import dataclass
from enum import StrEnum, auto


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


@dataclass(frozen=True, slots=True)
class StoredAuthenticationToken:
    email: str | None
    code: str | None
    phase: str | None = None


@dataclass(frozen=True, slots=True)
class WebAppSessionRecord:
    end_user_session_id: str


@dataclass(frozen=True, slots=True)
class WebLoginStatus:
    logged_in: bool
    app_logged_in: bool
