import json
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from typing import override
from unittest.mock import patch

import httpx
import pytest

from clients.plugin.auth import PluginCredentialAuthClient
from clients.plugin.auth_entities import CredentialCheckResult, OAuthRevokeResult
from core.plugin.entities.plugin_daemon import CredentialType, PluginDaemonInnerError
from core.plugin.impl.exc import PluginDaemonClientSideError, PluginDaemonInternalServerError, PluginInvokeError
from core.plugin.impl.tool import PluginToolManager

SECRET = "secret-that-must-not-escape"


def _frame(data: object, *, code: int = 0, message: str = "") -> str:
    return f"data: {json.dumps({'code': code, 'message': message, 'data': data})}\n\n"


def _result(status: str, *, reason_code: str | None = None, retryable: bool = False) -> dict[str, object]:
    return {"status": status, "reason_code": reason_code, "retryable": retryable}


@contextmanager
def _daemon(handler: Callable[[httpx.Request], httpx.Response]) -> Generator[None]:
    with (
        httpx.Client(transport=httpx.MockTransport(handler)) as http_client,
        patch("core.plugin.impl.base._httpx_client", http_client),
    ):
        yield


def _check(
    client: PluginCredentialAuthClient, credential_type: CredentialType = CredentialType.API_KEY
) -> CredentialCheckResult:
    return client.check_provider_credentials(
        tenant_id="tenant-1",
        user_id="user-1",
        provider="org/plugin/provider",
        credentials={"access_token": SECRET},
        credential_type=credential_type,
    )


def _revoke(client: PluginCredentialAuthClient) -> OAuthRevokeResult:
    return client.revoke_credentials(
        tenant_id="tenant-1",
        user_id="user-1",
        provider="org/plugin/provider",
        system_credentials={"client_secret": SECRET},
        credentials={"access_token": SECRET},
    )


Operation = Callable[[PluginCredentialAuthClient], CredentialCheckResult | OAuthRevokeResult]


def test_shared_client_preserves_legacy_and_detailed_requests() -> None:
    formats: list[str | None] = []

    def respond(request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content)["data"]
        formats.append(data.get("result_format"))
        payload = _result("valid") if data.get("result_format") == "detailed" else {"result": True}
        return httpx.Response(200, text=_frame(payload))

    with _daemon(respond):
        assert PluginToolManager().validate_provider_credentials("tenant-1", "user-1", "org/plugin/provider", {})
        assert _check(PluginCredentialAuthClient()).status == "valid"
    assert formats == [None, "detailed"]


@pytest.mark.parametrize("legacy_result", [True, False, 1, "true"])
def test_new_api_accepts_only_explicit_legacy_success(legacy_result: object) -> None:
    with _daemon(lambda _: httpx.Response(200, text=_frame({"result": legacy_result}))):
        if legacy_result is True:
            result = _check(PluginCredentialAuthClient())
            assert result.status == "valid"
            assert result.reason_code is None
            assert result.retryable is False
        else:
            with pytest.raises(PluginDaemonInternalServerError):
                _check(PluginCredentialAuthClient())


def test_missing_revoke_endpoint_raises_daemon_error() -> None:
    with _daemon(lambda _: httpx.Response(404)):
        with pytest.raises(PluginDaemonClientSideError):
            _revoke(PluginCredentialAuthClient())


@pytest.mark.parametrize(
    ("credential_type", "wire_type"), [(CredentialType.API_KEY, "api_key"), (CredentialType.OAUTH2, "oauth2")]
)
def test_check_request_and_api_timestamp(
    credential_type: CredentialType, wire_type: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, text=": keepalive\n\n" + _frame(_result("valid")))

    monkeypatch.setattr("clients.plugin.auth.time.time", lambda: 1792141200.9)
    with _daemon(respond):
        result = _check(PluginCredentialAuthClient(), credential_type)

    assert result.model_dump() == {**_result("valid"), "checked_at": 1792141200}
    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert request.url.path == "/plugin/tenant-1/dispatch/tool/validate_credentials"
    assert request.headers["X-Plugin-ID"] == "org/plugin"
    assert json.loads(request.content) == {
        "user_id": "user-1",
        "data": {
            "provider": "provider",
            "credentials": {"access_token": SECRET},
            "credential_type": wire_type,
            "result_format": "detailed",
        },
    }


def test_revoke_request_uses_original_oauth_client() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/plugin/tenant-1/dispatch/oauth/revoke_credentials"
        assert request.headers["X-Plugin-ID"] == "org/plugin"
        assert json.loads(request.content) == {
            "user_id": "user-1",
            "data": {
                "provider": "provider",
                "credentials": {"access_token": SECRET},
                "system_credentials": {"client_secret": SECRET},
            },
        }
        return httpx.Response(200, text=_frame(_result("revoked")))

    with _daemon(respond):
        assert _revoke(PluginCredentialAuthClient()).status == "revoked"


@pytest.mark.parametrize(
    ("operation", "payload"),
    [
        (_check, _result("invalid", reason_code="credential_revoked")),
        (_check, _result("unsupported")),
        (_check, _result("temporarily_unavailable", reason_code="provider_timeout", retryable=True)),
        (_revoke, _result("unsupported")),
        (_revoke, _result("failed")),
        (_revoke, _result("temporarily_unavailable", reason_code="provider_rate_limited", retryable=True)),
    ],
)
def test_detailed_results_are_preserved(operation: Operation, payload: dict[str, object]) -> None:
    with _daemon(lambda _: httpx.Response(200, text=_frame(payload))):
        result = operation(PluginCredentialAuthClient())
    assert result.model_dump(exclude={"checked_at"}) == payload


@pytest.mark.parametrize(
    "body",
    [
        "",
        _frame(_result("unknown")),
        _frame({"result": True, **_result("invalid")}),
        _frame(_result("temporarily_unavailable", reason_code=SECRET, retryable=True)),
        _frame(_result("valid")) + _frame(_result("valid")),
        SECRET,
    ],
)
def test_malformed_checks_raise_daemon_errors(body: str) -> None:
    with _daemon(lambda _: httpx.Response(200, text=body)):
        with pytest.raises(PluginDaemonInternalServerError):
            _check(PluginCredentialAuthClient())


@pytest.mark.parametrize(
    ("operation", "success"),
    [(_check, _result("valid")), (_check, {"result": True}), (_revoke, _result("revoked"))],
)
def test_error_after_success_is_not_accepted(
    operation: Operation, success: dict[str, object], caplog: pytest.LogCaptureFixture
) -> None:
    error = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps({"message": SECRET})})
    body = _frame(success) + _frame(None, code=-500, message=error)
    with _daemon(lambda _: httpx.Response(200, text=body)):
        with pytest.raises(PluginInvokeError):
            operation(PluginCredentialAuthClient())
    assert SECRET not in caplog.text


@pytest.mark.parametrize("operation", [_check, _revoke])
@pytest.mark.parametrize("status_code", [401, 429, 503])
def test_http_errors_raise_daemon_errors(operation: Operation, status_code: int) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status_code, text=SECRET)

    with _daemon(respond):
        expected_error = PluginDaemonClientSideError if status_code < 500 else PluginDaemonInternalServerError
        with pytest.raises(expected_error):
            operation(PluginCredentialAuthClient())
    assert len(requests) == 1


@pytest.mark.parametrize(
    "exception", [httpx.ReadTimeout("Read timed out"), RuntimeError("Unexpected error"), TypeError("Bad argument")]
)
def test_stream_failure_after_success_propagates(exception: Exception) -> None:
    class InterruptedStream(httpx.SyncByteStream):
        @override
        def __iter__(self) -> Iterator[bytes]:
            yield _frame({"result": True}).encode()
            raise exception

    with _daemon(lambda _: httpx.Response(200, stream=InterruptedStream())):
        expected_error = PluginDaemonInnerError if isinstance(exception, httpx.RequestError) else type(exception)
        with pytest.raises(expected_error) as exc_info:
            _check(PluginCredentialAuthClient())
    if isinstance(exception, httpx.RequestError):
        assert exc_info.value.__cause__ is exception
    else:
        assert exc_info.value is exception


def test_unauthorized_type_does_not_dispatch() -> None:
    def respond(_: httpx.Request) -> httpx.Response:
        pytest.fail("Invalid credential type must not dispatch")

    with _daemon(respond):
        with pytest.raises(ValueError, match="require API key or OAuth2"):
            _check(PluginCredentialAuthClient(), CredentialType.UNAUTHORIZED)
