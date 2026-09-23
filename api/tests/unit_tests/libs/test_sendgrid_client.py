from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from python_http_client.exceptions import UnauthorizedError

from libs.sendgrid import SendGridClient


def _mail(to: str = "user@example.com") -> dict[str, Any]:
    return {"to": to, "subject": "Hi", "html": "<b>Hi</b>"}


@patch("libs.sendgrid.sendgrid.SendGridAPIClient")
def test_sendgrid_success(mock_client_cls: MagicMock):
    mock_client = MagicMock()
    mock_client_cls.return_value = mock_client
    # nested attribute access: client.mail.send.post
    mock_client.client.mail.send.post.return_value = MagicMock(status_code=202, body=b"", headers={})

    sg = SendGridClient(sendgrid_api_key="key", _from="noreply@example.com")
    sg.send(_mail())

    mock_client_cls.assert_called_once()
    mock_client.client.mail.send.post.assert_called_once()


@patch("libs.sendgrid.sendgrid.SendGridAPIClient")
def test_sendgrid_missing_to_raises(mock_client_cls: MagicMock):
    sg = SendGridClient(sendgrid_api_key="key", _from="noreply@example.com")
    with pytest.raises(ValueError):
        sg.send(_mail(to=""))


@patch("libs.sendgrid.sendgrid.SendGridAPIClient")
def test_sendgrid_auth_errors_reraise(mock_client_cls: MagicMock):
    mock_client = MagicMock()
    mock_client_cls.return_value = mock_client
    mock_client.client.mail.send.post.side_effect = UnauthorizedError(401, "Unauthorized", b"{}", {})

    sg = SendGridClient(sendgrid_api_key="key", _from="noreply@example.com")
    with pytest.raises(UnauthorizedError):
        sg.send(_mail())


@patch("libs.sendgrid.sendgrid.SendGridAPIClient")
def test_sendgrid_timeout_reraise(mock_client_cls: MagicMock):
    mock_client = MagicMock()
    mock_client_cls.return_value = mock_client
    mock_client.client.mail.send.post.side_effect = TimeoutError("timeout")

    sg = SendGridClient(sendgrid_api_key="key", _from="noreply@example.com")
    with pytest.raises(TimeoutError):
        sg.send(_mail())


@patch("libs.sendgrid.sendgrid.SendGridAPIClient")
def test_sensitive_send_has_timeout_and_does_not_log_provider_error(mock_client_cls: MagicMock, caplog):
    client = mock_client_cls.return_value
    client.send.side_effect = UnauthorizedError(401, "otp-secret", b"provider-secret", {})
    with pytest.raises(UnauthorizedError):
        SendGridClient(sendgrid_api_key="key", _from="noreply@example.com").send(_mail(), sensitive=True)
    assert client.client.timeout == 30
    assert "otp-secret" not in caplog.text
    assert "provider-secret" not in caplog.text


def test_sensitive_mail_keeps_sdk_request_and_response_bodies_out_of_debug_logs(monkeypatch, caplog):
    import logging
    import urllib.request

    from extensions import ext_logging

    response = MagicMock()
    response.getcode.return_value = 202
    response.read.return_value = b"provider-secret"
    response.info.return_value = {}
    opener = MagicMock()
    opener.open.return_value = response
    monkeypatch.setattr(urllib.request, "build_opener", lambda: opener)
    monkeypatch.setattr(ext_logging.logging, "basicConfig", lambda **_kwargs: None)
    monkeypatch.setattr(ext_logging.dify_config, "LOG_FILE", None)
    sdk_logger = logging.getLogger("python_http_client.client")
    previous_level = sdk_logger.level
    try:
        sdk_logger.setLevel(logging.DEBUG)
        ext_logging.init_app(None)
        with caplog.at_level(logging.DEBUG):
            SendGridClient(sendgrid_api_key="test-key", _from="noreply@example.com").send(
                {"to": "recipient@example.com", "subject": "OTP", "html": "otp-secret"}, sensitive=True
            )
        assert "otp-secret" not in caplog.text
        assert "provider-secret" not in caplog.text
        assert opener.open.call_args.kwargs["timeout"] == 30
    finally:
        sdk_logger.setLevel(previous_level)
