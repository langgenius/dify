import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


class SMTPClient:
    def __init__(self, server: str, port: int, username: str, password: str, _from: str, use_tls=False):
        self.server = server
        self.port = port
        self._from = _from
        self.username = username
        self.password = password
        self._use_tls = use_tls

    def send(self, mail: dict):
        smtp = smtplib.SMTP(self.server, self.port)
        if self._use_tls:
            smtp.starttls()
        if (self.username):
            smtp.login(self.username, self.password)
        msg = MIMEMultipart()
        msg['Subject'] = mail['subject']
        msg['From'] = self._from
        msg['To'] = mail['to']
        msg.attach(MIMEText(mail['html'], 'html'))
        smtp.sendmail(self.username, mail['to'], msg.as_string())
        smtp.quit()
