from unittest.mock import MagicMock, patch

import pytest


class TestDeleteAccountTask:
    """Unit tests for delete_account_task."""

    @patch("tasks.delete_account_task.send_deletion_success_task")
    @patch("tasks.delete_account_task.BillingService")
    @patch("tasks.delete_account_task.db")
    @patch("tasks.delete_account_task.dify_config")
    def test_delete_account_task_with_billing_enabled(
        self, mock_config, mock_db, mock_billing_service, mock_send_email
    ):
        """Test delete_account_task calls BillingService when BILLING_ENABLED is True."""
        from tasks.delete_account_task import delete_account_task

        account_id = "test-account-id"
        mock_account = MagicMock()
        mock_account.email = "test@example.com"

        mock_config.BILLING_ENABLED = True
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_account

        delete_account_task(account_id)

        mock_billing_service.delete_account.assert_called_once_with(account_id)
        mock_send_email.delay.assert_called_once_with("test@example.com")

    @patch("tasks.delete_account_task.send_deletion_success_task")
    @patch("tasks.delete_account_task.BillingService")
    @patch("tasks.delete_account_task.db")
    @patch("tasks.delete_account_task.dify_config")
    def test_delete_account_task_with_billing_disabled(
        self, mock_config, mock_db, mock_billing_service, mock_send_email
    ):
        """Test delete_account_task skips BillingService when BILLING_ENABLED is False."""
        from tasks.delete_account_task import delete_account_task

        account_id = "test-account-id"
        mock_account = MagicMock()
        mock_account.email = "test@example.com"

        mock_config.BILLING_ENABLED = False
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_account

        delete_account_task(account_id)

        mock_billing_service.delete_account.assert_not_called()
        mock_send_email.delay.assert_called_once_with("test@example.com")

    @patch("tasks.delete_account_task.send_deletion_success_task")
    @patch("tasks.delete_account_task.BillingService")
    @patch("tasks.delete_account_task.db")
    @patch("tasks.delete_account_task.dify_config")
    def test_delete_account_task_account_not_found(
        self, mock_config, mock_db, mock_billing_service, mock_send_email
    ):
        """Test delete_account_task handles account not found gracefully."""
        from tasks.delete_account_task import delete_account_task

        account_id = "nonexistent-account-id"

        mock_config.BILLING_ENABLED = False
        mock_db.session.query.return_value.where.return_value.first.return_value = None

        delete_account_task(account_id)

        mock_send_email.delay.assert_not_called()

    @patch("tasks.delete_account_task.send_deletion_success_task")
    @patch("tasks.delete_account_task.BillingService")
    @patch("tasks.delete_account_task.db")
    @patch("tasks.delete_account_task.dify_config")
    def test_delete_account_task_billing_service_failure(
        self, mock_config, mock_db, mock_billing_service, mock_send_email
    ):
        """Test delete_account_task raises exception when BillingService fails."""
        from tasks.delete_account_task import delete_account_task

        account_id = "test-account-id"
        mock_account = MagicMock()
        mock_account.email = "test@example.com"

        mock_config.BILLING_ENABLED = True
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_account
        mock_billing_service.delete_account.side_effect = Exception("Billing service error")

        with pytest.raises(Exception, match="Billing service error"):
            delete_account_task(account_id)

        mock_send_email.delay.assert_not_called()
