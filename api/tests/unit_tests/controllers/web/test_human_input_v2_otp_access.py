from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.common.human_input_v2_contracts import FormAccessRequestResponse
from controllers.web import human_input_form_access_request as controller
from libs.exception import BaseHTTPException


def test_access_returns_challenge_without_changing_public_contract(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = Mock()
    service.request_access.return_value = FormAccessRequestResponse(
        challenge_token="opaque-challenge", expires_in_seconds=600, resend_after_seconds=60
    )
    monkeypatch.setattr(controller, "build_email_otp_service", lambda: service, raising=False)
    with app.test_request_context("/api/form/human-input/v2/public/form-token/access-request", method="POST"):
        response = controller.FormAccessRequestApi().post("form-token")
    assert response == {
        "challenge_token": "opaque-challenge",
        "expires_in_seconds": 600,
        "resend_after_seconds": 60,
    }


def test_access_rate_limit_preserves_error_code_and_retry_after(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:

    from services.human_input_v2.email_otp_service import EmailOtpError, OtpFailure

    service = Mock()
    service.request_access.side_effect = EmailOtpError(OtpFailure.RATE_LIMIT, 45)
    monkeypatch.setattr(controller, "build_email_otp_service", lambda: service)
    with app.test_request_context("/api/form/human-input/v2/public/form-token/access-request", method="POST"):
        with pytest.raises(BaseHTTPException) as error:
            controller.FormAccessRequestApi().post("form-token")
    assert error.value.code == 429
    assert error.value.data is not None
    assert error.value.data["code"] == "human_input_access_rate_limit_exceeded"
    assert ("Retry-After", "45") in error.value.get_headers()
