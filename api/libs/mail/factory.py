"""
Factory for creating mail sender instances based on configuration.

This module provides a factory that automatically selects and configures
the appropriate mail sender implementation based on the provided configuration.
"""

from collections.abc import Callable
from typing import Any, Optional, Union

from configs.app_config import DifyConfig

from .exceptions import MailConfigError
from .protocol import MailSender


class MailSenderFactory:
    """
    Factory for creating mail sender instances.

    This factory automatically selects the appropriate mail sender implementation
    based on the mail type and authentication method specified in the configuration.
    """

    _senders: dict[str, Union[type[MailSender], Callable[..., MailSender]]] = {}

    @classmethod
    def register_sender(cls, mail_type: str, sender_class: Union[type[MailSender], Callable[..., MailSender]]) -> None:
        """
        Register a mail sender implementation.

        Args:
            mail_type: The mail type identifier (e.g., 'smtp', 'sendgrid')
            sender_class: The mail sender class or factory function to register
        """
        cls._senders[mail_type] = sender_class

    @classmethod
    def create_sender(cls, mail_type: str, config: dict) -> MailSender:
        """
        Create a mail sender instance based on configuration.

        Args:
            mail_type: The type of mail sender to create
            config: Configuration dictionary for the mail sender

        Returns:
            Configured mail sender instance

        Raises:
            MailConfigError: If the mail type is not supported or configuration is invalid
        """
        if mail_type not in cls._senders:
            raise MailConfigError(f"Unsupported mail type: {mail_type}")

        sender_factory = cls._senders[mail_type]

        try:
            # Handle both class constructors and factory functions
            if callable(sender_factory):
                return sender_factory(**config)
            else:
                return sender_factory(**config)
        except TypeError as e:
            raise MailConfigError(f"Invalid configuration for {mail_type}: {e}")

    @classmethod
    def get_supported_types(cls) -> list[str]:
        """
        Get list of supported mail types.

        Returns:
            List of supported mail type identifiers
        """
        return list(cls._senders.keys())

    @classmethod
    def create_from_dify_config(cls, dify_config: DifyConfig) -> Optional[MailSender]:
        """
        Create a mail sender from Dify configuration object.

        Args:
            dify_config: Dify configuration object

        Returns:
            Configured mail sender instance or None if mail is not configured

        Raises:
            MailConfigError: If configuration is invalid
        """
        mail_type = dify_config.MAIL_TYPE
        if not mail_type:
            return None

        # Build configuration based on mail type
        config: dict[str, Any] = {"default_from": dify_config.MAIL_DEFAULT_SEND_FROM}

        if mail_type == "smtp":
            config.update(
                {
                    "server": dify_config.SMTP_SERVER,
                    "port": dify_config.SMTP_PORT,
                    "username": dify_config.SMTP_USERNAME,
                    "password": dify_config.SMTP_PASSWORD,
                    "use_tls": dify_config.SMTP_USE_TLS,
                    "opportunistic_tls": dify_config.SMTP_OPPORTUNISTIC_TLS,
                    "auth_type": dify_config.SMTP_AUTH_TYPE,
                    "client_id": dify_config.SMTP_CLIENT_ID,
                    "client_secret": dify_config.SMTP_CLIENT_SECRET,
                    "tenant_id": dify_config.SMTP_TENANT_ID,
                    "oauth2_provider": dify_config.SMTP_OAUTH2_PROVIDER,
                }
            )
        elif mail_type == "resend":
            config.update(
                {
                    "api_key": dify_config.RESEND_API_KEY,
                    "api_url": dify_config.RESEND_API_URL,
                }
            )
        elif mail_type == "sendgrid":
            config.update(
                {
                    "api_key": dify_config.SENDGRID_API_KEY,
                }
            )

        return cls.create_sender(mail_type, config)


# Register all available mail senders
def _register_default_senders():
    """Register all default mail sender implementations."""
    from .resend_sender import ResendSender
    from .sendgrid_sender import SendGridSender
    from .smtp_sender import SMTPSender

    MailSenderFactory.register_sender("smtp", SMTPSender)
    MailSenderFactory.register_sender("resend", ResendSender)
    MailSenderFactory.register_sender("sendgrid", SendGridSender)


# Auto-register senders when module is imported
_register_default_senders()
