from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlparse

import pytest
from alibabacloud_dingtalk.oauth2_1_0.models import GetTokenRequest, GetTokenResponse, GetTokenResponseBody
from alibabacloud_dingtalk.robot_1_0.models import (
    BatchSendOTOHeaders,
    BatchSendOTORequest,
    BatchSendOTOResponse,
    BatchSendOTOResponseBody,
)
from alibabacloud_tea_util.models import RuntimeOptions

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import dingtalk as dingtalk_module
from core.human_input_v2.im_integration.adapters.dingtalk import (
    DingTalkIMProviderAdapter,
    _DingTalkDirectory,
    _DingTalkMessaging,
)
from core.human_input_v2.im_provider import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    DingTalkIMIntegrationCredentials,
    Directory,
    DirectoryReadFailure,
    EventAcceptance,
    MessageAccepted,
    MessageSendingError,
    ProviderUserId,
)


class _ProviderError(Exception):
    def __init__(self, *, status_code: int | None = None) -> None:
        super().__init__("sanitized provider response that must not escape")
        self.status_code = status_code


class _CamelCaseProviderError(Exception):
    def __init__(self, status_code: int) -> None:
        super().__init__("sanitized provider response that must not escape")
        self.statusCode = status_code


@dataclass(frozen=True, slots=True)
class _MalformedTokenResponse:
    body: object | None
    status_code: int = 200


class _FakeOAuthClient:
    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, GetTokenRequest]] = []

    def get_token(self, corp_id: str, request: GetTokenRequest) -> object:
        self.calls.append((corp_id, request))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class _FakeTokenProvider:
    def __init__(self, *responses: str | Exception) -> None:
        self.responses = list(responses)
        self.calls = 0

    def get(self) -> str:
        self.calls += 1
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class _FakeRobotClient:
    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[BatchSendOTORequest, BatchSendOTOHeaders, RuntimeOptions]] = []

    def batch_send_otowith_options(
        self,
        request: BatchSendOTORequest,
        headers: BatchSendOTOHeaders,
        runtime: RuntimeOptions,
    ) -> object:
        self.calls.append((request, headers, runtime))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


@dataclass(frozen=True)
class _RecordedRequest:
    path: str
    token: str | None
    body: dict[str, object]
    method: str = "POST"


class _FakeDirectoryHTTPClient:
    def __init__(
        self,
        route: Callable[[_RecordedRequest], tuple[int, dict[str, object]]],
        recorded: list[_RecordedRequest] | None = None,
    ) -> None:
        self._route = route
        self._recorded = recorded
        self.close_calls = 0

    def post(self, url: str, *, access_token: str, body: dict[str, int]) -> bytes:
        parsed = _RecordedRequest(
            path=urlparse(url).path,
            token=access_token,
            body=dict(body),
        )
        if self._recorded is not None:
            self._recorded.append(parsed)
        status_code, payload = self._route(parsed)
        if not 200 <= status_code < 300:
            raise OSError
        return json.dumps(payload, separators=(",", ":")).encode()

    def get(self, url: str, *, access_token: str) -> bytes:
        parsed = _RecordedRequest(
            path=urlparse(url).path,
            token=access_token,
            body={},
            method="GET",
        )
        if self._recorded is not None:
            self._recorded.append(parsed)
        try:
            status_code, payload = self._route(parsed)
        except OSError:
            raise dingtalk_module._DirectoryHTTPError from None
        if not 200 <= status_code < 300:
            raise dingtalk_module._DirectoryHTTPError
        return json.dumps(payload, separators=(",", ":")).encode()

    def close(self) -> None:
        self.close_calls += 1


class _Consumer:
    def accept(self, event: object) -> EventAcceptance:
        del event
        return EventAcceptance.ACCEPTED


def _token_response(token: str = "sanitized-access-token", expires_in: int = 7200) -> object:
    return SimpleNamespace(body=SimpleNamespace(access_token=token, expires_in=expires_in))


def _send_response(
    *,
    status_code: int = 200,
    process_query_key: str | None = "sanitized-process-key",
    filtered: list[str] | None = None,
    flow_controlled: list[str] | None = None,
    invalid: list[str] | None = None,
) -> object:
    return SimpleNamespace(
        status_code=status_code,
        body=SimpleNamespace(
            process_query_key=process_query_key,
            filtered_staff_id_list=filtered,
            flow_controlled_staff_id_list=flow_controlled,
            invalid_staff_id_list=invalid,
        ),
    )


def _credentials(
    *,
    corp_id: str = "sanitized-corp-id",
    client_id: str = "sanitized-client-id",
    client_secret: str = "sanitized-client-secret",
) -> DingTalkIMIntegrationCredentials:
    return DingTalkIMIntegrationCredentials(
        provider=IMProvider.DING_TALK,
        corp_id=corp_id,
        client_id=client_id,
        client_secret=client_secret,
    )


def _http_client(
    route: Callable[[_RecordedRequest], tuple[int, dict[str, object]]],
    recorded: list[_RecordedRequest] | None = None,
) -> _FakeDirectoryHTTPClient:
    return _FakeDirectoryHTTPClient(route, recorded)


def _successful_directory_route(request: _RecordedRequest) -> tuple[int, dict[str, object]]:
    if request.path.endswith("/auth/scopes"):
        return 200, {
            "errcode": 0,
            "errmsg": "ok",
            "auth_org_scopes": {
                "authed_dept": [1, 2],
                "authed_user": ["sanitized-redundant-user"],
            },
        }
    if request.path.endswith("/department/listsub"):
        department_id = request.body["dept_id"]
        children: list[dict[str, int]] = [{"dept_id": 2}] if department_id == 1 else []
        return 200, {"errcode": 0, "result": children}
    assert request.path.endswith("/user/list")
    department_id = request.body["dept_id"]
    cursor = request.body["cursor"]
    if department_id == 1 and cursor == 0:
        return 200, {
            "errcode": 0,
            "result": {
                "has_more": True,
                "next_cursor": 7,
                "list": [
                    {
                        "userid": "sanitized-user-1",
                        "name": "Sanitized User One",
                        "email": "one@example.com",
                        "active": True,
                    }
                ],
            },
        }
    if department_id == 1 and cursor == 7:
        return 200, {
            "errcode": 0,
            "result": {
                "has_more": False,
                "list": [
                    {
                        "userid": "sanitized-user-2",
                        "active": False,
                    }
                ],
            },
        }
    assert department_id == 2
    return 200, {
        "errcode": 0,
        "result": {
            "has_more": False,
            "list": [
                {
                    "userid": "sanitized-user-2",
                    "name": "Duplicate User",
                    "email": "duplicate@example.com",
                    "active": False,
                },
                {
                    "userid": "sanitized-user-3",
                    "name": "   ",
                    "email": "",
                    "active": True,
                },
            ],
        },
    }


def test_construction_and_capability_inspection_perform_no_provider_io(monkeypatch: pytest.MonkeyPatch) -> None:
    direct_client = _FakeOAuthClient()
    provider_client = _FakeOAuthClient()
    robot_client = _FakeRobotClient()
    http_client = _http_client(lambda _request: pytest.fail("unexpected provider I/O"))
    clients = iter((direct_client, provider_client))
    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: next(clients))
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", lambda: robot_client)
    monkeypatch.setattr(dingtalk_module, "_new_http_client", lambda: http_client)

    adapter = DingTalkIMProviderAdapter(_credentials())

    assert adapter.provider is IMProvider.DING_TALK
    assert adapter.directory is not None
    assert adapter.messaging is not None
    assert adapter.dynamic_card_messaging is None
    assert adapter.create_webhook_handler(_Consumer()) is None
    assert adapter.create_stream_handler(_Consumer()) is None
    assert direct_client.calls == []
    assert provider_client.calls == []
    assert robot_client.calls == []
    adapter.close()
    adapter.close()
    assert http_client.close_calls == 1


def test_credential_test_always_calls_sdk_directly_and_bypasses_provider_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    direct_client = _FakeOAuthClient(_token_response("direct-1"), _token_response("direct-2"))
    provider_client = _FakeOAuthClient(
        _token_response("provider-directory-token"),
        _token_response("provider-messaging-token"),
    )
    robot_client = _FakeRobotClient(_send_response())
    recorded: list[_RecordedRequest] = []
    http_client = _http_client(_successful_directory_route, recorded)
    clients = iter((direct_client, provider_client))
    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: next(clients))
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", lambda: robot_client)
    monkeypatch.setattr(dingtalk_module, "_new_http_client", lambda: http_client)
    adapter = DingTalkIMProviderAdapter(_credentials())

    first = adapter.test_credentials()
    directory = adapter.directory.read_directory()
    message = adapter.messaging.send_text(ProviderUserId("sanitized-user-1"), "Sanitized body")
    second = adapter.test_credentials()

    assert first == CredentialTestSuccess(IMProvider.DING_TALK, "sanitized-corp-id")
    assert second == first
    assert isinstance(directory, Directory)
    assert isinstance(message, MessageAccepted)
    assert len(direct_client.calls) == 2
    assert len(provider_client.calls) == 2
    assert [request.client_id for _, request in direct_client.calls] == [
        "sanitized-client-id",
        "sanitized-client-id",
    ]
    assert [request.client_secret for _, request in direct_client.calls] == [
        "sanitized-client-secret",
        "sanitized-client-secret",
    ]
    assert [corp_id for corp_id, _ in direct_client.calls] == ["sanitized-corp-id", "sanitized-corp-id"]
    baseline_tokens = [request.token for request in recorded if request.path.endswith("/department/listsub")]
    scope_tokens = [request.token for request in recorded if request.path.endswith("/auth/scopes")]
    assert scope_tokens == ["direct-1", "direct-2"]
    assert "direct-1" in baseline_tokens
    assert "direct-2" in baseline_tokens


def test_credential_test_verifies_complete_member_scope_before_root_baseline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clients = iter((_FakeOAuthClient(_token_response("direct-scope-token")), _FakeOAuthClient()))
    recorded: list[_RecordedRequest] = []
    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: next(clients))
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", _FakeRobotClient)
    monkeypatch.setattr(
        dingtalk_module, "_new_http_client", lambda: _http_client(_successful_directory_route, recorded)
    )

    result = DingTalkIMProviderAdapter(_credentials()).test_credentials()

    assert result == CredentialTestSuccess(IMProvider.DING_TALK, "sanitized-corp-id")
    assert [(request.method, request.path) for request in recorded] == [
        ("GET", "/auth/scopes"),
        ("POST", "/topapi/v2/department/listsub"),
    ]
    assert {request.token for request in recorded} == {"direct-scope-token"}


@pytest.mark.parametrize(
    "organization_scope",
    [
        {"authed_dept": [2, 3], "authed_user": []},
        {"authed_dept": [], "authed_user": ["sanitized-direct-user"]},
        {"authed_dept": [], "authed_user": []},
    ],
)
def test_credential_test_rejects_partial_member_scope_without_root_baseline(
    monkeypatch: pytest.MonkeyPatch,
    organization_scope: dict[str, object],
) -> None:
    clients = iter((_FakeOAuthClient(_token_response("direct-partial-scope-token")), _FakeOAuthClient()))
    recorded: list[_RecordedRequest] = []

    def route(request: _RecordedRequest) -> tuple[int, dict[str, object]]:
        if request.path.endswith("/auth/scopes"):
            return 200, {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": organization_scope,
            }
        pytest.fail("partial authorization must not proceed to the root baseline")

    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: next(clients))
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", _FakeRobotClient)
    monkeypatch.setattr(dingtalk_module, "_new_http_client", lambda: _http_client(route, recorded))

    result = DingTalkIMProviderAdapter(_credentials()).test_credentials()

    assert result == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "DingTalk could not verify complete member authorization.",
    )
    assert [(request.method, request.path) for request in recorded] == [("GET", "/auth/scopes")]


@pytest.mark.parametrize(
    "scope_result",
    [
        pytest.param({"errcode": 0, "errmsg": "ok"}, id="missing-scope"),
        pytest.param(
            {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_user": []},
            },
            id="missing-departments",
        ),
        pytest.param(
            {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": [1]},
            },
            id="missing-users",
        ),
        pytest.param(
            {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": ["1"], "authed_user": []},
            },
            id="string-root-department",
        ),
        pytest.param(
            {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": None, "authed_user": []},
            },
            id="null-departments",
        ),
        pytest.param(
            {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": {"root": 1}, "authed_user": []},
            },
            id="wrong-department-container",
        ),
        pytest.param(
            {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": [True], "authed_user": []},
            },
            id="boolean-root-department",
        ),
        pytest.param(
            {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": [1, "2"], "authed_user": []},
            },
            id="invalid-department-element-with-root",
        ),
        pytest.param(
            {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": [1], "authed_user": None},
            },
            id="null-users",
        ),
        pytest.param(
            {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": [1], "authed_user": "sanitized-user"},
            },
            id="wrong-user-container",
        ),
        pytest.param(
            {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": [1], "authed_user": [123]},
            },
            id="invalid-user-element-with-root",
        ),
        pytest.param(
            {"errcode": 60011, "errmsg": "sanitized provider detail"},
            id="provider-rejected",
        ),
        pytest.param(OSError("sanitized transport detail"), id="transport-failure"),
    ],
)
def test_credential_test_fails_closed_when_member_scope_is_unverifiable(
    monkeypatch: pytest.MonkeyPatch,
    scope_result: dict[str, object] | Exception,
) -> None:
    clients = iter((_FakeOAuthClient(_token_response("direct-unverifiable-scope-token")), _FakeOAuthClient()))
    recorded: list[_RecordedRequest] = []

    def route(request: _RecordedRequest) -> tuple[int, dict[str, object]]:
        if not request.path.endswith("/auth/scopes"):
            pytest.fail("unverifiable authorization must not proceed to the root baseline")
        if isinstance(scope_result, Exception):
            raise scope_result
        return 200, scope_result

    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: next(clients))
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", _FakeRobotClient)
    monkeypatch.setattr(dingtalk_module, "_new_http_client", lambda: _http_client(route, recorded))

    result = DingTalkIMProviderAdapter(_credentials()).test_credentials()

    assert result == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "DingTalk could not verify complete member authorization.",
    )
    assert [(request.method, request.path) for request in recorded] == [("GET", "/auth/scopes")]
    assert isinstance(result, CredentialTestFailure)
    assert "sanitized" not in result.reason


def test_credential_test_fails_closed_on_invalid_scope_json_without_leaking_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class InvalidJSONHTTPClient:
        def get(self, url: str, *, access_token: str) -> bytes:
            del url, access_token
            return b'{"secret":"sanitized-sensitive-value"'

        def post(self, url: str, *, access_token: str, body: dict[str, int]) -> bytes:
            del url, access_token, body
            pytest.fail("invalid scope JSON must not proceed to the root baseline")

        def close(self) -> None:
            return None

    clients = iter((_FakeOAuthClient(_token_response("direct-invalid-json-token")), _FakeOAuthClient()))
    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: next(clients))
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", _FakeRobotClient)
    monkeypatch.setattr(dingtalk_module, "_new_http_client", InvalidJSONHTTPClient)

    result = DingTalkIMProviderAdapter(_credentials()).test_credentials()

    assert result == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "DingTalk could not verify complete member authorization.",
    )
    assert isinstance(result, CredentialTestFailure)
    assert "sanitized-sensitive-value" not in result.reason


def test_credential_test_fails_closed_on_scope_http_error_without_root_baseline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clients = iter((_FakeOAuthClient(_token_response("direct-http-error-token")), _FakeOAuthClient()))
    recorded: list[_RecordedRequest] = []

    def route(request: _RecordedRequest) -> tuple[int, dict[str, object]]:
        if not request.path.endswith("/auth/scopes"):
            pytest.fail("scope HTTP failure must not proceed to the root baseline")
        return 503, {"errcode": 0, "errmsg": "sanitized unexpected body"}

    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: next(clients))
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", _FakeRobotClient)
    monkeypatch.setattr(dingtalk_module, "_new_http_client", lambda: _http_client(route, recorded))

    result = DingTalkIMProviderAdapter(_credentials()).test_credentials()

    assert result == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "DingTalk could not verify complete member authorization.",
    )
    assert [(request.method, request.path) for request in recorded] == [("GET", "/auth/scopes")]


def test_changed_credentials_use_a_new_adapter_direct_sdk_call(monkeypatch: pytest.MonkeyPatch) -> None:
    direct_clients = iter((_FakeOAuthClient(_token_response("first")), _FakeOAuthClient(_token_response("second"))))
    provider_clients = iter((_FakeOAuthClient(), _FakeOAuthClient()))
    created_direct: list[_FakeOAuthClient] = []
    invocation = 0

    def new_oauth_client() -> _FakeOAuthClient:
        nonlocal invocation
        invocation += 1
        if invocation % 2:
            client = next(direct_clients)
            created_direct.append(client)
            return client
        return next(provider_clients)

    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", new_oauth_client)
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", _FakeRobotClient)
    monkeypatch.setattr(dingtalk_module, "_new_http_client", lambda: _http_client(_successful_directory_route))

    first = DingTalkIMProviderAdapter(_credentials(client_secret="sanitized-old-secret"))
    second = DingTalkIMProviderAdapter(_credentials(client_secret="sanitized-new-secret"))

    assert isinstance(first.test_credentials(), CredentialTestSuccess)
    assert isinstance(second.test_credentials(), CredentialTestSuccess)
    assert created_direct[0].calls[0][1].client_secret == "sanitized-old-secret"
    assert created_direct[1].calls[0][1].client_secret == "sanitized-new-secret"


@pytest.mark.parametrize(
    ("token_response", "expected_kind"),
    [
        (_ProviderError(status_code=401), CredentialTestFailureKind.AUTHENTICATION_REJECTED),
        (_ProviderError(status_code=500), CredentialTestFailureKind.UNKNOWN),
        (_token_response(token=""), CredentialTestFailureKind.UNKNOWN),
        (_token_response(expires_in=0), CredentialTestFailureKind.UNKNOWN),
    ],
)
def test_credential_test_normalizes_sdk_failures_without_provider_material(
    monkeypatch: pytest.MonkeyPatch,
    token_response: object,
    expected_kind: CredentialTestFailureKind,
) -> None:
    clients = iter((_FakeOAuthClient(token_response), _FakeOAuthClient()))
    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: next(clients))
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", _FakeRobotClient)
    monkeypatch.setattr(dingtalk_module, "_new_http_client", lambda: _http_client(_successful_directory_route))

    result = DingTalkIMProviderAdapter(_credentials()).test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is expected_kind
    assert "sanitized provider response" not in result.reason
    assert "sanitized-client-secret" not in result.reason


def test_credential_test_requires_root_baseline_permission(monkeypatch: pytest.MonkeyPatch) -> None:
    clients = iter((_FakeOAuthClient(_token_response()), _FakeOAuthClient()))
    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: next(clients))
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", _FakeRobotClient)

    def route(request: _RecordedRequest) -> tuple[int, dict[str, object]]:
        if request.path.endswith("/auth/scopes"):
            return 200, {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": [1], "authed_user": []},
            }
        return 200, {"errcode": 60011, "errmsg": "sanitized raw detail"}

    monkeypatch.setattr(dingtalk_module, "_new_http_client", lambda: _http_client(route))

    result = DingTalkIMProviderAdapter(_credentials()).test_credentials()

    assert result == CredentialTestFailure(
        CredentialTestFailureKind.TENANT_ID_UNAVAILABLE,
        "DingTalk could not verify the configured corporation directory boundary.",
    )


def test_directory_traverses_all_departments_and_pages_with_stable_deduplication() -> None:
    token_provider = _FakeTokenProvider("sanitized-access-token")
    recorded: list[_RecordedRequest] = []
    directory = _DingTalkDirectory(token_provider, _http_client(_successful_directory_route, recorded))

    result = directory.read_directory()

    assert result == Directory(
        (
            dingtalk_module.DirectoryEntry(
                ProviderUserId("sanitized-user-1"),
                "Sanitized User One",
                "one@example.com",
            ),
            dingtalk_module.DirectoryEntry(ProviderUserId("sanitized-user-2"), None, None),
            dingtalk_module.DirectoryEntry(ProviderUserId("sanitized-user-3"), None, None),
        )
    )
    assert token_provider.calls == 1
    assert {request.token for request in recorded} == {"sanitized-access-token"}
    assert [request.body["cursor"] for request in recorded if request.path.endswith("/user/list")][:2] == [0, 7]


def test_directory_discards_partial_entries_when_a_later_page_fails() -> None:
    token_provider = _FakeTokenProvider("sanitized-access-token")

    def route(request: _RecordedRequest) -> tuple[int, dict[str, object]]:
        if request.path.endswith("/department/listsub"):
            return 200, {"errcode": 0, "result": []}
        if request.body["cursor"] == 0:
            return 200, {
                "errcode": 0,
                "result": {
                    "has_more": True,
                    "next_cursor": 9,
                    "list": [{"userid": "sanitized-partial-user"}],
                },
            }
        return 200, {"errcode": 0, "result": {"has_more": "invalid", "list": []}}

    result = _DingTalkDirectory(token_provider, _http_client(route)).read_directory()

    assert result == DirectoryReadFailure("DingTalk directory could not be read completely.")
    assert token_provider.calls == 1


@pytest.mark.parametrize(
    "response",
    [
        _send_response(process_query_key=None),
        _send_response(filtered=["sanitized-user"]),
        _send_response(flow_controlled=["sanitized-user"]),
        _send_response(invalid=["sanitized-user"]),
        _ProviderError(status_code=500),
    ],
)
def test_messaging_requires_complete_acceptance_and_persistable_reference(response: object) -> None:
    token_provider = _FakeTokenProvider("sanitized-access-token")
    robot = _FakeRobotClient(response)
    messaging = _DingTalkMessaging("sanitized-client-id", token_provider, robot)

    result = messaging.send_text(ProviderUserId("sanitized-user"), "Rendered **CommonMark** body")

    assert result == MessageSendingError("DingTalk message acceptance could not be confirmed.")
    assert token_provider.calls == 1
    assert len(robot.calls) == 1


def test_messaging_calls_sdk_once_and_returns_opaque_process_reference() -> None:
    token_provider = _FakeTokenProvider("sanitized-access-token")
    robot = _FakeRobotClient(_send_response())
    messaging = _DingTalkMessaging("sanitized-client-id", token_provider, robot)

    result = messaging.send_text(ProviderUserId("sanitized-user"), "Rendered **CommonMark** body")

    assert isinstance(result, MessageAccepted)
    assert token_provider.calls == 1
    assert len(robot.calls) == 1
    request, headers, runtime = robot.calls[0]
    assert request.msg_key == "sampleText"
    assert json.loads(request.msg_param) == {"content": "Rendered **CommonMark** body"}
    assert request.robot_code == "sanitized-client-id"
    assert request.user_ids == ["sanitized-user"]
    assert headers.x_acs_dingtalk_access_token == "sanitized-access-token"
    assert runtime.autoretry is False
    assert runtime.max_attempts == 1
    assert isinstance(result.locator, str)
    assert type(result.locator) is str
    assert (
        dingtalk_module._DingTalkLocatorPayload.decode(str(result.locator))
        == dingtalk_module._DingTalkLocatorPayload(
            v=1,
            p=IMProvider.DING_TALK,
            process_query_key="sanitized-process-key",
        )
    )


_SANITIZED_PROTOCOL_FIXTURE = (
    Path(__file__).parents[4] / "fixtures" / "im_provider" / "dingtalk" / "sanitized_protocol.json"
)


def _assert_sanitized_fixture(value: object, *, field_name: str = "") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized_key = key.casefold().replace("-", "_")
            assert normalized_key != "authorization"
            _assert_sanitized_fixture(nested, field_name=normalized_key)
        return
    if isinstance(value, list):
        for nested in value:
            _assert_sanitized_fixture(nested, field_name=field_name)
        return
    if not isinstance(value, str):
        return
    assert not value.casefold().startswith("bearer ")
    if field_name in {"access_token", "client_secret", "encrypted_client_secret"}:
        assert value.startswith("fake-")
    if field_name in {
        "corp_id",
        "userid",
        "unionid",
        "manager_userid",
        "processquerykey",
        "request_id",
        "login_id",
    }:
        assert not value or value.startswith("fake-")


def _load_sanitized_protocol_fixture() -> dict[str, object]:
    payload = json.loads(_SANITIZED_PROTOCOL_FIXTURE.read_text())
    assert isinstance(payload, dict)
    return payload


def test_sanitized_protocol_fixture_is_complete_and_rejects_sensitive_values() -> None:
    fixture = _load_sanitized_protocol_fixture()

    _assert_sanitized_fixture(fixture)
    assert set(fixture) == {"authorization_scope", "credential_test", "directory", "message"}
    credential_test = fixture["credential_test"]
    authorization_scope = fixture["authorization_scope"]
    message = fixture["message"]
    assert isinstance(credential_test, dict)
    assert set(credential_test) == {"headers", "statusCode", "body"}
    assert isinstance(authorization_scope, dict)
    assert authorization_scope["request"] == {"method": "GET", "path": "/auth/scopes"}
    assert isinstance(authorization_scope["response"], dict)
    assert isinstance(message, dict)
    assert set(message) == {"headers", "statusCode", "body"}
    directory = fixture["directory"]
    assert isinstance(directory, list)
    assert all(isinstance(exchange, dict) and set(exchange) == {"request", "response"} for exchange in directory)

    with pytest.raises(AssertionError):
        _assert_sanitized_fixture({"Authorization": "Bearer fake-placeholder"})
    with pytest.raises(AssertionError):
        _assert_sanitized_fixture({"access_token": "non-fake-token-material"})
    with pytest.raises(AssertionError):
        _assert_sanitized_fixture({"userid": "non-fake-user-identifier"})


def test_default_token_provider_uses_complete_sdk_responses_without_cache() -> None:
    client = _FakeOAuthClient(
        GetTokenResponse(
            headers={"content-type": "application/json", "x-acs-request-id": "fake-request-token-001"},
            status_code=200,
            body=GetTokenResponseBody(access_token="fake-access-token-001", expires_in=7200),
        ),
        GetTokenResponse(
            headers={"content-type": "application/json", "x-acs-request-id": "fake-request-token-002"},
            status_code=200,
            body=GetTokenResponseBody(access_token="fake-access-token-002", expires_in=3600),
        ),
    )
    provider = dingtalk_module._SDKAccessTokenProvider(_credentials(), client)

    assert provider.get() == "fake-access-token-001"
    assert provider.get() == "fake-access-token-002"
    assert len(client.calls) == 2


@pytest.mark.parametrize(
    "response",
    [
        _MalformedTokenResponse(body=None),
        GetTokenResponse(status_code=200, body=GetTokenResponseBody(access_token="fake-token", expires_in=True)),
        GetTokenResponse(status_code=200, body=GetTokenResponseBody(access_token="fake-token", expires_in=-1)),
        SimpleNamespace(body=SimpleNamespace(access_token=object(), expires_in=7200)),
    ],
)
def test_default_token_provider_rejects_malformed_sdk_responses(response: object) -> None:
    provider = dingtalk_module._SDKAccessTokenProvider(_credentials(), _FakeOAuthClient(response))

    with pytest.raises(dingtalk_module._AccessTokenError):
        provider.get()


def test_authentication_rejection_supports_sdk_status_code_aliases() -> None:
    camel_case_error = _CamelCaseProviderError(403)

    assert dingtalk_module._is_authentication_rejection(camel_case_error)
    assert not dingtalk_module._is_authentication_rejection(_ProviderError())


def test_adapter_rejects_non_resolved_credentials_before_client_construction(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: pytest.fail("unexpected client construction"))
    adapter_type_name = "DingTalkIMProviderAdapter"
    adapter_type = getattr(dingtalk_module, adapter_type_name)

    with pytest.raises(TypeError, match="resolved DingTalk credentials"):
        adapter_type(object())


def test_credential_test_normalizes_unknown_root_boundary_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    clients = iter((_FakeOAuthClient(_token_response()), _FakeOAuthClient()))
    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: next(clients))
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", _FakeRobotClient)

    def fail_root(request: _RecordedRequest) -> tuple[int, dict[str, object]]:
        if request.path.endswith("/auth/scopes"):
            return 200, {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": [1], "authed_user": []},
            }
        raise OSError("fake raw transport detail")

    monkeypatch.setattr(dingtalk_module, "_new_http_client", lambda: _http_client(fail_root))

    result = DingTalkIMProviderAdapter(_credentials()).test_credentials()

    assert result == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "DingTalk credential testing could not be completed.",
    )


def test_directory_fixture_preserves_full_traversal_and_minimal_projection() -> None:
    fixture = _load_sanitized_protocol_fixture()
    exchanges = fixture["directory"]
    assert isinstance(exchanges, list)
    queued = list(exchanges)
    recorded: list[_RecordedRequest] = []

    def route(request: _RecordedRequest) -> tuple[int, dict[str, object]]:
        for index, exchange in enumerate(queued):
            assert isinstance(exchange, dict)
            expected_request = exchange["request"]
            assert isinstance(expected_request, dict)
            if expected_request == {"path": request.path, "body": request.body}:
                response = exchange["response"]
                assert isinstance(response, dict)
                queued.pop(index)
                return 200, response
        raise AssertionError(f"unexpected sanitized fixture request: {request.path} {request.body}")

    result = _DingTalkDirectory(
        _FakeTokenProvider("fake-access-token-directory-001"),
        _http_client(route, recorded),
    ).read_directory()

    assert result == Directory(
        (
            dingtalk_module.DirectoryEntry(
                ProviderUserId("fake-user-001"),
                "Fake User One",
                "fake.user.one@example.invalid",
            ),
            dingtalk_module.DirectoryEntry(ProviderUserId("fake-user-002"), None, None),
            dingtalk_module.DirectoryEntry(ProviderUserId("fake-user-003"), None, None),
        )
    )
    assert queued == []
    assert all(set(request.body) <= {"dept_id", "cursor", "size"} for request in recorded)


def test_directory_ignores_repeated_department_edges_without_revisiting() -> None:
    recorded: list[_RecordedRequest] = []

    def route(request: _RecordedRequest) -> tuple[int, dict[str, object]]:
        if request.path.endswith("/department/listsub"):
            children: list[dict[str, int]] = (
                [{"dept_id": 1}, {"dept_id": 2}, {"dept_id": 2}] if request.body["dept_id"] == 1 else []
            )
            return 200, {"errcode": 0, "errmsg": "ok", "result": children}
        return 200, {"errcode": 0, "errmsg": "ok", "result": {"has_more": False, "list": []}}

    result = _DingTalkDirectory(
        _FakeTokenProvider("fake-access-token-directory-001"),
        _http_client(route, recorded),
    ).read_directory()

    assert result == Directory(())
    department_ids = [request.body["dept_id"] for request in recorded if request.path.endswith("/department/listsub")]
    assert department_ids == [1, 2]


@pytest.mark.parametrize(
    "route",
    [
        lambda _request: (200, {"errcode": 0, "errmsg": "ok"}),
        lambda _request: (200, {"errcode": 40035, "errmsg": "fake provider detail"}),
        lambda _request: (200, {"errcode": "invalid", "errmsg": "fake malformed detail"}),
    ],
)
def test_directory_normalizes_root_provider_and_parse_failures(
    route: Callable[[_RecordedRequest], tuple[int, dict[str, object]]],
) -> None:
    result = _DingTalkDirectory(
        _FakeTokenProvider("fake-access-token-directory-001"),
        _http_client(route),
    ).read_directory()

    assert result == DirectoryReadFailure("DingTalk directory could not be read completely.")


def test_directory_rejects_blank_canonical_user_id_without_partial_result() -> None:
    def route(request: _RecordedRequest) -> tuple[int, dict[str, object]]:
        if request.path.endswith("/department/listsub"):
            return 200, {"errcode": 0, "errmsg": "ok", "result": []}
        return 200, {
            "errcode": 0,
            "errmsg": "ok",
            "result": {
                "has_more": False,
                "list": [
                    {"userid": "fake-user-before-failure", "name": "Fake User"},
                    {"userid": "   ", "name": "Fake Invalid User"},
                ],
            },
        }

    result = _DingTalkDirectory(
        _FakeTokenProvider("fake-access-token-directory-001"),
        _http_client(route),
    ).read_directory()

    assert result == DirectoryReadFailure("DingTalk directory could not be read completely.")


def test_directory_rejects_missing_or_repeated_pagination_cursor() -> None:
    def route(request: _RecordedRequest) -> tuple[int, dict[str, object]]:
        if request.path.endswith("/department/listsub"):
            return 200, {"errcode": 0, "errmsg": "ok", "result": []}
        return 200, {
            "errcode": 0,
            "errmsg": "ok",
            "result": {"has_more": True, "next_cursor": 0, "list": []},
        }

    result = _DingTalkDirectory(
        _FakeTokenProvider("fake-access-token-directory-001"),
        _http_client(route),
    ).read_directory()

    assert result == DirectoryReadFailure("DingTalk directory could not be read completely.")


def test_directory_token_failure_does_not_call_http() -> None:
    http_client = _http_client(lambda _request: pytest.fail("unexpected HTTP call"))

    result = _DingTalkDirectory(_FakeTokenProvider(RuntimeError("fake token detail")), http_client).read_directory()

    assert result == DirectoryReadFailure("DingTalk directory could not be read completely.")


class _URLResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def __enter__(self) -> _URLResponse:
        return self

    def __exit__(self, *args: object) -> None:
        del args

    def read(self) -> bytes:
        return self._body


def test_urllib_directory_client_uses_fixed_post_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    recorded: list[tuple[urllib_request.Request, float]] = []

    def urlopen(request: urllib_request.Request, *, timeout: float) -> _URLResponse:
        recorded.append((request, timeout))
        return _URLResponse(b'{"errcode":0,"errmsg":"ok","result":[]}')

    monkeypatch.setattr(dingtalk_module.urllib_request, "urlopen", urlopen)
    client = dingtalk_module._UrllibDirectoryHTTPClient()

    response = client.post(
        dingtalk_module._DEPARTMENT_LIST_URL,
        access_token="fake-access-token-directory-001",
        body={"dept_id": 1},
    )

    assert response == b'{"errcode":0,"errmsg":"ok","result":[]}'
    request, timeout = recorded[0]
    assert request.method == "POST"
    assert request.full_url.startswith(dingtalk_module._DEPARTMENT_LIST_URL)
    assert "access_token=fake-access-token-directory-001" in request.full_url
    assert request.data == b'{"dept_id":1}'
    assert timeout == dingtalk_module._HTTP_TIMEOUT_SECONDS
    assert client.close() is None


def test_urllib_client_uses_fixed_authorization_scope_get_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    recorded: list[tuple[urllib_request.Request, float]] = []

    def urlopen(request: urllib_request.Request, *, timeout: float) -> _URLResponse:
        recorded.append((request, timeout))
        return _URLResponse(b'{"errcode":0,"errmsg":"ok","auth_org_scopes":{"authed_dept":[1],"authed_user":[]}}')

    monkeypatch.setattr(dingtalk_module.urllib_request, "urlopen", urlopen)
    client = dingtalk_module._UrllibDirectoryHTTPClient()

    response = client.get(
        "https://oapi.dingtalk.com/auth/scopes",
        access_token="fake-access-token-scope-001",
    )

    assert response.startswith(b'{"errcode":0')
    request, timeout = recorded[0]
    assert request.method == "GET"
    assert request.full_url.startswith("https://oapi.dingtalk.com/auth/scopes")
    assert "access_token=fake-access-token-scope-001" in request.full_url
    assert request.data is None
    assert timeout == dingtalk_module._HTTP_TIMEOUT_SECONDS


@pytest.mark.parametrize(
    "error",
    [OSError("fake os error"), ValueError("fake value error"), urllib_error.URLError("fake URL error")],
)
def test_urllib_client_normalizes_authorization_scope_transport_errors(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
) -> None:
    def fail_urlopen(*args: object, **kwargs: object) -> object:
        del args, kwargs
        raise error

    monkeypatch.setattr(dingtalk_module.urllib_request, "urlopen", fail_urlopen)

    with pytest.raises(dingtalk_module._DirectoryHTTPError) as caught:
        dingtalk_module._UrllibDirectoryHTTPClient().get(
            "https://oapi.dingtalk.com/auth/scopes",
            access_token="fake-access-token-scope-001",
        )
    assert str(caught.value) == ""


@pytest.mark.parametrize(
    "error",
    [OSError("fake os error"), ValueError("fake value error"), urllib_error.URLError("fake URL error")],
)
def test_urllib_directory_client_normalizes_transport_errors(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
) -> None:
    def fail_urlopen(*args: object, **kwargs: object) -> object:
        del args, kwargs
        raise error

    monkeypatch.setattr(dingtalk_module.urllib_request, "urlopen", fail_urlopen)

    with pytest.raises(dingtalk_module._DirectoryHTTPError) as caught:
        dingtalk_module._UrllibDirectoryHTTPClient().post(
            dingtalk_module._USER_LIST_URL,
            access_token="fake-access-token-directory-001",
            body={"dept_id": 1, "cursor": 0, "size": 100},
        )
    assert str(caught.value) == ""


def test_messaging_accepts_complete_sdk_response_and_locator_round_trips_through_json_text() -> None:
    token_provider = _FakeTokenProvider("fake-access-token-message-001")
    response = BatchSendOTOResponse(
        headers={"content-type": "application/json", "x-acs-request-id": "fake-request-message-001"},
        status_code=200,
        body=BatchSendOTOResponseBody(
            filtered_staff_id_list=[],
            flow_controlled_staff_id_list=[],
            invalid_staff_id_list=[],
            process_query_key="fake-process-query-key-001",
        ),
    )
    robot = _FakeRobotClient(response)

    result = _DingTalkMessaging("fake-client-id-001", token_provider, robot).send_text(
        ProviderUserId("fake-user-001"),
        "Exact **CommonMark** body",
    )

    assert isinstance(result, MessageAccepted)
    persisted_locator = json.loads(json.dumps({"locator": str(result.locator)}, separators=(",", ":")))["locator"]
    rehydrated = dingtalk_module.MessageLocator(persisted_locator)
    assert rehydrated == result.locator
    assert "fake-process-query-key-001" not in repr(rehydrated)
    assert token_provider.calls == 1
    assert len(robot.calls) == 1


@pytest.mark.parametrize(
    "response",
    [
        SimpleNamespace(body=None),
        SimpleNamespace(body=SimpleNamespace(process_query_key=" ")),
        SimpleNamespace(body=SimpleNamespace(process_query_key="fake-key", invalid_staff_id_list="fake-user-001")),
        SimpleNamespace(body=SimpleNamespace(process_query_key="fake-key", filtered_staff_id_list=object())),
    ],
)
def test_messaging_rejects_malformed_or_partial_sdk_responses_once(response: object) -> None:
    token_provider = _FakeTokenProvider("fake-access-token-message-001")
    robot = _FakeRobotClient(response)

    result = _DingTalkMessaging("fake-client-id-001", token_provider, robot).send_text(
        ProviderUserId("fake-user-001"),
        "Exact body",
    )

    assert result == MessageSendingError("DingTalk message acceptance could not be confirmed.")
    assert token_provider.calls == 1
    assert len(robot.calls) == 1


def test_messaging_token_failure_performs_no_mutation() -> None:
    token_provider = _FakeTokenProvider(RuntimeError("fake token failure"))
    robot = _FakeRobotClient()

    result = _DingTalkMessaging("fake-client-id-001", token_provider, robot).send_text(
        ProviderUserId("fake-user-001"),
        "Exact body",
    )

    assert result == MessageSendingError("DingTalk message acceptance could not be confirmed.")
    assert token_provider.calls == 1
    assert robot.calls == []


def test_sdk_configuration_disables_implicit_endpoint_or_retry_state() -> None:
    config = dingtalk_module._sdk_config()

    assert config.protocol == "https"
    assert config.connect_timeout == dingtalk_module._SDK_TIMEOUT_MILLISECONDS
    assert config.read_timeout == dingtalk_module._SDK_TIMEOUT_MILLISECONDS
    assert config.endpoint is None
