import logging

import sendgrid
from python_http_client.exceptions import ForbiddenError, UnauthorizedError
from sendgrid.helpers.mail import Content, Email, Mail, To

logger = logging.getLogger(__name__)


class SendGridClient:
    def __init__(self, sendgrid_api_key: str, _from: str):
        self.sendgrid_api_key = sendgrid_api_key
        self._from = _from

    def send(self, mail: dict):
        logger.debug("Sending email with SendGrid")
        _to = ""
        try:
            _to = mail["to"]

            if not _to:
                raise ValueError("SendGridClient: Cannot send email: recipient address is missing.")

            sg = sendgrid.SendGridAPIClient(api_key=self.sendgrid_api_key)
            from_email = Email(self._from)
            to_email = To(_to)
            subject = mail["subject"]
            content = Content("text/html", mail["html"])
            sg_mail = Mail(from_email, to_email, subject, content)
            mail_json = sg_mail.get()
            response = sg.client.mail.send.post(request_body=mail_json)  # type: ignore
            logger.debug(response.status_code)
            logger.debug(response.body)
            logger.debug(response.headers)

        except TimeoutError:
            logger.exception("SendGridClient Timeout occurred while sending email")
            raise
        except (UnauthorizedError, ForbiddenError):
            logger.exception(
                "SendGridClient Authentication failed. "
                "Verify that your credentials and the 'from' email address are correct"
            )
            raise
        except Exception:
            logger.exception("SendGridClient Unexpected error occurred while sending email to %s", _to)
            raise
