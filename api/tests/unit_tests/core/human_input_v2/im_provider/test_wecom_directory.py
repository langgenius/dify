from __future__ import annotations

import importlib
from collections.abc import Callable

import pytest
from wechatpy.exceptions import WeChatClientException

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    ProviderUserId,
    WeComCredentials,
)


class _TokenClient:
    def __init__(self, token: str) -> None:
        self._token = token
        self.fetch_calls = 0

    def fetch_access_token(self) -> dict[str, object]:
        self.fetch_calls += 1
        return {
            "errcode": 0,
            "errmsg": "ok",
            "access_token": self._token,
            "expires_in": 7200,
        }


class _AgentAPI:
    def __init__(self, response: object) -> None:
        self._response = response
        self.calls: list[int] = []

    def get(self, agent_id: int) -> object:
        self.calls.append(agent_id)
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


class _DepartmentAPI:
    def __init__(self, route: Callable[[int], object]) -> None:
        self._route = route
        self.calls: list[int] = []

    def get(self, department_id: int) -> object:
        self.calls.append(department_id)
        response = self._route(department_id)
        if isinstance(response, Exception):
            raise response
        return response


class _UserAPI:
    def __init__(
        self,
        list_route: Callable[[int], object],
        get_route: Callable[[str], object] | None = None,
    ) -> None:
        self._list_route = list_route
        self._get_route = get_route or (lambda user_id: {"errcode": 0, "userid": user_id})
        self.list_calls: list[tuple[int, bool, int, bool]] = []
        self.get_calls: list[str] = []

    def list(
        self,
        department_id: int,
        fetch_child: bool = False,
        status: int = 0,
        simple: bool = False,
    ) -> object:
        self.list_calls.append((department_id, fetch_child, status, simple))
        response = self._list_route(department_id)
        if isinstance(response, Exception):
            raise response
        return response

    def get(self, user_id: str) -> object:
        self.get_calls.append(user_id)
        response = self._get_route(user_id)
        if isinstance(response, Exception):
            raise response
        return response


class _TagAPI:
    def __init__(self, route: Callable[[int], object] | None = None) -> None:
        self._route = route or (lambda _tag_id: {"errcode": 0, "userlist": [], "partylist": []})
        self.calls: list[int] = []

    def get_users(self, tag_id: int) -> object:
        self.calls.append(tag_id)
        response = self._route(tag_id)
        if isinstance(response, Exception):
            raise response
        return response


class _DirectoryClient:
    def __init__(
        self,
        agent_response: object,
        department_route: Callable[[int], object],
        user_list_route: Callable[[int], object],
        *,
        user_get_route: Callable[[str], object] | None = None,
        tag_route: Callable[[int], object] | None = None,
    ) -> None:
        self.agent = _AgentAPI(agent_response)
        self.department = _DepartmentAPI(department_route)
        self.user = _UserAPI(user_list_route, user_get_route)
        self.tag = _TagAPI(tag_route)


def _credentials() -> WeComCredentials:
    return WeComCredentials(
        provider=IMProvider.WE_COM,
        corp_id="fake-corp-001",
        agent_id="1000001",
        secret="fake-secret-001",
    )


def _scope_response(
    *,
    departments: tuple[int, ...] = (),
    users: tuple[str, ...] = (),
    tags: tuple[int, ...] = (),
) -> dict[str, object]:
    return {
        "errcode": 0,
        "errmsg": "ok",
        "agentid": 1000001,
        "allow_partys": {"partyid": list(departments)},
        "allow_userinfos": {"user": [{"userid": user_id} for user_id in users]},
        "allow_tags": {"tagid": list(tags)},
    }


def _install_clients(
    monkeypatch: pytest.MonkeyPatch,
    token_clients: list[_TokenClient],
    directory_clients: dict[str, _DirectoryClient],
) -> list[tuple[str | None, object]]:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    calls: list[tuple[str | None, object]] = []

    def new_client(
        credentials: WeComCredentials,
        *,
        access_token: str | None = None,
    ) -> object:
        assert credentials is not None
        if access_token is None:
            client = token_clients.pop(0)
        else:
            client = directory_clients[access_token]
        calls.append((access_token, client))
        return client

    monkeypatch.setattr(wecom_module, "_new_client", new_client)
    return calls


def test_directory_uses_a_current_token_for_each_complete_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    first_directory_client = _DirectoryClient(_scope_response(), lambda _department_id: [], lambda _department_id: [])
    second_directory_client = _DirectoryClient(_scope_response(), lambda _department_id: [], lambda _department_id: [])
    first_token_client = _TokenClient("fake-access-token-001")
    second_token_client = _TokenClient("fake-access-token-002")
    factory_calls = _install_clients(
        monkeypatch,
        [first_token_client, second_token_client],
        {
            "fake-access-token-001": first_directory_client,
            "fake-access-token-002": second_directory_client,
        },
    )
    adapter = wecom_module.WeComIMProviderAdapter(_credentials())

    first = adapter.directory.read_directory()
    second = adapter.directory.read_directory()

    assert first == Directory(())
    assert second == first
    assert first_token_client.fetch_calls == 1
    assert second_token_client.fetch_calls == 1
    assert [access_token for access_token, _client in factory_calls] == [
        None,
        "fake-access-token-001",
        None,
        "fake-access-token-002",
    ]


def test_directory_traverses_configured_scope_with_stable_deduplication(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")

    def departments(department_id: int) -> object:
        if department_id == 1:
            return [
                {"id": 1, "name": "Root", "parentid": 0, "order": 1},
                {"id": 2, "name": "Child", "parentid": 1, "order": 2},
            ]
        assert department_id == 3
        return [{"id": 3, "name": "Tagged", "parentid": 0, "order": 3}]

    def users(department_id: int) -> object:
        if department_id == 1:
            return [
                {
                    "userid": "fake-user-001",
                    "name": "Fake User One",
                    "email": "one@example.com",
                    "department": [1],
                },
                {"userid": "fake-user-002", "department": [1]},
            ]
        if department_id == 2:
            return [
                {
                    "userid": "fake-user-002",
                    "name": "Duplicate User",
                    "email": "duplicate@example.com",
                    "department": [1, 2],
                },
                {"userid": "fake-user-003", "name": "   ", "email": "", "department": [2]},
            ]
        assert department_id == 3
        return [{"userid": "fake-user-006", "name": "Fake User Six", "department": [3]}]

    def user(user_id: str) -> object:
        values = {
            "fake-user-004": {
                "errcode": 0,
                "userid": "fake-user-004",
                "name": "Fake User Four",
                "email": "four@example.com",
            },
            "fake-user-005": {
                "errcode": 0,
                "userid": "fake-user-005",
                "name": "Fake User Five",
                "email": "   ",
            },
        }
        return values[user_id]

    directory_client = _DirectoryClient(
        _scope_response(departments=(1,), users=("fake-user-004", "fake-user-001"), tags=(7,)),
        departments,
        users,
        user_get_route=user,
        tag_route=lambda tag_id: (
            {
                "errcode": 0,
                "tagname": "Fake Tag",
                "userlist": [
                    {"userid": "fake-user-005", "name": "Tag User"},
                    {"userid": "fake-user-004", "name": "Duplicate Direct User"},
                ],
                "partylist": [3],
            }
            if tag_id == 7
            else pytest.fail("unexpected tag")
        ),
    )
    _install_clients(
        monkeypatch,
        [_TokenClient("fake-access-token-001")],
        {"fake-access-token-001": directory_client},
    )

    result = wecom_module.WeComIMProviderAdapter(_credentials()).directory.read_directory()

    assert result == Directory(
        (
            DirectoryEntry(ProviderUserId("fake-user-001"), "Fake User One", "one@example.com"),
            DirectoryEntry(ProviderUserId("fake-user-002"), None, None),
            DirectoryEntry(ProviderUserId("fake-user-003"), None, None),
            DirectoryEntry(ProviderUserId("fake-user-004"), "Fake User Four", "four@example.com"),
            DirectoryEntry(ProviderUserId("fake-user-005"), "Fake User Five", None),
            DirectoryEntry(ProviderUserId("fake-user-006"), "Fake User Six", None),
        )
    )
    assert directory_client.agent.calls == [1000001]
    assert directory_client.department.calls == [1, 3]
    assert directory_client.user.list_calls == [
        (1, False, 0, False),
        (2, False, 0, False),
        (3, False, 0, False),
    ]
    assert directory_client.user.get_calls == ["fake-user-004", "fake-user-005"]
    assert directory_client.tag.calls == [7]


def test_directory_discards_partial_entries_when_a_later_scope_call_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")

    def users(department_id: int) -> object:
        if department_id == 1:
            return [{"userid": "fake-partial-user", "name": "Partial User"}]
        return WeChatClientException(60011, "fake raw provider detail")

    directory_client = _DirectoryClient(
        _scope_response(departments=(1,)),
        lambda _department_id: [
            {"id": 1, "parentid": 0},
            {"id": 2, "parentid": 1},
        ],
        users,
    )
    _install_clients(
        monkeypatch,
        [_TokenClient("fake-access-token-001")],
        {"fake-access-token-001": directory_client},
    )

    result = wecom_module.WeComIMProviderAdapter(_credentials()).directory.read_directory()

    assert result == DirectoryReadFailure("WeCom directory could not be read completely.")
    assert "fake raw provider detail" not in result.reason
    assert directory_client.user.list_calls == [(1, False, 0, False), (2, False, 0, False)]


@pytest.mark.parametrize(
    "departments",
    [
        [
            {"id": 1, "parentid": 0},
            {"id": 2, "parentid": 1},
            {"id": 2, "parentid": 1},
        ],
        [
            {"id": 1, "parentid": 2},
            {"id": 2, "parentid": 1},
        ],
        [
            {"id": 1, "parentid": 0},
            {"id": 2, "parentid": 99},
        ],
        [{"id": 2, "parentid": 1}],
    ],
)
def test_directory_rejects_malformed_department_topology(
    monkeypatch: pytest.MonkeyPatch,
    departments: list[dict[str, int]],
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    directory_client = _DirectoryClient(
        _scope_response(departments=(1,)),
        lambda _department_id: departments,
        lambda _department_id: [],
    )
    _install_clients(
        monkeypatch,
        [_TokenClient("fake-access-token-001")],
        {"fake-access-token-001": directory_client},
    )

    result = wecom_module.WeComIMProviderAdapter(_credentials()).directory.read_directory()

    assert result == DirectoryReadFailure("WeCom directory could not be read completely.")
    assert directory_client.user.list_calls == []


def test_directory_rejects_an_invalid_provider_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    directory_client = _DirectoryClient(
        _scope_response(departments=(1,)),
        lambda _department_id: [{"id": 1, "parentid": 0}],
        lambda _department_id: [{"userid": "   ", "name": "Invalid Identity"}],
    )
    _install_clients(
        monkeypatch,
        [_TokenClient("fake-access-token-001")],
        {"fake-access-token-001": directory_client},
    )

    result = wecom_module.WeComIMProviderAdapter(_credentials()).directory.read_directory()

    assert result == DirectoryReadFailure("WeCom directory could not be read completely.")


def test_directory_rejects_an_invalid_provider_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    directory_client = _DirectoryClient(
        _scope_response(departments=(1,)),
        lambda _department_id: [{"id": 1, "parentid": 0}],
        lambda _department_id: [
            {
                "userid": "fake-user-001",
                "name": "Fake User",
                "email": "not-an-email-address",
            }
        ],
    )
    _install_clients(
        monkeypatch,
        [_TokenClient("fake-access-token-001")],
        {"fake-access-token-001": directory_client},
    )

    result = wecom_module.WeComIMProviderAdapter(_credentials()).directory.read_directory()

    assert result == DirectoryReadFailure("WeCom directory could not be read completely.")


def test_directory_rejects_a_scope_for_a_different_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    directory_client = _DirectoryClient(
        {**_scope_response(), "agentid": 1000002},
        lambda _department_id: [],
        lambda _department_id: [],
    )
    _install_clients(
        monkeypatch,
        [_TokenClient("fake-access-token-001")],
        {"fake-access-token-001": directory_client},
    )

    result = wecom_module.WeComIMProviderAdapter(_credentials()).directory.read_directory()

    assert result == DirectoryReadFailure("WeCom directory could not be read completely.")
    assert directory_client.department.calls == []


@pytest.mark.parametrize(
    ("scope", "expected_department_calls", "expected_tag_calls"),
    [
        (_scope_response(departments=(0,)), [], []),
        (_scope_response(tags=(0,)), [], []),
    ],
)
def test_directory_rejects_non_positive_scope_identifiers(
    monkeypatch: pytest.MonkeyPatch,
    scope: object,
    expected_department_calls: list[int],
    expected_tag_calls: list[int],
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    directory_client = _DirectoryClient(scope, lambda _department_id: [], lambda _department_id: [])
    _install_clients(
        monkeypatch,
        [_TokenClient("fake-access-token-001")],
        {"fake-access-token-001": directory_client},
    )

    result = wecom_module.WeComIMProviderAdapter(_credentials()).directory.read_directory()

    assert result == DirectoryReadFailure("WeCom directory could not be read completely.")
    assert directory_client.department.calls == expected_department_calls
    assert directory_client.tag.calls == expected_tag_calls


def test_directory_rejects_a_mismatched_direct_user_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    directory_client = _DirectoryClient(
        _scope_response(users=("fake-user-001",)),
        lambda _department_id: [],
        lambda _department_id: [],
        user_get_route=lambda _user_id: {"errcode": 0, "userid": "fake-user-002"},
    )
    _install_clients(
        monkeypatch,
        [_TokenClient("fake-access-token-001")],
        {"fake-access-token-001": directory_client},
    )

    result = wecom_module.WeComIMProviderAdapter(_credentials()).directory.read_directory()

    assert result == DirectoryReadFailure("WeCom directory could not be read completely.")


def test_directory_skips_a_repeated_department_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wecom_module = importlib.import_module("core.human_input_v2.im_integration.adapters.wecom")
    directory_client = _DirectoryClient(
        _scope_response(departments=(1, 1)),
        lambda _department_id: [{"id": 1, "parentid": 0}],
        lambda _department_id: [{"userid": "fake-user-001"}],
    )
    _install_clients(
        monkeypatch,
        [_TokenClient("fake-access-token-001")],
        {"fake-access-token-001": directory_client},
    )

    result = wecom_module.WeComIMProviderAdapter(_credentials()).directory.read_directory()

    assert result == Directory((DirectoryEntry(ProviderUserId("fake-user-001"), None, None),))
    assert directory_client.department.calls == [1]
