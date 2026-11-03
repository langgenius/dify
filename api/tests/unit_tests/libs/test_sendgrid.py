from email.message import Message
from unittest.mock import MagicMock, patch

import pytest
from python_http_client.exceptions import UnauthorizedError

from libs.sendgrid import SendGridClient


def _mail(to: str = "user@example.com") -> dict[str, object]:
    return {"to": to, "subject": "Hi", "html": "<b>Hi</b>"}


@patch("libs.sendgrid.sendgrid.SendGridAPIClient")
def test_sendgrid_success(mock_client_cls: MagicMock) -> None:
    mock_client = MagicMock()
    mock_client_cls.return_value = mock_client
    # nested attribute access: client.mail.send.post
    mock_client.client.mail.send.post.return_value = MagicMock(status_code=202, body=b"", headers={})

    sg = SendGridClient(sendgrid_api_key="key", _from="noreply@example.com")
    sg.send(_mail())

    mock_client_cls.assert_called_once()
    mock_client.client.mail.send.post.assert_called_once()


@patch("libs.sendgrid.sendgrid.SendGridAPIClient")
def test_sendgrid_missing_to_raises(mock_client_cls: MagicMock) -> None:
    sg = SendGridClient(sendgrid_api_key="key", _from="noreply@example.com")
    with pytest.raises(ValueError, match="SendGridClient: Cannot send email: recipient address is missing\\."):
        sg.send(_mail(to=""))
    mock_client_cls.assert_not_called()


@patch("libs.sendgrid.sendgrid.SendGridAPIClient")
def test_sendgrid_auth_errors_reraise(mock_client_cls: MagicMock) -> None:
    mock_client = MagicMock()
    mock_client_cls.return_value = mock_client
    mock_client.client.mail.send.post.side_effect = UnauthorizedError(401, "Unauthorized", b"{}", Message())

    sg = SendGridClient(sendgrid_api_key="key", _from="noreply@example.com")
    with pytest.raises(UnauthorizedError):
        sg.send(_mail())


@patch("libs.sendgrid.sendgrid.SendGridAPIClient")
def test_sendgrid_timeout_reraise(mock_client_cls: MagicMock) -> None:
    mock_client = MagicMock()
    mock_client_cls.return_value = mock_client
    mock_client.client.mail.send.post.side_effect = TimeoutError("timeout")

    sg = SendGridClient(sendgrid_api_key="key", _from="noreply@example.com")
    with pytest.raises(TimeoutError):
        sg.send(_mail())
