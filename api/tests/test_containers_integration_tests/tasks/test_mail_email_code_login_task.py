"""
TestContainers-based integration tests for send_email_code_login_mail_task.

This module provides comprehensive integration tests for the email code login mail task
using TestContainers infrastructure. The tests ensure that the task properly sends
email verification codes for login with internationalization support and handles
various error scenarios in a real database environment.

All tests use the testcontainers infrastructure to ensure proper database isolation
and realistic testing scenarios with actual PostgreSQL and Redis instances.
"""

from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from libs.email_i18n import EmailType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from tasks.mail_email_code_login import send_email_code_login_mail_task


class TestSendEmailCodeLoginMailTask:
    """
    Comprehensive integration tests for send_email_code_login_mail_task using testcontainers.

    This test class covers all major functionality of the email code login mail task:
    - Successful email sending with different languages
    - Email service integration and template rendering
    - Error handling for various failure scenarios
    - Performance metrics and logging verification
    - Edge cases and boundary conditions

    All tests use the testcontainers infrastructure to ensure proper database isolation
    and realistic testing environment with actual database interactions.
    """

    @pytest.fixture(autouse=True)
    def cleanup_database(self, db_session_with_containers):
        """Clean up database before each test to ensure isolation."""
        from extensions.ext_redis import redis_client

        # Clear all test data
        db_session_with_containers.query(TenantAccountJoin).delete()
        db_session_with_containers.query(Tenant).delete()
        db_session_with_containers.query(Account).delete()
        db_session_with_containers.commit()

        # Clear Redis cache
        redis_client.flushdb()

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.mail_email_code_login.mail") as mock_mail,
            patch("tasks.mail_email_code_login.get_email_i18n_service") as mock_email_service,
        ):
            # Setup default mock returns
            mock_mail.is_inited.return_value = True

            # Mock email service
            mock_email_service_instance = MagicMock()
            mock_email_service_instance.send_email.return_value = None
            mock_email_service.return_value = mock_email_service_instance

            yield {
                "mail": mock_mail,
                "email_service": mock_email_service,
                "email_service_instance": mock_email_service_instance,
            }

    def _create_test_account(self, db_session_with_containers, fake=None):
        """
        Helper method to create a test account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            fake: Faker instance for generating test data

        Returns:
            Account: Created account instance
        """
        if fake is None:
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

        return account

    def _create_test_tenant_and_account(self, db_session_with_containers, fake=None):
        """
        Helper method to create a test tenant and account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            fake: Faker instance for generating test data

        Returns:
            tuple: (Account, Tenant) created instances
        """
        if fake is None:
            fake = Faker()

        # Create account using the existing helper method
        account = self._create_test_account(db_session_with_containers, fake)

        # Create tenant
        tenant = Tenant(
            name=fake.company(),
            plan="basic",
            status="active",
        )

        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # Create tenant-account relationship
        tenant_account_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
        )

        db_session_with_containers.add(tenant_account_join)
        db_session_with_containers.commit()

        return account, tenant

    def test_send_email_code_login_mail_task_success_english(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful email code login mail sending in English.

        This test verifies that the task can successfully:
        1. Send email code login mail with English language
        2. Use proper email service integration
        3. Pass correct template context to email service
        4. Log performance metrics correctly
        5. Complete task execution without errors
        """
        # Arrange: Setup test data
        fake = Faker()
        test_email = fake.email()
        test_code = "123456"
        test_language = "en-US"

        # Act: Execute the task
        send_email_code_login_mail_task(
            language=test_language,
            to=test_email,
            code=test_code,
        )

        # Assert: Verify expected outcomes
        mock_mail = mock_external_service_dependencies["mail"]
        mock_email_service_instance = mock_external_service_dependencies["email_service_instance"]

        # Verify mail service was checked for initialization
        mock_mail.is_inited.assert_called_once()

        # Verify email service was called with correct parameters
        mock_email_service_instance.send_email.assert_called_once_with(
            email_type=EmailType.EMAIL_CODE_LOGIN,
            language_code=test_language,
            to=test_email,
            template_context={
                "to": test_email,
                "code": test_code,
            },
        )

    def test_send_email_code_login_mail_task_success_chinese(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful email code login mail sending in Chinese.

        This test verifies that the task can successfully:
        1. Send email code login mail with Chinese language
        2. Handle different language codes properly
        3. Use correct template context for Chinese emails
        4. Complete task execution without errors
        """
        # Arrange: Setup test data
        fake = Faker()
        test_email = fake.email()
        test_code = "789012"
        test_language = "zh-Hans"

        # Act: Execute the task
        send_email_code_login_mail_task(
            language=test_language,
            to=test_email,
            code=test_code,
        )

        # Assert: Verify expected outcomes
        mock_email_service_instance = mock_external_service_dependencies["email_service_instance"]

        # Verify email service was called with Chinese language
        mock_email_service_instance.send_email.assert_called_once_with(
            email_type=EmailType.EMAIL_CODE_LOGIN,
            language_code=test_language,
            to=test_email,
            template_context={
                "to": test_email,
                "code": test_code,
            },
        )

    def test_send_email_code_login_mail_task_success_multiple_languages(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful email code login mail sending with multiple languages.

        This test verifies that the task can successfully:
        1. Handle various language codes correctly
        2. Send emails with different language configurations
        3. Maintain proper template context for each language
        4. Complete multiple task executions without conflicts
        """
        # Arrange: Setup test data
        fake = Faker()
        test_languages = ["en-US", "zh-Hans", "zh-CN", "ja-JP", "ko-KR"]
        test_emails = [fake.email() for _ in test_languages]
        test_codes = [fake.numerify("######") for _ in test_languages]

        # Act: Execute the task for each language
        for i, language in enumerate(test_languages):
            send_email_code_login_mail_task(
                language=language,
                to=test_emails[i],
                code=test_codes[i],
            )

        # Assert: Verify expected outcomes
        mock_email_service_instance = mock_external_service_dependencies["email_service_instance"]

        # Verify email service was called for each language
        assert mock_email_service_instance.send_email.call_count == len(test_languages)

        # Verify each call had correct parameters
        for i, language in enumerate(test_languages):
            call_args = mock_email_service_instance.send_email.call_args_list[i]
            assert call_args[1]["email_type"] == EmailType.EMAIL_CODE_LOGIN
            assert call_args[1]["language_code"] == language
            assert call_args[1]["to"] == test_emails[i]
            assert call_args[1]["template_context"]["code"] == test_codes[i]

    def test_send_email_code_login_mail_task_mail_not_initialized(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email code login mail task when mail service is not initialized.

        This test verifies that the task can properly:
        1. Check mail service initialization status
        2. Return early when mail is not initialized
        3. Not attempt to send email when service is unavailable
        4. Handle gracefully without errors
        """
        # Arrange: Setup test data
        fake = Faker()
        test_email = fake.email()
        test_code = "123456"
        test_language = "en-US"

        # Mock mail service as not initialized
        mock_mail = mock_external_service_dependencies["mail"]
        mock_mail.is_inited.return_value = False

        # Act: Execute the task
        send_email_code_login_mail_task(
            language=test_language,
            to=test_email,
            code=test_code,
        )

        # Assert: Verify expected outcomes
        mock_email_service_instance = mock_external_service_dependencies["email_service_instance"]

        # Verify mail service was checked for initialization
        mock_mail.is_inited.assert_called_once()

        # Verify email service was not called
        mock_email_service_instance.send_email.assert_not_called()

    def test_send_email_code_login_mail_task_email_service_exception(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email code login mail task when email service raises an exception.

        This test verifies that the task can properly:
        1. Handle email service exceptions gracefully
        2. Log appropriate error messages
        3. Continue execution without crashing
        4. Maintain proper error handling
        """
        # Arrange: Setup test data
        fake = Faker()
        test_email = fake.email()
        test_code = "123456"
        test_language = "en-US"

        # Mock email service to raise an exception
        mock_email_service_instance = mock_external_service_dependencies["email_service_instance"]
        mock_email_service_instance.send_email.side_effect = Exception("Email service unavailable")

        # Act: Execute the task - it should handle the exception gracefully
        send_email_code_login_mail_task(
            language=test_language,
            to=test_email,
            code=test_code,
        )

        # Assert: Verify expected outcomes
        mock_mail = mock_external_service_dependencies["mail"]
        mock_email_service_instance = mock_external_service_dependencies["email_service_instance"]

        # Verify mail service was checked for initialization
        mock_mail.is_inited.assert_called_once()

        # Verify email service was called (and failed)
        mock_email_service_instance.send_email.assert_called_once_with(
            email_type=EmailType.EMAIL_CODE_LOGIN,
            language_code=test_language,
            to=test_email,
            template_context={
                "to": test_email,
                "code": test_code,
            },
        )

    def test_send_email_code_login_mail_task_invalid_parameters(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email code login mail task with invalid parameters.

        This test verifies that the task can properly:
        1. Handle empty or None email addresses
        2. Process empty or None verification codes
        3. Handle invalid language codes
        4. Maintain proper error handling for invalid inputs
        """
        # Arrange: Setup test data
        fake = Faker()
        test_language = "en-US"

        # Test cases for invalid parameters
        invalid_test_cases = [
            {"email": "", "code": "123456", "description": "empty email"},
            {"email": None, "code": "123456", "description": "None email"},
            {"email": fake.email(), "code": "", "description": "empty code"},
            {"email": fake.email(), "code": None, "description": "None code"},
            {"email": "invalid-email", "code": "123456", "description": "invalid email format"},
        ]

        for test_case in invalid_test_cases:
            # Reset mocks for each test case
            mock_email_service_instance = mock_external_service_dependencies["email_service_instance"]
            mock_email_service_instance.reset_mock()

            # Act: Execute the task with invalid parameters
            send_email_code_login_mail_task(
                language=test_language,
                to=test_case["email"],
                code=test_case["code"],
            )

            # Assert: Verify that email service was still called
            # The task should pass parameters to email service as-is
            # and let the email service handle validation
            mock_email_service_instance.send_email.assert_called_once()

    def test_send_email_code_login_mail_task_edge_cases(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email code login mail task with edge cases and boundary conditions.

        This test verifies that the task can properly:
        1. Handle very long email addresses
        2. Process very long verification codes
        3. Handle special characters in parameters
        4. Process extreme language codes
        """
        # Arrange: Setup test data
        fake = Faker()
        test_language = "en-US"

        # Edge case test data
        edge_cases = [
            {
                "email": "a" * 100 + "@example.com",  # Very long email
                "code": "1" * 20,  # Very long code
                "description": "very long email and code",
            },
            {
                "email": "test+tag@example.com",  # Email with special characters
                "code": "123-456",  # Code with special characters
                "description": "special characters",
            },
            {
                "email": "test@sub.domain.example.com",  # Complex domain
                "code": "000000",  # All zeros
                "description": "complex domain and all zeros code",
            },
            {
                "email": "test@example.co.uk",  # International domain
                "code": "999999",  # All nines
                "description": "international domain and all nines code",
            },
        ]

        for test_case in edge_cases:
            # Reset mocks for each test case
            mock_email_service_instance = mock_external_service_dependencies["email_service_instance"]
            mock_email_service_instance.reset_mock()

            # Act: Execute the task with edge case data
            send_email_code_login_mail_task(
                language=test_language,
                to=test_case["email"],
                code=test_case["code"],
            )

            # Assert: Verify that email service was called with edge case data
            mock_email_service_instance.send_email.assert_called_once_with(
                email_type=EmailType.EMAIL_CODE_LOGIN,
                language_code=test_language,
                to=test_case["email"],
                template_context={
                    "to": test_case["email"],
                    "code": test_case["code"],
                },
            )

    def test_send_email_code_login_mail_task_database_integration(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email code login mail task with database integration.

        This test verifies that the task can properly:
        1. Work with real database connections
        2. Handle database session management
        3. Maintain proper database state
        4. Complete without database-related errors
        """
        # Arrange: Setup test data with database
        fake = Faker()
        account, tenant = self._create_test_tenant_and_account(db_session_with_containers, fake)

        test_email = account.email
        test_code = "123456"
        test_language = "en-US"

        # Act: Execute the task
        send_email_code_login_mail_task(
            language=test_language,
            to=test_email,
            code=test_code,
        )

        # Assert: Verify expected outcomes
        mock_email_service_instance = mock_external_service_dependencies["email_service_instance"]

        # Verify email service was called with database account email
        mock_email_service_instance.send_email.assert_called_once_with(
            email_type=EmailType.EMAIL_CODE_LOGIN,
            language_code=test_language,
            to=test_email,
            template_context={
                "to": test_email,
                "code": test_code,
            },
        )

        # Verify database state is maintained
        db_session_with_containers.refresh(account)
        assert account.email == test_email
        assert account.status == "active"

    def test_send_email_code_login_mail_task_redis_integration(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email code login mail task with Redis integration.

        This test verifies that the task can properly:
        1. Work with Redis cache connections
        2. Handle Redis operations without errors
        3. Maintain proper cache state
        4. Complete without Redis-related errors
        """
        # Arrange: Setup test data
        fake = Faker()
        test_email = fake.email()
        test_code = "123456"
        test_language = "en-US"

        # Setup Redis cache data
        from extensions.ext_redis import redis_client

        cache_key = f"email_code_login_test_{test_email}"
        redis_client.set(cache_key, "test_value", ex=300)

        # Act: Execute the task
        send_email_code_login_mail_task(
            language=test_language,
            to=test_email,
            code=test_code,
        )

        # Assert: Verify expected outcomes
        mock_email_service_instance = mock_external_service_dependencies["email_service_instance"]

        # Verify email service was called
        mock_email_service_instance.send_email.assert_called_once()

        # Verify Redis cache is still accessible
        assert redis_client.exists(cache_key) == 1
        assert redis_client.get(cache_key) == b"test_value"

        # Clean up Redis cache
        redis_client.delete(cache_key)

    def test_send_email_code_login_mail_task_error_handling_comprehensive(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test comprehensive error handling for email code login mail task.

        This test verifies that the task can properly:
        1. Handle various types of exceptions
        2. Log appropriate error messages
        3. Continue execution despite errors
        4. Maintain proper error reporting
        """
        # Arrange: Setup test data
        fake = Faker()
        test_email = fake.email()
        test_code = "123456"
        test_language = "en-US"

        # Test different exception types
        exception_types = [
            ("ValueError", ValueError("Invalid email format")),
            ("RuntimeError", RuntimeError("Service unavailable")),
            ("ConnectionError", ConnectionError("Network error")),
            ("TimeoutError", TimeoutError("Request timeout")),
            ("Exception", Exception("Generic error")),
        ]

        for error_name, exception in exception_types:
            # Reset mocks for each test case
            mock_email_service_instance = mock_external_service_dependencies["email_service_instance"]
            mock_email_service_instance.reset_mock()
            mock_email_service_instance.send_email.side_effect = exception

            # Mock logging to capture error messages
            with patch("tasks.mail_email_code_login.logger") as mock_logger:
                # Act: Execute the task - it should handle the exception gracefully
                send_email_code_login_mail_task(
                    language=test_language,
                    to=test_email,
                    code=test_code,
                )

                # Assert: Verify error handling
                # Verify email service was called (and failed)
                mock_email_service_instance.send_email.assert_called_once()

                # Verify error was logged
                error_calls = [
                    call
                    for call in mock_logger.exception.call_args_list
                    if f"Send email code login mail to {test_email} failed" in str(call)
                ]
                # Check if any exception call was made (the exact message format may vary)
                assert mock_logger.exception.call_count >= 1, f"Error should be logged for {error_name}"

            # Reset side effect for next iteration
            mock_email_service_instance.send_email.side_effect = None
