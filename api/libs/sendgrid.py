import logging

import sendgrid  # type: ignore
from python_http_client.exceptions import ForbiddenError, UnauthorizedError
from sendgrid.helpers.mail import Content, Email, Mail, To  # type: ignore


class SendGridClient:
    def __init__(self, sendgrid_api_key: str, _from: str):
        self.sendgrid_api_key = sendgrid_api_key
        self._from = _from

    def send(self, mail: dict):
        logging.debug("Sending email with SendGrid")

        try:
            _to = mail["to"]

            if not _to:
                raise ValueError("SendGridClient: Cannot send email: recipient address is missing.")

            sg = sendgrid.SendGridAPIClient(api_key=self.sendgrid_api_key)
            from_email = Email(self._from)
            to_email = To(_to)
            subject = mail["subject"]
            content = Content("text/html", mail["html"])
            mail = Mail(from_email, to_email, subject, content)
            mail_json = mail.get()  # type: ignore
            response = sg.client.mail.send.post(request_body=mail_json)
            logging.debug(response.status_code)
            logging.debug(response.body)
            logging.debug(response.headers)

        except TimeoutError as e:
            logging.exception("SendGridClient Timeout occurred while sending email")
            raise
        except (UnauthorizedError, ForbiddenError) as e:
            logging.exception(
                "SendGridClient Authentication failed. "
                "Verify that your credentials and the 'from' email address are correct"
            )
            raise
        except Exception as e:
            logging.exception("SendGridClient Unexpected error occurred while sending email to %s", _to)
            raise
