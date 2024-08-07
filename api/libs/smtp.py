import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


class SMTPClient:
    def __init__(self, server: str, port: int, username: str, password: str, _from: str, use_tls=False, opportunistic_tls=False):
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
                    smtp.starttls()
                else:
                    smtp = smtplib.SMTP_SSL(self.server, self.port, timeout=10)
            else:
                smtp = smtplib.SMTP(self.server, self.port, timeout=10)
                
            if self.username and self.password:
                smtp.login(self.username, self.password)

            msg = MIMEMultipart()
            msg['Subject'] = mail['subject']
            msg['From'] = self._from
            msg['To'] = mail['to']
            msg.attach(MIMEText(mail['html'], 'html'))

            smtp.sendmail(self._from, mail['to'], msg.as_string())
        except smtplib.SMTPException as e:
            logging.error(f"SMTP error occurred: {str(e)}")
            raise
        except TimeoutError as e:
            logging.error(f"Timeout occurred while sending email: {str(e)}")
            raise
        except Exception as e:
            logging.error(f"Unexpected error occurred while sending email: {str(e)}")
            raise
        finally:
            if smtp:
                smtp.quit()
