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
                    raise ValueError("RESEND_API_KEY 未设置")

                api_url = dify_config.RESEND_API_URL
                if api_url:
                    resend.api_url = api_url

                resend.api_key = api_key
                self._client = resend.Emails
            case "smtp":
                from libs.smtp import SMTPClient

                if not dify_config.SMTP_SERVER or not dify_config.SMTP_PORT:
                    raise ValueError("SMTP 邮件类型需要 SMTP_SERVER 和 SMTP_PORT")
                if not dify_config.SMTP_USE_TLS and dify_config.SMTP_OPPORTUNISTIC_TLS:
                    raise ValueError("未启用 SMTP_USE_TLS 时不支持 SMTP_OPPORTUNISTIC_TLS")
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
                    raise ValueError("SendGrid 邮件类型需要 SENDGRID_API_KEY")

                self._client = SendGridClient(
                    sendgrid_api_key=dify_config.SENDGRID_API_KEY, _from=dify_config.MAIL_DEFAULT_SEND_FROM or ""
                )
            case _:
                raise ValueError(f"Unsupported mail type {mail_type}")

    def send(self, to: str, subject: str, html: str, from_: str | None = None):
        if not self._client:
            raise ValueError("邮件客户端未初始化")

        if not from_ and self._default_send_from:
            from_ = self._default_send_from

        if not from_:
            raise ValueError("邮件发件人未设置")

        if not to:
            raise ValueError("邮件收件人未设置")

        if not subject:
            raise ValueError("邮件主题未设置")

        if not html:
            raise ValueError("邮件 HTML 未设置")

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
