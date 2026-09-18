"""Regression coverage for the ``db.session``→session-parameter refactor on
``MCPToolProvider.load_user``.

The method reached for the global ``db.session`` internally and has been converted to
take an explicit ``session: Session`` (per the pattern established in #40370/#42316,
tracked in #40372).
"""

from uuid import uuid4

from sqlalchemy.orm import Session

from models.account import Account
from models.tools import MCPToolProvider


def _persist_account(session: Session, *, name: str = "MCP Owner") -> Account:
    account = Account(name=name, email=f"{uuid4().hex}@example.com")
    session.add(account)
    session.flush()
    return account


def _persist_provider(session: Session, *, user_id: str) -> MCPToolProvider:
    provider = MCPToolProvider(
        name="Test Provider",
        server_identifier=f"test-provider-{uuid4().hex[:8]}",
        server_url="https://example.com/mcp",
        server_url_hash=uuid4().hex,
        icon="icon",
        tenant_id=str(uuid4()),
        user_id=user_id,
    )
    session.add(provider)
    session.flush()
    return provider


def test_load_user_returns_account_through_the_given_session(sqlite_session: Session) -> None:
    account = _persist_account(sqlite_session)
    provider = _persist_provider(sqlite_session, user_id=account.id)

    result = provider.load_user(sqlite_session)

    assert result is not None
    assert result.id == account.id
    assert result.name == account.name


def test_load_user_returns_none_when_account_is_missing(sqlite_session: Session) -> None:
    provider = _persist_provider(sqlite_session, user_id=str(uuid4()))

    assert provider.load_user(sqlite_session) is None
