import logging

from flask import Flask

from configs import dify_config
from dify_app import DifyApp

logger = logging.getLogger(__name__)


class Mail:
    def __init__(self):
        self._client = None
        self._default_send_from = None

    def is_inited(self) -> bool:
        return self._client is not None

    def init_app(self, app: Flask):
        mail_type = dify_config.MAIL_TYPE
        if not mail_type:
            logger.warning("MAIL_TYPE is not set")
            return

        if dify_config.MAIL_DEFAULT_SEND_FROM:
            self._default_send_from = dify_config.MAIL_DEFAULT_SEND_FROM

        match mail_type:
            case "resend":
                import resend

                api_key = dify_config.RESEND_API_KEY
                if not api_key:
                    raise ValueError("RESEND_API_KEY is not set")

                api_url = dify_config.RESEND_API_URL
                if api_url:
                    resend.api_url = api_url

                resend.api_key = api_key
                self._client = resend.Emails
            case "smtp":
                from libs.smtp import SMTPClient

                if not dify_config.SMTP_SERVER or not dify_config.SMTP_PORT:
                    raise ValueError("SMTP_SERVER and SMTP_PORT are required for smtp mail type")
                if not dify_config.SMTP_USE_TLS and dify_config.SMTP_OPPORTUNISTIC_TLS:
                    raise ValueError("SMTP_OPPORTUNISTIC_TLS is not supported without enabling SMTP_USE_TLS")
                self._client = SMTPClient(
                    server=dify_config.SMTP_SERVER,
                    port=dify_config.SMTP_PORT,
                    username=dify_config.SMTP_USERNAME or "",
                    password=dify_config.SMTP_PASSWORD or "",
                    _from=dify_config.MAIL_DEFAULT_SEND_FROM or "",
                    use_tls=dify_config.SMTP_USE_TLS,
                    opportunistic_tls=dify_config.SMTP_OPPORTUNISTIC_TLS,
                )
            case "sendgrid":
                from libs.sendgrid import SendGridClient

                if not dify_config.SENDGRID_API_KEY:
                    raise ValueError("SENDGRID_API_KEY is required for SendGrid mail type")

                self._client = SendGridClient(
                    sendgrid_api_key=dify_config.SENDGRID_API_KEY, _from=dify_config.MAIL_DEFAULT_SEND_FROM or ""
                )
            case _:
                raise ValueError(f"Unsupported mail type {mail_type}")

    def send(self, to: str, subject: str, html: str, from_: str | None = None):
        if not self._client:
            raise ValueError("Mail client is not initialized")

        if not from_ and self._default_send_from:
            from_ = self._default_send_from

        if not from_:
            raise ValueError("mail from is not set")

        if not to:
            raise ValueError("mail to is not set")

        if not subject:
            raise ValueError("mail subject is not set")

        if not html:
            raise ValueError("mail html is not set")

        self._client.send(
            {
                "from": from_,
                "to": to,
                "subject": subject,
                "html": html,
            }
        )


def is_enabled() -> bool:
    return dify_config.MAIL_TYPE is not None and dify_config.MAIL_TYPE != ""


def init_app(app: DifyApp):
    mail.init_app(app)


mail = Mail()
