import json

import httpx
import pytest
from flask import Flask

from configs import DifyConfig
from core.helper import ssrf_proxy
from extensions import ext_mail


@pytest.mark.parametrize("from_", ["", "Support <support@example.com>"])
def test_rasket_mail_sends_through_extension(monkeypatch: pytest.MonkeyPatch, from_: str) -> None:
    monkeypatch.setenv("MAIL_TYPE", "rasket")
    monkeypatch.setenv("MAIL_DEFAULT_SEND_FROM", "Dify <noreply@example.com>")
    monkeypatch.setenv("RASKET_API_KEY", "rk_test_key")
    monkeypatch.setattr(ext_mail, "dify_config", DifyConfig())
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"id": "email-id"})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _ssl_verify_enabled: client)
        mail = ext_mail.Mail()
        mail.init_app(Flask(__name__))
        assert mail.is_inited()
        mail.send(to="user@example.com", subject="Hi", html="<b>Hi</b>", from_=from_)

    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == "https://api.rasket.com/emails"
    assert request.headers["Authorization"] == "Bearer rk_test_key"
    assert request.headers["User-Agent"] == "Dify"
    assert request.headers["Content-Type"] == "application/json"
    assert json.loads(request.content) == {
        "from": from_ or "Dify <noreply@example.com>",
        "to": ["user@example.com"],
        "subject": "Hi",
        "html": "<b>Hi</b>",
    }


@pytest.mark.parametrize("api_key", ["", None])
def test_rasket_requires_api_key(monkeypatch: pytest.MonkeyPatch, api_key: str | None) -> None:
    config = DifyConfig(MAIL_TYPE="rasket", RASKET_API_KEY=api_key)
    monkeypatch.setattr(ext_mail, "dify_config", config)
    mail = ext_mail.Mail()
    with pytest.raises(ValueError, match="RASKET_API_KEY is required for Rasket mail type"):
        mail.init_app(Flask(__name__))
    assert not mail.is_inited()


@pytest.mark.parametrize("mail_type", [None, "", "unknown"])
def test_disabled_and_unsupported_mail_types(monkeypatch: pytest.MonkeyPatch, mail_type: str | None) -> None:
    monkeypatch.setattr(ext_mail, "dify_config", DifyConfig(MAIL_TYPE=mail_type))
    mail = ext_mail.Mail()
    if mail_type == "unknown":
        with pytest.raises(ValueError, match="Unsupported mail type unknown"):
            mail.init_app(Flask(__name__))
    else:
        mail.init_app(Flask(__name__))
        assert not ext_mail.is_enabled()
    assert not mail.is_inited()


@pytest.mark.parametrize("mail_type", ["smtp", "sendgrid", "resend"])
def test_existing_mail_providers_initialize(monkeypatch: pytest.MonkeyPatch, mail_type: str) -> None:
    monkeypatch.setattr(
        ext_mail,
        "dify_config",
        DifyConfig(
            MAIL_TYPE=mail_type,
            SMTP_SERVER="smtp.example.com",
            SMTP_PORT=465,
            SMTP_USE_TLS=True,
            SENDGRID_API_KEY="test-key",
            RESEND_API_KEY="test-key",
        ),
    )
    mail = ext_mail.Mail()
    mail.init_app(Flask(__name__))
    assert mail.is_inited()


@pytest.mark.parametrize("field", ["from_", "to", "subject", "html"])
def test_rasket_preserves_mail_validation(monkeypatch: pytest.MonkeyPatch, field: str) -> None:
    monkeypatch.setattr(
        ext_mail,
        "dify_config",
        DifyConfig(MAIL_TYPE="rasket", RASKET_API_KEY="rk_test_key", MAIL_DEFAULT_SEND_FROM=None),
    )
    mail = ext_mail.Mail()
    mail.init_app(Flask(__name__))
    payload = {"from_": "sender@example.com", "to": "user@example.com", "subject": "Hi", "html": "<b>Hi</b>"}
    payload[field] = ""
    with pytest.raises(ValueError, match=f"mail {field.rstrip('_')} is not set"):
        mail.send(**payload)
