"""Shared contracts for authentication audit events."""

from enum import StrEnum, auto


class LoginFailureReason(StrEnum):
    """Bounded reason codes shared by Console and Web login audit logs."""

    ACCOUNT_BANNED = auto()
    ACCOUNT_IN_FREEZE = auto()
    ACCOUNT_NOT_FOUND = auto()
    EMAIL_CODE_EMAIL_MISMATCH = auto()
    INVALID_CREDENTIALS = auto()
    INVALID_EMAIL_CODE = auto()
    INVALID_EMAIL_CODE_TOKEN = auto()
    INVALID_INVITATION_EMAIL = auto()
    LOGIN_RATE_LIMITED = auto()
