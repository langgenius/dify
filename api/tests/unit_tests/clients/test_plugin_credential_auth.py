import json
from collections.abc import Callable, Iterator
from typing import override
from unittest.mock import patch

import httpx
import pytest

from clients.plugin.auth import PluginCredentialAuthClient
from clients.plugin.auth_entities import CredentialCheckResult, OAuthRevokeResult
from clients.plugin.http_client import get_client
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


def test_shared_client_preserves_legacy_and_detailed_requests() -> None:
    formats: list[str | None] = []

    def respond(request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content)["data"]
        formats.append(data.get("result_format"))
        payload = _result("valid") if data.get("result_format") == "detailed" else {"result": True}
        return httpx.Response(200, text=_frame(payload))

    with (
        httpx.Client(transport=httpx.MockTransport(respond)) as http_client,
        patch.object(get_client(), "stream", http_client.stream),
    ):
        assert PluginToolManager().validate_provider_credentials("tenant-1", "user-1", "org/plugin/provider", {})
        assert _check(PluginCredentialAuthClient()).status == "valid"
    assert formats == [None, "detailed"]


@pytest.mark.parametrize("legacy_result", [True, False, 1, "true"])
def test_new_api_accepts_only_explicit_legacy_success(legacy_result: object) -> None:
    with httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, text=_frame({"result": legacy_result})))
    ) as http_client:
        result = _check(PluginCredentialAuthClient(http_client=http_client))
    assert result.status == ("valid" if legacy_result is True else "temporarily_unavailable")
    assert result.reason_code == (None if legacy_result is True else "protocol_error")
    assert result.retryable is False


def test_missing_revoke_endpoint_is_not_plugin_unsupported() -> None:
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(404))) as http_client:
        result = _revoke(PluginCredentialAuthClient(http_client=http_client))
    assert result.status == "failed"
    assert result.retryable is False


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
        (_check, _result("invalid", reason_code="credential_revoked")),
        (_check, _result("unsupported")),
        (_check, _result("temporarily_unavailable", reason_code="provider_timeout", retryable=True)),
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
def test_malformed_checks_do_not_invalidate_credentials(body: str, caplog: pytest.LogCaptureFixture) -> None:
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, text=body))) as http_client:
        result = _check(PluginCredentialAuthClient(http_client=http_client))
    assert result.status == "temporarily_unavailable"
    assert result.reason_code == "protocol_error"
    assert result.retryable is False
    assert SECRET not in result.model_dump_json()
    assert SECRET not in caplog.text


@pytest.mark.parametrize(
    ("operation", "success"),
    [(_check, _result("valid")), (_check, {"result": True}), (_revoke, _result("revoked"))],
)
def test_error_after_success_is_not_accepted(
    operation: Operation, success: dict[str, object], caplog: pytest.LogCaptureFixture
) -> None:
    error = json.dumps({"error_type": "PluginInvokeError", "message": SECRET})
    body = _frame(success) + _frame(None, code=-500, message=error)
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, text=body))) as http_client:
        result = operation(PluginCredentialAuthClient(http_client=http_client))
    assert result.status == ("temporarily_unavailable" if operation is _check else "failed")
    assert result.reason_code == "protocol_error"
    assert result.retryable is False
    assert SECRET not in result.model_dump_json()
    assert SECRET not in caplog.text


@pytest.mark.parametrize("operation", [_check, _revoke])
@pytest.mark.parametrize(("status_code", "retryable"), [(401, False), (429, True), (503, True)])
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


@pytest.mark.parametrize("exception", [httpx.ReadTimeout(SECRET), RuntimeError(SECRET)])
def test_stream_failure_after_success_is_not_accepted(exception: Exception, caplog: pytest.LogCaptureFixture) -> None:
    class InterruptedStream(httpx.SyncByteStream):
        @override
        def __iter__(self) -> Iterator[bytes]:
            yield _frame({"result": True}).encode()
            raise exception

    with httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=InterruptedStream()))
    ) as http_client:
        result = _check(PluginCredentialAuthClient(http_client=http_client))
    assert result.status == "temporarily_unavailable"
    assert result.retryable is isinstance(exception, httpx.TransportError)
    assert SECRET not in result.model_dump_json()
    assert SECRET not in caplog.text


def test_unauthorized_type_does_not_dispatch() -> None:
    def respond(_: httpx.Request) -> httpx.Response:
        pytest.fail("Invalid credential type must not dispatch")

    with httpx.Client(transport=httpx.MockTransport(respond)) as http_client:
        with pytest.raises(ValueError, match="require API key or OAuth2"):
            _check(PluginCredentialAuthClient(http_client=http_client), CredentialType.UNAUTHORIZED)


@pytest.mark.parametrize("enabled", [False, True])
def test_provider_capabilities_default_to_disabled_and_survive_parsing(enabled: bool) -> None:
    capabilities = {"credential_check": {"api_key": True, "oauth2": False}, "oauth_revoke_supported": True}
    provider = PluginToolProviderEntity.model_validate(
        {
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
                **(capabilities if enabled else {}),
            },
        }
    )
    declaration = provider.model_dump()["declaration"]
    assert declaration["credential_check"] == {"api_key": enabled, "oauth2": False}
    assert declaration["oauth_revoke_supported"] is enabled
