"""
Unit tests for EmailI18nService

Tests the email internationalization service with mocked dependencies
following Domain-Driven Design principles.
"""

from typing import Any
from unittest.mock import MagicMock

import pytest

from libs.email_i18n import (
    EmailI18nConfig,
    EmailI18nService,
    EmailLanguage,
    EmailTemplate,
    EmailType,
    FlaskEmailRenderer,
    FlaskMailSender,
    create_default_email_config,
    get_email_i18n_service,
)
from services.feature_service import BrandingModel


class MockEmailRenderer:
    """Mock implementation of EmailRenderer protocol"""

    def __init__(self):
        self.rendered_templates: list[tuple[str, dict[str, Any]]] = []

    def render_template(self, template_path: str, **context: Any) -> str:
        """Mock render_template that returns a formatted string"""
        self.rendered_templates.append((template_path, context))
        return f"<html>Rendered {template_path} with {context}</html>"


class MockBrandingService:
    """Mock implementation of BrandingService protocol"""

    def __init__(self, enabled: bool = False, application_title: str = "Dify"):
        self.enabled = enabled
        self.application_title = application_title

    def get_branding_config(self) -> BrandingModel:
        """Return mock branding configuration"""
        branding_model = MagicMock(spec=BrandingModel)
        branding_model.enabled = self.enabled
        branding_model.application_title = self.application_title
        return branding_model


class MockEmailSender:
    """Mock implementation of EmailSender protocol"""

    def __init__(self):
        self.sent_emails: list[dict[str, str]] = []

    def send_email(self, to: str, subject: str, html_content: str):
        """Mock send_email that records sent emails"""
        self.sent_emails.append(
            {
                "to": to,
                "subject": subject,
                "html_content": html_content,
            }
        )


class TestEmailI18nService:
    """Test cases for EmailI18nService"""

    @pytest.fixture
    def email_config(self) -> EmailI18nConfig:
        """Create test email configuration"""
        return EmailI18nConfig(
            templates={
                EmailType.RESET_PASSWORD: {
                    EmailLanguage.EN_US: EmailTemplate(
                        subject="Reset Your {application_title} Password",
                        template_path="reset_password_en.html",
                        branded_template_path="branded/reset_password_en.html",
                    ),
                    EmailLanguage.ZH_HANS: EmailTemplate(
                        subject="重置您的 {application_title} 密码",
                        template_path="reset_password_zh.html",
                        branded_template_path="branded/reset_password_zh.html",
                    ),
                },
                EmailType.INVITE_MEMBER: {
                    EmailLanguage.EN_US: EmailTemplate(
                        subject="Join {application_title} Workspace",
                        template_path="invite_member_en.html",
                        branded_template_path="branded/invite_member_en.html",
                    ),
                },
            }
        )

    @pytest.fixture
    def mock_renderer(self) -> MockEmailRenderer:
        """Create mock email renderer"""
        return MockEmailRenderer()

    @pytest.fixture
    def mock_branding_service(self) -> MockBrandingService:
        """Create mock branding service"""
        return MockBrandingService()

    @pytest.fixture
    def mock_sender(self) -> MockEmailSender:
        """Create mock email sender"""
        return MockEmailSender()

    @pytest.fixture
    def email_service(
        self,
        email_config: EmailI18nConfig,
        mock_renderer: MockEmailRenderer,
        mock_branding_service: MockBrandingService,
        mock_sender: MockEmailSender,
    ) -> EmailI18nService:
        """Create EmailI18nService with mocked dependencies"""
        return EmailI18nService(
            config=email_config,
            renderer=mock_renderer,
            branding_service=mock_branding_service,
            sender=mock_sender,
        )

    def test_send_email_with_english_language(
        self,
        email_service: EmailI18nService,
        mock_renderer: MockEmailRenderer,
        mock_sender: MockEmailSender,
    ):
        """Test sending email with English language"""
        email_service.send_email(
            email_type=EmailType.RESET_PASSWORD,
            language_code="en-US",
            to="test@example.com",
            template_context={"reset_link": "https://example.com/reset"},
        )

        # Verify renderer was called with correct template
        assert len(mock_renderer.rendered_templates) == 1
        template_path, context = mock_renderer.rendered_templates[0]
        assert template_path == "reset_password_en.html"
        assert context["reset_link"] == "https://example.com/reset"
        assert context["branding_enabled"] is False
        assert context["application_title"] == "Dify"

        # Verify email was sent
        assert len(mock_sender.sent_emails) == 1
        sent_email = mock_sender.sent_emails[0]
        assert sent_email["to"] == "test@example.com"
        assert sent_email["subject"] == "Reset Your Dify Password"
        assert "reset_password_en.html" in sent_email["html_content"]

    def test_send_email_with_chinese_language(
        self,
        email_service: EmailI18nService,
        mock_sender: MockEmailSender,
    ):
        """Test sending email with Chinese language"""
        email_service.send_email(
            email_type=EmailType.RESET_PASSWORD,
            language_code="zh-Hans",
            to="test@example.com",
            template_context={"reset_link": "https://example.com/reset"},
        )

        # Verify email was sent with Chinese subject
        assert len(mock_sender.sent_emails) == 1
        sent_email = mock_sender.sent_emails[0]
        assert sent_email["subject"] == "重置您的 Dify 密码"

    def test_send_email_with_branding_enabled(
        self,
        email_config: EmailI18nConfig,
        mock_renderer: MockEmailRenderer,
        mock_sender: MockEmailSender,
    ):
        """Test sending email with branding enabled"""
        # Create branding service with branding enabled
        branding_service = MockBrandingService(enabled=True, application_title="MyApp")

        email_service = EmailI18nService(
            config=email_config,
            renderer=mock_renderer,
            branding_service=branding_service,
            sender=mock_sender,
        )

        email_service.send_email(
            email_type=EmailType.RESET_PASSWORD,
            language_code="en-US",
            to="test@example.com",
        )

        # Verify branded template was used
        assert len(mock_renderer.rendered_templates) == 1
        template_path, context = mock_renderer.rendered_templates[0]
        assert template_path == "branded/reset_password_en.html"
        assert context["branding_enabled"] is True
        assert context["application_title"] == "MyApp"

        # Verify subject includes custom application title
        assert len(mock_sender.sent_emails) == 1
        sent_email = mock_sender.sent_emails[0]
        assert sent_email["subject"] == "Reset Your MyApp Password"

    def test_send_email_with_language_fallback(
        self,
        email_service: EmailI18nService,
        mock_sender: MockEmailSender,
    ):
        """Test language fallback to English when requested language not available"""
        # Request invite member in Chinese (not configured)
        email_service.send_email(
            email_type=EmailType.INVITE_MEMBER,
            language_code="zh-Hans",
            to="test@example.com",
        )

        # Should fall back to English
        assert len(mock_sender.sent_emails) == 1
        sent_email = mock_sender.sent_emails[0]
        assert sent_email["subject"] == "Join Dify Workspace"

    def test_send_email_with_unknown_language_code(
        self,
        email_service: EmailI18nService,
        mock_sender: MockEmailSender,
    ):
        """Test unknown language code falls back to English"""
        email_service.send_email(
            email_type=EmailType.RESET_PASSWORD,
            language_code="fr-FR",  # French not configured
            to="test@example.com",
        )

        # Should use English
        assert len(mock_sender.sent_emails) == 1
        sent_email = mock_sender.sent_emails[0]
        assert sent_email["subject"] == "Reset Your Dify Password"

    def test_subject_format_keyerror_fallback_path(
        self,
        mock_renderer: MockEmailRenderer,
        mock_sender: MockEmailSender,
    ):
        """Trigger subject KeyError and cover except branch."""
        # Config with subject that references an unknown key (no {application_title} to avoid second format)
        config = EmailI18nConfig(
            templates={
                EmailType.INVITE_MEMBER: {
                    EmailLanguage.EN_US: EmailTemplate(
                        subject="Invite: {unknown_placeholder}",
                        template_path="invite_member_en.html",
                        branded_template_path="branded/invite_member_en.html",
                    ),
                }
            }
        )
        branding_service = MockBrandingService(enabled=False)
        service = EmailI18nService(
            config=config,
            renderer=mock_renderer,
            branding_service=branding_service,
            sender=mock_sender,
        )

        # Will raise KeyError on subject.format(**full_context), then hit except branch and skip fallback
        service.send_email(
            email_type=EmailType.INVITE_MEMBER,
            language_code="en-US",
            to="test@example.com",
        )

        assert len(mock_sender.sent_emails) == 1
        # Subject is left unformatted due to KeyError fallback path without application_title
        assert mock_sender.sent_emails[0]["subject"] == "Invite: {unknown_placeholder}"

    def test_send_change_email_old_phase(
        self,
        email_config: EmailI18nConfig,
        mock_renderer: MockEmailRenderer,
        mock_sender: MockEmailSender,
        mock_branding_service: MockBrandingService,
    ):
        """Test sending change email for old email verification"""
        # Add change email templates to config
        email_config.templates[EmailType.CHANGE_EMAIL_OLD] = {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Verify your current email",
                template_path="change_email_old_en.html",
                branded_template_path="branded/change_email_old_en.html",
            ),
        }

        email_service = EmailI18nService(
            config=email_config,
            renderer=mock_renderer,
            branding_service=mock_branding_service,
            sender=mock_sender,
        )

        email_service.send_change_email(
            language_code="en-US",
            to="old@example.com",
            code="123456",
            phase="old_email",
        )

        # Verify correct template and context
        assert len(mock_renderer.rendered_templates) == 1
        template_path, context = mock_renderer.rendered_templates[0]
        assert template_path == "change_email_old_en.html"
        assert context["to"] == "old@example.com"
        assert context["code"] == "123456"

    def test_send_change_email_new_phase(
        self,
        email_config: EmailI18nConfig,
        mock_renderer: MockEmailRenderer,
        mock_sender: MockEmailSender,
        mock_branding_service: MockBrandingService,
    ):
        """Test sending change email for new email verification"""
        # Add change email templates to config
        email_config.templates[EmailType.CHANGE_EMAIL_NEW] = {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Verify your new email",
                template_path="change_email_new_en.html",
                branded_template_path="branded/change_email_new_en.html",
            ),
        }

        email_service = EmailI18nService(
            config=email_config,
            renderer=mock_renderer,
            branding_service=mock_branding_service,
            sender=mock_sender,
        )

        email_service.send_change_email(
            language_code="en-US",
            to="new@example.com",
            code="654321",
            phase="new_email",
        )

        # Verify correct template and context
        assert len(mock_renderer.rendered_templates) == 1
        template_path, context = mock_renderer.rendered_templates[0]
        assert template_path == "change_email_new_en.html"
        assert context["to"] == "new@example.com"
        assert context["code"] == "654321"

    def test_send_change_email_invalid_phase(
        self,
        email_service: EmailI18nService,
    ):
        """Test sending change email with invalid phase raises error"""
        with pytest.raises(ValueError, match="Invalid phase: invalid_phase"):
            email_service.send_change_email(
                language_code="en-US",
                to="test@example.com",
                code="123456",
                phase="invalid_phase",
            )

    def test_send_raw_email_single_recipient(
        self,
        email_service: EmailI18nService,
        mock_sender: MockEmailSender,
    ):
        """Test sending raw email to single recipient"""
        email_service.send_raw_email(
            to="test@example.com",
            subject="Test Subject",
            html_content="<html>Test Content</html>",
        )

        assert len(mock_sender.sent_emails) == 1
        sent_email = mock_sender.sent_emails[0]
        assert sent_email["to"] == "test@example.com"
        assert sent_email["subject"] == "Test Subject"
        assert sent_email["html_content"] == "<html>Test Content</html>"

    def test_send_raw_email_multiple_recipients(
        self,
        email_service: EmailI18nService,
        mock_sender: MockEmailSender,
    ):
        """Test sending raw email to multiple recipients"""
        recipients = ["user1@example.com", "user2@example.com", "user3@example.com"]

        email_service.send_raw_email(
            to=recipients,
            subject="Test Subject",
            html_content="<html>Test Content</html>",
        )

        # Should send individual emails to each recipient
        assert len(mock_sender.sent_emails) == 3
        for i, recipient in enumerate(recipients):
            sent_email = mock_sender.sent_emails[i]
            assert sent_email["to"] == recipient
            assert sent_email["subject"] == "Test Subject"
            assert sent_email["html_content"] == "<html>Test Content</html>"

    def test_get_template_missing_email_type(
        self,
        email_config: EmailI18nConfig,
    ):
        """Test getting template for missing email type raises error"""
        with pytest.raises(ValueError, match="No templates configured for email type"):
            email_config.get_template(EmailType.EMAIL_CODE_LOGIN, EmailLanguage.EN_US)

    def test_get_template_missing_language_and_english(
        self,
        email_config: EmailI18nConfig,
    ):
        """Test error when neither requested language nor English fallback exists"""
        # Add template without English fallback
        email_config.templates[EmailType.EMAIL_CODE_LOGIN] = {
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="Test",
                template_path="test.html",
                branded_template_path="branded/test.html",
            ),
        }

        with pytest.raises(ValueError, match="No template found for"):
            # Request a language that doesn't exist and no English fallback
            email_config.get_template(EmailType.EMAIL_CODE_LOGIN, EmailLanguage.EN_US)

    def test_subject_templating_with_variables(
        self,
        email_config: EmailI18nConfig,
        mock_renderer: MockEmailRenderer,
        mock_sender: MockEmailSender,
        mock_branding_service: MockBrandingService,
    ):
        """Test subject templating with custom variables"""
        # Add template with variable in subject
        email_config.templates[EmailType.OWNER_TRANSFER_NEW_NOTIFY] = {
            EmailLanguage.EN_US: EmailTemplate(
                subject="You are now the owner of {WorkspaceName}",
                template_path="owner_transfer_en.html",
                branded_template_path="branded/owner_transfer_en.html",
            ),
        }

        email_service = EmailI18nService(
            config=email_config,
            renderer=mock_renderer,
            branding_service=mock_branding_service,
            sender=mock_sender,
        )

        email_service.send_email(
            email_type=EmailType.OWNER_TRANSFER_NEW_NOTIFY,
            language_code="en-US",
            to="test@example.com",
            template_context={"WorkspaceName": "My Workspace"},
        )

        # Verify subject was templated correctly
        assert len(mock_sender.sent_emails) == 1
        sent_email = mock_sender.sent_emails[0]
        assert sent_email["subject"] == "You are now the owner of My Workspace"

    def test_email_language_from_language_code(self):
        """Test EmailLanguage.from_language_code method"""
        assert EmailLanguage.from_language_code("zh-Hans") == EmailLanguage.ZH_HANS
        assert EmailLanguage.from_language_code("en-US") == EmailLanguage.EN_US
        assert EmailLanguage.from_language_code("fr-FR") == EmailLanguage.EN_US  # Fallback
        assert EmailLanguage.from_language_code("unknown") == EmailLanguage.EN_US  # Fallback


class TestEmailI18nIntegration:
    """Integration tests for email i18n components"""

    def test_create_default_email_config(self):
        """Test creating default email configuration"""
        config = create_default_email_config()

        # Verify key email types have at least English template
        expected_types = [
            EmailType.RESET_PASSWORD,
            EmailType.INVITE_MEMBER,
            EmailType.EMAIL_CODE_LOGIN,
            EmailType.CHANGE_EMAIL_OLD,
            EmailType.CHANGE_EMAIL_NEW,
            EmailType.OWNER_TRANSFER_CONFIRM,
            EmailType.OWNER_TRANSFER_OLD_NOTIFY,
            EmailType.OWNER_TRANSFER_NEW_NOTIFY,
            EmailType.ACCOUNT_DELETION_SUCCESS,
            EmailType.ACCOUNT_DELETION_VERIFICATION,
            EmailType.QUEUE_MONITOR_ALERT,
            EmailType.DOCUMENT_CLEAN_NOTIFY,
        ]

        for email_type in expected_types:
            assert email_type in config.templates
            assert EmailLanguage.EN_US in config.templates[email_type]

        # Verify some have Chinese translations
        assert EmailLanguage.ZH_HANS in config.templates[EmailType.RESET_PASSWORD]
        assert EmailLanguage.ZH_HANS in config.templates[EmailType.INVITE_MEMBER]

    def test_get_email_i18n_service(self):
        """Test getting global email i18n service instance"""
        service1 = get_email_i18n_service()
        service2 = get_email_i18n_service()

        # Should return the same instance
        assert service1 is service2

    def test_flask_email_renderer(self):
        """Test FlaskEmailRenderer implementation"""
        renderer = FlaskEmailRenderer()

        # Should raise TemplateNotFound when template doesn't exist
        from jinja2.exceptions import TemplateNotFound

        with pytest.raises(TemplateNotFound):
            renderer.render_template("test.html", foo="bar")

    def test_flask_mail_sender_not_initialized(self):
        """Test FlaskMailSender when mail is not initialized"""
        sender = FlaskMailSender()

        # Mock mail.is_inited() to return False
        import libs.email_i18n

        original_mail = libs.email_i18n.mail
        mock_mail = MagicMock()
        mock_mail.is_inited.return_value = False
        libs.email_i18n.mail = mock_mail

        try:
            # Should not send email when mail is not initialized
            sender.send_email("test@example.com", "Subject", "<html>Content</html>")
            mock_mail.send.assert_not_called()
        finally:
            # Restore original mail
            libs.email_i18n.mail = original_mail

    def test_flask_mail_sender_initialized(self):
        """Test FlaskMailSender when mail is initialized"""
        sender = FlaskMailSender()

        # Mock mail.is_inited() to return True
        import libs.email_i18n

        original_mail = libs.email_i18n.mail
        mock_mail = MagicMock()
        mock_mail.is_inited.return_value = True
        libs.email_i18n.mail = mock_mail

        try:
            # Should send email when mail is initialized
            sender.send_email("test@example.com", "Subject", "<html>Content</html>")
            mock_mail.send.assert_called_once_with(
                to="test@example.com",
                subject="Subject",
                html="<html>Content</html>",
            )
        finally:
            # Restore original mail
            libs.email_i18n.mail = original_mail
