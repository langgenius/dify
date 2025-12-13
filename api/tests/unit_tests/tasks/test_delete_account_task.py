from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_delete_account_deps():
    """Fixture to mock all dependencies for delete_account_task."""
    with (
        patch("tasks.delete_account_task.send_deletion_success_task") as mock_send_email,
        patch("tasks.delete_account_task.BillingService") as mock_billing_service,
        patch("tasks.delete_account_task.db") as mock_db,
        patch("tasks.delete_account_task.dify_config") as mock_config,
    ):
        yield {
            "config": mock_config,
            "db": mock_db,
            "billing_service": mock_billing_service,
            "send_email": mock_send_email,
        }


class TestDeleteAccountTask:
    """Unit tests for delete_account_task."""

    def test_delete_account_task_with_billing_enabled(self, mock_delete_account_deps):
        """Test delete_account_task calls BillingService when BILLING_ENABLED is True."""
        from tasks.delete_account_task import delete_account_task

        mocks = mock_delete_account_deps
        account_id = "test-account-id"
        mock_account = MagicMock()
        mock_account.email = "test@example.com"

        mocks["config"].BILLING_ENABLED = True
        mocks["db"].session.query.return_value.where.return_value.first.return_value = mock_account

        delete_account_task(account_id)

        mocks["billing_service"].delete_account.assert_called_once_with(account_id)
        mocks["send_email"].delay.assert_called_once_with("test@example.com")

    def test_delete_account_task_with_billing_disabled(self, mock_delete_account_deps):
        """Test delete_account_task skips BillingService when BILLING_ENABLED is False."""
        from tasks.delete_account_task import delete_account_task

        mocks = mock_delete_account_deps
        account_id = "test-account-id"
        mock_account = MagicMock()
        mock_account.email = "test@example.com"

        mocks["config"].BILLING_ENABLED = False
        mocks["db"].session.query.return_value.where.return_value.first.return_value = mock_account

        delete_account_task(account_id)

        mocks["billing_service"].delete_account.assert_not_called()
        mocks["send_email"].delay.assert_called_once_with("test@example.com")

    def test_delete_account_task_account_not_found(self, mock_delete_account_deps):
        """Test delete_account_task returns early when account not found."""
        from tasks.delete_account_task import delete_account_task

        mocks = mock_delete_account_deps
        account_id = "nonexistent-account-id"

        mocks["config"].BILLING_ENABLED = True
        mocks["db"].session.query.return_value.where.return_value.first.return_value = None

        delete_account_task(account_id)

        # Should not call billing service or send email when account not found
        mocks["billing_service"].delete_account.assert_not_called()
        mocks["send_email"].delay.assert_not_called()

    def test_delete_account_task_billing_service_failure(self, mock_delete_account_deps):
        """Test delete_account_task raises exception when BillingService fails."""
        from tasks.delete_account_task import delete_account_task

        mocks = mock_delete_account_deps
        account_id = "test-account-id"
        mock_account = MagicMock()
        mock_account.email = "test@example.com"

        mocks["config"].BILLING_ENABLED = True
        mocks["db"].session.query.return_value.where.return_value.first.return_value = mock_account
        mocks["billing_service"].delete_account.side_effect = Exception("Billing service error")

        with pytest.raises(Exception, match="Billing service error"):
            delete_account_task(account_id)

        mocks["send_email"].delay.assert_not_called()
