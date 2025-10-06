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
            patch("tasks.mail_inner_task._render_template_with_strategy") as mock_render_template,
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
            email_data["body"], email_data["substitutions"]
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
        mock_external_service_dependencies["render_template"].assert_called_once_with(email_data["body"], {})

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
