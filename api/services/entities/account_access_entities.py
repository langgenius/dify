"""Framework-neutral data contracts for account identity and access sessions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from services.entities.account_entities import AccountSnapshot


@dataclass(frozen=True, slots=True)
class AccountWorkspaceSnapshot:
    id: str
    name: str
    role: str
    current: bool


@dataclass(frozen=True, slots=True)
class AccountAccessSnapshot:
    account: AccountSnapshot
    workspaces: tuple[AccountWorkspaceSnapshot, ...]
    default_workspace_id: str | None


@dataclass(frozen=True, slots=True)
class AccountSessionSnapshot:
    id: str
    prefix: str
    client_id: str
    device_label: str
    created_at: datetime | None
    last_used_at: datetime | None
    expires_at: datetime | None


@dataclass(frozen=True, slots=True)
class AccountSessionPage:
    page: int
    limit: int
    total: int
    items: tuple[AccountSessionSnapshot, ...]

    @property
    def has_more(self) -> bool:
        return self.page * self.limit < self.total


@dataclass(frozen=True, slots=True)
class AccountSessionRevocation:
    owned: bool
    token_hash: str | None = None
