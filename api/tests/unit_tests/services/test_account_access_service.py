from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest

from machinery.context import AccountRequestContext
from services.account_access_service import AccountAccessService
from services.account_errors import AccountNotFoundError, AccountSessionNotFoundError
from services.entities.account_access_entities import (
    AccountSessionRevocation,
    AccountSessionSnapshot,
    AccountWorkspaceSnapshot,
)
from services.entities.account_entities import AccountSnapshot

NOW = datetime(2026, 8, 25, 12, tzinfo=UTC)


def _context(*, token_id: str | None = "token-1") -> AccountRequestContext:
    return AccountRequestContext("request-1", "trace-1", "account-1", token_id)


def _account() -> AccountSnapshot:
    return AccountSnapshot(
        id="account-1",
        name="Ada",
        email="ada@example.com",
        avatar=None,
        is_password_set=False,
        interface_language=None,
        interface_theme=None,
        timezone=None,
        last_login_at=None,
        last_login_ip=None,
        status="active",
        initialized_at=None,
        created_at=NOW,
    )


@dataclass
class _Accounts:
    account: AccountSnapshot | None = field(default_factory=_account)

    def get(self, account_id: str) -> AccountSnapshot | None:
        assert account_id == "account-1"
        return self.account


@dataclass
class _Workspaces:
    items: tuple[AccountWorkspaceSnapshot, ...] = ()

    def list_account_access_workspaces(self, account_id: str) -> tuple[AccountWorkspaceSnapshot, ...]:
        assert account_id == "account-1"
        return self.items


@dataclass
class _Sessions:
    items: tuple[AccountSessionSnapshot, ...] = ()
    total: int = 0
    revocation: AccountSessionRevocation = AccountSessionRevocation(owned=True)
    list_call: tuple[str, datetime, int, int] | None = None
    revoke_call: tuple[str, str, datetime] | None = None

    def list_active(
        self,
        *,
        account_id: str,
        active_at: datetime,
        offset: int,
        limit: int,
    ) -> tuple[int, tuple[AccountSessionSnapshot, ...]]:
        self.list_call = (account_id, active_at, offset, limit)
        return self.total, self.items

    def revoke(self, *, account_id: str, token_id: str, revoked_at: datetime) -> AccountSessionRevocation:
        self.revoke_call = (account_id, token_id, revoked_at)
        return self.revocation


@dataclass
class _TokenCache:
    invalidated: list[str] = field(default_factory=list)

    def __call__(self, token_hash: str) -> None:
        self.invalidated.append(token_hash)


def _service(
    *,
    accounts: _Accounts | None = None,
    workspaces: _Workspaces | None = None,
    sessions: _Sessions | None = None,
    token_cache: _TokenCache | None = None,
) -> AccountAccessService:
    return AccountAccessService(
        accounts=accounts or _Accounts(),
        workspaces=workspaces or _Workspaces(),
        sessions=sessions or _Sessions(),
        invalidate_token_cache=token_cache or _TokenCache(),
        now=lambda: NOW,
    )


def test_get_prefers_current_workspace_as_default() -> None:
    workspaces = _Workspaces(
        items=(
            AccountWorkspaceSnapshot("workspace-1", "First", "normal", False),
            AccountWorkspaceSnapshot("workspace-2", "Current", "owner", True),
        )
    )

    snapshot = _service(workspaces=workspaces).get(_context())

    assert snapshot.account.email == "ada@example.com"
    assert snapshot.workspaces == workspaces.items
    assert snapshot.default_workspace_id == "workspace-2"


def test_get_falls_back_to_first_workspace() -> None:
    workspaces = _Workspaces(
        items=(
            AccountWorkspaceSnapshot("workspace-1", "First", "normal", False),
            AccountWorkspaceSnapshot("workspace-2", "Second", "owner", False),
        )
    )

    assert _service(workspaces=workspaces).get(_context()).default_workspace_id == "workspace-1"


def test_get_raises_when_admitted_account_disappeared() -> None:
    with pytest.raises(AccountNotFoundError):
        _service(accounts=_Accounts(account=None)).get(_context())


def test_list_sessions_delegates_database_pagination() -> None:
    sessions = _Sessions(total=12)

    page = _service(sessions=sessions).list_sessions(_context(), page=3, limit=5)

    assert sessions.list_call == ("account-1", NOW, 10, 5)
    assert page.page == 3
    assert page.total == 12
    assert page.has_more is False


def test_revoke_current_session_invalidates_live_token_cache() -> None:
    sessions = _Sessions(revocation=AccountSessionRevocation(owned=True, token_hash="hash-1"))
    cache = _TokenCache()

    _service(sessions=sessions, token_cache=cache).revoke_current_session(_context())

    assert sessions.revoke_call == ("account-1", "token-1", NOW)
    assert cache.invalidated == ["hash-1"]


def test_revoke_foreign_session_does_not_invalidate_cache() -> None:
    sessions = _Sessions(revocation=AccountSessionRevocation(owned=False))
    cache = _TokenCache()

    with pytest.raises(AccountSessionNotFoundError):
        _service(sessions=sessions, token_cache=cache).revoke_session(_context(), token_id="foreign")

    assert cache.invalidated == []


def test_revoke_current_requires_admitted_token_id() -> None:
    with pytest.raises(RuntimeError, match="did not resolve an access token"):
        _service().revoke_current_session(_context(token_id=None))
