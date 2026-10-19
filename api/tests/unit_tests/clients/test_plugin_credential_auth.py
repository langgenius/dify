import json
from collections.abc import Callable, Iterator
from typing import override

import httpx
import pytest
from pydantic import ValidationError

from clients.plugin.auth import PluginCredentialAuthClient
from clients.plugin.auth_entities import CredentialCheckResult, OAuthRevokeResult
from configs import dify_config
from core.plugin.entities.plugin_daemon import CredentialType, PluginToolProviderEntity
from core.plugin.impl.tool import PluginToolManager

SECRET = "secret-that-must-not-escape"


def _frame(data: object, *, code: int = 0, message: str = "") -> str:
    return f"data: {json.dumps({'code': code, 'message': message, 'data': data})}\n\n"


def _result(status: str, *, reason_code: str | None = None, retryable: bool = False) -> dict[str, object]:
    return {"status": status, "reason_code": reason_code, "retryable": retryable}


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
    with httpx.Client(transport=httpx.MockTransport(respond)) as http_client:
        result = _check(PluginCredentialAuthClient(http_client=http_client), credential_type)

    assert result.model_dump() == {**_result("valid"), "checked_at": 1792141200}
    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert request.url.path == "/plugin/tenant-1/dispatch/tool/validate_credentials"
    assert request.headers["X-Plugin-ID"] == "org/plugin"
    assert request.headers["X-Api-Key"] == dify_config.PLUGIN_DAEMON_KEY
    assert request.extensions["timeout"] == {"connect": 10, "read": 10, "write": 10, "pool": 10}
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

    with httpx.Client(transport=httpx.MockTransport(respond)) as http_client:
        assert _revoke(PluginCredentialAuthClient(http_client=http_client)).status == "revoked"


@pytest.mark.parametrize(
    ("operation", "payload"),
    [
        (_check, _result("valid")),
        (_check, _result("invalid", reason_code="credential_revoked")),
        (_check, _result("unsupported")),
        (_check, _result("temporarily_unavailable", reason_code="provider_timeout", retryable=True)),
        (_revoke, _result("revoked")),
        (_revoke, _result("unsupported")),
        (_revoke, _result("failed")),
        (_revoke, _result("temporarily_unavailable", reason_code="provider_rate_limited", retryable=True)),
    ],
)
def test_detailed_results_are_preserved(operation: Operation, payload: dict[str, object]) -> None:
    with httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, text=_frame(payload)))
    ) as http_client:
        result = operation(PluginCredentialAuthClient(http_client=http_client))
    assert result.model_dump(exclude={"checked_at"}) == payload


@pytest.mark.parametrize("operation", [_check, _revoke])
@pytest.mark.parametrize(
    "body",
    [
        "",
        _frame({"result": True}),
        _frame({"result": False}),
        _frame(None),
        _frame(_result("unknown")),
        _frame({"status": "valid"}),
        _frame(_result("valid", retryable=True)),
        _frame(_result("unsupported", retryable=True)),
        _frame(_result("temporarily_unavailable", reason_code=SECRET, retryable=True)),
        _frame({**_result("unsupported"), "retryable": "false"}),
        _frame({**_result("unsupported"), "credentials": {"access_token": SECRET}}),
        _frame(_result("unsupported")) + _frame(_result("unsupported")),
        _frame(_result("unsupported")) + SECRET,
        SECRET,
        json.dumps([SECRET]),
    ],
)
def test_malformed_streams_fail_closed_without_leaking(
    operation: Operation, body: str, caplog: pytest.LogCaptureFixture
) -> None:
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, text=body))) as http_client:
        result = operation(PluginCredentialAuthClient(http_client=http_client))
    assert result.status == ("temporarily_unavailable" if operation is _check else "failed")
    assert result.reason_code == "protocol_error"
    assert result.retryable is False
    assert SECRET not in result.model_dump_json()
    assert SECRET not in caplog.text


@pytest.mark.parametrize(("operation", "success"), [(_check, "valid"), (_revoke, "revoked")])
def test_error_after_success_is_not_accepted(
    operation: Operation, success: str, caplog: pytest.LogCaptureFixture
) -> None:
    body = _frame(_result(success)) + _frame(None, code=-500, message=SECRET)
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, text=body))) as http_client:
        result = operation(PluginCredentialAuthClient(http_client=http_client))
    assert result.status == ("temporarily_unavailable" if operation is _check else "failed")
    assert result.reason_code == "plugin_error"
    assert result.retryable is False
    assert SECRET not in result.model_dump_json()
    assert SECRET not in caplog.text


@pytest.mark.parametrize("operation", [_check, _revoke])
@pytest.mark.parametrize(
    ("status_code", "retryable"), [(401, False), (404, False), (429, True), (500, True), (503, True)]
)
def test_http_errors_are_not_credential_errors(operation: Operation, status_code: int, retryable: bool) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status_code, text=SECRET)

    with httpx.Client(transport=httpx.MockTransport(respond)) as http_client:
        result = operation(PluginCredentialAuthClient(http_client=http_client))
    assert result.status == ("temporarily_unavailable" if operation is _check or retryable else "failed")
    assert result.reason_code == "daemon_unavailable"
    assert result.retryable is retryable
    assert len(requests) == 1


class _InterruptedStream(httpx.SyncByteStream):
    def __init__(self, first_status: str, exception: Exception) -> None:
        self.first_status = first_status
        self.exception = exception
        self.closed = False

    @override
    def __iter__(self) -> Iterator[bytes]:
        yield _frame(_result(self.first_status)).encode()
        raise self.exception

    @override
    def close(self) -> None:
        self.closed = True


@pytest.mark.parametrize(("operation", "success"), [(_check, "valid"), (_revoke, "revoked")])
@pytest.mark.parametrize("exception", [httpx.ReadTimeout(SECRET), httpx.ConnectError(SECRET), RuntimeError(SECRET)])
def test_interrupted_stream_is_closed_and_sanitized(
    operation: Operation, success: str, exception: Exception, caplog: pytest.LogCaptureFixture
) -> None:
    stream = _InterruptedStream(success, exception)
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=stream))) as http_client:
        result = operation(PluginCredentialAuthClient(http_client=http_client))
    retryable = isinstance(exception, httpx.TransportError)
    assert result.status == ("temporarily_unavailable" if operation is _check or retryable else "failed")
    assert result.reason_code == ("daemon_unavailable" if retryable else "unknown_error")
    assert result.retryable is retryable
    assert stream.closed
    assert SECRET not in result.model_dump_json()
    assert SECRET not in caplog.text


def test_unauthorized_type_does_not_dispatch() -> None:
    def respond(_: httpx.Request) -> httpx.Response:
        pytest.fail("Invalid credential type must not dispatch")

    with httpx.Client(transport=httpx.MockTransport(respond)) as http_client:
        with pytest.raises(ValueError, match="require API key or OAuth2"):
            _check(PluginCredentialAuthClient(http_client=http_client), CredentialType.UNAUTHORIZED)


@pytest.mark.parametrize("timeout", [0, -1])
def test_timeout_must_be_positive(timeout: float) -> None:
    with pytest.raises(ValueError, match="greater than zero"):
        PluginCredentialAuthClient(timeout_seconds=timeout)


def _provider_payload(capabilities: dict[str, object]) -> dict[str, object]:
    return {
        "provider": "provider",
        "plugin_id": "org/plugin",
        "plugin_unique_identifier": "org/plugin:1.0.0@digest",
        "declaration": {
            "identity": {
                "author": "org",
                "name": "provider",
                "description": {"en_US": "Provider"},
                "icon": "icon.svg",
                "label": {"en_US": "Provider"},
            },
            **capabilities,
        },
    }


@pytest.mark.parametrize(
    "capabilities",
    [{}, {"credential_check": {"api_key": True, "oauth2": False}, "oauth_revoke_supported": True}],
)
@pytest.mark.parametrize("list_providers", [False, True])
def test_capabilities_survive_management_parsing(
    capabilities: dict[str, object], list_providers: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = _provider_payload(capabilities)
    data = [payload] if list_providers else payload
    with httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"code": 0, "message": "", "data": data}))
    ) as http_client:
        monkeypatch.setattr("core.plugin.impl.base._httpx_client", http_client)
        manager = PluginToolManager()
        provider = (
            manager.fetch_tool_providers("tenant-1")[0]
            if list_providers
            else manager.fetch_tool_provider("tenant-1", "org/plugin/provider")
        )

    assert provider.plugin_unique_identifier == "org/plugin:1.0.0@digest"
    assert provider.declaration.identity.name == "org/plugin/provider"
    dumped = provider.model_dump()["declaration"]
    assert dumped["credential_check"] == capabilities.get("credential_check", {"api_key": False, "oauth2": False})
    assert dumped["oauth_revoke_supported"] == capabilities.get("oauth_revoke_supported", False)


@pytest.mark.parametrize(
    "capabilities",
    [{"credential_check": {"api_key": "true"}}, {"oauth_revoke_supported": 1}],
)
def test_capabilities_require_explicit_boolean_opt_in(capabilities: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        PluginToolProviderEntity.model_validate(_provider_payload(capabilities))
