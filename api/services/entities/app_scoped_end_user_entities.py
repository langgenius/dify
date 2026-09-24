"""Framework-neutral contracts for app-scoped end-user use cases."""

from dataclasses import dataclass
from datetime import datetime
from typing import NamedTuple


class AppScopedEndUserRecord(NamedTuple):
    id: str
    tenant_id: str
    app_id: str
    type: str
    external_user_id: str | None
    name: str | None
    is_anonymous: bool
    session_id: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class StoredAppScopedEndUser[T]:
    """Persistence metadata paired with an opaque caller-facing entity."""

    id: str
    app_id: str
    type: str
    value: T


@dataclass(frozen=True, slots=True)
class NewAppScopedEndUser:
    tenant_id: str
    app_id: str
    type: str
    is_anonymous: bool
    session_id: str
    external_user_id: str
