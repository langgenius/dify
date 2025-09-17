"""
TestContainers-based integration tests for mail_register_task.py

This module provides integration tests for email registration tasks
using TestContainers to ensure real database and service interactions.
"""

from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from libs.email_i18n import EmailType
from tasks.mail_register_task import send_email_register_mail_task, send_email_register_mail_task_when_account_exist


class TestMailRegisterTask:
    """Integration tests for mail_register_task using testcontainers."""

    @pytest.fixture
    def mock_mail_dependencies(self):
        """Mock setup for mail service dependencies."""
        with (
            patch("tasks.mail_register_task.mail") as mock_mail,
            patch("tasks.mail_register_task.get_email_i18n_service") as mock_get_email_service,
        ):
            # Setup mock mail service
            mock_mail.is_inited.return_value = True

            # Setup mock email i18n service
            mock_email_service = MagicMock()
            mock_get_email_service.return_value = mock_email_service

            yield {
                "mail": mock_mail,
                "email_service": mock_email_service,
                "get_email_service": mock_get_email_service,
            }

    def test_send_email_register_mail_task_success(self, db_session_with_containers, mock_mail_dependencies):
        """Test successful email registration mail sending."""
        fake = Faker()
        language = "en-US"
        to_email = fake.email()
        code = fake.numerify("######")

        send_email_register_mail_task(language=language, to=to_email, code=code)

        mock_mail_dependencies["mail"].is_inited.assert_called_once()
        mock_mail_dependencies["email_service"].send_email.assert_called_once_with(
            email_type=EmailType.EMAIL_REGISTER,
            language_code=language,
            to=to_email,
            template_context={
                "to": to_email,
                "code": code,
            },
        )

    def test_send_email_register_mail_task_mail_not_initialized(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """Test email registration task when mail service is not initialized."""
        mock_mail_dependencies["mail"].is_inited.return_value = False

        send_email_register_mail_task(language="en-US", to="test@example.com", code="123456")

        mock_mail_dependencies["get_email_service"].assert_not_called()
        mock_mail_dependencies["email_service"].send_email.assert_not_called()

    def test_send_email_register_mail_task_exception_handling(self, db_session_with_containers, mock_mail_dependencies):
        """Test email registration task exception handling."""
        mock_mail_dependencies["email_service"].send_email.side_effect = Exception("Email service error")

        fake = Faker()
        to_email = fake.email()
        code = fake.numerify("######")

        with patch("tasks.mail_register_task.logger") as mock_logger:
            send_email_register_mail_task(language="en-US", to=to_email, code=code)
            mock_logger.exception.assert_called_once_with("Send email register mail to %s failed", to_email)

    def test_send_email_register_mail_task_when_account_exist_success(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """Test successful email registration mail sending when account exists."""
        fake = Faker()
        language = "en-US"
        to_email = fake.email()
        account_name = fake.name()

        with patch("tasks.mail_register_task.dify_config") as mock_config:
            mock_config.CONSOLE_WEB_URL = "https://console.dify.ai"

            send_email_register_mail_task_when_account_exist(language=language, to=to_email, account_name=account_name)

            mock_mail_dependencies["email_service"].send_email.assert_called_once_with(
                email_type=EmailType.EMAIL_REGISTER_WHEN_ACCOUNT_EXIST,
                language_code=language,
                to=to_email,
                template_context={
                    "to": to_email,
                    "login_url": "https://console.dify.ai/signin",
                    "reset_password_url": "https://console.dify.ai/reset-password",
                    "account_name": account_name,
                },
            )

    def test_send_email_register_mail_task_when_account_exist_mail_not_initialized(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """Test account exist email task when mail service is not initialized."""
        mock_mail_dependencies["mail"].is_inited.return_value = False

        send_email_register_mail_task_when_account_exist(
            language="en-US", to="test@example.com", account_name="Test User"
        )

        mock_mail_dependencies["get_email_service"].assert_not_called()
        mock_mail_dependencies["email_service"].send_email.assert_not_called()

    def test_send_email_register_mail_task_when_account_exist_exception_handling(
        self, db_session_with_containers, mock_mail_dependencies
    ):
        """Test account exist email task exception handling."""
        mock_mail_dependencies["email_service"].send_email.side_effect = Exception("Email service error")

        fake = Faker()
        to_email = fake.email()
        account_name = fake.name()

        with patch("tasks.mail_register_task.logger") as mock_logger:
            send_email_register_mail_task_when_account_exist(language="en-US", to=to_email, account_name=account_name)
            mock_logger.exception.assert_called_once_with("Send email register mail to %s failed", to_email)
