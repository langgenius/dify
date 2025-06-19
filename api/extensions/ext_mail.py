import logging
from typing import Optional

from flask import Flask

from configs import dify_config
from dify_app import DifyApp
from libs.mail import MailConfigError, MailMessage, MailSender, MailSenderFactory


class Mail:
    def __init__(self):
        self._sender: Optional[MailSender] = None

    def is_inited(self) -> bool:
        return self._sender is not None

    def init_app(self, app: Flask) -> None:
        """Initialize mail sender using the new factory pattern."""
        try:
            self._sender = MailSenderFactory.create_from_dify_config(dify_config)
            if self._sender:
                logging.info("Mail sender initialized successfully")
            else:
                logging.warning("MAIL_TYPE is not set, mail functionality disabled")
        except MailConfigError as e:
            logging.exception("Failed to initialize mail sender")
            raise ValueError(f"Mail configuration error: {e}")
        except Exception as e:
            logging.exception("Unexpected error initializing mail sender")
            raise ValueError(f"Failed to initialize mail sender: {e}")

    def send(self, to: str, subject: str, html: str, from_: Optional[str] = None):
        """
        Send an email using the configured mail sender.

        Args:
            to: Recipient email address
            subject: Email subject
            html: Email HTML content
            from_: Sender email address (optional, uses default if not provided)
        """
        if not self._sender:
            raise ValueError("Mail sender is not initialized")

        try:
            # Create mail message
            message = MailMessage(to=to, subject=subject, html=html, from_=from_)

            # Send the message
            self._sender.send(message)

        except Exception as e:
            logging.exception(f"Failed to send email to {to}")
            raise


def is_enabled() -> bool:
    return dify_config.MAIL_TYPE is not None and dify_config.MAIL_TYPE != ""


def init_app(app: DifyApp):
    mail.init_app(app)


mail = Mail()
