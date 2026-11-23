"""Shared format for account-scoped avatar preview signatures."""

from uuid import UUID

ACCOUNT_AVATAR_NONCE_PREFIX = "account-avatar-v2:"


def account_avatar_owner(nonce: str) -> str:
    """Return the canonical account ID carried by an avatar nonce or raise ValueError."""
    return str(UUID(nonce.removeprefix(ACCOUNT_AVATAR_NONCE_PREFIX)))
