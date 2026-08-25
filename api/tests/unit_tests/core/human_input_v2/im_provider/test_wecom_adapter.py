from __future__ import annotations

import gc
import importlib
import weakref

import httpx
import pytest
from wechatpy.enterprise import WeChatClient
from wechatpy.exceptions import WeChatClientException

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    EventAcceptance,
    WeComCredentials,
)


class _Consumer:
    def __init__(self) -> None:
        self.calls = 0

    def accept(self, event: object) -> EventAcceptance:
        del event
        self.calls += 1
        return EventAcceptance.ACCEPTED


class _FakeAgentAPI:
    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.calls: list[int] = []

    def get(self, agent_id: int) -> object:
        self.calls.append(agent_id)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class _FakeClient:
    def __init__(self, token_response: object, *agent_responses: object) -> None:
        self.token_response = token_response
        self.fetch_calls = 0
        self.agent = _FakeAgentAPI(*agent_responses)

    def fetch_access_token(self) -> object:
        self.fetch_calls += 1
        if isinstance(self.token_response, Exception):
            raise self.token_response
        return self.token_response


def _credentials() -> WeComCredentials:
    return WeComCredentials(
        provider=IMProvider.WE_COM,
        corp_id="fake-corp-001",
        agent_id="1000001",
        secret="fake-secret-001",
    )


def _token_response(*, token: str = "fake-access-token-001", expires_in: int = 7200) -> dict[str, object]:
    return {
        "errcode": 0,
        "errmsg": "ok",
        "access_token": token,
        "expires_in": expires_in,
    }


def _agent_response(*, agent_id: int = 1000001) -> dict[str, object]:
    return {
        "errcode": 0,
        "errmsg": "ok",
        "agentid": agent_id,
        "allow_partys": {"partyid": [1]},
    }


def test_root_construction_capabilities_and_close_perform_no_provider_io(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    adapter_type = wecom_module.WeComIMProviderAdapter

    monkeypatch.setattr(
        wecom_module,
        "_new_client",
        lambda *_args, **_kwargs: pytest.fail("unexpected provider I/O"),
    )

    adapter = adapter_type(_credentials())
    directory = adapter.directory
    messaging = adapter.messaging
    consumer = _Consumer()
    consumer_reference = weakref.ref(consumer)

    assert adapter.provider is IMProvider.WE_COM
    assert adapter.directory is directory
    assert adapter.messaging is messaging
    assert adapter.dynamic_card_messaging is None
    assert adapter.create_webhook_handler(consumer) is None
    assert adapter.create_stream_handler(consumer) is None
    assert consumer.calls == 0

    del consumer
    gc.collect()
    assert consumer_reference() is None
    assert adapter.close() is None
    assert adapter.close() is None


def test_root_rejects_a_different_provider_credential_type() -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    adapter_type = wecom_module.WeComIMProviderAdapter

    with pytest.raises(TypeError, match="resolved WeCom credentials"):
        adapter_type(object())


def test_public_sdk_client_factory_disables_automatic_retry_without_io() -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")

    client = wecom_module._new_client(_credentials(), access_token="fake-access-token-001")

    assert isinstance(client, WeChatClient)
    assert client.corp_id == "fake-corp-001"
    assert client.timeout == 5.0
    assert client.auto_retry is False


def test_credential_token_fetch_applies_a_bounded_network_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    observed_requests: list[tuple[object, object]] = []

    class TokenResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "errcode": 0,
                "access_token": " ",
                "expires_in": 7200,
            }

    def get(
        url: httpx.URL | str,
        **kwargs: object,
    ) -> TokenResponse:
        observed_requests.append((url, kwargs.get("timeout")))
        return TokenResponse()

    monkeypatch.setattr(httpx, "get", get)

    result = wecom_module.WeComIMProviderAdapter(_credentials()).test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert observed_requests == [(wecom_module._ACCESS_TOKEN_URL, 5.0)]


def test_credential_token_fetch_preserves_authentication_rejection_classification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")

    class TokenResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "errcode": 40013,
                "errmsg": "fake raw provider detail",
            }

    monkeypatch.setattr(httpx, "get", lambda *_args, **_kwargs: TokenResponse())

    result = wecom_module.WeComIMProviderAdapter(_credentials()).test_credentials()

    assert result == CredentialTestFailure(
        CredentialTestFailureKind.AUTHENTICATION_REJECTED,
        "WeCom rejected the credential test.",
    )
    assert "fake raw provider detail" not in result.reason


def test_credential_test_calls_the_sdk_directly_for_every_invocation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    clients = [
        _FakeClient(_token_response(token="fake-direct-token-001"), _agent_response()),
        _FakeClient(_token_response(token="fake-direct-token-002"), _agent_response()),
    ]
    factory_calls: list[tuple[WeComCredentials, str | None]] = []

    def new_client(
        credentials: WeComCredentials,
        *,
        access_token: str | None = None,
    ) -> _FakeClient:
        factory_calls.append((credentials, access_token))
        return clients[len(factory_calls) - 1]

    monkeypatch.setattr(wecom_module, "_new_client", new_client)
    adapter = wecom_module.WeComIMProviderAdapter(_credentials())

    first = adapter.test_credentials()
    second = adapter.test_credentials()

    assert first == CredentialTestSuccess(IMProvider.WE_COM, "fake-corp-001")
    assert second == first
    assert [client.fetch_calls for client in clients] == [1, 1]
    assert [client.agent.calls for client in clients] == [[1000001], [1000001]]
    assert [access_token for _credentials_value, access_token in factory_calls] == [None, None]


@pytest.mark.parametrize(
    ("token_response", "expected_kind"),
    [
        (WeChatClientException(40013, "fake raw provider detail"), CredentialTestFailureKind.AUTHENTICATION_REJECTED),
        (WeChatClientException(None, "fake transport detail"), CredentialTestFailureKind.UNKNOWN),
        (OSError("fake transport detail"), CredentialTestFailureKind.UNKNOWN),
        (_token_response(token=""), CredentialTestFailureKind.UNKNOWN),
        (_token_response(token="   "), CredentialTestFailureKind.UNKNOWN),
        (_token_response(expires_in=0), CredentialTestFailureKind.UNKNOWN),
        (_token_response(expires_in=-1), CredentialTestFailureKind.UNKNOWN),
        (
            {"errcode": 0, "access_token": "fake-access-token-001", "expires_in": "7200"},
            CredentialTestFailureKind.UNKNOWN,
        ),
        (
            {"errcode": "0", "access_token": "fake-access-token-001", "expires_in": 7200},
            CredentialTestFailureKind.UNKNOWN,
        ),
        ({"errcode": 0, "access_token": "fake-access-token-001"}, CredentialTestFailureKind.UNKNOWN),
        ([], CredentialTestFailureKind.UNKNOWN),
    ],
)
def test_credential_test_normalizes_token_failures_without_provider_material(
    monkeypatch: pytest.MonkeyPatch,
    token_response: object,
    expected_kind: CredentialTestFailureKind,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    client = _FakeClient(token_response)
    monkeypatch.setattr(wecom_module, "_new_client", lambda *_args, **_kwargs: client)

    result = wecom_module.WeComIMProviderAdapter(_credentials()).test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is expected_kind
    assert "fake raw provider detail" not in result.reason
    assert "fake transport detail" not in result.reason
    assert "fake-secret-001" not in result.reason
    assert client.agent.calls == []


@pytest.mark.parametrize(
    ("agent_response", "expected"),
    [
        (
            WeChatClientException(40056, "fake raw provider detail"),
            CredentialTestFailure(
                CredentialTestFailureKind.TENANT_ID_UNAVAILABLE,
                "WeCom could not verify the configured corporation directory boundary.",
            ),
        ),
        (
            WeChatClientException(None, "fake transport detail"),
            CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "WeCom credential testing could not be completed.",
            ),
        ),
        (
            _agent_response(agent_id=1000002),
            CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "WeCom credential testing could not be completed.",
            ),
        ),
        (
            {"errcode": 0, "allow_partys": {"partyid": [1]}},
            CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "WeCom credential testing could not be completed.",
            ),
        ),
    ],
)
def test_credential_test_requires_the_bound_agent_directory_boundary(
    monkeypatch: pytest.MonkeyPatch,
    agent_response: object,
    expected: CredentialTestFailure,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    client = _FakeClient(_token_response(), agent_response)
    monkeypatch.setattr(wecom_module, "_new_client", lambda *_args, **_kwargs: client)

    result = wecom_module.WeComIMProviderAdapter(_credentials()).test_credentials()

    assert result == expected
    assert client.fetch_calls == 1
    assert client.agent.calls == [1000001]
    assert "fake raw provider detail" not in result.reason
    assert "fake transport detail" not in result.reason


@pytest.mark.parametrize(
    "agent_response",
    [
        {
            **_agent_response(),
            "allow_partys": {"partyid": [0]},
        },
        {
            **_agent_response(),
            "allow_partys": {"partyid": []},
            "allow_userinfos": {"user": [{"userid": "   "}]},
        },
        {
            **_agent_response(),
            "allow_partys": {"partyid": []},
            "allow_tags": {"tagid": [0]},
        },
    ],
)
def test_credential_test_rejects_malformed_directory_scope(
    monkeypatch: pytest.MonkeyPatch,
    agent_response: object,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    client = _FakeClient(_token_response(), agent_response)
    monkeypatch.setattr(wecom_module, "_new_client", lambda *_args, **_kwargs: client)

    result = wecom_module.WeComIMProviderAdapter(_credentials()).test_credentials()

    assert result == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "WeCom credential testing could not be completed.",
    )
