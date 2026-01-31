"""
Unit tests for delete_account_task.

Covers:
- Billing enabled with existing account: calls billing and sends success email
- Billing disabled with existing account: skips billing, sends success email
- Account not found: still calls billing when enabled, does not send email
- Billing deletion raises: logs and re-raises, no email
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from tasks.delete_account_task import delete_account_task


@pytest.fixture
def mock_db_session():
    """Mock session via session_factory.create_session()."""
    with patch("tasks.delete_account_task.session_factory") as mock_sf:
        session = MagicMock()
        cm = MagicMock()
        cm.__enter__.return_value = session
        cm.__exit__.return_value = None
        mock_sf.create_session.return_value = cm

        query = MagicMock()
        session.query.return_value = query
        query.where.return_value = query
        yield session


@pytest.fixture
def mock_deps():
    """Patch external dependencies: BillingService and send_deletion_success_task."""
    with (
        patch("tasks.delete_account_task.BillingService") as mock_billing,
        patch("tasks.delete_account_task.send_deletion_success_task") as mock_mail_task,
    ):
        # ensure .delay exists on the mail task
        mock_mail_task.delay = MagicMock()
        yield {
            "billing": mock_billing,
            "mail_task": mock_mail_task,
        }


def _set_account_found(mock_db_session, email: str = "user@example.com"):
    account = SimpleNamespace(email=email)
    mock_db_session.query.return_value.where.return_value.first.return_value = account
    return account


def _set_account_missing(mock_db_session):
    mock_db_session.query.return_value.where.return_value.first.return_value = None


class TestDeleteAccountTask:
    def test_billing_enabled_account_exists_calls_billing_and_sends_email(self, mock_db_session, mock_deps):
        # Arrange
        account_id = "acc-123"
        account = _set_account_found(mock_db_session, email="a@b.com")

        # Enable billing
        with patch("tasks.delete_account_task.dify_config.BILLING_ENABLED", True):
            # Act
            delete_account_task(account_id)

        # Assert
        mock_deps["billing"].delete_account.assert_called_once_with(account_id)
        mock_deps["mail_task"].delay.assert_called_once_with(account.email)

    def test_billing_disabled_account_exists_sends_email_only(self, mock_db_session, mock_deps):
        # Arrange
        account_id = "acc-456"
        account = _set_account_found(mock_db_session, email="x@y.com")

        # Disable billing
        with patch("tasks.delete_account_task.dify_config.BILLING_ENABLED", False):
            # Act
            delete_account_task(account_id)

        # Assert
        mock_deps["billing"].delete_account.assert_not_called()
        mock_deps["mail_task"].delay.assert_called_once_with(account.email)

    def test_account_not_found_billing_enabled_calls_billing_no_email(self, mock_db_session, mock_deps, caplog):
        # Arrange
        account_id = "missing-id"
        _set_account_missing(mock_db_session)

        # Enable billing
        with patch("tasks.delete_account_task.dify_config.BILLING_ENABLED", True):
            # Act
            delete_account_task(account_id)

        # Assert
        mock_deps["billing"].delete_account.assert_called_once_with(account_id)
        mock_deps["mail_task"].delay.assert_not_called()
        # Optional: verify log contains not found message
        assert any("not found" in rec.getMessage().lower() for rec in caplog.records)

    def test_billing_delete_raises_propagates_and_no_email(self, mock_db_session, mock_deps):
        # Arrange
        account_id = "acc-err"
        _set_account_found(mock_db_session, email="err@ex.com")
        mock_deps["billing"].delete_account.side_effect = RuntimeError("billing down")

        # Enable billing
        with patch("tasks.delete_account_task.dify_config.BILLING_ENABLED", True):
            # Act & Assert
            with pytest.raises(RuntimeError):
                delete_account_task(account_id)

        # Ensure email was not sent
        mock_deps["mail_task"].delay.assert_not_called()
