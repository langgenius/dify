"""Account lifecycle data shared by application and persistence boundaries."""

from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

from services.entities.account_entities import AccountPasswordDigest


@dataclass(frozen=True, slots=True)
class AccountCreation:
    email: str
    name: str
    interface_language: str
    interface_theme: str
    timezone: str
    password: AccountPasswordDigest | None = None
    ip_address: str | None = None
    check_normalized_email: bool = False
    status: str = "active"
    initialized_at: datetime | None = None
    id: str = field(default_factory=lambda: str(uuid4()))


@dataclass(frozen=True, slots=True)
class SetupInput:
    email: str
    name: str
    password: str
    ip_address: str
    language: str | None


@dataclass(frozen=True, slots=True)
class SetupStatus:
    completed: bool
    setup_at: datetime | None = None
