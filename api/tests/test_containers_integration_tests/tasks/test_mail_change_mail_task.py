from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from extensions.ext_database import db
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

    def test_send_change_mail_task_success_old_email_phase(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful change email task execution for old_email phase.

        This test verifies:
        - Proper mail service initialization check
        - Correct email service method call with old_email phase
        - Performance logging with latency measurement
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
        - Performance logging with latency measurement
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
        - No performance logging when mail is not initialized
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
        - Performance logging still occurs before exception
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

    def test_send_change_mail_task_different_languages(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test change email task with different language codes.

        This test verifies:
        - Proper handling of various language codes
        - Correct parameter passing to email service
        - Language-specific email processing
        """
        # Arrange: Test different language codes
        test_cases = [
            ("en-US", "old_email"),
            ("zh-Hans", "new_email"),
            ("fr-FR", "old_email"),  # Unsupported language should fallback
            ("es-ES", "new_email"),  # Unsupported language should fallback
        ]

        for language, phase in test_cases:
            # Reset mocks for each test case
            mock_external_service_dependencies["email_i18n_service"].reset_mock()
            mock_external_service_dependencies["get_email_i18n_service"].reset_mock()

            test_email = f"test_{language.replace('-', '_')}@example.com"
            test_code = "123456"

            # Act: Execute the task
            send_change_mail_task(language, test_email, test_code, phase)

            # Assert: Verify correct parameters passed
            mock_external_service_dependencies["email_i18n_service"].send_change_email.assert_called_once_with(
                language_code=language,
                to=test_email,
                code=test_code,
                phase=phase,
            )

    def test_send_change_mail_task_performance_logging(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test performance logging in change email task.

        This test verifies:
        - Performance timing is measured and logged
        - Logging includes latency information
        - Success and failure logging works correctly
        """
        # Arrange: Setup logging mock
        with patch("tasks.mail_change_mail_task.logger") as mock_logger:
            test_language = "en-US"
            test_email = "test@example.com"
            test_code = "123456"
            test_phase = "old_email"

            # Act: Execute the task
            send_change_mail_task(test_language, test_email, test_code, test_phase)

            # Assert: Verify logging calls
            assert mock_logger.info.call_count == 2  # Start and success messages
            start_log_call = mock_logger.info.call_args_list[0]
            success_log_call = mock_logger.info.call_args_list[1]

            # Verify start message
            assert "Start change email mail to" in str(start_log_call)
            assert test_email in str(start_log_call)

            # Verify success message with latency
            assert "Send change email mail to" in str(success_log_call)
            assert "succeeded: latency:" in str(success_log_call)
            assert test_email in str(success_log_call)

    def test_send_change_mail_completed_notification_task_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful change email completed notification task execution.

        This test verifies:
        - Proper mail service initialization check
        - Correct email service method call with CHANGE_EMAIL_COMPLETED type
        - Template context is properly constructed
        - Performance logging with latency measurement
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

    def test_send_change_mail_completed_notification_task_different_languages(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test change email completed notification task with different languages.

        This test verifies:
        - Proper handling of various language codes
        - Correct parameter passing to email service
        - Language-specific email processing
        """
        # Arrange: Test different language codes
        test_cases = [
            "en-US",
            "zh-Hans",
            "fr-FR",  # Unsupported language should fallback
            "es-ES",  # Unsupported language should fallback
        ]

        for language in test_cases:
            # Reset mocks for each test case
            mock_external_service_dependencies["email_i18n_service"].reset_mock()
            mock_external_service_dependencies["get_email_i18n_service"].reset_mock()

            test_email = f"test_{language.replace('-', '_')}@example.com"

            # Act: Execute the task
            send_change_mail_completed_notification_task(language, test_email)

            # Assert: Verify correct parameters passed
            mock_external_service_dependencies["email_i18n_service"].send_email.assert_called_once_with(
                email_type=EmailType.CHANGE_EMAIL_COMPLETED,
                language_code=language,
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
        - No performance logging when mail is not initialized
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
        - Performance logging still occurs before exception
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

    def test_send_change_mail_completed_notification_task_performance_logging(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test performance logging in change email completed notification task.

        This test verifies:
        - Performance timing is measured and logged
        - Logging includes latency information
        - Success and failure logging works correctly
        """
        # Arrange: Setup logging mock
        with patch("tasks.mail_change_mail_task.logger") as mock_logger:
            test_language = "en-US"
            test_email = "test@example.com"

            # Act: Execute the task
            send_change_mail_completed_notification_task(test_language, test_email)

            # Assert: Verify logging calls
            assert mock_logger.info.call_count == 2  # Start and success messages
            start_log_call = mock_logger.info.call_args_list[0]
            success_log_call = mock_logger.info.call_args_list[1]

            # Verify start message
            assert "Start change email completed notify mail to" in str(start_log_call)
            assert test_email in str(start_log_call)

            # Verify success message with latency
            assert "Send change email completed mail to" in str(success_log_call)
            assert "succeeded: latency:" in str(success_log_call)
            assert test_email in str(success_log_call)

    def test_send_change_mail_task_comprehensive_error_scenarios(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test comprehensive error scenarios for change email task.

        This test verifies:
        - Multiple types of exceptions are handled properly
        - Task completes without raising exceptions
        - Error logging occurs for all exception types
        - Performance logging still occurs before exceptions
        """
        # Arrange: Test different exception types
        test_exceptions = [
            ("Email service connection error", Exception("Connection failed")),
            ("Template rendering error", RuntimeError("Template rendering failed")),
            ("Memory error", MemoryError("Out of memory")),
            ("Value error", ValueError("Invalid email format")),
            ("Network error", ConnectionError("Network unreachable")),
        ]

        for error_name, exception in test_exceptions:
            # Reset mocks for each test case
            mock_external_service_dependencies["email_i18n_service"].reset_mock()
            mock_external_service_dependencies["get_email_i18n_service"].reset_mock()

            # Setup email service to raise specific exception
            mock_external_service_dependencies["email_i18n_service"].send_change_email.side_effect = exception

            test_language = "en-US"
            test_email = "test@example.com"
            test_code = "123456"
            test_phase = "old_email"

            # Act: Execute the task (should not raise exception)
            send_change_mail_task(test_language, test_email, test_code, test_phase)

            # Assert: Verify email service was called despite exception
            mock_external_service_dependencies["email_i18n_service"].send_change_email.assert_called_once_with(
                language_code=test_language,
                to=test_email,
                code=test_code,
                phase=test_phase,
            )

    def test_send_change_mail_completed_notification_task_comprehensive_error_scenarios(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test comprehensive error scenarios for change email completed notification task.

        This test verifies:
        - Multiple types of exceptions are handled properly
        - Task completes without raising exceptions
        - Error logging occurs for all exception types
        - Performance logging still occurs before exceptions
        """
        # Arrange: Test different exception types
        test_exceptions = [
            ("Email service connection error", Exception("Connection failed")),
            ("Template rendering error", RuntimeError("Template rendering failed")),
            ("Memory error", MemoryError("Out of memory")),
            ("Value error", ValueError("Invalid email format")),
            ("Network error", ConnectionError("Network unreachable")),
        ]

        for error_name, exception in test_exceptions:
            # Reset mocks for each test case
            mock_external_service_dependencies["email_i18n_service"].reset_mock()
            mock_external_service_dependencies["get_email_i18n_service"].reset_mock()

            # Setup email service to raise specific exception
            mock_external_service_dependencies["email_i18n_service"].send_email.side_effect = exception

            test_language = "en-US"
            test_email = "test@example.com"

            # Act: Execute the task (should not raise exception)
            send_change_mail_completed_notification_task(test_language, test_email)

            # Assert: Verify email service was called despite exception
            mock_external_service_dependencies["email_i18n_service"].send_email.assert_called_once_with(
                email_type=EmailType.CHANGE_EMAIL_COMPLETED,
                language_code=test_language,
                to=test_email,
                template_context={
                    "to": test_email,
                    "email": test_email,
                },
            )

    def test_send_change_mail_task_edge_cases(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test edge cases for change email task.

        This test verifies:
        - Empty string parameters are handled correctly
        - Special characters in email addresses
        - Very long verification codes
        - Unicode characters in parameters
        """
        # Arrange: Test edge cases
        edge_cases = [
            ("", "", "", ""),  # Empty strings
            ("test@example.com", "123456", "old_email", "en-US"),  # Normal case
            ("test+tag@example.com", "123456", "new_email", "zh-Hans"),  # Email with plus
            ("test.user@sub.domain.com", "123456", "old_email", "en-US"),  # Complex email
            ("测试@example.com", "123456", "new_email", "zh-Hans"),  # Unicode email
            ("test@example.com", "12345678901234567890", "old_email", "en-US"),  # Long code
            ("test@example.com", "123", "new_email", "en-US"),  # Short code
        ]

        for email, code, phase, language in edge_cases:
            # Reset mocks for each test case
            mock_external_service_dependencies["email_i18n_service"].reset_mock()
            mock_external_service_dependencies["get_email_i18n_service"].reset_mock()

            # Act: Execute the task
            send_change_mail_task(language, email, code, phase)

            # Assert: Verify email service was called with correct parameters
            mock_external_service_dependencies["email_i18n_service"].send_change_email.assert_called_once_with(
                language_code=language,
                to=email,
                code=code,
                phase=phase,
            )

    def test_send_change_mail_completed_notification_task_edge_cases(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test edge cases for change email completed notification task.

        This test verifies:
        - Empty string parameters are handled correctly
        - Special characters in email addresses
        - Unicode characters in parameters
        - Various language codes
        """
        # Arrange: Test edge cases
        edge_cases = [
            ("", ""),  # Empty strings
            ("test@example.com", "en-US"),  # Normal case
            ("test+tag@example.com", "zh-Hans"),  # Email with plus
            ("test.user@sub.domain.com", "en-US"),  # Complex email
            ("测试@example.com", "zh-Hans"),  # Unicode email
            ("test@example.com", "fr-FR"),  # Unsupported language
            ("test@example.com", "es-ES"),  # Unsupported language
        ]

        for email, language in edge_cases:
            # Reset mocks for each test case
            mock_external_service_dependencies["email_i18n_service"].reset_mock()
            mock_external_service_dependencies["get_email_i18n_service"].reset_mock()

            # Act: Execute the task
            send_change_mail_completed_notification_task(language, email)

            # Assert: Verify email service was called with correct parameters
            mock_external_service_dependencies["email_i18n_service"].send_email.assert_called_once_with(
                email_type=EmailType.CHANGE_EMAIL_COMPLETED,
                language_code=language,
                to=email,
                template_context={
                    "to": email,
                    "email": email,
                },
            )

    def test_send_change_mail_task_integration_with_real_database(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test change email task integration with real database using testcontainers.

        This test verifies:
        - Task works with real database connections
        - Database state is properly managed
        - Account data is correctly retrieved and used
        - Integration with actual database operations
        """
        # Arrange: Create real account in database
        account = self._create_test_account(db_session_with_containers)
        test_language = "en-US"
        test_code = "123456"
        test_phase = "old_email"

        # Act: Execute the task with real account email
        send_change_mail_task(test_language, account.email, test_code, test_phase)

        # Assert: Verify email service was called with real account data
        mock_external_service_dependencies["email_i18n_service"].send_change_email.assert_called_once_with(
            language_code=test_language,
            to=account.email,
            code=test_code,
            phase=test_phase,
        )

        # Verify database state is unchanged (account still exists)
        db.session.refresh(account)
        assert account.email is not None
        assert account.status == "active"

    def test_send_change_mail_completed_notification_task_integration_with_real_database(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test change email completed notification task integration with real database using testcontainers.

        This test verifies:
        - Task works with real database connections
        - Database state is properly managed
        - Account data is correctly retrieved and used
        - Integration with actual database operations
        """
        # Arrange: Create real account in database
        account = self._create_test_account(db_session_with_containers)
        test_language = "zh-Hans"

        # Act: Execute the task with real account email
        send_change_mail_completed_notification_task(test_language, account.email)

        # Assert: Verify email service was called with real account data
        mock_external_service_dependencies["email_i18n_service"].send_email.assert_called_once_with(
            email_type=EmailType.CHANGE_EMAIL_COMPLETED,
            language_code=test_language,
            to=account.email,
            template_context={
                "to": account.email,
                "email": account.email,
            },
        )

        # Verify database state is unchanged (account still exists)
        db.session.refresh(account)
        assert account.email is not None
        assert account.status == "active"
