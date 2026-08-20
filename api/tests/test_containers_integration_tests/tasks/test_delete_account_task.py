"""
Integration tests for delete_account_task.

These tests keep billing and email dispatch mocked, but exercise the account
lookup through the real Testcontainers PostgreSQL session factory instead of a
patched session_factory mock.
"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from _pytest.logging import LogCaptureFixture
from celery.exceptions import Retry
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from enums import DeploymentEdition
from models.account import Account, AccountStatus
from tasks.delete_account_task import delete_account_task


def _create_account(db_session: Session, *, email: str = "user@example.com") -> Account:
    account = Account(
        name=f"account-{uuid4()}",
        email=email,
        status=AccountStatus.CLOSED,
    )
    db_session.add(account)
    db_session.commit()
    return account


@pytest.fixture
def mock_external_dependencies(mocker: MockerFixture) -> tuple[MagicMock, MagicMock]:
    billing_service = mocker.patch("tasks.delete_account_task.BillingService")
    mail_task = mocker.patch("tasks.delete_account_task.send_deletion_success_task")
    return billing_service, mail_task


def test_cloud_account_exists_calls_billing_and_sends_email(
    db_session_with_containers: Session,
    mock_external_dependencies: tuple[MagicMock, MagicMock],
    mocker: MockerFixture,
) -> None:
    billing_service, mail_task = mock_external_dependencies
    account = _create_account(db_session_with_containers, email="a@b.com")
    mocker.patch("tasks.delete_account_task.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)

    delete_account_task(account.id)

    billing_service.delete_account.assert_called_once_with(account.id)
    mail_task.delay.assert_called_once_with(account.email)


def test_community_account_exists_sends_email_only(
    db_session_with_containers: Session,
    mock_external_dependencies: tuple[MagicMock, MagicMock],
    mocker: MockerFixture,
) -> None:
    billing_service, mail_task = mock_external_dependencies
    account = _create_account(db_session_with_containers, email="x@y.com")
    mocker.patch("tasks.delete_account_task.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)

    delete_account_task(account.id)

    billing_service.delete_account.assert_not_called()
    mail_task.delay.assert_called_once_with(account.email)


def test_cloud_account_not_found_is_idempotent(
    mock_external_dependencies: tuple[MagicMock, MagicMock], mocker: MockerFixture, caplog: LogCaptureFixture
) -> None:
    billing_service, mail_task = mock_external_dependencies
    account_id = str(uuid4())
    mocker.patch("tasks.delete_account_task.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)

    delete_account_task(account_id)

    billing_service.delete_account.assert_not_called()
    mail_task.delay.assert_not_called()
    assert any("not found" in record.getMessage().lower() for record in caplog.records)


def test_active_account_retries_without_side_effects(
    db_session_with_containers: Session,
    mock_external_dependencies: tuple[MagicMock, MagicMock],
    mocker: MockerFixture,
) -> None:
    billing_service, mail_task = mock_external_dependencies
    account = _create_account(db_session_with_containers)
    account.status = AccountStatus.ACTIVE
    db_session_with_containers.commit()
    retry = mocker.patch.object(delete_account_task, "retry", side_effect=Retry())

    with pytest.raises(Retry):
        delete_account_task(account.id)

    retry.assert_called_once_with(countdown=5, max_retries=12)
    billing_service.delete_account.assert_not_called()
    mail_task.delay.assert_not_called()


def test_billing_delete_raises_propagates_and_no_email(
    db_session_with_containers: Session,
    mock_external_dependencies: tuple[MagicMock, MagicMock],
    mocker: MockerFixture,
) -> None:
    billing_service, mail_task = mock_external_dependencies
    account = _create_account(db_session_with_containers, email="err@example.com")
    error = RuntimeError("billing down")
    billing_service.delete_account.side_effect = error
    mocker.patch("tasks.delete_account_task.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    retry = mocker.patch.object(delete_account_task, "retry", side_effect=Retry())

    with pytest.raises(Retry):
        delete_account_task(account.id)

    retry.assert_called_once_with(exc=error, countdown=5, max_retries=12)
    mail_task.delay.assert_not_called()
