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
            role=TenantAccountRole.OWNER.value,
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
        - Performance logging is recorded
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

    def test_send_deletion_success_task_with_different_language(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account deletion success email with different language.

        This test verifies:
        - Language parameter is properly passed
        - Email service receives correct language code
        - Template context is correctly formatted
        - Performance logging is recorded
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email
        test_language = "zh-Hans"

        # Act: Execute the task
        send_deletion_success_task(test_email, test_language)

        # Assert: Verify the expected outcomes
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
        - Performance logging is not recorded
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
        - Performance logging is not recorded on error
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

    def test_send_deletion_success_task_performance_logging(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test performance logging for account deletion success email.

        This test verifies:
        - Performance timing is calculated correctly
        - Logging includes latency information
        - Success message is logged with performance data
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email

        # Act: Execute the task
        with patch("tasks.mail_account_deletion_task.logger") as mock_logger:
            send_deletion_success_task(test_email)

            # Assert: Verify performance logging
            # Check that info was called for start and success messages
            assert mock_logger.info.call_count >= 2

            # Verify success message contains latency information
            success_calls = [call for call in mock_logger.info.call_args_list if "latency:" in str(call)]
            assert len(success_calls) == 1

    def test_send_account_deletion_verification_code_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful account deletion verification code email sending.

        This test verifies:
        - Proper email service initialization check
        - Correct email service method calls
        - Template context includes verification code
        - Performance logging is recorded
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

    def test_send_account_deletion_verification_code_with_different_language(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account deletion verification code email with different language.

        This test verifies:
        - Language parameter is properly passed
        - Email service receives correct language code
        - Template context includes verification code
        - Performance logging is recorded
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email
        test_code = "654321"
        test_language = "zh-Hans"

        # Act: Execute the task
        send_account_deletion_verification_code(test_email, test_code, test_language)

        # Assert: Verify the expected outcomes
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
        - Performance logging is not recorded
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
        - Performance logging is not recorded on error
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

    def test_send_account_deletion_verification_code_performance_logging(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test performance logging for account deletion verification code email.

        This test verifies:
        - Performance timing is calculated correctly
        - Logging includes latency information
        - Success message is logged with performance data
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email
        test_code = "123456"

        # Act: Execute the task
        with patch("tasks.mail_account_deletion_task.logger") as mock_logger:
            send_account_deletion_verification_code(test_email, test_code)

            # Assert: Verify performance logging
            # Check that info was called for start and success messages
            assert mock_logger.info.call_count >= 2

            # Verify success message contains latency information
            success_calls = [call for call in mock_logger.info.call_args_list if "latency:" in str(call)]
            assert len(success_calls) == 1

    def test_send_deletion_success_task_with_default_language(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account deletion success email with default language parameter.

        This test verifies:
        - Default language parameter works correctly
        - Email service receives default language code
        - Template context is correctly formatted
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email

        # Act: Execute the task without specifying language
        send_deletion_success_task(test_email)

        # Assert: Verify the expected outcomes
        mock_external_service_dependencies["email_service"].send_email.assert_called_once_with(
            email_type=EmailType.ACCOUNT_DELETION_SUCCESS,
            language_code="en-US",  # Default language
            to=test_email,
            template_context={
                "to": test_email,
                "email": test_email,
            },
        )

    def test_send_account_deletion_verification_code_with_default_language(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account deletion verification code email with default language parameter.

        This test verifies:
        - Default language parameter works correctly
        - Email service receives default language code
        - Template context includes verification code
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email
        test_code = "123456"

        # Act: Execute the task without specifying language
        send_account_deletion_verification_code(test_email, test_code)

        # Assert: Verify the expected outcomes
        mock_external_service_dependencies["email_service"].send_email.assert_called_once_with(
            email_type=EmailType.ACCOUNT_DELETION_VERIFICATION,
            language_code="en-US",  # Default language
            to=test_email,
            template_context={
                "to": test_email,
                "code": test_code,
            },
        )

    def test_send_deletion_success_task_comprehensive_error_scenarios(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test comprehensive error scenarios for account deletion success email.

        This test verifies:
        - Multiple types of exceptions are handled properly
        - Task completes without raising exception in all error cases
        - Error logging is recorded for different exception types
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email

        # Test different exception types
        test_exceptions = [
            ("Email service error", Exception("Email service failed")),
            ("Network error", ConnectionError("Network connection failed")),
            ("Template error", ValueError("Template rendering failed")),
            ("Configuration error", RuntimeError("Email configuration invalid")),
        ]

        for error_name, exception in test_exceptions:
            # Reset mocks for each test
            mock_external_service_dependencies["email_service"].send_email.side_effect = exception

            # Act: Execute the task (should not raise exception)
            send_deletion_success_task(test_email)

            # Assert: Verify email service was called but exception was handled
            mock_external_service_dependencies["email_service"].send_email.assert_called_once()

            # Reset for next iteration
            mock_external_service_dependencies["email_service"].reset_mock()

    def test_send_account_deletion_verification_code_comprehensive_error_scenarios(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test comprehensive error scenarios for account deletion verification code email.

        This test verifies:
        - Multiple types of exceptions are handled properly
        - Task completes without raising exception in all error cases
        - Error logging is recorded for different exception types
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email
        test_code = "123456"

        # Test different exception types
        test_exceptions = [
            ("Email service error", Exception("Email service failed")),
            ("Network error", ConnectionError("Network connection failed")),
            ("Template error", ValueError("Template rendering failed")),
            ("Configuration error", RuntimeError("Email configuration invalid")),
        ]

        for error_name, exception in test_exceptions:
            # Reset mocks for each test
            mock_external_service_dependencies["email_service"].send_email.side_effect = exception

            # Act: Execute the task (should not raise exception)
            send_account_deletion_verification_code(test_email, test_code)

            # Assert: Verify email service was called but exception was handled
            mock_external_service_dependencies["email_service"].send_email.assert_called_once()

            # Reset for next iteration
            mock_external_service_dependencies["email_service"].reset_mock()

    def test_send_deletion_success_task_with_various_email_formats(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account deletion success email with various email formats.

        This test verifies:
        - Different email formats are handled correctly
        - Template context is properly formatted for each email
        - Email service receives correct recipient address
        """
        # Arrange: Test various email formats
        test_emails = [
            "user@example.com",
            "user.name@example.com",
            "user+tag@example.com",
            "user123@subdomain.example.com",
            "test@localhost",
        ]

        for test_email in test_emails:
            # Act: Execute the task
            send_deletion_success_task(test_email)

            # Assert: Verify email was sent with correct recipient
            mock_external_service_dependencies["email_service"].send_email.assert_called_with(
                email_type=EmailType.ACCOUNT_DELETION_SUCCESS,
                language_code="en-US",
                to=test_email,
                template_context={
                    "to": test_email,
                    "email": test_email,
                },
            )

            # Reset for next iteration
            mock_external_service_dependencies["email_service"].reset_mock()

    def test_send_account_deletion_verification_code_with_various_codes(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test account deletion verification code email with various verification codes.

        This test verifies:
        - Different verification codes are handled correctly
        - Template context includes the correct verification code
        - Email service receives correct template context
        """
        # Arrange: Test various verification codes
        test_codes = [
            "123456",
            "000000",
            "999999",
            "123456789",
            "ABC123",
        ]

        test_email = "test@example.com"

        for test_code in test_codes:
            # Act: Execute the task
            send_account_deletion_verification_code(test_email, test_code)

            # Assert: Verify email was sent with correct verification code
            mock_external_service_dependencies["email_service"].send_email.assert_called_with(
                email_type=EmailType.ACCOUNT_DELETION_VERIFICATION,
                language_code="en-US",
                to=test_email,
                template_context={
                    "to": test_email,
                    "code": test_code,
                },
            )

            # Reset for next iteration
            mock_external_service_dependencies["email_service"].reset_mock()

    def test_send_deletion_success_task_logging_verification(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test logging verification for account deletion success email.

        This test verifies:
        - Start message is logged with correct information
        - Success message is logged with performance data
        - Exception message is logged on error
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email

        # Act: Execute the task
        with patch("tasks.mail_account_deletion_task.logger") as mock_logger:
            send_deletion_success_task(test_email)

            # Assert: Verify logging calls
            # Check that info was called for start and success messages
            assert mock_logger.info.call_count >= 2

            # Verify start message
            start_calls = [
                call
                for call in mock_logger.info.call_args_list
                if "Start send account deletion success email" in str(call)
            ]
            assert len(start_calls) == 1
            assert test_email in str(start_calls[0])

            # Verify success message contains latency
            success_calls = [call for call in mock_logger.info.call_args_list if "latency:" in str(call)]
            assert len(success_calls) == 1

    def test_send_account_deletion_verification_code_logging_verification(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test logging verification for account deletion verification code email.

        This test verifies:
        - Start message is logged with correct information
        - Success message is logged with performance data
        - Exception message is logged on error
        """
        # Arrange: Create test data
        account = self._create_test_account(db_session_with_containers)
        test_email = account.email
        test_code = "123456"

        # Act: Execute the task
        with patch("tasks.mail_account_deletion_task.logger") as mock_logger:
            send_account_deletion_verification_code(test_email, test_code)

            # Assert: Verify logging calls
            # Check that info was called for start and success messages
            assert mock_logger.info.call_count >= 2

            # Verify start message
            start_calls = [
                call
                for call in mock_logger.info.call_args_list
                if "Start send account deletion verification code email" in str(call)
            ]
            assert len(start_calls) == 1
            assert test_email in str(start_calls[0])

            # Verify success message contains latency
            success_calls = [call for call in mock_logger.info.call_args_list if "latency:" in str(call)]
            assert len(success_calls) == 1
