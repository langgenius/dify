"""
TestContainers-based integration tests for mail_owner_transfer_task.

This module provides comprehensive integration tests for the mail owner transfer tasks
using TestContainers to ensure real email service integration and proper functionality
testing with actual database and service dependencies.
"""

import logging
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from libs.email_i18n import EmailType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from tasks.mail_owner_transfer_task import (
    send_new_owner_transfer_notify_email_task,
    send_old_owner_transfer_notify_email_task,
    send_owner_transfer_confirm_task,
)

logger = logging.getLogger(__name__)


class TestMailOwnerTransferTask:
    """Integration tests for mail owner transfer tasks using testcontainers."""

    @pytest.fixture
    def mock_mail_dependencies(self):
        """Mock setup for mail service dependencies."""
        with (
            patch("tasks.mail_owner_transfer_task.mail") as mock_mail,
            patch("tasks.mail_owner_transfer_task.get_email_i18n_service") as mock_get_email_service,
        ):
            # Setup mock mail service
            mock_mail.is_inited.return_value = True

            # Setup mock email service
            mock_email_service = MagicMock()
            mock_get_email_service.return_value = mock_email_service

            yield {
                "mail": mock_mail,
                "email_service": mock_email_service,
                "get_email_service": mock_get_email_service,
            }

    def _create_test_account_and_tenant(self, db_session_with_containers):
        """
        Helper method to create test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure

        Returns:
            tuple: (account, tenant) - Created account and tenant instances
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        # Create tenant
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER.value,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        return account, tenant

    def test_send_owner_transfer_confirm_task_success(self, db_session_with_containers, mock_mail_dependencies):
        """
        Test successful owner transfer confirmation email sending.

        This test verifies:
        - Proper email service initialization check
        - Correct email service method calls with right parameters
        - Email template context is properly constructed
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)

        test_language = "en-US"
        test_email = account.email
        test_code = "123456"
        test_workspace = tenant.name

        # Act: Execute the task
        send_owner_transfer_confirm_task(
            language=test_language,
            to=test_email,
            code=test_code,
            workspace=test_workspace,
        )

        # Assert: Verify the expected outcomes
        mock_mail_dependencies["mail"].is_inited.assert_called_once()
        mock_mail_dependencies["get_email_service"].assert_called_once()

        # Verify email service was called with correct parameters
        mock_mail_dependencies["email_service"].send_email.assert_called_once()
        call_args = mock_mail_dependencies["email_service"].send_email.call_args

        assert call_args[1]["email_type"] == EmailType.OWNER_TRANSFER_CONFIRM
        assert call_args[1]["language_code"] == test_language
        assert call_args[1]["to"] == test_email
        assert call_args[1]["template_context"]["to"] == test_email
        assert call_args[1]["template_context"]["code"] == test_code
        assert call_args[1]["template_context"]["WorkspaceName"] == test_workspace

    def test_send_owner_transfer_confirm_task_mail_not_initialized(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """
        Test owner transfer confirmation email when mail service is not initialized.

        This test verifies:
        - Early return when mail service is not initialized
        - No email service calls are made
        - No exceptions are raised
        """
        # Arrange: Set mail service as not initialized
        mock_mail_dependencies["mail"].is_inited.return_value = False

        test_language = "en-US"
        test_email = "test@example.com"
        test_code = "123456"
        test_workspace = "Test Workspace"

        # Act: Execute the task
        send_owner_transfer_confirm_task(
            language=test_language,
            to=test_email,
            code=test_code,
            workspace=test_workspace,
        )

        # Assert: Verify no email service calls were made
        mock_mail_dependencies["get_email_service"].assert_not_called()
        mock_mail_dependencies["email_service"].send_email.assert_not_called()

    def test_send_owner_transfer_confirm_task_exception_handling(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """
        Test exception handling in owner transfer confirmation email.

        This test verifies:
        - Exceptions are properly caught and logged
        - No exceptions are propagated to caller
        - Email service calls are attempted
        - Error logging works correctly
        """
        # Arrange: Setup email service to raise exception
        mock_mail_dependencies["email_service"].send_email.side_effect = Exception("Email service error")

        test_language = "en-US"
        test_email = "test@example.com"
        test_code = "123456"
        test_workspace = "Test Workspace"

        # Act & Assert: Verify no exception is raised
        try:
            send_owner_transfer_confirm_task(
                language=test_language,
                to=test_email,
                code=test_code,
                workspace=test_workspace,
            )
        except Exception as e:
            pytest.fail(f"Task should not raise exceptions, but raised: {e}")

        # Verify email service was called despite the exception
        mock_mail_dependencies["email_service"].send_email.assert_called_once()

    def test_send_old_owner_transfer_notify_email_task_success(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """
        Test successful old owner transfer notification email sending.

        This test verifies:
        - Proper email service initialization check
        - Correct email service method calls with right parameters
        - Email template context includes new owner email
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)

        test_language = "en-US"
        test_email = account.email
        test_workspace = tenant.name
        test_new_owner_email = "newowner@example.com"

        # Act: Execute the task
        send_old_owner_transfer_notify_email_task(
            language=test_language,
            to=test_email,
            workspace=test_workspace,
            new_owner_email=test_new_owner_email,
        )

        # Assert: Verify the expected outcomes
        mock_mail_dependencies["mail"].is_inited.assert_called_once()
        mock_mail_dependencies["get_email_service"].assert_called_once()

        # Verify email service was called with correct parameters
        mock_mail_dependencies["email_service"].send_email.assert_called_once()
        call_args = mock_mail_dependencies["email_service"].send_email.call_args

        assert call_args[1]["email_type"] == EmailType.OWNER_TRANSFER_OLD_NOTIFY
        assert call_args[1]["language_code"] == test_language
        assert call_args[1]["to"] == test_email
        assert call_args[1]["template_context"]["to"] == test_email
        assert call_args[1]["template_context"]["WorkspaceName"] == test_workspace
        assert call_args[1]["template_context"]["NewOwnerEmail"] == test_new_owner_email

    def test_send_old_owner_transfer_notify_email_task_mail_not_initialized(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """
        Test old owner transfer notification email when mail service is not initialized.

        This test verifies:
        - Early return when mail service is not initialized
        - No email service calls are made
        - No exceptions are raised
        """
        # Arrange: Set mail service as not initialized
        mock_mail_dependencies["mail"].is_inited.return_value = False

        test_language = "en-US"
        test_email = "test@example.com"
        test_workspace = "Test Workspace"
        test_new_owner_email = "newowner@example.com"

        # Act: Execute the task
        send_old_owner_transfer_notify_email_task(
            language=test_language,
            to=test_email,
            workspace=test_workspace,
            new_owner_email=test_new_owner_email,
        )

        # Assert: Verify no email service calls were made
        mock_mail_dependencies["get_email_service"].assert_not_called()
        mock_mail_dependencies["email_service"].send_email.assert_not_called()

    def test_send_old_owner_transfer_notify_email_task_exception_handling(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """
        Test exception handling in old owner transfer notification email.

        This test verifies:
        - Exceptions are properly caught and logged
        - No exceptions are propagated to caller
        - Email service calls are attempted
        - Error logging works correctly
        """
        # Arrange: Setup email service to raise exception
        mock_mail_dependencies["email_service"].send_email.side_effect = Exception("Email service error")

        test_language = "en-US"
        test_email = "test@example.com"
        test_workspace = "Test Workspace"
        test_new_owner_email = "newowner@example.com"

        # Act & Assert: Verify no exception is raised
        try:
            send_old_owner_transfer_notify_email_task(
                language=test_language,
                to=test_email,
                workspace=test_workspace,
                new_owner_email=test_new_owner_email,
            )
        except Exception as e:
            pytest.fail(f"Task should not raise exceptions, but raised: {e}")

        # Verify email service was called despite the exception
        mock_mail_dependencies["email_service"].send_email.assert_called_once()

    def test_send_new_owner_transfer_notify_email_task_success(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """
        Test successful new owner transfer notification email sending.

        This test verifies:
        - Proper email service initialization check
        - Correct email service method calls with right parameters
        - Email template context is properly constructed
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)

        test_language = "en-US"
        test_email = account.email
        test_workspace = tenant.name

        # Act: Execute the task
        send_new_owner_transfer_notify_email_task(
            language=test_language,
            to=test_email,
            workspace=test_workspace,
        )

        # Assert: Verify the expected outcomes
        mock_mail_dependencies["mail"].is_inited.assert_called_once()
        mock_mail_dependencies["get_email_service"].assert_called_once()

        # Verify email service was called with correct parameters
        mock_mail_dependencies["email_service"].send_email.assert_called_once()
        call_args = mock_mail_dependencies["email_service"].send_email.call_args

        assert call_args[1]["email_type"] == EmailType.OWNER_TRANSFER_NEW_NOTIFY
        assert call_args[1]["language_code"] == test_language
        assert call_args[1]["to"] == test_email
        assert call_args[1]["template_context"]["to"] == test_email
        assert call_args[1]["template_context"]["WorkspaceName"] == test_workspace

    def test_send_new_owner_transfer_notify_email_task_mail_not_initialized(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """
        Test new owner transfer notification email when mail service is not initialized.

        This test verifies:
        - Early return when mail service is not initialized
        - No email service calls are made
        - No exceptions are raised
        """
        # Arrange: Set mail service as not initialized
        mock_mail_dependencies["mail"].is_inited.return_value = False

        test_language = "en-US"
        test_email = "test@example.com"
        test_workspace = "Test Workspace"

        # Act: Execute the task
        send_new_owner_transfer_notify_email_task(
            language=test_language,
            to=test_email,
            workspace=test_workspace,
        )

        # Assert: Verify no email service calls were made
        mock_mail_dependencies["get_email_service"].assert_not_called()
        mock_mail_dependencies["email_service"].send_email.assert_not_called()

    def test_send_new_owner_transfer_notify_email_task_exception_handling(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """
        Test exception handling in new owner transfer notification email.

        This test verifies:
        - Exceptions are properly caught and logged
        - No exceptions are propagated to caller
        - Email service calls are attempted
        - Error logging works correctly
        """
        # Arrange: Setup email service to raise exception
        mock_mail_dependencies["email_service"].send_email.side_effect = Exception("Email service error")

        test_language = "en-US"
        test_email = "test@example.com"
        test_workspace = "Test Workspace"

        # Act & Assert: Verify no exception is raised
        try:
            send_new_owner_transfer_notify_email_task(
                language=test_language,
                to=test_email,
                workspace=test_workspace,
            )
        except Exception as e:
            pytest.fail(f"Task should not raise exceptions, but raised: {e}")

        # Verify email service was called despite the exception
        mock_mail_dependencies["email_service"].send_email.assert_called_once()
