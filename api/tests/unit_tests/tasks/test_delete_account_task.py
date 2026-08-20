from contextlib import nullcontext
from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import Retry

from enums import DeploymentEdition
from models import Account, AccountStatus
from tasks.delete_account_task import delete_account_task


def _account(status: AccountStatus) -> Account:
    account = Account(name="Delete Me", email="delete@example.com", status=status)
    account.id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    return account


def test_active_account_retries_without_billing_or_email() -> None:
    session = MagicMock()
    session.scalar.return_value = _account(AccountStatus.ACTIVE)
    with (
        patch("tasks.delete_account_task.session_factory.create_session", return_value=nullcontext(session)),
        patch.object(delete_account_task, "retry", side_effect=Retry()) as retry,
        patch("tasks.delete_account_task.BillingService") as billing,
        patch("tasks.delete_account_task.send_deletion_success_task") as email,
        pytest.raises(Retry),
    ):
        delete_account_task.run("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

    retry.assert_called_once_with(countdown=5, max_retries=12)
    billing.delete_account.assert_not_called()
    email.delay.assert_not_called()


def test_closed_account_runs_side_effects() -> None:
    account = _account(AccountStatus.CLOSED)
    session = MagicMock()
    session.scalar.return_value = account
    with (
        patch("tasks.delete_account_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.delete_account_task.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
        patch("tasks.delete_account_task.BillingService") as billing,
        patch("tasks.delete_account_task.send_deletion_success_task") as email,
    ):
        delete_account_task.run(account.id)

    billing.delete_account.assert_called_once_with(account.id)
    email.delay.assert_called_once_with(account.email)


def test_billing_failure_retries_without_sending_email() -> None:
    account = _account(AccountStatus.CLOSED)
    session = MagicMock()
    session.scalar.return_value = account
    error = RuntimeError("billing unavailable")
    with (
        patch("tasks.delete_account_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.delete_account_task.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
        patch.object(delete_account_task, "retry", side_effect=Retry()) as retry,
        patch("tasks.delete_account_task.BillingService.delete_account", side_effect=error),
        patch("tasks.delete_account_task.send_deletion_success_task") as email,
        pytest.raises(Retry),
    ):
        delete_account_task.run(account.id)

    retry.assert_called_once_with(exc=error, countdown=5, max_retries=12)
    email.delay.assert_not_called()


def test_email_queue_failure_is_best_effort() -> None:
    account = _account(AccountStatus.CLOSED)
    session = MagicMock()
    session.scalar.return_value = account
    with (
        patch("tasks.delete_account_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.delete_account_task.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
        patch("tasks.delete_account_task.BillingService") as billing,
        patch("tasks.delete_account_task.send_deletion_success_task.delay", side_effect=RuntimeError("broker")),
    ):
        delete_account_task.run(account.id)

    billing.delete_account.assert_called_once_with(account.id)
