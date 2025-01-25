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


def send_mail(params: SendEmailToolParameters):
    timeout = 60
    msg = MIMEMultipart("alternative")
    msg["From"] = params.email_account
    msg["To"] = params.sender_to
    msg["Subject"] = params.subject
    msg.attach(MIMEText(params.email_content, "plain"))
    msg.attach(MIMEText(params.email_content, "html"))

    ctx = ssl.create_default_context()

    if params.encrypt_method.upper() == "SSL":
        try:
            with smtplib.SMTP_SSL(params.smtp_server, params.smtp_port, context=ctx, timeout=timeout) as server:
                server.login(params.email_account, params.email_password)
                server.sendmail(params.email_account, params.sender_to, msg.as_string())
                return True
        except Exception as e:
            logging.exception("send email failed")
            return False
    else:  # NONE or TLS
        try:
            with smtplib.SMTP(params.smtp_server, params.smtp_port, timeout=timeout) as server:
                if params.encrypt_method.upper() == "TLS":
                    server.starttls(context=ctx)
                server.login(params.email_account, params.email_password)
                server.sendmail(params.email_account, params.sender_to, msg.as_string())
                return True
        except Exception as e:
            logging.exception("send email failed")
            return False
