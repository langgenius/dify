"""Live DingTalk integration tests.

These tests intentionally use real DingTalk credentials and external APIs. They
skip when the required environment variables are unavailable and never emit
credential material, Provider identifiers, or raw Provider responses.
"""

from __future__ import annotations

import os
from collections import deque
from dataclasses import dataclass
from time import monotonic, sleep
from typing import Never
from uuid import uuid4

import pytest
from alibabacloud_dingtalk.robot_1_0.models import BatchOTOQueryHeaders, BatchOTOQueryRequest
from alibabacloud_tea_util.models import RuntimeOptions
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from Tea.exceptions import RetryError, TeaException, UnretryableException, ValidateException

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    CredentialTestSuccess,
    DingTalkCredentials,
    Directory,
    MessageAccepted,
    ProviderUserId,
)
from core.human_input_v2.im_integration.adapters import dingtalk as dingtalk_module
from core.human_input_v2.im_integration.adapters.dingtalk import DingTalkIMProviderAdapter

_DEPARTMENT_LIST_URL = "https://oapi.dingtalk.com/topapi/v2/department/listsub"
_USER_LIST_URL = "https://oapi.dingtalk.com/topapi/v2/user/list"
_ROOT_DEPARTMENT_ID = 1
_FORCED_PAGE_SIZE = 1
_SDK_TIMEOUT_MILLISECONDS = 5000
_STATUS_QUERY_TIMEOUT_SECONDS = 10.0
_STATUS_QUERY_INTERVAL_SECONDS = 0.5
_SUCCESS_SEND_STATUS = "SUCCESS"


def _fail(reason: str) -> Never:
    raise AssertionError(reason)


class _WireProviderResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    errcode: int


class _WireDepartment(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    dept_id: int = Field(ge=1)


class _WireDepartmentListResponse(_WireProviderResponse):
    result: tuple[_WireDepartment, ...] | None = None


class _WireDirectoryUser(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    userid: str
    name: str | None = None
    email: str | None = None


class _WireUserPage(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    has_more: bool
    next_cursor: int | None = None
    users: tuple[_WireDirectoryUser, ...] = Field(alias="list")


class _WireUserListResponse(_WireProviderResponse):
    result: _WireUserPage | None = None


@dataclass(frozen=True, slots=True)
class _LiveDirectoryEntry:
    provider_user_id: str
    display_name: str | None
    email: str | None


@dataclass(frozen=True, slots=True)
class _LiveDirectorySnapshot:
    entries: tuple[_LiveDirectoryEntry, ...]
    exercised_pagination: bool


@pytest.fixture(scope="module")
def dingtalk_credentials() -> DingTalkCredentials:
    corp_id = os.getenv("DINGTALK_CORP_ID")
    client_id = os.getenv("DINGTALK_CLIENT_ID")
    client_secret = os.getenv("DINGTALK_CLIENT_SECRET")
    if not corp_id or not client_id or not client_secret:
        pytest.skip("DingTalk live credentials are not configured")
    return DingTalkCredentials(
        provider=IMProvider.DING_TALK,
        corp_id=corp_id,
        client_id=client_id,
        client_secret=client_secret,
    )


@pytest.fixture
def dingtalk_test_recipient_id() -> ProviderUserId:
    recipient_id = os.getenv("DINGTALK_TEST_RECIPIENT_ID")
    if not recipient_id:
        pytest.skip("DINGTALK_TEST_RECIPIENT_ID is not configured")
    return ProviderUserId(recipient_id)


def test_live_credentials_verify_complete_member_authorization(
    dingtalk_credentials: DingTalkCredentials,
) -> None:
    adapter = DingTalkIMProviderAdapter(dingtalk_credentials)
    try:
        result = adapter.test_credentials()
    finally:
        adapter.close()
        adapter.close()

    if not isinstance(result, CredentialTestSuccess):
        _fail("DingTalk live credential testing did not verify complete member authorization")
    if result.provider_tenant_id != dingtalk_credentials.corp_id:
        _fail("DingTalk live credential testing returned an unexpected tenant boundary")


def test_live_directory_reads_complete_non_empty_entries_across_real_pages(
    dingtalk_credentials: DingTalkCredentials,
) -> None:
    expected_snapshot = _read_live_directory_with_forced_pagination(dingtalk_credentials)
    adapter = DingTalkIMProviderAdapter(dingtalk_credentials)
    try:
        actual_snapshot = adapter.directory.read_directory()
    finally:
        adapter.close()
        adapter.close()

    if not isinstance(actual_snapshot, Directory):
        _fail("DingTalk live Directory did not return a complete snapshot")
    if not actual_snapshot.entries:
        _fail("DingTalk live Directory returned an empty snapshot")
    if not expected_snapshot.exercised_pagination:
        _fail("DingTalk live Directory fixture did not exercise a real pagination boundary")
    if not all(
        str(entry.provider_user_id).strip()
        and entry.display_name is not None
        and entry.display_name.strip()
        and entry.email is not None
        and entry.email.strip()
        for entry in actual_snapshot.entries
    ):
        _fail("DingTalk live Directory returned an entry with an empty shared field")

    expected_by_user_id = {
        entry.provider_user_id: (entry.display_name, entry.email) for entry in expected_snapshot.entries
    }
    actual_by_user_id = {
        str(entry.provider_user_id): (entry.display_name, entry.email) for entry in actual_snapshot.entries
    }
    if actual_by_user_id != expected_by_user_id:
        _fail("DingTalk live Directory snapshot did not match the independently paginated snapshot")


def test_live_messaging_reports_provider_send_success(
    dingtalk_credentials: DingTalkCredentials,
    dingtalk_test_recipient_id: ProviderUserId,
) -> None:
    message_body = f"Dify DingTalk live integration {uuid4()}"
    adapter = DingTalkIMProviderAdapter(dingtalk_credentials)
    try:
        send_result = adapter.messaging.send_text(dingtalk_test_recipient_id, message_body)
    finally:
        adapter.close()
        adapter.close()

    if not isinstance(send_result, MessageAccepted):
        _fail("DingTalk did not confirm live message acceptance")
    try:
        locator_payload = dingtalk_module._DingTalkLocatorPayload.decode(str(send_result.locator))
    except Exception as exc:
        raise AssertionError("DingTalk live message did not return a valid opaque locator") from exc

    # DingTalk exposes send/read status for OTO robot messages, but not the
    # persisted message body. Exact msgParam content is therefore asserted in
    # the SDK-boundary unit test while this test verifies the real mutation.
    _wait_for_message_send_success(
        dingtalk_credentials,
        dingtalk_test_recipient_id,
        locator_payload.process_query_key,
    )


def _read_live_directory_with_forced_pagination(
    credentials: DingTalkCredentials,
) -> _LiveDirectorySnapshot:
    access_token = dingtalk_module._get_access_token(dingtalk_module._new_oauth_client(), credentials)
    http_client = dingtalk_module._UrllibDirectoryHTTPClient()
    entries: list[_LiveDirectoryEntry] = []
    seen_user_ids: set[str] = set()
    pending_departments: deque[int] = deque((_ROOT_DEPARTMENT_ID,))
    discovered_departments = {_ROOT_DEPARTMENT_ID}
    exercised_pagination = False
    try:
        while pending_departments:
            department_id = pending_departments.popleft()
            department_response = _parse_wire_response(
                http_client.post(
                    _DEPARTMENT_LIST_URL,
                    access_token=access_token,
                    body={"dept_id": department_id},
                ),
                _WireDepartmentListResponse,
            )
            if department_response.result is None:
                _fail("DingTalk live department response omitted its result")
            for child in department_response.result:
                if child.dept_id in discovered_departments:
                    continue
                discovered_departments.add(child.dept_id)
                pending_departments.append(child.dept_id)

            cursor = 0
            seen_cursors = {cursor}
            while True:
                user_response = _parse_wire_response(
                    http_client.post(
                        _USER_LIST_URL,
                        access_token=access_token,
                        body={
                            "dept_id": department_id,
                            "cursor": cursor,
                            "size": _FORCED_PAGE_SIZE,
                        },
                    ),
                    _WireUserListResponse,
                )
                if user_response.result is None:
                    _fail("DingTalk live user response omitted its result")
                page = user_response.result
                for user in page.users:
                    if user.userid in seen_user_ids:
                        continue
                    seen_user_ids.add(user.userid)
                    entries.append(_LiveDirectoryEntry(user.userid, user.name, user.email))
                if not page.has_more:
                    break
                exercised_pagination = True
                next_cursor = page.next_cursor
                if next_cursor is None or next_cursor in seen_cursors:
                    _fail("DingTalk live Directory returned an invalid pagination cursor")
                seen_cursors.add(next_cursor)
                cursor = next_cursor
    finally:
        http_client.close()
    return _LiveDirectorySnapshot(tuple(entries), exercised_pagination)


def _parse_wire_response[ResponseT: _WireProviderResponse](
    response_body: bytes,
    response_type: type[ResponseT],
) -> ResponseT:
    try:
        response = response_type.model_validate_json(response_body)
    except (ValidationError, ValueError):
        _fail("DingTalk live Directory returned an invalid response")
    if response.errcode != 0:
        _fail("DingTalk live Directory rejected the request")
    return response


def _wait_for_message_send_success(
    credentials: DingTalkCredentials,
    recipient_id: ProviderUserId,
    process_query_key: str,
) -> None:
    access_token = dingtalk_module._get_access_token(dingtalk_module._new_oauth_client(), credentials)
    robot_client = dingtalk_module._new_robot_client()
    deadline = monotonic() + _STATUS_QUERY_TIMEOUT_SECONDS
    while True:
        try:
            response = robot_client.batch_otoquery_with_options(
                BatchOTOQueryRequest(
                    process_query_key=process_query_key,
                    robot_code=credentials.client_id,
                ),
                BatchOTOQueryHeaders(x_acs_dingtalk_access_token=access_token),
                RuntimeOptions(
                    autoretry=False,
                    max_attempts=1,
                    connect_timeout=_SDK_TIMEOUT_MILLISECONDS,
                    read_timeout=_SDK_TIMEOUT_MILLISECONDS,
                ),
            )
        except (RetryError, TeaException, UnretryableException, ValidateException):
            _fail("DingTalk live message status query failed")
        if not isinstance(response.status_code, int) or not 200 <= response.status_code < 300:
            _fail("DingTalk live message status query returned a non-success status")
        response_body = response.body
        if response_body is None:
            _fail("DingTalk live message status query returned no body")
        recipient_observed = any(
            read_info.user_id == str(recipient_id) for read_info in response_body.message_read_info_list or ()
        )
        if response_body.send_status == _SUCCESS_SEND_STATUS and recipient_observed:
            return
        if monotonic() >= deadline:
            _fail("DingTalk did not report successful live message delivery before timeout")
        sleep(_STATUS_QUERY_INTERVAL_SECONDS)
