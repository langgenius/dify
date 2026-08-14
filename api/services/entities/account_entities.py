"""Account data shared by Console application services."""

from datetime import datetime
from typing import NamedTuple


class AccountProfile(NamedTuple):
    id: str
    interface_language: str | None
    initialized_at: datetime | None
    created_at: datetime
