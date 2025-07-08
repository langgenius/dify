import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

class SMTPClient:
    def __init__(
        self, server: str, port: int, username: str, password: str, _from: str,
        use_tls=False, opportunistic_tls=False
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
            # Port 465 is implicit SSL, always use SMTP_SSL.
            if self.port == 465:
                smtp = smtplib.SMTP_SSL(self.server, self.port, timeout=10)
            else:
                smtp = smtplib.SMTP(self.server, self.port, timeout=10)
                smtp.ehlo(self.server)
                if self.use_tls:
                    # Strict: fail if STARTTLS fails
                    smtp.starttls()
                    smtp.ehlo(self.server)
                elif self.opportunistic_tls:
                    # Try STARTTLS, but continue if it fails
                    try:
                        smtp.starttls()
                        smtp.ehlo(self.server)
                        logging.info("Opportunistic STARTTLS succeeded")
                    except Exception as e:
                        logging.warning(f"Opportunistic STARTTLS failed, continuing unencrypted: {e}")

            # Authenticate if needed
            if self.username and self.password and self.username.strip() and self.password.strip():
                smtp.login(self.username, self.password)

            msg = MIMEMultipart()
            msg["Subject"] = mail["subject"]
            msg["From"] = self._from
            msg["To"] = mail["to"]
            msg.attach(MIMEText(mail["html"], "html"))

            smtp.sendmail(self._from, mail["to"], msg.as_string())
        except smtplib.SMTPException:
            logging.exception("SMTP error occurred")
            raise
        except TimeoutError:
            logging.exception("Timeout occurred while sending email")
            raise
        except Exception as e:
            logging.exception(f"Unexpected error occurred while sending email to {mail['to']}: {e}")
            raise
        finally:
            if smtp:
                try:
                    smtp.quit()
                except Exception:
                    pass
