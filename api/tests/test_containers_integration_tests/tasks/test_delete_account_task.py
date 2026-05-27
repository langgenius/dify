"""
Integration tests for delete_account_task.

These tests keep billing and email dispatch mocked, but exercise the account
lookup through the real Testcontainers PostgreSQL session factory instead of a
patched session_factory mock.
"""

from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models.account import Account
from tasks.delete_account_task import delete_account_task


def _create_account(db_session: Session, *, email: str = "user@example.com") -> Account:
    account = Account(
        name=f"account-{uuid4()}",
        email=email,
    )
    db_session.add(account)
    db_session.commit()
    return account


@pytest.fixture
def mock_external_dependencies(mocker):
    billing_service = mocker.patch("tasks.delete_account_task.BillingService")
    mail_task = mocker.patch("tasks.delete_account_task.send_deletion_success_task")
    return billing_service, mail_task


def test_billing_enabled_account_exists_calls_billing_and_sends_email(
    db_session_with_containers: Session, mock_external_dependencies, mocker
) -> None:
    billing_service, mail_task = mock_external_dependencies
    account = _create_account(db_session_with_containers, email="a@b.com")
    mocker.patch("tasks.delete_account_task.dify_config.BILLING_ENABLED", True)

    delete_account_task(account.id)

    billing_service.delete_account.assert_called_once_with(account.id)
    mail_task.delay.assert_called_once_with(account.email)


def test_billing_disabled_account_exists_sends_email_only(
    db_session_with_containers: Session, mock_external_dependencies, mocker
) -> None:
    billing_service, mail_task = mock_external_dependencies
    account = _create_account(db_session_with_containers, email="x@y.com")
    mocker.patch("tasks.delete_account_task.dify_config.BILLING_ENABLED", False)

    delete_account_task(account.id)

    billing_service.delete_account.assert_not_called()
    mail_task.delay.assert_called_once_with(account.email)


def test_billing_enabled_account_not_found_calls_billing_no_email(mock_external_dependencies, mocker, caplog) -> None:
    billing_service, mail_task = mock_external_dependencies
    account_id = str(uuid4())
    mocker.patch("tasks.delete_account_task.dify_config.BILLING_ENABLED", True)

    delete_account_task(account_id)

    billing_service.delete_account.assert_called_once_with(account_id)
    mail_task.delay.assert_not_called()
    assert any("not found" in record.getMessage().lower() for record in caplog.records)


def test_billing_delete_raises_propagates_and_no_email(
    db_session_with_containers: Session, mock_external_dependencies, mocker
) -> None:
    billing_service, mail_task = mock_external_dependencies
    account = _create_account(db_session_with_containers, email="err@example.com")
    billing_service.delete_account.side_effect = RuntimeError("billing down")
    mocker.patch("tasks.delete_account_task.dify_config.BILLING_ENABLED", True)

    with pytest.raises(RuntimeError, match="billing down"):
        delete_account_task(account.id)

    mail_task.delay.assert_not_called()
