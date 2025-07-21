"""SMTP connection abstraction for better testability"""

import smtplib
from abc import ABC, abstractmethod
from typing import Protocol, Union


class SMTPConnectionProtocol(Protocol):
    """Protocol defining SMTP connection interface"""

    def ehlo(self, name: str = "") -> tuple[int, bytes]: ...

    def starttls(self) -> tuple[int, bytes]: ...

    def login(self, user: str, password: str) -> tuple[int, bytes]: ...

    def docmd(self, cmd: str, args: str = "") -> tuple[int, bytes]: ...

    def sendmail(self, from_addr: str, to_addrs: str, msg: str) -> dict: ...

    def quit(self) -> tuple[int, bytes]: ...


class SMTPConnectionFactory(ABC):
    """Abstract factory for creating SMTP connections"""

    @abstractmethod
    def create_connection(self, server: str, port: int, timeout: int = 10) -> SMTPConnectionProtocol:
        """Create an SMTP connection"""
        pass


class SMTPConnectionWrapper:
    """Wrapper to adapt smtplib.SMTP to our protocol"""

    def __init__(self, smtp_obj: Union[smtplib.SMTP, smtplib.SMTP_SSL]):
        self._smtp = smtp_obj

    def ehlo(self, name: str = "") -> tuple[int, bytes]:
        result = self._smtp.ehlo(name)
        return (result[0], result[1])

    def starttls(self) -> tuple[int, bytes]:
        result = self._smtp.starttls()
        return (result[0], result[1])

    def login(self, user: str, password: str) -> tuple[int, bytes]:
        result = self._smtp.login(user, password)
        return (result[0], result[1])

    def docmd(self, cmd: str, args: str = "") -> tuple[int, bytes]:
        result = self._smtp.docmd(cmd, args)
        return (result[0], result[1])

    def sendmail(self, from_addr: str, to_addrs: str, msg: str) -> dict:
        result = self._smtp.sendmail(from_addr, to_addrs, msg)
        return dict(result)

    def quit(self) -> tuple[int, bytes]:
        result = self._smtp.quit()
        return (result[0], result[1])


class StandardSMTPConnectionFactory(SMTPConnectionFactory):
    """Factory for creating standard SMTP connections"""

    def create_connection(self, server: str, port: int, timeout: int = 10) -> SMTPConnectionProtocol:
        """Create a standard SMTP connection"""
        smtp_obj = smtplib.SMTP(server, port, timeout=timeout)
        return SMTPConnectionWrapper(smtp_obj)


class SSLSMTPConnectionFactory(SMTPConnectionFactory):
    """Factory for creating SSL SMTP connections"""

    def create_connection(self, server: str, port: int, timeout: int = 10) -> SMTPConnectionProtocol:
        """Create an SSL SMTP connection"""
        smtp_obj = smtplib.SMTP_SSL(server, port, timeout=timeout)
        return SMTPConnectionWrapper(smtp_obj)
