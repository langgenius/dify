"""Unit tests for DingTalk SDK and HTTP boundaries using test doubles."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

import pytest
from alibabacloud_dingtalk.oauth2_1_0.client import Client as OAuthClient
from alibabacloud_dingtalk.oauth2_1_0.models import GetTokenRequest, GetTokenResponse, GetTokenResponseBody
from alibabacloud_dingtalk.robot_1_0.client import Client as RobotClient
from alibabacloud_dingtalk.robot_1_0.models import (
    BatchSendOTOHeaders,
    BatchSendOTORequest,
    BatchSendOTOResponse,
    BatchSendOTOResponseBody,
)
from alibabacloud_tea_util.models import RuntimeOptions

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import dingtalk as dingtalk_module
from core.human_input_v2.im_integration.adapters.dingtalk import DingTalkIMProviderAdapter
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

_FIXTURE_PATH = Path(__file__).parents[4] / "fixtures" / "im_provider" / "dingtalk" / "sanitized_protocol.json"


class _SDKError(Exception):
    def __init__(self, status_code: int | None = None) -> None:
        super().__init__("fake provider exception detail must not escape")
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class _MalformedTokenResponse:
    body: object | None
    status_code: int = 200


class _OAuthSequence:
    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, GetTokenRequest]] = []

    def get_token(self, corp_id: str, request: GetTokenRequest) -> object:
        self.calls.append((corp_id, request))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class _RobotSequence:
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


class _FixtureHTTPClient:
    def __init__(
        self,
        route: Callable[[str, dict[str, int]], tuple[int, dict[str, object]]],
    ) -> None:
        self._route = route
        self.calls: list[tuple[str, str, dict[str, int]]] = []
        self.close_calls = 0

    def get(self, url: str, *, access_token: str) -> bytes:
        path = urlparse(url).path
        self.calls.append((path, access_token, {}))
        status_code, response = self._route(path, {})
        if not 200 <= status_code < 300:
            raise OSError("fake HTTP failure detail")
        return json.dumps(response, separators=(",", ":")).encode()

    def post(self, url: str, *, access_token: str, body: dict[str, int]) -> bytes:
        path = urlparse(url).path
        self.calls.append((path, access_token, dict(body)))
        status_code, response = self._route(path, dict(body))
        if not 200 <= status_code < 300:
            raise OSError("fake HTTP failure detail")
        return json.dumps(response, separators=(",", ":")).encode()

    def close(self) -> None:
        self.close_calls += 1


class _Consumer:
    def accept(self, event: object) -> EventAcceptance:
        del event
        return EventAcceptance.ACCEPTED


def _credentials(
    *,
    corp_id: str = "fake-corp-001",
    client_id: str = "fake-client-001",
    client_secret: str = "fake-client-secret-001",
) -> DingTalkIMIntegrationCredentials:
    return DingTalkIMIntegrationCredentials(
        provider=IMProvider.DING_TALK,
        corp_id=corp_id,
        client_id=client_id,
        client_secret=client_secret,
    )


def _token_response(token: str) -> GetTokenResponse:
    return GetTokenResponse(
        headers={"content-type": "application/json", "x-acs-request-id": "fake-request-token-001"},
        status_code=200,
        body=GetTokenResponseBody(access_token=token, expires_in=7200),
    )


def _message_response(
    *,
    status_code: int = 200,
    process_query_key: str = "fake-process-query-key-001",
    filtered: list[str] | None = None,
    flow_controlled: list[str] | None = None,
    invalid: list[str] | None = None,
) -> BatchSendOTOResponse:
    filtered_ids: list[str] = [] if filtered is None else filtered
    flow_controlled_ids: list[str] = [] if flow_controlled is None else flow_controlled
    invalid_ids: list[str] = [] if invalid is None else invalid
    return BatchSendOTOResponse(
        headers={"content-type": "application/json", "x-acs-request-id": "fake-request-message-001"},
        status_code=status_code,
        body=BatchSendOTOResponseBody(
            filtered_staff_id_list=filtered_ids,
            flow_controlled_staff_id_list=flow_controlled_ids,
            invalid_staff_id_list=invalid_ids,
            process_query_key=process_query_key,
        ),
    )


def _message_response_without_locator() -> BatchSendOTOResponse:
    return BatchSendOTOResponse(
        headers={"content-type": "application/json", "x-acs-request-id": "fake-request-message-missing-locator"},
        status_code=200,
        body=BatchSendOTOResponseBody(
            filtered_staff_id_list=[],
            flow_controlled_staff_id_list=[],
            invalid_staff_id_list=[],
        ),
    )


def _fixture_route() -> Callable[[str, dict[str, int]], tuple[int, dict[str, object]]]:
    fixture = json.loads(_FIXTURE_PATH.read_text())
    scope_exchange = fixture["authorization_scope"]
    exchanges = fixture["directory"]

    def route(path: str, body: dict[str, int]) -> tuple[int, dict[str, object]]:
        if scope_exchange["request"] == {"method": "GET", "path": path} and body == {}:
            return 200, scope_exchange["response"]
        for exchange in exchanges:
            request = exchange["request"]
            if request == {"path": path, "body": body}:
                return 200, exchange["response"]
        raise AssertionError(f"unexpected fixture request: {path} {body}")

    return route


def _adapter(
    monkeypatch: pytest.MonkeyPatch,
    *,
    direct: _OAuthSequence,
    provider: _OAuthSequence | None = None,
    robot: _RobotSequence | None = None,
    http: _FixtureHTTPClient | None = None,
    credentials: DingTalkIMIntegrationCredentials | None = None,
) -> tuple[DingTalkIMProviderAdapter, _OAuthSequence, _RobotSequence, _FixtureHTTPClient]:
    provider = provider or _OAuthSequence()
    robot = robot or _RobotSequence()
    http = http or _FixtureHTTPClient(_fixture_route())
    clients = iter((direct, provider))
    monkeypatch.setattr(dingtalk_module, "_new_oauth_client", lambda: next(clients))
    monkeypatch.setattr(dingtalk_module, "_new_robot_client", lambda: robot)
    monkeypatch.setattr(dingtalk_module, "_new_http_client", lambda: http)
    return DingTalkIMProviderAdapter(credentials or _credentials()), provider, robot, http


def test_public_adapter_round_trips_fresh_credentials_directory_and_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    direct = _OAuthSequence(
        _token_response("fake-access-token-direct-001"),
        _token_response("fake-access-token-direct-002"),
    )
    provider = _OAuthSequence(
        _token_response("fake-access-token-directory-001"),
        _token_response("fake-access-token-message-001"),
    )
    robot = _RobotSequence(_message_response(filtered=[], flow_controlled=[], invalid=[]))
    adapter, provider, robot, http = _adapter(
        monkeypatch,
        direct=direct,
        provider=provider,
        robot=robot,
    )

    assert adapter.provider is IMProvider.DING_TALK
    assert adapter.directory is adapter.directory
    assert adapter.messaging is adapter.messaging
    assert adapter.dynamic_card_messaging is None
    assert adapter.create_webhook_handler(_Consumer()) is None
    assert adapter.create_stream_handler(_Consumer()) is None
    assert direct.calls == []
    assert provider.calls == []
    assert robot.calls == []

    first_credentials = adapter.test_credentials()
    directory = adapter.directory.read_directory()
    message = adapter.messaging.send_text(ProviderUserId("fake-user-001"), "Exact **CommonMark** body")
    second_credentials = adapter.test_credentials()

    assert first_credentials == CredentialTestSuccess(IMProvider.DING_TALK, "fake-corp-001")
    assert second_credentials == first_credentials
    assert isinstance(directory, Directory)
    assert [entry.provider_user_id for entry in directory.entries] == [
        "fake-user-001",
        "fake-user-002",
        "fake-user-003",
    ]
    assert directory.entries[1].display_name is None
    assert directory.entries[2].email is None
    assert isinstance(message, MessageAccepted)
    persisted_locator = json.loads(json.dumps({"locator": str(message.locator)}, separators=(",", ":")))["locator"]
    assert dingtalk_module.MessageLocator(persisted_locator) == message.locator
    assert len(direct.calls) == 2
    assert len(provider.calls) == 2
    assert [corp_id for corp_id, _request in direct.calls] == ["fake-corp-001", "fake-corp-001"]
    assert [call[1] for call in http.calls if call[0].endswith("/department/listsub")][:2] == [
        "fake-access-token-direct-001",
        "fake-access-token-directory-001",
    ]
    request, headers, runtime = robot.calls[0]
    assert request.user_ids == ["fake-user-001"]
    assert request.msg_key == "sampleText"
    assert json.loads(request.msg_param) == {"content": "Exact **CommonMark** body"}
    assert headers.x_acs_dingtalk_access_token == "fake-access-token-message-001"
    assert runtime.autoretry is False
    assert runtime.max_attempts == 1

    adapter.close()
    adapter.close()
    assert http.close_calls == 1


@pytest.mark.parametrize(
    ("direct_response", "expected_kind"),
    [
        (_SDKError(401), CredentialTestFailureKind.AUTHENTICATION_REJECTED),
        (_SDKError(500), CredentialTestFailureKind.UNKNOWN),
        (_MalformedTokenResponse(body=None), CredentialTestFailureKind.UNKNOWN),
        (
            GetTokenResponse(status_code=200, body=GetTokenResponseBody(access_token="fake-token", expires_in=0)),
            CredentialTestFailureKind.UNKNOWN,
        ),
    ],
)
def test_public_credential_test_normalizes_token_failures(
    monkeypatch: pytest.MonkeyPatch,
    direct_response: object,
    expected_kind: CredentialTestFailureKind,
) -> None:
    adapter, _provider, _robot, http = _adapter(
        monkeypatch,
        direct=_OAuthSequence(direct_response),
    )

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is expected_kind
    assert "fake" not in result.reason.casefold()
    assert http.calls == []


def test_public_credential_test_reads_scope_fixture_before_root_baseline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter, _provider, _robot, http = _adapter(
        monkeypatch,
        direct=_OAuthSequence(_token_response("fake-access-token-direct-scope-001")),
    )

    result = adapter.test_credentials()

    assert result == CredentialTestSuccess(IMProvider.DING_TALK, "fake-corp-001")
    assert http.calls[:2] == [
        ("/auth/scopes", "fake-access-token-direct-scope-001", {}),
        ("/topapi/v2/department/listsub", "fake-access-token-direct-scope-001", {"dept_id": 1}),
    ]


@pytest.mark.parametrize(
    ("root_response", "expected_kind"),
    [
        ({"errcode": 40035, "errmsg": "fake raw provider detail"}, CredentialTestFailureKind.TENANT_ID_UNAVAILABLE),
        ({"errcode": 0, "errmsg": "ok"}, CredentialTestFailureKind.UNKNOWN),
        ({"errcode": "invalid", "errmsg": "fake malformed detail"}, CredentialTestFailureKind.UNKNOWN),
    ],
)
def test_public_credential_test_requires_a_valid_root_baseline(
    monkeypatch: pytest.MonkeyPatch,
    root_response: dict[str, object],
    expected_kind: CredentialTestFailureKind,
) -> None:
    def route(path: str, _body: dict[str, int]) -> tuple[int, dict[str, object]]:
        if path.endswith("/auth/scopes"):
            return 200, {
                "errcode": 0,
                "errmsg": "ok",
                "auth_org_scopes": {"authed_dept": [1], "authed_user": []},
            }
        return 200, root_response

    http = _FixtureHTTPClient(route)
    adapter, _provider, _robot, _http = _adapter(
        monkeypatch,
        direct=_OAuthSequence(_token_response("fake-access-token-direct-001")),
        http=http,
    )

    result = adapter.test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is expected_kind
    assert "fake" not in result.reason.casefold()
    assert len(http.calls) == 2


def test_public_directory_discards_late_partial_state_and_detects_bad_cursor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def route(path: str, body: dict[str, int]) -> tuple[int, dict[str, object]]:
        if path.endswith("/department/listsub"):
            return 200, {"errcode": 0, "errmsg": "ok", "result": [{"dept_id": 2}]}
        if body["dept_id"] == 1:
            return 200, {
                "errcode": 0,
                "errmsg": "ok",
                "result": {
                    "has_more": True,
                    "next_cursor": 0,
                    "list": [{"userid": "fake-user-partial", "name": "Fake Partial"}],
                },
            }
        return 200, {"errcode": 0, "errmsg": "ok", "result": {"has_more": False, "list": []}}

    adapter, provider, _robot, http = _adapter(
        monkeypatch,
        direct=_OAuthSequence(),
        provider=_OAuthSequence(_token_response("fake-access-token-directory-001")),
        http=_FixtureHTTPClient(route),
    )

    result = adapter.directory.read_directory()

    assert result == DirectoryReadFailure("DingTalk directory could not be read completely.")
    assert len(provider.calls) == 1
    assert len(http.calls) >= 2


@pytest.mark.parametrize(
    "provider_response",
    [
        _SDKError(500),
        _message_response_without_locator(),
        _message_response(filtered=["fake-user-001"]),
        _message_response(flow_controlled=["fake-user-001"]),
        _message_response(invalid=["fake-user-001"]),
        SimpleNamespace(body=SimpleNamespace(process_query_key="fake-key", invalid_staff_id_list=object())),
    ],
)
def test_public_messaging_returns_one_safe_failure_without_replay(
    monkeypatch: pytest.MonkeyPatch,
    provider_response: object,
) -> None:
    adapter, provider, robot, _http = _adapter(
        monkeypatch,
        direct=_OAuthSequence(),
        provider=_OAuthSequence(_token_response("fake-access-token-message-001")),
        robot=_RobotSequence(provider_response),
    )

    result = adapter.messaging.send_text(ProviderUserId("fake-user-001"), "Exact body")

    assert result == MessageSendingError("DingTalk message acceptance could not be confirmed.")
    assert len(provider.calls) == 1
    assert len(robot.calls) == 1


def test_public_messaging_does_not_mutate_when_token_acquisition_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter, provider, robot, _http = _adapter(
        monkeypatch,
        direct=_OAuthSequence(),
        provider=_OAuthSequence(_SDKError(500)),
        robot=_RobotSequence(),
    )

    result = adapter.messaging.send_text(ProviderUserId("fake-user-001"), "Exact body")

    assert result == MessageSendingError("DingTalk message acceptance could not be confirmed.")
    assert len(provider.calls) == 1
    assert robot.calls == []


def test_public_sdk_surface_and_local_factories_are_importable_without_io() -> None:
    assert callable(OAuthClient.get_token)
    assert callable(RobotClient.batch_send_otowith_options)
    assert isinstance(dingtalk_module._new_oauth_client(), OAuthClient)
    assert isinstance(dingtalk_module._new_robot_client(), RobotClient)
    http_client = dingtalk_module._new_http_client()
    assert isinstance(http_client, dingtalk_module._UrllibDirectoryHTTPClient)
    assert http_client.close() is None


def test_public_messaging_rejects_non_success_http_status_even_with_locator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter, provider, robot, _http = _adapter(
        monkeypatch,
        direct=_OAuthSequence(),
        provider=_OAuthSequence(_token_response("fake-access-token-message-001")),
        robot=_RobotSequence(
            _message_response(
                status_code=500,
                process_query_key="fake-process-query-key-must-not-confirm-acceptance",
                filtered=[],
                flow_controlled=[],
                invalid=[],
            )
        ),
    )

    result = adapter.messaging.send_text(ProviderUserId("fake-user-001"), "Exact body")

    assert result == MessageSendingError("DingTalk message acceptance could not be confirmed.")
    assert len(provider.calls) == 1
    assert len(robot.calls) == 1
    _request, _headers, runtime = robot.calls[0]
    assert runtime.autoretry is False
    assert runtime.max_attempts == 1
