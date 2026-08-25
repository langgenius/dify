"""Live WeCom integration tests using only explicitly authorized credentials."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Never
from uuid import uuid4

import pytest
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, ValidationError
from wechatpy.enterprise import WeChatClient

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    CredentialTestSuccess,
    Directory,
    MessageAccepted,
    ProviderUserId,
    WeComCredentials,
)
from core.human_input_v2.im_integration.adapters.wecom import WeComIMProviderAdapter

_SDK_TIMEOUT_SECONDS = 5.0


def _fail(reason: str) -> Never:
    pytest.fail(reason, pytrace=False)


class _ScopedUser(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    userid: StrictStr


class _AllowedDepartments(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    partyid: tuple[StrictInt, ...] = ()


class _AllowedUsers(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    user: tuple[_ScopedUser, ...] = ()


class _AllowedTags(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    tagid: tuple[StrictInt, ...] = ()


class _AgentScope(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    agentid: StrictInt = Field(gt=0)
    allow_partys: _AllowedDepartments = Field(default_factory=_AllowedDepartments)
    allow_userinfos: _AllowedUsers = Field(default_factory=_AllowedUsers)
    allow_tags: _AllowedTags = Field(default_factory=_AllowedTags)


class _Department(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    id: StrictInt = Field(gt=0)


class _DirectoryUser(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    userid: StrictStr
    name: StrictStr | None = None
    email: StrictStr | None = None


class _TagScope(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    userlist: tuple[_ScopedUser, ...] = ()
    partylist: tuple[StrictInt, ...] = ()


@dataclass(frozen=True, slots=True)
class _ExpectedDirectoryEntry:
    provider_user_id: str
    display_name: str | None
    email: str | None


@dataclass(frozen=True, slots=True)
class _LiveCredentials:
    value: WeComCredentials = field(repr=False)


@dataclass(frozen=True, slots=True)
class _LiveRecipient:
    provider_user_id: ProviderUserId = field(repr=False)


@pytest.fixture(scope="module")
def wecom_credentials() -> _LiveCredentials:
    corp_id = os.getenv("WECOM_CORP_ID")
    agent_id = os.getenv("WECOM_AGENT_ID")
    secret = os.getenv("WECOM_SECRET")
    if not corp_id or not agent_id or not secret:
        pytest.skip("WeCom live credentials are not configured")
    try:
        return _LiveCredentials(
            WeComCredentials(
                provider=IMProvider.WE_COM,
                corp_id=corp_id,
                agent_id=agent_id,
                secret=secret,
            )
        )
    except ValidationError:
        _fail("WeCom live credentials failed local validation")


@pytest.fixture
def wecom_test_recipient_id() -> _LiveRecipient:
    recipient_id = os.getenv("WECOM_TEST_RECIPIENT_ID")
    if not recipient_id:
        pytest.skip("WECOM_TEST_RECIPIENT_ID is not configured")
    return _LiveRecipient(ProviderUserId(recipient_id))


def test_live_credentials_confirm_the_configured_corporation(
    wecom_credentials: _LiveCredentials,
) -> None:
    credential_repr = repr(wecom_credentials)
    if any(
        sensitive_value in credential_repr
        for sensitive_value in (
            wecom_credentials.value.corp_id,
            wecom_credentials.value.agent_id,
            wecom_credentials.value.secret,
        )
    ):
        _fail("WeCom live credential fixture repr is not sanitized")
    adapter = WeComIMProviderAdapter(wecom_credentials.value)
    try:
        result = adapter.test_credentials()
    finally:
        adapter.close()

    if not isinstance(result, CredentialTestSuccess):
        _fail("WeCom live credential testing did not succeed")
    if result.provider is not IMProvider.WE_COM:
        _fail("WeCom live credential testing returned the wrong Provider")
    if result.provider_tenant_id != wecom_credentials.value.corp_id:
        _fail("WeCom live credential testing returned the wrong corporation boundary")


def test_live_directory_matches_an_independent_complete_sdk_traversal(
    wecom_credentials: _LiveCredentials,
) -> None:
    expected_entries = _read_expected_directory(wecom_credentials)
    adapter = WeComIMProviderAdapter(wecom_credentials.value)
    try:
        actual = adapter.directory.read_directory()
    finally:
        adapter.close()

    if not isinstance(actual, Directory):
        _fail("WeCom live Directory did not return a complete snapshot")
    if not expected_entries:
        _fail("WeCom live Directory scope did not expose any members")
    expected = tuple((entry.provider_user_id, entry.display_name, entry.email) for entry in expected_entries)
    observed = tuple((str(entry.provider_user_id), entry.display_name, entry.email) for entry in actual.entries)
    if observed != expected:
        _fail("WeCom live Directory did not match the independent SDK traversal")
    if any(not entry.provider_user_id.strip() for entry in expected_entries):
        _fail("WeCom live Directory returned an invalid identity")


def test_live_messaging_confirms_provider_acceptance(
    wecom_credentials: _LiveCredentials,
    wecom_test_recipient_id: _LiveRecipient,
) -> None:
    message_body = f"Dify WeCom live integration {uuid4()}"
    if str(wecom_test_recipient_id.provider_user_id) in repr(wecom_test_recipient_id):
        _fail("WeCom live recipient fixture repr is not sanitized")
    adapter = WeComIMProviderAdapter(wecom_credentials.value)
    try:
        result = adapter.messaging.send_text(wecom_test_recipient_id.provider_user_id, message_body)
    finally:
        adapter.close()

    if not isinstance(result, MessageAccepted):
        _fail("WeCom did not confirm live message acceptance")


def _read_expected_directory(
    live_credentials: _LiveCredentials,
) -> tuple[_ExpectedDirectoryEntry, ...]:
    try:
        credentials = live_credentials.value
        client = WeChatClient(
            credentials.corp_id,
            credentials.secret,
            timeout=_SDK_TIMEOUT_SECONDS,
            auto_retry=False,
        )
        client.fetch_access_token()
        scope = _AgentScope.model_validate(client.agent.get(int(credentials.agent_id)))
        if scope.agentid != int(credentials.agent_id):
            _fail("WeCom live agent scope did not match the configured application")

        entries: list[_ExpectedDirectoryEntry] = []
        seen_users: set[str] = set()
        seen_departments: set[int] = set()
        for department_id in scope.allow_partys.partyid:
            _read_expected_department(client, department_id, entries, seen_users, seen_departments)
        for scoped_user in scope.allow_userinfos.user:
            _read_expected_user(client, scoped_user.userid, entries, seen_users)
        for tag_id in scope.allow_tags.tagid:
            tag = _TagScope.model_validate(client.tag.get_users(tag_id))
            for scoped_user in tag.userlist:
                _read_expected_user(client, scoped_user.userid, entries, seen_users)
            for department_id in tag.partylist:
                _read_expected_department(client, department_id, entries, seen_users, seen_departments)
        return tuple(entries)
    except AssertionError:
        raise
    except Exception:
        _fail("Independent WeCom live Directory traversal failed")


def _read_expected_department(
    client: WeChatClient,
    root_department_id: int,
    entries: list[_ExpectedDirectoryEntry],
    seen_users: set[str],
    seen_departments: set[int],
) -> None:
    if root_department_id in seen_departments:
        return
    departments = tuple(_Department.model_validate(value) for value in client.department.get(root_department_id))
    if not any(department.id == root_department_id for department in departments):
        _fail("WeCom live department traversal omitted its requested root")
    for department in departments:
        if department.id in seen_departments:
            continue
        seen_departments.add(department.id)
        users = tuple(
            _DirectoryUser.model_validate(value)
            for value in client.user.list(department.id, fetch_child=False, status=0, simple=False)
        )
        for user in users:
            _append_expected_user(user, entries, seen_users)


def _read_expected_user(
    client: WeChatClient,
    user_id: str,
    entries: list[_ExpectedDirectoryEntry],
    seen_users: set[str],
) -> None:
    if user_id in seen_users:
        return
    user = _DirectoryUser.model_validate(client.user.get(user_id))
    if user.userid != user_id:
        _fail("WeCom live user lookup returned a different identity")
    _append_expected_user(user, entries, seen_users)


def _append_expected_user(
    user: _DirectoryUser,
    entries: list[_ExpectedDirectoryEntry],
    seen_users: set[str],
) -> None:
    if not user.userid.strip():
        _fail("WeCom live Directory returned a blank identity")
    if user.userid in seen_users:
        return
    seen_users.add(user.userid)
    entries.append(
        _ExpectedDirectoryEntry(
            provider_user_id=user.userid,
            display_name=_optional_non_blank(user.name),
            email=_optional_non_blank(user.email),
        )
    )


def _optional_non_blank(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return value
