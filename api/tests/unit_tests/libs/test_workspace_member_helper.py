"""SQLite-backed unit tests for workspace membership enforcement."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from unittest.mock import Mock

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from libs import oauth_bearer
from libs.oauth_bearer import AuthContext, Scope, SubjectType, TokenType, require_workspace_member
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import TypeBase


@dataclass(frozen=True)
class Database:
    """Real ORM binding and executed-statement log for one isolated test."""

    engine: Engine
    session: Session
    statements: list[str]


@pytest.fixture
def database(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Database]:
    TypeBase.metadata.create_all(
        sqlite_engine,
        tables=[Account.__table__, Tenant.__table__, TenantAccountJoin.__table__],
    )
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        binding = Database(engine=sqlite_engine, session=session, statements=statements)
        monkeypatch.setattr(oauth_bearer, "db", binding)
        yield binding
    event.remove(sqlite_engine, "before_cursor_execute", record_statement)


@pytest.fixture
def community_edition(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(oauth_bearer.dify_config, "ENTERPRISE_ENABLED", False)


def _ctx(
    verified: dict[str, bool] | None = None,
    *,
    account_id: uuid.UUID | None = None,
    account: bool = True,
) -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.ACCOUNT if account else SubjectType.EXTERNAL_SSO,
        subject_email="e@example.com",
        subject_issuer=None,
        account_id=account_id or (uuid.uuid4() if account else None),
        client_id="difyctl",
        scopes=frozenset({Scope.FULL}),
        token_id=uuid.uuid4(),
        token_type=TokenType.OAUTH_ACCOUNT if account else TokenType.OAUTH_EXTERNAL_SSO,
        expires_at=None,
        token_hash="h1",
        verified_tenants=dict(verified or {}),
    )


def _persist_membership(
    session: Session,
    *,
    account_id: uuid.UUID,
    tenant_id: str,
    status: AccountStatus = AccountStatus.ACTIVE,
) -> None:
    account = Account(name="Workspace member", email=f"{account_id}@example.com", status=status)
    # SQLite's StringUUID adapter binds UUID objects as compact hex, while
    # PostgreSQL binds their dashed string form. Persist the SQLite-bound form
    # so the production query can keep accepting the AuthContext UUID object.
    account.id = account_id.hex
    tenant = Tenant(name=f"Tenant {tenant_id}")
    tenant.id = tenant_id
    membership = TenantAccountJoin(
        tenant_id=tenant_id,
        account_id=account_id.hex,
        role=TenantAccountRole.NORMAL,
    )
    session.add_all([account, tenant, membership])
    session.commit()


def test_skips_when_enterprise_enabled(database: Database, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(oauth_bearer.dify_config, "ENTERPRISE_ENABLED", True)
    before = len(database.statements)

    require_workspace_member(_ctx(), "tenant-1")

    assert len(database.statements) == before


def test_skips_for_external_sso(database: Database, community_edition: None) -> None:
    before = len(database.statements)

    require_workspace_member(_ctx(account=False), "tenant-1")

    assert len(database.statements) == before


def test_uses_cached_allow_without_database_access(database: Database, community_edition: None) -> None:
    before = len(database.statements)

    require_workspace_member(_ctx({"tenant-1": True}), "tenant-1")

    assert len(database.statements) == before


def test_uses_cached_denial_without_database_access(database: Database, community_edition: None) -> None:
    before = len(database.statements)

    with pytest.raises(Forbidden, match="workspace_membership_revoked"):
        require_workspace_member(_ctx({"tenant-1": False}), "tenant-1")

    assert len(database.statements) == before


def test_denies_when_membership_is_absent(
    database: Database,
    community_edition: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record_verdict = Mock()
    monkeypatch.setattr(oauth_bearer, "record_layer0_verdict", record_verdict)

    with pytest.raises(Forbidden, match="workspace_membership_revoked"):
        require_workspace_member(_ctx(), "tenant-1")

    record_verdict.assert_called_once_with("h1", "tenant-1", False)


def test_denies_membership_from_another_tenant(
    database: Database,
    community_edition: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account_id = uuid.uuid4()
    _persist_membership(database.session, account_id=account_id, tenant_id="tenant-2")
    record_verdict = Mock()
    monkeypatch.setattr(oauth_bearer, "record_layer0_verdict", record_verdict)

    with pytest.raises(Forbidden, match="workspace_membership_revoked"):
        require_workspace_member(_ctx(account_id=account_id), "tenant-1")

    record_verdict.assert_called_once_with("h1", "tenant-1", False)


def test_denies_when_account_is_inactive(
    database: Database,
    community_edition: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account_id = uuid.uuid4()
    _persist_membership(
        database.session,
        account_id=account_id,
        tenant_id="tenant-1",
        status=AccountStatus.BANNED,
    )
    record_verdict = Mock()
    monkeypatch.setattr(oauth_bearer, "record_layer0_verdict", record_verdict)

    with pytest.raises(Forbidden, match="workspace_membership_revoked"):
        require_workspace_member(_ctx(account_id=account_id), "tenant-1")

    record_verdict.assert_called_once_with("h1", "tenant-1", False)


def test_allows_active_member_and_records_verdict(
    database: Database,
    community_edition: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account_id = uuid.uuid4()
    _persist_membership(database.session, account_id=account_id, tenant_id="tenant-1")
    record_verdict = Mock()
    monkeypatch.setattr(oauth_bearer, "record_layer0_verdict", record_verdict)

    require_workspace_member(_ctx(account_id=account_id), "tenant-1")

    record_verdict.assert_called_once_with("h1", "tenant-1", True)
