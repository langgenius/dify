import asyncio
from email.message import EmailMessage

import aiosmtplib


class SMTPClient:
    def __init__(self, server: str, port: str, username: str, password: str, _from: str, use_tls=False):
        self.server = server
        self.port = int(port)
        self._from = _from
        self.username = username
        self.password = password
        self._use_tls = use_tls

    def send(self, mail: dict):
        message = EmailMessage()
        message["From"] = self._from
        message["To"] = mail['to']
        message["Subject"] = mail['subject']
        message.set_content(mail['html'], subtype='html')
        asyncio.run(aiosmtplib.send(message,
                                    hostname=self.server,
                                    port=self.port,
                                    use_tls=self._use_tls,
                                    username=self.username,
                                    password=self.password))

