"""Tests for actor -> account resolution and tenant-scoped app loading.

These services do NO authorization of their own; ``load_app``'s tenant check
is the only gate standing between an ``Actor`` and another tenant's app. Both
helpers are exercised against a mocked ``session`` (``session.get(Model, id)``)
-- no DB.
"""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.dify_builder.errors import NotFoundError
from core.dify_builder.models import Actor
from models.account import Account
from models.model import App
from services.dify_builder.identity import load_app, resolve_account


def _actor(account_id: str = "acc-1", tenant_id: str = "tenant-1") -> Actor:
    return Actor(account_id=account_id, tenant_id=tenant_id)


def test_resolve_account_returns_account_on_hit():
    account = SimpleNamespace(id="acc-1")
    session = Mock()
    session.get.return_value = account

    result = resolve_account(session, _actor(account_id="acc-1"))

    assert result is account
    session.get.assert_called_once_with(Account, "acc-1")


def test_resolve_account_raises_not_found_on_miss():
    session = Mock()
    session.get.return_value = None

    with pytest.raises(NotFoundError):
        resolve_account(session, _actor(account_id="acc-missing"))


def test_load_app_returns_app_on_tenant_match():
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    session = Mock()
    session.get.return_value = app

    result = load_app(session, "app-1", _actor(tenant_id="tenant-1"))

    assert result is app
    session.get.assert_called_once_with(App, "app-1")


def test_load_app_raises_not_found_on_tenant_mismatch():
    app = SimpleNamespace(id="app-1", tenant_id="other-tenant")
    session = Mock()
    session.get.return_value = app

    with pytest.raises(NotFoundError):
        load_app(session, "app-1", _actor(tenant_id="tenant-1"))


def test_load_app_raises_not_found_on_absent():
    session = Mock()
    session.get.return_value = None

    with pytest.raises(NotFoundError):
        load_app(session, "does-not-exist", _actor())
