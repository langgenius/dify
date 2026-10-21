"""Tests for actor -> account resolution and tenant-scoped app loading.

These services do NO authorization of their own; ``load_app``'s tenant check
is the only gate standing between an ``Actor`` and another tenant's app. Both
helpers read persisted rows through a real SQLite session.
"""

import pytest
import pytest_mock
from sqlalchemy.orm import Session

from core.dify_builder.errors import NotFoundError
from core.dify_builder.models import Actor
from models.account import Account
from models.model import App
from services.dify_builder.identity import load_app, resolve_account


def _actor(account_id: str = "acc-1", tenant_id: str = "tenant-1") -> Actor:
    return Actor(account_id=account_id, tenant_id=tenant_id)


def test_resolve_account_returns_account_on_hit(sqlite_session: Session, mocker: pytest_mock.MockerFixture) -> None:
    session = sqlite_session
    account = Account(name="Actor", email="actor@example.test")
    account.id = "acc-1"
    session.add(account)
    session.flush()
    get = mocker.spy(session, "get")

    result = resolve_account(session, _actor(account_id="acc-1"))

    assert result is account
    get.assert_called_once_with(Account, "acc-1")


def test_resolve_account_raises_not_found_on_miss(sqlite_session: Session) -> None:
    session = sqlite_session

    with pytest.raises(NotFoundError):
        resolve_account(session, _actor(account_id="acc-missing"))


def test_load_app_returns_app_on_tenant_match(sqlite_session: Session, mocker: pytest_mock.MockerFixture) -> None:
    session = sqlite_session
    app = App(id="app-1", tenant_id="tenant-1", name="Draft", mode="workflow", enable_site=False, enable_api=False)
    session.add(app)
    session.flush()
    get = mocker.spy(session, "get")

    result = load_app(session, "app-1", _actor(tenant_id="tenant-1"))

    assert result is app
    get.assert_called_once_with(App, "app-1")


def test_load_app_raises_not_found_on_tenant_mismatch(sqlite_session: Session) -> None:
    session = sqlite_session
    app = App(id="app-1", tenant_id="other-tenant", name="Draft", mode="workflow", enable_site=False, enable_api=False)
    session.add(app)
    session.flush()

    with pytest.raises(NotFoundError):
        load_app(session, "app-1", _actor(tenant_id="tenant-1"))


def test_load_app_raises_not_found_on_absent(sqlite_session: Session) -> None:
    session = sqlite_session

    with pytest.raises(NotFoundError):
        load_app(session, "does-not-exist", _actor())
