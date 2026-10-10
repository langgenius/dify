from __future__ import annotations

from dataclasses import dataclass

from models import Account, EndUser


@dataclass(frozen=True, slots=True)
class UserSnapshot:
    """Immutable user data that is safe to pass beyond a request Session."""

    id: str
    is_account: bool
    name: str = ""
    email: str = ""
    session_id: str = ""

    @classmethod
    def from_user(cls, user: Account | EndUser) -> UserSnapshot:
        if isinstance(user, Account):
            return cls(
                id=user.id,
                is_account=True,
                name=user.name,
                email=user.email,
            )

        return cls(
            id=user.id,
            is_account=False,
            session_id=user.session_id,
        )
