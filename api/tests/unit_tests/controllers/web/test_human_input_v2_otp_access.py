import pytest
from flask import Flask

from controllers.web import human_input_form_access_request as controller
from libs.exception import BaseHTTPException
from services.human_input_v2.email_otp_service import AccessChallenge, EmailOtpService


def test_access_returns_challenge_without_changing_public_contract(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    challenge = AccessChallenge(challenge_token="opaque-challenge", expires_in_seconds=600, resend_after_seconds=60)
    monkeypatch.setattr(EmailOtpService, "request_access", lambda _self, _form_token, **_kwargs: challenge)
    with app.test_request_context("/api/form/human-input/v2/public/form-token/access-request", method="POST"):
        response = controller.FormAccessRequestApi().post("form-token")
    assert response == {
        "challenge_token": "opaque-challenge",
        "expires_in_seconds": 600,
        "resend_after_seconds": 60,
    }


def test_access_rate_limit_preserves_error_code_and_retry_after(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:

    from services.human_input_v2.email_otp_service import EmailOtpError, OtpFailure

    def rate_limited(_self: EmailOtpService, form_token: str, *, ip_address: str | None = None) -> AccessChallenge:
        assert form_token == "form-token"
        del ip_address
        raise EmailOtpError(OtpFailure.RATE_LIMIT, 45)

    monkeypatch.setattr(EmailOtpService, "request_access", rate_limited)
    with app.test_request_context("/api/form/human-input/v2/public/form-token/access-request", method="POST"):
        with pytest.raises(BaseHTTPException) as error:
            controller.FormAccessRequestApi().post("form-token")
    assert error.value.code == 429
    assert error.value.data is not None
    assert error.value.data["code"] == "human_input_access_rate_limit_exceeded"
    assert ("Retry-After", "45") in error.value.get_headers()
