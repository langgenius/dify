"""
Email Internationalization Module

This module provides a centralized, elegant way to handle email internationalization
in Dify. It follows Domain-Driven Design principles with proper type hints and
eliminates the need for repetitive language switching logic.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum, auto
from typing import Any, Protocol

from flask import render_template
from pydantic import BaseModel, Field

from extensions.ext_mail import mail
from services.feature_service import BrandingModel, FeatureService


class EmailType(StrEnum):
    """Enumeration of supported email types."""

    RESET_PASSWORD = auto()
    RESET_PASSWORD_WHEN_ACCOUNT_NOT_EXIST = auto()
    INVITE_MEMBER = auto()
    EMAIL_CODE_LOGIN = auto()
    CHANGE_EMAIL_OLD = auto()
    CHANGE_EMAIL_NEW = auto()
    CHANGE_EMAIL_COMPLETED = auto()
    OWNER_TRANSFER_CONFIRM = auto()
    OWNER_TRANSFER_OLD_NOTIFY = auto()
    OWNER_TRANSFER_NEW_NOTIFY = auto()
    ACCOUNT_DELETION_SUCCESS = auto()
    ACCOUNT_DELETION_VERIFICATION = auto()
    ENTERPRISE_CUSTOM = auto()
    QUEUE_MONITOR_ALERT = auto()
    DOCUMENT_CLEAN_NOTIFY = auto()
    EMAIL_REGISTER = auto()
    EMAIL_REGISTER_WHEN_ACCOUNT_EXIST = auto()
    RESET_PASSWORD_WHEN_ACCOUNT_NOT_EXIST_NO_REGISTER = auto()
    TRIGGER_EVENTS_LIMIT_SANDBOX = auto()
    TRIGGER_EVENTS_LIMIT_PROFESSIONAL = auto()
    TRIGGER_EVENTS_USAGE_WARNING_SANDBOX = auto()
    TRIGGER_EVENTS_USAGE_WARNING_PROFESSIONAL = auto()
    API_RATE_LIMIT_LIMIT_SANDBOX = auto()
    API_RATE_LIMIT_WARNING_SANDBOX = auto()


class EmailLanguage(StrEnum):
    """Supported email languages with fallback handling."""

    EN_US = "en-US"
    ZH_HANS = "zh-Hans"

    @classmethod
    def from_language_code(cls, language_code: str) -> EmailLanguage:
        """Convert a language code to EmailLanguage with fallback to English."""
        if language_code == "zh-Hans":
            return cls.ZH_HANS
        return cls.EN_US


@dataclass(frozen=True)
class EmailTemplate:
    """Immutable value object representing an email template configuration."""

    subject: str
    template_path: str
    branded_template_path: str


@dataclass(frozen=True)
class EmailContent:
    """Immutable value object containing rendered email content."""

    subject: str
    html_content: str
    template_context: dict[str, Any]


class EmailI18nConfig(BaseModel):
    """Configuration for email internationalization."""

    model_config = {"frozen": True, "extra": "forbid"}

    templates: dict[EmailType, dict[EmailLanguage, EmailTemplate]] = Field(
        default_factory=dict, description="Mapping of email types to language-specific templates"
    )

    def get_template(self, email_type: EmailType, language: EmailLanguage) -> EmailTemplate:
        """Get template configuration for specific email type and language."""
        type_templates = self.templates.get(email_type)
        if not type_templates:
            raise ValueError(f"No templates configured for email type: {email_type}")

        template = type_templates.get(language)
        if not template:
            # Fallback to English if specific language not found
            template = type_templates.get(EmailLanguage.EN_US)
            if not template:
                raise ValueError(f"No template found for {email_type} in {language} or English")

        return template


class EmailRenderer(Protocol):
    """Protocol for email template renderers."""

    def render_template(self, template_path: str, **context: Any) -> str:
        """Render email template with given context."""
        ...


class FlaskEmailRenderer:
    """Flask-based email template renderer."""

    def render_template(self, template_path: str, **context: Any) -> str:
        """Render email template using Flask's render_template."""
        return render_template(template_path, **context)


class BrandingService(Protocol):
    """Protocol for branding service abstraction."""

    def get_branding_config(self) -> BrandingModel:
        """Get current branding configuration."""
        ...


class FeatureBrandingService:
    """Feature service based branding implementation."""

    def get_branding_config(self) -> BrandingModel:
        """Get branding configuration from feature service."""
        return FeatureService.get_system_features().branding


class EmailSender(Protocol):
    """Protocol for email sending abstraction."""

    def send_email(self, to: str, subject: str, html_content: str):
        """Send email with given parameters."""
        ...


class FlaskMailSender:
    """Flask-Mail based email sender."""

    def send_email(self, to: str, subject: str, html_content: str):
        """Send email using Flask-Mail."""
        if mail.is_inited():
            mail.send(to=to, subject=subject, html=html_content)


class EmailI18nService:
    """
    Main service for internationalized email handling.

    This service provides a clean API for sending internationalized emails
    with proper branding support and template management.
    """

    def __init__(
        self,
        config: EmailI18nConfig,
        renderer: EmailRenderer,
        branding_service: BrandingService,
        sender: EmailSender,
    ):
        self._config = config
        self._renderer = renderer
        self._branding_service = branding_service
        self._sender = sender

    def send_email(
        self,
        email_type: EmailType,
        language_code: str,
        to: str,
        template_context: dict[str, Any] | None = None,
    ):
        """
        Send internationalized email with branding support.

        Args:
            email_type: Type of email to send
            language_code: Target language code
            to: Recipient email address
            template_context: Additional context for template rendering
        """
        if template_context is None:
            template_context = {}

        language = EmailLanguage.from_language_code(language_code)
        email_content = self._render_email_content(email_type, language, template_context)

        self._sender.send_email(to=to, subject=email_content.subject, html_content=email_content.html_content)

    def send_change_email(
        self,
        language_code: str,
        to: str,
        code: str,
        phase: str,
    ):
        """
        Send change email notification with phase-specific handling.

        Args:
            language_code: Target language code
            to: Recipient email address
            code: Verification code
            phase: Either 'old_email' or 'new_email'
        """
        if phase == "old_email":
            email_type = EmailType.CHANGE_EMAIL_OLD
        elif phase == "new_email":
            email_type = EmailType.CHANGE_EMAIL_NEW
        else:
            raise ValueError(f"Invalid phase: {phase}. Must be 'old_email' or 'new_email'")

        self.send_email(
            email_type=email_type,
            language_code=language_code,
            to=to,
            template_context={
                "to": to,
                "code": code,
            },
        )

    def send_raw_email(
        self,
        to: str | list[str],
        subject: str,
        html_content: str,
    ):
        """
        Send a raw email directly without template processing.

        This method is provided for backward compatibility with legacy email
        sending that uses pre-rendered HTML content (e.g., enterprise emails
        with custom templates).

        Args:
            to: Recipient email address(es)
            subject: Email subject
            html_content: Pre-rendered HTML content
        """
        if isinstance(to, list):
            for recipient in to:
                self._sender.send_email(to=recipient, subject=subject, html_content=html_content)
        else:
            self._sender.send_email(to=to, subject=subject, html_content=html_content)

    def _render_email_content(
        self,
        email_type: EmailType,
        language: EmailLanguage,
        template_context: dict[str, Any],
    ) -> EmailContent:
        """Render email content with branding and internationalization."""
        template_config = self._config.get_template(email_type, language)
        branding = self._branding_service.get_branding_config()

        # Determine template path based on branding
        template_path = template_config.branded_template_path if branding.enabled else template_config.template_path

        # Prepare template context with branding information
        full_context = {
            **template_context,
            "branding_enabled": branding.enabled,
            "application_title": branding.application_title if branding.enabled else "Dify",
        }

        # Render template
        html_content = self._renderer.render_template(template_path, **full_context)

        # Apply templating to subject with all context variables
        subject = template_config.subject
        try:
            subject = subject.format(**full_context)
        except KeyError:
            # If template variables are missing, fall back to basic formatting
            if branding.enabled and "{application_title}" in subject:
                subject = subject.format(application_title=branding.application_title)

        return EmailContent(
            subject=subject,
            html_content=html_content,
            template_context=full_context,
        )


def create_default_email_config() -> EmailI18nConfig:
    """Create default email i18n configuration with all supported templates."""
    templates: dict[EmailType, dict[EmailLanguage, EmailTemplate]] = {
        EmailType.RESET_PASSWORD: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Set Your {application_title} Password",
                template_path="reset_password_mail_template_en-US.html",
                branded_template_path="without-brand/reset_password_mail_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="设置您的 {application_title} 密码",
                template_path="reset_password_mail_template_zh-CN.html",
                branded_template_path="without-brand/reset_password_mail_template_zh-CN.html",
            ),
        },
        EmailType.INVITE_MEMBER: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Join {application_title} Workspace Now",
                template_path="invite_member_mail_template_en-US.html",
                branded_template_path="without-brand/invite_member_mail_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="立即加入 {application_title} 工作空间",
                template_path="invite_member_mail_template_zh-CN.html",
                branded_template_path="without-brand/invite_member_mail_template_zh-CN.html",
            ),
        },
        EmailType.EMAIL_CODE_LOGIN: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="{application_title} Login Code",
                template_path="email_code_login_mail_template_en-US.html",
                branded_template_path="without-brand/email_code_login_mail_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="{application_title} 登录验证码",
                template_path="email_code_login_mail_template_zh-CN.html",
                branded_template_path="without-brand/email_code_login_mail_template_zh-CN.html",
            ),
        },
        EmailType.CHANGE_EMAIL_OLD: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Check your current email",
                template_path="change_mail_confirm_old_template_en-US.html",
                branded_template_path="without-brand/change_mail_confirm_old_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="检测您现在的邮箱",
                template_path="change_mail_confirm_old_template_zh-CN.html",
                branded_template_path="without-brand/change_mail_confirm_old_template_zh-CN.html",
            ),
        },
        EmailType.CHANGE_EMAIL_NEW: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Confirm your new email address",
                template_path="change_mail_confirm_new_template_en-US.html",
                branded_template_path="without-brand/change_mail_confirm_new_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="确认您的邮箱地址变更",
                template_path="change_mail_confirm_new_template_zh-CN.html",
                branded_template_path="without-brand/change_mail_confirm_new_template_zh-CN.html",
            ),
        },
        EmailType.CHANGE_EMAIL_COMPLETED: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Your login email has been changed",
                template_path="change_mail_completed_template_en-US.html",
                branded_template_path="without-brand/change_mail_completed_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="您的登录邮箱已更改",
                template_path="change_mail_completed_template_zh-CN.html",
                branded_template_path="without-brand/change_mail_completed_template_zh-CN.html",
            ),
        },
        EmailType.OWNER_TRANSFER_CONFIRM: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Verify Your Request to Transfer Workspace Ownership",
                template_path="transfer_workspace_owner_confirm_template_en-US.html",
                branded_template_path="without-brand/transfer_workspace_owner_confirm_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="验证您转移工作空间所有权的请求",
                template_path="transfer_workspace_owner_confirm_template_zh-CN.html",
                branded_template_path="without-brand/transfer_workspace_owner_confirm_template_zh-CN.html",
            ),
        },
        EmailType.OWNER_TRANSFER_OLD_NOTIFY: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Workspace ownership has been transferred",
                template_path="transfer_workspace_old_owner_notify_template_en-US.html",
                branded_template_path="without-brand/transfer_workspace_old_owner_notify_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="工作区所有权已转移",
                template_path="transfer_workspace_old_owner_notify_template_zh-CN.html",
                branded_template_path="without-brand/transfer_workspace_old_owner_notify_template_zh-CN.html",
            ),
        },
        EmailType.OWNER_TRANSFER_NEW_NOTIFY: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="You are now the owner of {WorkspaceName}",
                template_path="transfer_workspace_new_owner_notify_template_en-US.html",
                branded_template_path="without-brand/transfer_workspace_new_owner_notify_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="您现在是 {WorkspaceName} 的所有者",
                template_path="transfer_workspace_new_owner_notify_template_zh-CN.html",
                branded_template_path="without-brand/transfer_workspace_new_owner_notify_template_zh-CN.html",
            ),
        },
        EmailType.ACCOUNT_DELETION_SUCCESS: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Your Dify.AI Account Has Been Successfully Deleted",
                template_path="delete_account_success_template_en-US.html",
                branded_template_path="delete_account_success_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="您的 Dify.AI 账户已成功删除",
                template_path="delete_account_success_template_zh-CN.html",
                branded_template_path="delete_account_success_template_zh-CN.html",
            ),
        },
        EmailType.ACCOUNT_DELETION_VERIFICATION: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Dify.AI Account Deletion and Verification",
                template_path="delete_account_code_email_template_en-US.html",
                branded_template_path="delete_account_code_email_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="Dify.AI 账户删除和验证",
                template_path="delete_account_code_email_template_zh-CN.html",
                branded_template_path="delete_account_code_email_template_zh-CN.html",
            ),
        },
        EmailType.QUEUE_MONITOR_ALERT: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Alert: Dataset Queue pending tasks exceeded the limit",
                template_path="queue_monitor_alert_email_template_en-US.html",
                branded_template_path="queue_monitor_alert_email_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="警报：数据集队列待处理任务超过限制",
                template_path="queue_monitor_alert_email_template_zh-CN.html",
                branded_template_path="queue_monitor_alert_email_template_zh-CN.html",
            ),
        },
        EmailType.DOCUMENT_CLEAN_NOTIFY: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Dify Knowledge base auto disable notification",
                template_path="clean_document_job_mail_template-US.html",
                branded_template_path="clean_document_job_mail_template-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="Dify 知识库自动禁用通知",
                template_path="clean_document_job_mail_template_zh-CN.html",
                branded_template_path="clean_document_job_mail_template_zh-CN.html",
            ),
        },
        EmailType.TRIGGER_EVENTS_LIMIT_SANDBOX: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="You’ve reached your Sandbox Trigger Events limit",
                template_path="trigger_events_limit_template_en-US.html",
                branded_template_path="without-brand/trigger_events_limit_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="您的 Sandbox 触发事件额度已用尽",
                template_path="trigger_events_limit_template_zh-CN.html",
                branded_template_path="without-brand/trigger_events_limit_template_zh-CN.html",
            ),
        },
        EmailType.TRIGGER_EVENTS_LIMIT_PROFESSIONAL: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="You’ve reached your monthly Trigger Events limit",
                template_path="trigger_events_limit_template_en-US.html",
                branded_template_path="without-brand/trigger_events_limit_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="您的月度触发事件额度已用尽",
                template_path="trigger_events_limit_template_zh-CN.html",
                branded_template_path="without-brand/trigger_events_limit_template_zh-CN.html",
            ),
        },
        EmailType.TRIGGER_EVENTS_USAGE_WARNING_SANDBOX: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="You’re nearing your Sandbox Trigger Events limit",
                template_path="trigger_events_usage_warning_template_en-US.html",
                branded_template_path="without-brand/trigger_events_usage_warning_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="您的 Sandbox 触发事件额度接近上限",
                template_path="trigger_events_usage_warning_template_zh-CN.html",
                branded_template_path="without-brand/trigger_events_usage_warning_template_zh-CN.html",
            ),
        },
        EmailType.TRIGGER_EVENTS_USAGE_WARNING_PROFESSIONAL: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="You’re nearing your Monthly Trigger Events limit",
                template_path="trigger_events_usage_warning_template_en-US.html",
                branded_template_path="without-brand/trigger_events_usage_warning_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="您的月度触发事件额度接近上限",
                template_path="trigger_events_usage_warning_template_zh-CN.html",
                branded_template_path="without-brand/trigger_events_usage_warning_template_zh-CN.html",
            ),
        },
        EmailType.API_RATE_LIMIT_LIMIT_SANDBOX: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="You’ve reached your API Rate Limit",
                template_path="api_rate_limit_limit_template_en-US.html",
                branded_template_path="without-brand/api_rate_limit_limit_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="您的 API 速率额度已用尽",
                template_path="api_rate_limit_limit_template_zh-CN.html",
                branded_template_path="without-brand/api_rate_limit_limit_template_zh-CN.html",
            ),
        },
        EmailType.API_RATE_LIMIT_WARNING_SANDBOX: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="You’re nearing your API Rate Limit",
                template_path="api_rate_limit_warning_template_en-US.html",
                branded_template_path="without-brand/api_rate_limit_warning_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="您的 API 速率额度接近上限",
                template_path="api_rate_limit_warning_template_zh-CN.html",
                branded_template_path="without-brand/api_rate_limit_warning_template_zh-CN.html",
            ),
        },
        EmailType.EMAIL_REGISTER: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Register Your {application_title} Account",
                template_path="register_email_template_en-US.html",
                branded_template_path="without-brand/register_email_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="注册您的 {application_title} 账户",
                template_path="register_email_template_zh-CN.html",
                branded_template_path="without-brand/register_email_template_zh-CN.html",
            ),
        },
        EmailType.EMAIL_REGISTER_WHEN_ACCOUNT_EXIST: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Register Your {application_title} Account",
                template_path="register_email_when_account_exist_template_en-US.html",
                branded_template_path="without-brand/register_email_when_account_exist_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="注册您的 {application_title} 账户",
                template_path="register_email_when_account_exist_template_zh-CN.html",
                branded_template_path="without-brand/register_email_when_account_exist_template_zh-CN.html",
            ),
        },
        EmailType.RESET_PASSWORD_WHEN_ACCOUNT_NOT_EXIST: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Reset Your {application_title} Password",
                template_path="reset_password_mail_when_account_not_exist_template_en-US.html",
                branded_template_path="without-brand/reset_password_mail_when_account_not_exist_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="重置您的 {application_title} 密码",
                template_path="reset_password_mail_when_account_not_exist_template_zh-CN.html",
                branded_template_path="without-brand/reset_password_mail_when_account_not_exist_template_zh-CN.html",
            ),
        },
        EmailType.RESET_PASSWORD_WHEN_ACCOUNT_NOT_EXIST_NO_REGISTER: {
            EmailLanguage.EN_US: EmailTemplate(
                subject="Reset Your {application_title} Password",
                template_path="reset_password_mail_when_account_not_exist_no_register_template_en-US.html",
                branded_template_path="without-brand/reset_password_mail_when_account_not_exist_no_register_template_en-US.html",
            ),
            EmailLanguage.ZH_HANS: EmailTemplate(
                subject="重置您的 {application_title} 密码",
                template_path="reset_password_mail_when_account_not_exist_no_register_template_zh-CN.html",
                branded_template_path="without-brand/reset_password_mail_when_account_not_exist_no_register_template_zh-CN.html",
            ),
        },
    }

    return EmailI18nConfig(templates=templates)


# Singleton instance for application-wide use
def get_default_email_i18n_service() -> EmailI18nService:
    """Get configured email i18n service with default dependencies."""
    config = create_default_email_config()
    renderer = FlaskEmailRenderer()
    branding_service = FeatureBrandingService()
    sender = FlaskMailSender()

    return EmailI18nService(
        config=config,
        renderer=renderer,
        branding_service=branding_service,
        sender=sender,
    )


# Global instance
_email_i18n_service: EmailI18nService | None = None


def get_email_i18n_service() -> EmailI18nService:
    """Get global email i18n service instance."""
    global _email_i18n_service
    if _email_i18n_service is None:
        _email_i18n_service = get_default_email_i18n_service()
    return _email_i18n_service
