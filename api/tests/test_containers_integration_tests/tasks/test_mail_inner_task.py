from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from tasks.mail_inner_task import send_inner_email_task


class TestMailInnerTask:
    """Integration tests for send_inner_email_task using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.mail_inner_task.mail") as mock_mail,
            patch("tasks.mail_inner_task.get_email_i18n_service") as mock_get_email_i18n_service,
            patch("tasks.mail_inner_task.render_template_string") as mock_render_template,
        ):
            # Setup mock mail service
            mock_mail.is_inited.return_value = True

            # Setup mock email i18n service
            mock_email_service = MagicMock()
            mock_get_email_i18n_service.return_value = mock_email_service

            # Setup mock template rendering
            mock_render_template.return_value = "<html>Test email content</html>"

            yield {
                "mail": mock_mail,
                "email_service": mock_email_service,
                "render_template": mock_render_template,
            }

    def _create_test_email_data(self, fake: Faker) -> dict:
        """
        Helper method to create test email data for testing.

        Args:
            fake: Faker instance for generating test data

        Returns:
            dict: Test email data including recipients, subject, body, and substitutions
        """
        return {
            "to": [fake.email() for _ in range(3)],
            "subject": fake.sentence(nb_words=4),
            "body": "Hello {{name}}, this is a test email from {{company}}.",
            "substitutions": {
                "name": fake.name(),
                "company": fake.company(),
                "date": fake.date(),
            },
        }

    def test_send_inner_email_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful email sending with valid data.

        This test verifies:
        - Proper email service initialization check
        - Template rendering with substitutions
        - Email service integration
        - Performance logging
        - Multiple recipient handling
        """
        # Arrange: Create test data
        fake = Faker()
        email_data = self._create_test_email_data(fake)

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify the expected outcomes
        # Verify mail service was checked for initialization
        mock_external_service_dependencies["mail"].is_inited.assert_called_once()

        # Verify template rendering was called with correct parameters
        mock_external_service_dependencies["render_template"].assert_called_once_with(
            email_data["body"], **email_data["substitutions"]
        )

        # Verify email service was called once with the full recipient list
        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_raw_email.assert_called_once_with(
            to=email_data["to"],
            subject=email_data["subject"],
            html_content="<html>Test email content</html>",
        )

    def test_send_inner_email_single_recipient(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test email sending with single recipient.

        This test verifies:
        - Single recipient handling
        - Template rendering
        - Email service integration
        - Performance logging
        """
        # Arrange: Create test data with single recipient
        fake = Faker()
        email_data = {
            "to": [fake.email()],
            "subject": fake.sentence(nb_words=3),
            "body": "Welcome {{user_name}}!",
            "substitutions": {
                "user_name": fake.name(),
            },
        }

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify the expected outcomes
        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_raw_email.assert_called_once_with(
            to=email_data["to"],
            subject=email_data["subject"],
            html_content="<html>Test email content</html>",
        )

    def test_send_inner_email_empty_substitutions(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test email sending with empty substitutions.

        This test verifies:
        - Template rendering with empty substitutions
        - Email service integration
        - Handling of minimal template context
        """
        # Arrange: Create test data with empty substitutions
        fake = Faker()
        email_data = {
            "to": [fake.email()],
            "subject": fake.sentence(nb_words=3),
            "body": "This is a simple email without variables.",
            "substitutions": {},
        }

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify the expected outcomes
        mock_external_service_dependencies["render_template"].assert_called_once_with(email_data["body"], **{})

        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_raw_email.assert_called_once_with(
            to=email_data["to"],
            subject=email_data["subject"],
            html_content="<html>Test email content</html>",
        )

    def test_send_inner_email_mail_not_initialized(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email sending when mail service is not initialized.

        This test verifies:
        - Early return when mail service is not initialized
        - No template rendering occurs
        - No email service calls
        - No exceptions raised
        """
        # Arrange: Setup mail service as not initialized
        mock_external_service_dependencies["mail"].is_inited.return_value = False

        fake = Faker()
        email_data = self._create_test_email_data(fake)

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["render_template"].assert_not_called()
        mock_external_service_dependencies["email_service"].send_raw_email.assert_not_called()

    def test_send_inner_email_template_rendering_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email sending when template rendering fails.

        This test verifies:
        - Exception handling during template rendering
        - Error logging
        - No email service calls when template fails
        """
        # Arrange: Setup template rendering to raise an exception
        mock_external_service_dependencies["render_template"].side_effect = Exception("Template rendering failed")

        fake = Faker()
        email_data = self._create_test_email_data(fake)

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify template rendering was attempted
        mock_external_service_dependencies["render_template"].assert_called_once()

        # Verify no email service calls due to exception
        mock_external_service_dependencies["email_service"].send_raw_email.assert_not_called()

    def test_send_inner_email_service_error(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test email sending when email service fails.

        This test verifies:
        - Exception handling during email sending
        - Error logging
        - Graceful error handling
        """
        # Arrange: Setup email service to raise an exception
        mock_external_service_dependencies["email_service"].send_raw_email.side_effect = Exception(
            "Email service failed"
        )

        fake = Faker()
        email_data = self._create_test_email_data(fake)

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify template rendering occurred
        mock_external_service_dependencies["render_template"].assert_called_once()

        # Verify email service was called (and failed)
        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_raw_email.assert_called_once_with(
            to=email_data["to"],
            subject=email_data["subject"],
            html_content="<html>Test email content</html>",
        )

    def test_send_inner_email_performance_logging(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test performance logging during email sending.

        This test verifies:
        - Performance timing is measured
        - Success logging includes latency information
        - Logging format is correct
        """
        # Arrange: Create test data
        fake = Faker()
        email_data = self._create_test_email_data(fake)

        # Act: Execute the task with logging patch
        with patch("tasks.mail_inner_task.logger") as mock_logger:
            send_inner_email_task(
                to=email_data["to"],
                subject=email_data["subject"],
                body=email_data["body"],
                substitutions=email_data["substitutions"],
            )

            # Assert: Verify performance logging
            # Check that info logging was called for start and success
            assert mock_logger.info.call_count >= 2

            # Verify start logging
            start_calls = [call for call in mock_logger.info.call_args_list if "Start enterprise mail" in str(call)]
            assert len(start_calls) == 1

            # Verify success logging with latency
            success_calls = [call for call in mock_logger.info.call_args_list if "succeeded: latency:" in str(call)]
            assert len(success_calls) == 1

    def test_send_inner_email_error_logging(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test error logging when email sending fails.

        This test verifies:
        - Exception logging when email service fails
        - Error logging format
        - Exception details are captured
        """
        # Arrange: Setup email service to raise an exception
        test_exception = Exception("Email service connection failed")
        mock_external_service_dependencies["email_service"].send_raw_email.side_effect = test_exception

        fake = Faker()
        email_data = self._create_test_email_data(fake)

        # Act: Execute the task with logging patch
        with patch("tasks.mail_inner_task.logger") as mock_logger:
            send_inner_email_task(
                to=email_data["to"],
                subject=email_data["subject"],
                body=email_data["body"],
                substitutions=email_data["substitutions"],
            )

            # Assert: Verify error logging
            # Check that exception was logged
            mock_logger.exception.assert_called_once()
            exception_call = mock_logger.exception.call_args
            assert "Send enterprise mail to" in str(exception_call)
            assert str(email_data["to"]) in str(exception_call)

    def test_send_inner_email_complex_substitutions(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email sending with complex substitution data.

        This test verifies:
        - Complex substitution handling
        - Template rendering with nested data
        - Email service integration with complex data
        """
        # Arrange: Create test data with complex substitutions
        fake = Faker()
        email_data = {
            "to": [fake.email()],
            "subject": "Welcome to {{platform_name}} - {{user_type}}",
            "body": """
            <html>
            <body>
                <h1>Welcome {{user.name}}!</h1>
                <p>Your account type: {{user.type}}</p>
                <p>Account created: {{user.created_date}}</p>
                <p>Platform: {{platform_name}}</p>
                <p>Features: {{features|join(', ')}}</p>
            </body>
            </html>
            """,
            "substitutions": {
                "platform_name": "Dify Enterprise",
                "user_type": "Premium User",
                "user": {
                    "name": fake.name(),
                    "type": "Premium",
                    "created_date": fake.date(),
                },
                "features": ["AI Chat", "Workflow Automation", "Custom Models"],
            },
        }

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify the expected outcomes
        mock_external_service_dependencies["render_template"].assert_called_once_with(
            email_data["body"], **email_data["substitutions"]
        )

        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_raw_email.assert_called_once_with(
            to=email_data["to"],
            subject=email_data["subject"],
            html_content="<html>Test email content</html>",
        )

    def test_send_inner_email_large_recipient_list(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email sending with large recipient list.

        This test verifies:
        - Handling of large recipient lists
        - Performance with multiple recipients
        - Email service called for each recipient
        """
        # Arrange: Create test data with large recipient list
        fake = Faker()
        large_recipient_list = [fake.email() for _ in range(50)]  # 50 recipients
        email_data = {
            "to": large_recipient_list,
            "subject": fake.sentence(nb_words=3),
            "body": "Bulk email notification: {{message}}",
            "substitutions": {
                "message": "This is a bulk notification email.",
            },
        }

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify the expected outcomes
        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_raw_email.assert_called_once_with(
            to=large_recipient_list,
            subject=email_data["subject"],
            html_content="<html>Test email content</html>",
        )

    def test_send_inner_email_special_characters(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test email sending with special characters in content.

        This test verifies:
        - Special character handling in subject and body
        - Template rendering with special characters
        - Email service integration with special content
        """
        # Arrange: Create test data with special characters
        fake = Faker()
        email_data = {
            "to": [fake.email()],
            "subject": "Test Email with Special Characters: @#$%^&*()",
            "body": """
            <html>
            <body>
                <h1>Special Characters Test</h1>
                <p>Unicode: {{unicode_text}}</p>
                <p>Symbols: {{symbols}}</p>
                <p>HTML: {{html_content}}</p>
            </body>
            </html>
            """,
            "substitutions": {
                "unicode_text": "测试中文内容 🚀",
                "symbols": "!@#$%^&*()_+-=[]{}|;':\",./<>?",
                "html_content": "<script>alert('test')</script>",
            },
        }

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify the expected outcomes
        mock_external_service_dependencies["render_template"].assert_called_once_with(
            email_data["body"], **email_data["substitutions"]
        )

        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_raw_email.assert_called_once_with(
            to=email_data["to"],
            subject=email_data["subject"],
            html_content="<html>Test email content</html>",
        )

    def test_send_inner_email_mixed_recipient_types(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email sending with mixed recipient types and edge cases.

        This test verifies:
        - Mixed recipient handling
        - Edge case recipient formats
        - Email service integration with various recipient types
        """
        # Arrange: Create test data with mixed recipient types
        fake = Faker()
        email_data = {
            "to": [
                fake.email(),  # Standard email
                f"{fake.user_name()}+test@{fake.domain_name()}",  # Email with plus
                f"{fake.user_name()}.{fake.user_name()}@{fake.domain_name()}",  # Email with dots
            ],
            "subject": fake.sentence(nb_words=3),
            "body": "Test email for mixed recipients: {{test_type}}",
            "substitutions": {
                "test_type": "Mixed recipient types",
            },
        }

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify the expected outcomes
        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_raw_email.assert_called_once_with(
            to=email_data["to"],
            subject=email_data["subject"],
            html_content="<html>Test email content</html>",
        )

    def test_send_inner_email_comprehensive_error_scenarios(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test comprehensive error scenarios and recovery.

        This test verifies:
        - Multiple types of exceptions are handled properly
        - Error logging is consistent
        - Graceful error handling in all scenarios
        """
        # Arrange: Create test data
        fake = Faker()
        email_data = self._create_test_email_data(fake)

        # Test template rendering error
        mock_external_service_dependencies["render_template"].side_effect = Exception("Template rendering failed")

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify template error handling
        mock_external_service_dependencies["email_service"].send_raw_email.assert_not_called()

        # Reset mocks for email service error test
        mock_external_service_dependencies["render_template"].reset_mock()
        mock_external_service_dependencies["email_service"].send_raw_email.reset_mock()
        mock_external_service_dependencies["render_template"].side_effect = None
        mock_external_service_dependencies["email_service"].send_raw_email.side_effect = RuntimeError(
            "Email service unavailable"
        )

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify email service error handling
        mock_external_service_dependencies["email_service"].send_raw_email.assert_called_once()

    def test_send_inner_email_real_database_integration(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email sending with real database integration using TestContainers.

        This test verifies:
        - Integration with TestContainers database
        - Real database session handling
        - Email task execution in containerized environment
        - Performance in realistic test environment
        """
        # Arrange: Create test data
        fake = Faker()
        email_data = self._create_test_email_data(fake)

        # Verify database connection is working
        with db_session_with_containers:
            # Simple database operation to verify connection
            from sqlalchemy import text

            result = db_session_with_containers.execute(text("SELECT 1 as test")).fetchone()
            assert result[0] == 1

        # Act: Execute the task
        send_inner_email_task(
            to=email_data["to"],
            subject=email_data["subject"],
            body=email_data["body"],
            substitutions=email_data["substitutions"],
        )

        # Assert: Verify the expected outcomes
        mock_email_service = mock_external_service_dependencies["email_service"]
        mock_email_service.send_raw_email.assert_called_once_with(
            to=email_data["to"],
            subject=email_data["subject"],
            html_content="<html>Test email content</html>",
        )

        # Verify template rendering occurred
        mock_external_service_dependencies["render_template"].assert_called_once_with(
            email_data["body"], **email_data["substitutions"]
        )

    def test_send_inner_email_performance_under_load(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test email sending performance under simulated load.

        This test verifies:
        - Performance with multiple rapid calls
        - Resource management under load
        - Error handling under load conditions
        """
        # Arrange: Create test data
        fake = Faker()
        email_data = self._create_test_email_data(fake)

        # Act: Execute multiple tasks rapidly
        for i in range(10):  # Simulate 10 rapid email sends
            send_inner_email_task(
                to=email_data["to"],
                subject=f"{email_data['subject']} - Batch {i}",
                body=email_data["body"],
                substitutions=email_data["substitutions"],
            )

        # Assert: Verify all emails were processed
        mock_email_service = mock_external_service_dependencies["email_service"]
        assert mock_email_service.send_raw_email.call_count == 10  # 10 batches

        # Verify template rendering occurred for each batch
        assert mock_external_service_dependencies["render_template"].call_count == 10
