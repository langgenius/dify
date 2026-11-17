from __future__ import annotations

import json
import logging
from email.message import Message
from io import BytesIO
from urllib import error as urllib_error
from urllib import request as urllib_request

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
@pytest.mark.parametrize(
    "request_id",
    [
        pytest.param("01A1E70F-03B7-77BB-8BD8-8B4AE00F565E", id="uuid"),
        pytest.param("dt:req-17.abc", id="opaque"),
        pytest.param(None, id="absent"),
        pytest.param(123, id="non-string"),
        pytest.param("", id="empty"),
        pytest.param("vendor\nrequest", id="newline"),
        pytest.param("  vendor request  ", id="whitespace"),
        pytest.param("vendor\x00\t\r\x7frequest", id="control-characters"),
        pytest.param("请求标识", id="unicode"),
        pytest.param("x" * 1024, id="long"),
    ],
)
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
    expected_request_id = request_id if isinstance(request_id, str) else None
    assert result.provider_request_id == expected_request_id
    if expected_request_id is not None:
        assert expected_request_id in caplog.text or repr(expected_request_id) in caplog.text
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


def test_oauth_rejection_preserves_numeric_provider_code(monkeypatch: pytest.MonkeyPatch) -> None:
    def send(_session: requests.Session, _request: requests.PreparedRequest, **_kwargs: object) -> requests.Response:
        response = requests.Response()
        response.status_code = 500
        response.raw = BytesIO(b'{"code":"unknownError","errcode":40013,"requestid":"DT:request-42.ABC"}')
        return response

    monkeypatch.setattr(requests.Session, "send", send)
    adapter = DingTalkIMProviderAdapter(
        DingTalkCredentials(
            provider=IMProvider.DING_TALK, corp_id="fake-corp", client_id="fake-id", client_secret="fake-secret"
        )
    )
    try:
        result = adapter.test_credentials()
    finally:
        adapter.close()

    assert isinstance(result, CredentialTestFailure)
    assert result.provider_error_code == "40013"
    assert result.provider_request_id == "DT:request-42.ABC"
    assert result.http_status == 500


@pytest.mark.parametrize("failure_point", ["scope", "root", "http"])
def test_directory_rejection_preserves_provider_code_and_request_id(
    monkeypatch: pytest.MonkeyPatch, failure_point: str
) -> None:
    class DirectoryResponse(BytesIO):
        status = 200

    def send(_session: requests.Session, _request: requests.PreparedRequest, **_kwargs: object) -> requests.Response:
        response = requests.Response()
        response.status_code = 200
        response.raw = BytesIO(b'{"access_token":"fake-token","expires_in":7200}')
        return response

    def urlopen(request: urllib_request.Request, **_kwargs: object) -> DirectoryResponse:
        rejection = b'{"errcode":60011,"errmsg":"not authorized","request_id":"DT-Directory:ABC-42"}'
        if failure_point == "http":
            raise urllib_error.HTTPError(request.full_url, 403, "Forbidden", Message(), BytesIO(rejection))
        if failure_point == "root" and "/auth/scopes" in request.full_url:
            return DirectoryResponse(b'{"errcode":0,"auth_org_scopes":{"authed_dept":[1],"authed_user":[]}}')
        return DirectoryResponse(rejection)

    monkeypatch.setattr(requests.Session, "send", send)
    monkeypatch.setattr(urllib_request, "urlopen", urlopen)
    adapter = DingTalkIMProviderAdapter(
        DingTalkCredentials(
            provider=IMProvider.DING_TALK, corp_id="fake-corp", client_id="fake-id", client_secret="fake-secret"
        )
    )
    try:
        result = adapter.test_credentials()
    finally:
        adapter.close()

    assert isinstance(result, CredentialTestFailure)
    assert result.provider_error_code == "60011"
    assert result.provider_request_id == "DT-Directory:ABC-42"
    assert result.http_status == (403 if failure_point == "http" else 200)
    expected_kind = (
        CredentialTestFailureKind.TENANT_ID_UNAVAILABLE
        if failure_point == "root"
        else CredentialTestFailureKind.UNKNOWN
    )
    assert result.kind is expected_kind
