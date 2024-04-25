from typing import Optional

import resend
from flask import Flask


class Mail:
    def __init__(self):
        self._client = None
        self._default_send_from = None

    def is_inited(self) -> bool:
        return self._client is not None

    def init_app(self, app: Flask):
        if app.config.get('MAIL_TYPE'):
            if app.config.get('MAIL_DEFAULT_SEND_FROM'):
                self._default_send_from = app.config.get('MAIL_DEFAULT_SEND_FROM')

            if app.config.get('MAIL_TYPE') == 'resend':
                api_key = app.config.get('RESEND_API_KEY')
                if not api_key:
                    raise ValueError('RESEND_API_KEY is not set')

                api_url = app.config.get('RESEND_API_URL')
                if api_url:
                    resend.api_url = api_url

                resend.api_key = api_key
                self._client = resend.Emails
            elif app.config.get('MAIL_TYPE') == 'smtp':
                from libs.smtp import SMTPClient
                if not app.config.get('SMTP_SERVER') or not app.config.get('SMTP_PORT'):
                    raise ValueError('SMTP_SERVER and SMTP_PORT are required for smtp mail type')
                self._client = SMTPClient(
                    server=app.config.get('SMTP_SERVER'),
                    port=app.config.get('SMTP_PORT'),
                    username=app.config.get('SMTP_USERNAME'),
                    password=app.config.get('SMTP_PASSWORD'),
                    _from=app.config.get('MAIL_DEFAULT_SEND_FROM'),
                    use_tls=app.config.get('SMTP_USE_TLS')
                )
            else:
                raise ValueError('Unsupported mail type {}'.format(app.config.get('MAIL_TYPE')))

    def send(self, to: str, subject: str, html: str, from_: Optional[str] = None):
        if not self._client:
            raise ValueError('Mail client is not initialized')

        if not from_ and self._default_send_from:
            from_ = self._default_send_from

        if not from_:
            raise ValueError('mail from is not set')

        if not to:
            raise ValueError('mail to is not set')

        if not subject:
            raise ValueError('mail subject is not set')

        if not html:
            raise ValueError('mail html is not set')

        self._client.send({
            "from": from_,
            "to": to,
            "subject": subject,
            "html": html
        })


def init_app(app: Flask):
    mail.init_app(app)


mail = Mail()
