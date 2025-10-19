import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


class SMTPClient:
    def __init__(
        self, server: str, port: int, username: str, password: str, _from: str, use_tls=False, opportunistic_tls=False
    ):
        self.server = server
        self.port = port
        self._from = _from
        self.username = username
        self.password = password
        self.use_tls = use_tls
        self.opportunistic_tls = opportunistic_tls

    def send(self, mail: dict):
        smtp = None
        try:
            if self.use_tls:
                if self.opportunistic_tls:
                    smtp = smtplib.SMTP(self.server, self.port, timeout=10)
                    # Send EHLO command with the HELO domain name as the server address
                    smtp.ehlo(self.server)
                    smtp.starttls()
                    # Resend EHLO command to identify the TLS session
                    smtp.ehlo(self.server)
                else:
                    smtp = smtplib.SMTP_SSL(self.server, self.port, timeout=10)
            else:
                smtp = smtplib.SMTP(self.server, self.port, timeout=10)

            # Only authenticate if both username and password are non-empty
            if self.username and self.password and self.username.strip() and self.password.strip():
                smtp.login(self.username, self.password)

            msg = MIMEMultipart()
            msg["Subject"] = mail["subject"]
            msg["From"] = self._from
            msg["To"] = mail["to"]
            msg.attach(MIMEText(mail["html"], "html"))

            smtp.sendmail(self._from, mail["to"], msg.as_string())
        except smtplib.SMTPException:
            logger.exception("SMTP error occurred")
            raise
        except TimeoutError:
            logger.exception("Timeout occurred while sending email")
            raise
        except Exception:
            logger.exception("Unexpected error occurred while sending email to %s", mail["to"])
            raise
        finally:
            if smtp:
                smtp.quit()
