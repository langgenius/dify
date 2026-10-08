from __future__ import annotations

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from repositories.account.repository import SQLAlchemyAccountRepository
from services.account_errors import AccountNotFoundError
from services.account_profile_service import AccountProfileService
from services.entities.account_entities import AccountProfileChanges
from tests.unit_tests.model_factories import make_account


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1", trace_id="trace-1", account_id="account-1", active_workspace_id="workspace-1"
    )


@pytest.fixture
def accounts(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyAccountRepository:
    with sqlite_session_factory.begin() as session:
        session.add(make_account())
    return SQLAlchemyAccountRepository(sqlite_session_factory)


def test_get_returns_framework_neutral_account_snapshot(
    accounts: SQLAlchemyAccountRepository, mocker: MockerFixture
) -> None:
    expected = accounts.get("account-1")
    lookup = mocker.spy(accounts, "get")
    service = AccountProfileService(accounts=accounts)

    result = service.get(_context())

    assert result == expected
    lookup.assert_called_once_with("account-1")


def test_update_applies_profile_changes(accounts: SQLAlchemyAccountRepository, mocker: MockerFixture) -> None:
    update = mocker.spy(accounts, "update_profile")
    service = AccountProfileService(accounts=accounts)
    changes = AccountProfileChanges(name="Updated", timezone="Asia/Singapore")

    result = service.update(_context(), changes)

    assert result.name == "Updated"
    assert result.timezone == "Asia/Singapore"
    assert accounts.get("account-1") == result
    update.assert_called_once_with("account-1", changes)


def test_update_treats_empty_changes_as_noop(accounts: SQLAlchemyAccountRepository, mocker: MockerFixture) -> None:
    expected = accounts.get("account-1")
    lookup = mocker.spy(accounts, "get")
    update = mocker.spy(accounts, "update_profile")
    service = AccountProfileService(accounts=accounts)

    result = service.update(_context(), AccountProfileChanges())

    assert result == expected
    lookup.assert_called_once_with("account-1")
    update.assert_not_called()


def test_update_rejects_missing_account(sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture) -> None:
    accounts = SQLAlchemyAccountRepository(sqlite_session_factory)
    update = mocker.spy(accounts, "update_profile")
    service = AccountProfileService(accounts=accounts)
    changes = AccountProfileChanges(name="Updated")

    with pytest.raises(AccountNotFoundError):
        service.update(_context(), changes)

    update.assert_called_once_with("account-1", changes)
