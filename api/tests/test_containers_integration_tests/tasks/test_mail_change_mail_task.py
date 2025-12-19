from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from libs.email_i18n import EmailType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from tasks.mail_change_mail_task import send_change_mail_completed_notification_task, send_change_mail_task


class TestMailChangeMailTask:
    """Integration tests for mail_change_mail_task using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.mail_change_mail_task.mail") as mock_mail,
            patch("tasks.mail_change_mail_task.get_email_i18n_service") as mock_get_email_i18n_service,
        ):
            # Setup mock mail service
            mock_mail.is_inited.return_value = True

            # Setup mock email i18n service
            mock_email_service = MagicMock()
            mock_get_email_i18n_service.return_value = mock_email_service

            yield {
                "mail": mock_mail,
                "email_i18n_service": mock_email_service,
                "get_email_i18n_service": mock_get_email_i18n_service,
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
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        return account

    def test_send_change_mail_task_success_old_email_phase(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful change email task execution for old_email phase.

        This test verifies:
        - Proper mail service initialization check
        - Correct email service method call with old_email phase
        - Successful task completion
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_language = "en-US"
        test_email = account.email
        test_code = "123456"
        test_phase = "old_email"

        # Act: Execute the task
        send_change_mail_task(test_language, test_email, test_code, test_phase)

        # Assert: Verify the expected outcomes
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()
        mock_external_service_dependencies["get_email_i18n_service"].assert_called_once()
        mock_external_service_dependencies["email_i18n_service"].send_change_email.assert_called_once_with(
            language_code=test_language,
            to=test_email,
            code=test_code,
            phase=test_phase,
        )

    def test_send_change_mail_task_success_new_email_phase(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful change email task execution for new_email phase.

        This test verifies:
        - Proper mail service initialization check
        - Correct email service method call with new_email phase
        - Successful task completion
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_language = "zh-Hans"
        test_email = "new@example.com"
        test_code = "789012"
        test_phase = "new_email"

        # Act: Execute the task
        send_change_mail_task(test_language, test_email, test_code, test_phase)

        # Assert: Verify the expected outcomes
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()
        mock_external_service_dependencies["get_email_i18n_service"].assert_called_once()
        mock_external_service_dependencies["email_i18n_service"].send_change_email.assert_called_once_with(
            language_code=test_language,
            to=test_email,
            code=test_code,
            phase=test_phase,
        )

    def test_send_change_mail_task_mail_not_initialized(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test change email task when mail service is not initialized.

        This test verifies:
        - Early return when mail service is not initialized
        - No email service calls when mail is not available
        """
        # Arrange: Setup mail service as not initialized
        mock_external_service_dependencies["mail"].is_inited.return_value = False
        test_language = "en-US"
        test_email = "test@example.com"
        test_code = "123456"
        test_phase = "old_email"

        # Act: Execute the task
        send_change_mail_task(test_language, test_email, test_code, test_phase)

        # Assert: Verify no email service calls
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()
        mock_external_service_dependencies["get_email_i18n_service"].assert_not_called()
        mock_external_service_dependencies["email_i18n_service"].send_change_email.assert_not_called()

    def test_send_change_mail_task_email_service_exception(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test change email task when email service raises an exception.

        This test verifies:
        - Exception is properly caught and logged
        - Task completes without raising exception
        """
        # Arrange: Setup email service to raise exception
        mock_external_service_dependencies["email_i18n_service"].send_change_email.side_effect = Exception(
            "Email service failed"
        )
        test_language = "en-US"
        test_email = "test@example.com"
        test_code = "123456"
        test_phase = "old_email"

        # Act: Execute the task (should not raise exception)
        send_change_mail_task(test_language, test_email, test_code, test_phase)

        # Assert: Verify email service was called despite exception
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()
        mock_external_service_dependencies["get_email_i18n_service"].assert_called_once()
        mock_external_service_dependencies["email_i18n_service"].send_change_email.assert_called_once_with(
            language_code=test_language,
            to=test_email,
            code=test_code,
            phase=test_phase,
        )

    def test_send_change_mail_completed_notification_task_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful change email completed notification task execution.

        This test verifies:
        - Proper mail service initialization check
        - Correct email service method call with CHANGE_EMAIL_COMPLETED type
        - Template context is properly constructed
        - Successful task completion
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_language = "en-US"
        test_email = account.email

        # Act: Execute the task
        send_change_mail_completed_notification_task(test_language, test_email)

        # Assert: Verify the expected outcomes
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()
        mock_external_service_dependencies["get_email_i18n_service"].assert_called_once()
        mock_external_service_dependencies["email_i18n_service"].send_email.assert_called_once_with(
            email_type=EmailType.CHANGE_EMAIL_COMPLETED,
            language_code=test_language,
            to=test_email,
            template_context={
                "to": test_email,
                "email": test_email,
            },
        )

    def test_send_change_mail_completed_notification_task_mail_not_initialized(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test change email completed notification task when mail service is not initialized.

        This test verifies:
        - Early return when mail service is not initialized
        - No email service calls when mail is not available
        """
        # Arrange: Setup mail service as not initialized
        mock_external_service_dependencies["mail"].is_inited.return_value = False
        test_language = "en-US"
        test_email = "test@example.com"

        # Act: Execute the task
        send_change_mail_completed_notification_task(test_language, test_email)

        # Assert: Verify no email service calls
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()
        mock_external_service_dependencies["get_email_i18n_service"].assert_not_called()
        mock_external_service_dependencies["email_i18n_service"].send_email.assert_not_called()

    def test_send_change_mail_completed_notification_task_email_service_exception(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test change email completed notification task when email service raises an exception.

        This test verifies:
        - Exception is properly caught and logged
        - Task completes without raising exception
        """
        # Arrange: Setup email service to raise exception
        mock_external_service_dependencies["email_i18n_service"].send_email.side_effect = Exception(
            "Email service failed"
        )
        test_language = "en-US"
        test_email = "test@example.com"

        # Act: Execute the task (should not raise exception)
        send_change_mail_completed_notification_task(test_language, test_email)

        # Assert: Verify email service was called despite exception
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()
        mock_external_service_dependencies["get_email_i18n_service"].assert_called_once()
        mock_external_service_dependencies["email_i18n_service"].send_email.assert_called_once_with(
            email_type=EmailType.CHANGE_EMAIL_COMPLETED,
            language_code=test_language,
            to=test_email,
            template_context={
                "to": test_email,
                "email": test_email,
            },
        )
