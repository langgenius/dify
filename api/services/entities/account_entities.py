"""Framework-neutral contracts for Console account use cases."""

from dataclasses import dataclass
from datetime import datetime


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
