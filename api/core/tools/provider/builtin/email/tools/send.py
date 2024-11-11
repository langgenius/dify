import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from pydantic import BaseModel


class SendEmailToolParameters(BaseModel):
    smtp_server: str
    smtp_port: int

    email_account: str
    email_password: str

    sender_to: str
    subject: str
    email_content: str
    encrypt_method: str


def send_mail(parmas: SendEmailToolParameters):
    timeout = 60
    msg = MIMEMultipart("alternative")
    msg["From"] = parmas.email_account
    msg["To"] = parmas.sender_to
    msg["Subject"] = parmas.subject
    msg.attach(MIMEText(parmas.email_content, "plain"))
    msg.attach(MIMEText(parmas.email_content, "html"))

    ctx = ssl.create_default_context()

    if parmas.encrypt_method.upper() == "SSL":
        try:
            with smtplib.SMTP_SSL(parmas.smtp_server, parmas.smtp_port, context=ctx, timeout=timeout) as server:
                server.login(parmas.email_account, parmas.email_password)
                server.sendmail(parmas.email_account, parmas.sender_to, msg.as_string())
                return True
        except Exception as e:
            logging.exception("send email failed: %s", e)
            return False
    else:  # NONE or TLS
        try:
            with smtplib.SMTP(parmas.smtp_server, parmas.smtp_port, timeout=timeout) as server:
                if parmas.encrypt_method.upper() == "TLS":
                    server.starttls(context=ctx)
                server.login(parmas.email_account, parmas.email_password)
                server.sendmail(parmas.email_account, parmas.sender_to, msg.as_string())
                return True
        except Exception as e:
            logging.exception("send email failed: %s", e)
            return False
