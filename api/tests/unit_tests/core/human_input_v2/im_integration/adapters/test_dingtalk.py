from __future__ import annotations

import json
import logging
from io import BytesIO

import pytest
import requests

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.credentials import DingTalkCredentials
from core.human_input_v2.im_integration.adapters.dingtalk import DingTalkIMProviderAdapter
from core.human_input_v2.im_integration.adapters.entities import CredentialTestFailure, CredentialTestFailureKind


@pytest.mark.parametrize(
    ("status", "code", "expected_kind"),
    [
        (500, "unknownError", CredentialTestFailureKind.UNKNOWN),
        (401, "invalid.client", CredentialTestFailureKind.AUTHENTICATION_REJECTED),
    ],
)
@pytest.mark.parametrize("request_id_key", ["requestid", "RequestId"])
@pytest.mark.parametrize("request_id", ["11111111-2222-4333-8444-555555555555", None, 123, "invalid-request-id"])
def test_token_rejection_logs_safe_diagnostics_without_changing_failure(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    status: int,
    code: str,
    expected_kind: CredentialTestFailureKind,
    request_id_key: str,
    request_id: str | int | None,
) -> None:
    credentials = DingTalkCredentials(
        provider=IMProvider.DING_TALK,
        corp_id="fake-corp-id",
        client_id="fake-client-id",
        client_secret="fake-client-secret",
    )
    rejection: dict[str, object] = {
        "code": code,
        "message": f"upstream echoed {credentials.client_secret}",
        "access_token": "fake-access-token",
        "Authorization": "Bearer fake-authorization",
        "request": credentials.model_dump(mode="json"),
    }
    if request_id is not None:
        rejection[request_id_key] = request_id

    def send(_session: requests.Session, _request: requests.PreparedRequest, **_kwargs: object) -> requests.Response:
        response = requests.Response()
        response.status_code = status
        response.headers["Content-Type"] = "application/json"
        response.raw = BytesIO(json.dumps(rejection).encode())
        return response

    monkeypatch.setattr(requests.Session, "send", send)

    adapter = DingTalkIMProviderAdapter(credentials)
    try:
        with caplog.at_level(logging.WARNING):
            result = adapter.test_credentials()
    finally:
        adapter.close()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is expected_kind
    assert result.http_status == status
    assert result.provider_error_code == code
    assert f"http_status={status}" in caplog.text
    assert code in caplog.text
    if request_id == "11111111-2222-4333-8444-555555555555":
        assert request_id in caplog.text
    else:
        assert "request_id=None" in caplog.text
    for sensitive_value in (
        credentials.corp_id,
        credentials.client_id,
        credentials.client_secret,
        "fake-access-token",
        "fake-authorization",
        "upstream echoed",
    ):
        assert sensitive_value not in caplog.text
        assert sensitive_value not in repr(result)
    assert all(record.exc_info is None for record in caplog.records)
