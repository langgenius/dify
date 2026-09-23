from unittest.mock import Mock

from flask import Flask

from controllers.common.human_input_v2_contracts import FormAccessRequestResponse
from controllers.web import human_input_form_access_request as controller


def test_access_returns_challenge_without_changing_public_contract(app: Flask, monkeypatch):
    service = Mock()
    service.request_access.return_value = FormAccessRequestResponse(
        challenge_token="opaque-challenge", expires_in_seconds=600, resend_after_seconds=60
    )
    monkeypatch.setattr(controller, "build_email_otp_service", lambda: service, raising=False)
    with app.test_request_context("/api/form/human-input/form-token/access-request", method="POST"):
        response = controller.FormAccessRequestApi().post("form-token")
    assert response == {
        "challenge_token": "opaque-challenge",
        "expires_in_seconds": 600,
        "resend_after_seconds": 60,
    }


def test_access_rate_limit_preserves_error_code_and_retry_after(app: Flask, monkeypatch):
    import pytest
    from werkzeug.exceptions import HTTPException

    from services.human_input_v2.email_otp_service import EmailOtpError, OtpFailure

    service = Mock()
    service.request_access.side_effect = EmailOtpError(OtpFailure.RATE_LIMIT, 45)
    monkeypatch.setattr(controller, "build_email_otp_service", lambda: service)
    with app.test_request_context("/api/form/human-input/form-token/access-request", method="POST"):
        with pytest.raises(HTTPException) as error:
            controller.FormAccessRequestApi().post("form-token")
    assert error.value.code == 429
    assert error.value.data["code"] == "human_input_access_rate_limit_exceeded"
    assert ("Retry-After", "45") in error.value.get_headers()
