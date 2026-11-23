from __future__ import annotations

import importlib
from functools import partial

import httpx
import pytest
from requests import Response
from requests.exceptions import ConnectionError as RequestsConnectionError
from wechatpy.exceptions import WeChatClientException

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    DirectoryReadFailure,
    MessageAccepted,
    MessageLocator,
    MessageSendingError,
    ProviderUserId,
    WeComCredentials,
)


class _TokenClient:
    def __init__(self, response: object) -> None:
        self._response = response
        self.fetch_calls = 0

    def fetch_access_token(self) -> object:
        self.fetch_calls += 1
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


class _MessageAPI:
    def __init__(self, response: object) -> None:
        self._response = response
        self.calls: list[tuple[int, list[str], str, str, str, int]] = []

    def send_text(
        self,
        agent_id: int,
        user_ids: list[str],
        content: str,
        party_ids: str = "",
        tag_ids: str = "",
        safe: int = 0,
    ) -> object:
        self.calls.append((agent_id, list(user_ids), content, party_ids, tag_ids, safe))
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


class _MessagingClient:
    def __init__(self, response: object) -> None:
        self.message = _MessageAPI(response)


def _credentials() -> WeComCredentials:
    return WeComCredentials(
        provider=IMProvider.WE_COM,
        corp_id="fake-corp-001",
        agent_id="1000001",
        secret="fake-secret-001",
    )


def _token_response(token: str = "fake-access-token-001") -> dict[str, object]:
    return {
        "errcode": 0,
        "errmsg": "ok",
        "access_token": token,
        "expires_in": 7200,
    }


def _message_response(
    *,
    msg_id: object = "fake-message-id-001",
    invalid_user: object = "",
    invalid_party: object = "",
    invalid_tag: object = "",
) -> dict[str, object]:
    return {
        "errcode": 0,
        "errmsg": "ok",
        "invaliduser": invalid_user,
        "invalidparty": invalid_party,
        "invalidtag": invalid_tag,
        "msgid": msg_id,
    }


def _install_clients(
    monkeypatch: pytest.MonkeyPatch,
    token_client: _TokenClient,
    messaging_client: _MessagingClient,
) -> list[str | None]:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    access_tokens: list[str | None] = []

    def new_client(
        credentials: WeComCredentials,
        *,
        access_token: str | None = None,
    ) -> object:
        assert credentials is not None
        access_tokens.append(access_token)
        return token_client if access_token is None else messaging_client

    monkeypatch.setattr(wecom_module, "_new_client", new_client)
    return access_tokens


@pytest.mark.parametrize(
    ("subject", "expected"),
    [
        (None, "Rendered **CommonMark** body\nwithout custom tags"),
        ("### Review", "### Review\n\nRendered **CommonMark** body\nwithout custom tags"),
    ],
)
def test_messaging_calls_sdk_once_with_the_directory_user_id_and_exact_body(
    monkeypatch: pytest.MonkeyPatch,
    subject: str | None,
    expected: str,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    token_client = _TokenClient(_token_response())
    messaging_client = _MessagingClient(_message_response())
    access_tokens = _install_clients(monkeypatch, token_client, messaging_client)
    adapter = wecom_module.WeComIMProviderAdapter(_credentials())

    result = adapter.messaging.send_text(
        ProviderUserId("fake-user-001"),
        "Rendered **CommonMark** body\nwithout custom tags",
        subject,
    )

    assert isinstance(result, MessageAccepted)
    assert isinstance(result.locator, str)
    assert type(result.locator) is str
    assert MessageLocator(str(result.locator)) == result.locator
    assert wecom_module._WeComLocatorPayload.decode(str(result.locator)) == wecom_module._WeComLocatorPayload(
        v=1,
        p=IMProvider.WE_COM,
        message_id="fake-message-id-001",
    )
    assert token_client.fetch_calls == 1
    assert access_tokens == [None, "fake-access-token-001"]
    assert messaging_client.message.calls == [
        (
            1000001,
            ["fake-user-001"],
            expected,
            "",
            "",
            0,
        )
    ]


@pytest.mark.parametrize(
    "provider_response",
    [
        _message_response(msg_id=""),
        _message_response(msg_id=None),
        _message_response(msg_id=123),
        _message_response(invalid_user="fake-user-001"),
        _message_response(invalid_party="1"),
        _message_response(invalid_tag="7"),
        {"errcode": 0, "errmsg": "ok"},
        {"errcode": 40003, "errmsg": "fake raw provider detail"},
        WeChatClientException(40003, "fake raw provider detail"),
        RequestsConnectionError("fake transport detail"),
    ],
)
def test_messaging_returns_one_safe_failure_without_replay(
    monkeypatch: pytest.MonkeyPatch,
    provider_response: object,
    caplog: pytest.LogCaptureFixture,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    token_client = _TokenClient(_token_response())
    messaging_client = _MessagingClient(provider_response)
    _install_clients(monkeypatch, token_client, messaging_client)
    adapter = wecom_module.WeComIMProviderAdapter(_credentials())

    result = adapter.messaging.send_text(ProviderUserId("fake-user-001"), "Exact body")

    assert result == MessageSendingError("WeCom message acceptance could not be confirmed.")
    assert token_client.fetch_calls == 1
    assert len(messaging_client.message.calls) == 1
    assert "fake raw provider detail" not in result.reason
    assert "fake transport detail" not in result.reason
    assert "fake-secret-001" not in result.reason

    assert caplog.text.count("im_provider=we_com operation=send_text") == 1
    assert "fake raw provider detail" not in caplog.text
    assert "fake transport detail" not in caplog.text


@pytest.mark.parametrize(
    ("errcode", "http_status", "logged_code"),
    [
        (40003, 200, 40003),
        (48002, None, 48002),
        (None, 403, None),
        (2**40, 429, 2**40),
    ],
)
def test_messaging_logs_safe_send_rejection_without_replay(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    errcode: int | None,
    http_status: int | None,
    logged_code: int | None,
) -> None:
    response = None
    if http_status is not None:
        response = Response()
        response.status_code = http_status
        response._content = b"private provider response"
    rejection = WeChatClientException(errcode, "private SDK exception text", response=response)
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    token_client = _TokenClient(_token_response("private-access-token"))
    messaging_client = _MessagingClient(rejection)
    _install_clients(monkeypatch, token_client, messaging_client)
    adapter = wecom_module.WeComIMProviderAdapter(_credentials())

    result = adapter.messaging.send_text(ProviderUserId("private-recipient"), "private request body")

    assert result == MessageSendingError("WeCom message acceptance could not be confirmed.")
    assert token_client.fetch_calls == 1
    assert len(messaging_client.message.calls) == 1
    assert "im_provider=we_com" in caplog.text
    assert "operation=send_text" in caplog.text
    assert f"provider_error_code={logged_code}" in caplog.text
    assert f"http_status={http_status}" in caplog.text
    assert "private" not in caplog.text


def test_messaging_does_not_attempt_creation_when_token_acquisition_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    token_client = _TokenClient(WeChatClientException(40013, "fake raw provider detail"))
    messaging_client = _MessagingClient(_message_response())
    access_tokens = _install_clients(monkeypatch, token_client, messaging_client)
    adapter = wecom_module.WeComIMProviderAdapter(_credentials())

    result = adapter.messaging.send_text(ProviderUserId("fake-user-001"), "Exact body")

    assert result == MessageSendingError("WeCom message acceptance could not be confirmed.")
    assert token_client.fetch_calls == 1
    assert messaging_client.message.calls == []
    assert access_tokens == [None]


@pytest.mark.parametrize("operation", ["read_directory", "send_text"])
@pytest.mark.parametrize(
    ("error", "code", "status"),
    [
        (WeChatClientException(40013, "private provider detail"), 40013, None),
        (httpx.ReadError("private provider detail"), None, None),
        (
            httpx.HTTPStatusError(
                "private provider detail",
                request=httpx.Request("GET", "https://example.invalid/"),
                response=httpx.Response(403),
            ),
            None,
            403,
        ),
    ],
)
def test_operations_log_expected_token_failures(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    operation: str,
    error: Exception,
    code: int | None,
    status: int | None,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    token_client = _TokenClient(error)
    messaging_client = _MessagingClient(_message_response())
    _install_clients(monkeypatch, token_client, messaging_client)
    adapter = wecom_module.WeComIMProviderAdapter(_credentials())

    if operation == "read_directory":
        assert adapter.directory.read_directory() == DirectoryReadFailure(
            "WeCom directory could not be read completely."
        )
    else:
        assert adapter.messaging.send_text(ProviderUserId("fake-user-001"), "Exact body") == MessageSendingError(
            "WeCom message acceptance could not be confirmed."
        )

    assert token_client.fetch_calls == 1
    assert messaging_client.message.calls == []
    assert caplog.text.count(f"operation=get_access_token provider_error_code={code} http_status={status}") == 1
    assert "private provider detail" not in caplog.text


@pytest.mark.parametrize("operation", ["read_directory", "send_text", "get_access_token"])
def test_operations_surface_unexpected_failure(monkeypatch: pytest.MonkeyPatch, operation: str) -> None:
    failure = RuntimeError("unexpected SDK failure")
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    token_client = _TokenClient(_token_response() if operation == "send_text" else failure)
    messaging_client = _MessagingClient(failure)
    _install_clients(monkeypatch, token_client, messaging_client)
    adapter = wecom_module.WeComIMProviderAdapter(_credentials())

    call = (
        adapter.directory.read_directory
        if operation == "read_directory"
        else partial(adapter.messaging.send_text, ProviderUserId("fake-user-001"), "Exact body")
    )
    with pytest.raises(RuntimeError) as raised:
        call()

    assert raised.value is failure
    assert len(messaging_client.message.calls) == (1 if operation == "send_text" else 0)
