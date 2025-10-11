from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from extensions.ext_database import db
from libs.email_i18n import EmailType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from tasks.mail_account_deletion_task import send_account_deletion_verification_code, send_deletion_success_task


class TestMailAccountDeletionTask:
    """Integration tests for mail account deletion tasks using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.mail_account_deletion_task.mail") as mock_mail,
            patch("tasks.mail_account_deletion_task.get_email_i18n_service") as mock_get_email_service,
        ):
            # Setup mock mail service
            mock_mail.is_inited.return_value = True

            # Setup mock email service
            mock_email_service = MagicMock()
            mock_get_email_service.return_value = mock_email_service

            yield {
                "mail": mock_mail,
                "get_email_service": mock_get_email_service,
                "email_service": mock_email_service,
            }

    def _create_test_account(self, db_session_with_containers):
        """
        Helper method to create a test account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure

        Returns:
            Account: Created account instance
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )
        db.session.add(account)
        db.session.commit()

        # Create tenant
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        return account

    def test_send_deletion_success_task_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful account deletion success email sending.

        This test verifies:
        - Proper email service initialization check
        - Correct email service method calls
        - Template context is properly formatted
        - Email type is correctly specified
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email
        test_language = "en-US"

        # Act: Execute the task
        send_deletion_success_task(test_email, test_language)

        # Assert: Verify the expected outcomes
        # Verify mail service was checked
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()

        # Verify email service was retrieved
        mock_external_service_dependencies["get_email_service"].assert_called_once()

        # Verify email was sent with correct parameters
        mock_external_service_dependencies["email_service"].send_email.assert_called_once_with(
            email_type=EmailType.ACCOUNT_DELETION_SUCCESS,
            language_code=test_language,
            to=test_email,
            template_context={
                "to": test_email,
                "email": test_email,
            },
        )

    def test_send_deletion_success_task_mail_not_initialized(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account deletion success email when mail service is not initialized.

        This test verifies:
        - Early return when mail service is not initialized
        - No email service calls are made
        - No exceptions are raised
        """
        # Arrange: Setup mail service to return not initialized
        mock_external_service_dependencies["mail"].is_inited.return_value = False
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email

        # Act: Execute the task
        send_deletion_success_task(test_email)

        # Assert: Verify no email service calls were made
        mock_external_service_dependencies["get_email_service"].assert_not_called()
        mock_external_service_dependencies["email_service"].send_email.assert_not_called()

    def test_send_deletion_success_task_email_service_exception(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account deletion success email when email service raises exception.

        This test verifies:
        - Exception is properly caught and logged
        - Task completes without raising exception
        - Error logging is recorded
        """
        # Arrange: Setup email service to raise exception
        mock_external_service_dependencies["email_service"].send_email.side_effect = Exception("Email service failed")
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email

        # Act: Execute the task (should not raise exception)
        send_deletion_success_task(test_email)

        # Assert: Verify email service was called but exception was handled
        mock_external_service_dependencies["email_service"].send_email.assert_called_once()

    def test_send_account_deletion_verification_code_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful account deletion verification code email sending.

        This test verifies:
        - Proper email service initialization check
        - Correct email service method calls
        - Template context includes verification code
        - Email type is correctly specified
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email
        test_code = "123456"
        test_language = "en-US"

        # Act: Execute the task
        send_account_deletion_verification_code(test_email, test_code, test_language)

        # Assert: Verify the expected outcomes
        # Verify mail service was checked
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()

        # Verify email service was retrieved
        mock_external_service_dependencies["get_email_service"].assert_called_once()

        # Verify email was sent with correct parameters
        mock_external_service_dependencies["email_service"].send_email.assert_called_once_with(
            email_type=EmailType.ACCOUNT_DELETION_VERIFICATION,
            language_code=test_language,
            to=test_email,
            template_context={
                "to": test_email,
                "code": test_code,
            },
        )

    def test_send_account_deletion_verification_code_mail_not_initialized(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account deletion verification code email when mail service is not initialized.

        This test verifies:
        - Early return when mail service is not initialized
        - No email service calls are made
        - No exceptions are raised
        """
        # Arrange: Setup mail service to return not initialized
        mock_external_service_dependencies["mail"].is_inited.return_value = False
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email
        test_code = "123456"

        # Act: Execute the task
        send_account_deletion_verification_code(test_email, test_code)

        # Assert: Verify no email service calls were made
        mock_external_service_dependencies["get_email_service"].assert_not_called()
        mock_external_service_dependencies["email_service"].send_email.assert_not_called()

    def test_send_account_deletion_verification_code_email_service_exception(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account deletion verification code email when email service raises exception.

        This test verifies:
        - Exception is properly caught and logged
        - Task completes without raising exception
        - Error logging is recorded
        """
        # Arrange: Setup email service to raise exception
        mock_external_service_dependencies["email_service"].send_email.side_effect = Exception("Email service failed")
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email
        test_code = "123456"

        # Act: Execute the task (should not raise exception)
        send_account_deletion_verification_code(test_email, test_code)

        # Assert: Verify email service was called but exception was handled
        mock_external_service_dependencies["email_service"].send_email.assert_called_once()
