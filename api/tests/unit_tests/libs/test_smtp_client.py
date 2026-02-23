from unittest.mock import ANY, MagicMock, patch

import pytest

from libs.smtp import SMTPClient


def _mail() -> dict:
    return {"to": "user@example.com", "subject": "Hi", "html": "<b>Hi</b>"}


@patch("libs.smtp.smtplib.SMTP")
def test_smtp_plain_success(mock_smtp_cls: MagicMock):
    mock_smtp = MagicMock()
    mock_smtp_cls.return_value = mock_smtp

    client = SMTPClient(server="smtp.example.com", port=25, username="", password="", _from="noreply@example.com")
    client.send(_mail())

    mock_smtp_cls.assert_called_once_with("smtp.example.com", 25, timeout=10, local_hostname=ANY)
    mock_smtp.sendmail.assert_called_once()
    mock_smtp.quit.assert_called_once()


@patch("libs.smtp.smtplib.SMTP")
def test_smtp_tls_opportunistic_success(mock_smtp_cls: MagicMock):
    mock_smtp = MagicMock()
    mock_smtp_cls.return_value = mock_smtp

    client = SMTPClient(
        server="smtp.example.com",
        port=587,
        username="user",
        password="pass",
        _from="noreply@example.com",
        use_tls=True,
        opportunistic_tls=True,
    )
    client.send(_mail())

    mock_smtp_cls.assert_called_once_with("smtp.example.com", 587, timeout=10, local_hostname=ANY)
    assert mock_smtp.ehlo.call_count == 2
    mock_smtp.starttls.assert_called_once()
    mock_smtp.login.assert_called_once_with("user", "pass")
    mock_smtp.sendmail.assert_called_once()
    mock_smtp.quit.assert_called_once()


@patch("libs.smtp.smtplib.SMTP_SSL")
def test_smtp_tls_ssl_branch_and_timeout(mock_smtp_ssl_cls: MagicMock):
    # Cover SMTP_SSL branch and TimeoutError handling
    mock_smtp = MagicMock()
    mock_smtp.sendmail.side_effect = TimeoutError("timeout")
    mock_smtp_ssl_cls.return_value = mock_smtp

    client = SMTPClient(
        server="smtp.example.com",
        port=465,
        username="",
        password="",
        _from="noreply@example.com",
        use_tls=True,
        opportunistic_tls=False,
    )
    with pytest.raises(TimeoutError):
        client.send(_mail())
    mock_smtp.quit.assert_called_once()


@patch("libs.smtp.smtplib.SMTP")
def test_smtp_generic_exception_propagates(mock_smtp_cls: MagicMock):
    mock_smtp = MagicMock()
    mock_smtp.sendmail.side_effect = RuntimeError("oops")
    mock_smtp_cls.return_value = mock_smtp

    client = SMTPClient(server="smtp.example.com", port=25, username="", password="", _from="noreply@example.com")
    with pytest.raises(RuntimeError):
        client.send(_mail())
    mock_smtp.quit.assert_called_once()


@patch("libs.smtp.smtplib.SMTP")
def test_smtp_smtplib_exception_in_login(mock_smtp_cls: MagicMock):
    # Ensure we hit the specific SMTPException except branch
    import smtplib

    mock_smtp = MagicMock()
    mock_smtp.login.side_effect = smtplib.SMTPException("login-fail")
    mock_smtp_cls.return_value = mock_smtp

    client = SMTPClient(
        server="smtp.example.com",
        port=25,
        username="user",  # non-empty to trigger login
        password="pass",
        _from="noreply@example.com",
    )
    with pytest.raises(smtplib.SMTPException):
        client.send(_mail())
    mock_smtp.quit.assert_called_once()
