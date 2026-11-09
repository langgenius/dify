import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from configs import dify_config

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

    def send(self, mail: dict[str, Any]):
        """Send a mail containing subject/to/html with the configured local EHLO identity.

        Returns after SMTP acceptance. Connection, TLS, authentication and send
        failures propagate; cleanup never replaces the primary outcome.
        """
        smtp: smtplib.SMTP | None = None
        # A blank value must fall back to smtplib's socket.getfqdn() default;
        # SMTP(local_hostname="") would send a bare "ehlo" with no hostname.
        local_host = dify_config.SMTP_LOCAL_HOSTNAME or None
        try:
            if self.use_tls and not self.opportunistic_tls:
                # SMTP with SSL (implicit TLS)
                smtp = smtplib.SMTP_SSL(self.server, self.port, timeout=10, local_hostname=local_host)
            else:
                # Plain SMTP or SMTP with STARTTLS (explicit TLS)
                smtp = smtplib.SMTP(self.server, self.port, timeout=10, local_hostname=local_host)

            assert smtp is not None
            if self.use_tls and self.opportunistic_tls:
                smtp.ehlo()
                smtp.starttls()
                smtp.ehlo()

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
                # Cleanup must not replace a send failure or turn an accepted send into a failure.
                try:
                    smtp.quit()
                except Exception:
                    logger.warning("Failed to quit SMTP connection", exc_info=True)
                    try:
                        smtp.close()
                    except Exception:
                        logger.warning("Failed to close SMTP connection", exc_info=True)
