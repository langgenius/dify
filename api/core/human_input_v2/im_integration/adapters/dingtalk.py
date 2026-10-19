"""Concrete DingTalk adapter for Provider-neutral Human Input IM contracts.

The root and its ordinary capabilities rely on the contract's external
serialization rule and intentionally contain no synchronization or token
cache. Credential testing bypasses the replaceable capability token provider
so future caching cannot validate stale credentials.
"""

from __future__ import annotations

import json
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol, override
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from alibabacloud_dingtalk.oauth2_1_0.client import Client as OAuthClient
from alibabacloud_dingtalk.oauth2_1_0.models import GetTokenRequest
from alibabacloud_dingtalk.robot_1_0.client import Client as RobotClient
from alibabacloud_dingtalk.robot_1_0.models import BatchSendOTOHeaders, BatchSendOTORequest
from alibabacloud_tea_openapi.models import Config
from alibabacloud_tea_util.models import RuntimeOptions
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from requests.exceptions import Timeout as RequestsTimeout
from Tea.exceptions import TeaException

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.avatar import read_avatars
from core.human_input_v2.im_integration.adapters.credentials import DingTalkCredentials
from core.human_input_v2.im_integration.adapters.entities import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    CredentialTestTimeoutError,
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    IMProviderError,
    MessageAccepted,
    MessageSendingError,
    MessageSendingResult,
    ProviderUserId,
)
from core.human_input_v2.im_integration.adapters.message_locator import MessageLocator, _Base64JSONLocatorPayload
from core.human_input_v2.im_integration.adapters.protocols import (
    IMCardEventDecoder,
    IMDirectory,
    IMDynamicCardMessaging,
    IMEventConsumer,
    IMEventStream,
    IMMessaging,
    IMWebhookHandler,
)

_DEPARTMENT_LIST_URL = "https://oapi.dingtalk.com/topapi/v2/department/listsub"
_USER_LIST_URL = "https://oapi.dingtalk.com/topapi/v2/user/list"
_AUTHORIZATION_SCOPE_URL = "https://oapi.dingtalk.com/auth/scopes"
_ROOT_DEPARTMENT_ID = 1
_DIRECTORY_PAGE_SIZE = 100
_HTTP_TIMEOUT_SECONDS = 5.0
_SDK_TIMEOUT_MILLISECONDS = 5000
_HTTP_SUCCESS_STATUS_MIN = 200
_HTTP_SUCCESS_STATUS_MAX_EXCLUSIVE = 300

_CREDENTIAL_REJECTED = "DingTalk rejected the credential test."
_AUTHORIZATION_SCOPE_UNVERIFIED = "DingTalk could not verify complete member authorization."
_TENANT_BOUNDARY_UNAVAILABLE = "DingTalk could not verify the configured corporation directory boundary."
_DIRECTORY_READ_FAILED = "DingTalk directory could not be read completely."
_MESSAGE_ACCEPTANCE_UNCONFIRMED = "DingTalk message acceptance could not be confirmed."


class AccessTokenProvider(Protocol):
    """DingTalk-private seam for a currently usable application token."""

    def get(self) -> str:
        """Return a currently usable access token."""
        ...


class _OAuthClient(Protocol):
    def get_token(self, corp_id: str, request: GetTokenRequest) -> object: ...


class _RobotClient(Protocol):
    def batch_send_otowith_options(
        self,
        request: BatchSendOTORequest,
        headers: BatchSendOTOHeaders,
        runtime: RuntimeOptions,
    ) -> object: ...


@dataclass(frozen=True, slots=True)
class _DirectoryHTTPResponse:
    body: bytes
    http_status: int


class _DirectoryHTTPClient(Protocol):
    def get(self, url: str, *, access_token: str) -> _DirectoryHTTPResponse: ...

    def post(self, url: str, *, access_token: str, body: dict[str, int]) -> _DirectoryHTTPResponse: ...

    def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class _AccessToken:
    value: str
    expires_in: int


class _AccessTokenResponseBody(BaseModel):
    model_config = ConfigDict(strict=True, from_attributes=True)

    access_token: str = Field(min_length=1)
    expires_in: int = Field(gt=0)


class _AccessTokenResponse(BaseModel):
    model_config = ConfigDict(strict=True, from_attributes=True)

    body: _AccessTokenResponseBody


class _DirectoryHTTPError(Exception):
    pass


class _DirectoryProviderRejectedError(_DirectoryHTTPError):
    def __init__(self, provider_error_code: int | None, *, http_status: int) -> None:
        super().__init__()
        self.provider_error_code = str(provider_error_code) if provider_error_code is not None else None
        self.http_status = http_status


class _OAuthErrorData(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    status_code: int | None = Field(default=None, alias="statusCode")


class _OAuthErrorResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True, hide_input_in_errors=True)

    code: str | None = None
    data: _OAuthErrorData | None = None


class _ProviderResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    errcode: int | None = None
    errmsg: str | None = None


class _Department(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    dept_id: int = Field(ge=1)


class _DepartmentListResponse(_ProviderResponse):
    result: tuple[_Department, ...] | None = None


class _AuthorizationOrganizationScope(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    authed_dept: tuple[int, ...]
    authed_user: tuple[str, ...]


class _AuthorizationScopeResponse(_ProviderResponse):
    auth_org_scopes: _AuthorizationOrganizationScope


class _DirectoryUser(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    userid: str
    name: str | None = None
    email: str | None = None
    avatar_url: str | None = Field(default=None, alias="avatar")

    @field_validator("avatar_url")
    @classmethod
    def _normalize_avatar_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class _UserPage(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    has_more: bool
    next_cursor: int | None = None
    users: tuple[_DirectoryUser, ...] = Field(alias="list")


class _UserListResponse(_ProviderResponse):
    result: _UserPage | None = None


class _DingTalkLocatorPayload(_Base64JSONLocatorPayload):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    # version of the locator
    v: Literal[1]
    # provider of the locator
    p: Literal[IMProvider.DING_TALK]
    # DingTalk process query key returned for the sent message:
    # https://open.dingtalk.com/document/orgapp/chatbots-send-one-on-one-chat-messages-in-batches.md
    process_query_key: str = Field(min_length=1, pattern=r"\S")


class _SDKAccessTokenProvider(AccessTokenProvider):
    def __init__(self, credentials: DingTalkCredentials, client: _OAuthClient) -> None:
        self._credentials = credentials
        self._client = client

    @override
    def get(self) -> str:
        return _get_access_token(self._client, self._credentials)


class _UrllibDirectoryHTTPClient(_DirectoryHTTPClient):
    @override
    def get(self, url: str, *, access_token: str) -> _DirectoryHTTPResponse:
        target = f"{url}?{urllib_parse.urlencode({'access_token': access_token})}"
        request = urllib_request.Request(target, method="GET")
        with urllib_request.urlopen(request, timeout=_HTTP_TIMEOUT_SECONDS) as response:
            return _DirectoryHTTPResponse(body=response.read(), http_status=response.status)

    @override
    def post(self, url: str, *, access_token: str, body: dict[str, int]) -> _DirectoryHTTPResponse:
        target = f"{url}?{urllib_parse.urlencode({'access_token': access_token})}"
        request = urllib_request.Request(
            target,
            data=json.dumps(body, separators=(",", ":")).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib_request.urlopen(request, timeout=_HTTP_TIMEOUT_SECONDS) as response:
            return _DirectoryHTTPResponse(body=response.read(), http_status=response.status)

    @override
    def close(self) -> None:
        return None


class _DingTalkDirectory(IMDirectory):
    def __init__(self, token_provider: AccessTokenProvider, http_client: _DirectoryHTTPClient) -> None:
        self._token_provider = token_provider
        self._http_client = http_client

    @override
    def read_directory(self) -> Directory | DirectoryReadFailure:
        try:
            access_token = self._token_provider.get()
            return self._read_complete_directory(access_token)
        except Exception:
            return DirectoryReadFailure(_DIRECTORY_READ_FAILED)

    def _read_complete_directory(self, access_token: str) -> Directory:
        users: list[_DirectoryUser] = []
        seen_user_ids: set[str] = set()
        pending_departments: deque[int] = deque((_ROOT_DEPARTMENT_ID,))
        discovered_departments = {_ROOT_DEPARTMENT_ID}

        while pending_departments:
            department_id = pending_departments.popleft()
            for child in _department_children(self._http_client, access_token, department_id):
                if child.dept_id in discovered_departments:
                    continue
                discovered_departments.add(child.dept_id)
                pending_departments.append(child.dept_id)

            cursor = 0
            seen_cursors = {cursor}
            while True:
                page = _user_page(self._http_client, access_token, department_id, cursor)
                for user in page.users:
                    if not user.userid.strip():
                        raise _DirectoryHTTPError
                    if user.userid in seen_user_ids:
                        continue
                    seen_user_ids.add(user.userid)
                    users.append(user)
                if not page.has_more:
                    break
                next_cursor = page.next_cursor
                if next_cursor is None or next_cursor in seen_cursors:
                    raise _DirectoryHTTPError
                seen_cursors.add(next_cursor)
                cursor = next_cursor

        avatars = read_avatars([user.avatar_url for user in users])
        return Directory(
            tuple(
                DirectoryEntry(
                    ProviderUserId(user.userid),
                    _optional_non_blank(user.name),
                    _optional_non_blank(user.email),
                    avatar=avatar,
                )
                for user, avatar in zip(users, avatars, strict=True)
            )
        )


class _DingTalkMessaging(IMMessaging):
    def __init__(
        self,
        robot_code: str,
        token_provider: AccessTokenProvider,
        client: _RobotClient,
    ) -> None:
        self._robot_code = robot_code
        self._token_provider = token_provider
        self._client = client

    @override
    def send_text(
        self, provider_user_id: ProviderUserId, body: str, subject: str | None = None
    ) -> MessageSendingResult:
        if subject is not None:
            body = f"{subject}\n\n{body}"
        try:
            access_token = self._token_provider.get()
            response = self._client.batch_send_otowith_options(
                BatchSendOTORequest(
                    msg_key="sampleText",
                    msg_param=json.dumps({"content": body}, ensure_ascii=False, separators=(",", ":")),
                    robot_code=self._robot_code,
                    user_ids=[str(provider_user_id)],
                ),
                BatchSendOTOHeaders(x_acs_dingtalk_access_token=access_token),
                RuntimeOptions(
                    autoretry=False,
                    max_attempts=1,
                    connect_timeout=_SDK_TIMEOUT_MILLISECONDS,
                    read_timeout=_SDK_TIMEOUT_MILLISECONDS,
                ),
            )
            status_code = getattr(response, "status_code", None)
            if (
                not isinstance(status_code, int)
                or isinstance(status_code, bool)
                or not _HTTP_SUCCESS_STATUS_MIN <= status_code < _HTTP_SUCCESS_STATUS_MAX_EXCLUSIVE
            ):
                return MessageSendingError(_MESSAGE_ACCEPTANCE_UNCONFIRMED)
            response_body = getattr(response, "body", None)
            if response_body is None or _has_rejected_recipients(response_body):
                return MessageSendingError(_MESSAGE_ACCEPTANCE_UNCONFIRMED)
            process_query_key = getattr(response_body, "process_query_key", None)
            if not isinstance(process_query_key, str) or not process_query_key.strip():
                return MessageSendingError(_MESSAGE_ACCEPTANCE_UNCONFIRMED)
            return MessageAccepted(
                MessageLocator(
                    _DingTalkLocatorPayload(
                        v=1,
                        p=IMProvider.DING_TALK,
                        process_query_key=process_query_key,
                    ).encode()
                )
            )
        except Exception:
            return MessageSendingError(_MESSAGE_ACCEPTANCE_UNCONFIRMED)


class DingTalkIMProviderAdapter:
    """Externally serialized DingTalk capability composition root."""

    @classmethod
    def card_event_decoder(cls) -> IMCardEventDecoder | None:
        return None

    def __init__(self, credentials: DingTalkCredentials) -> None:
        if not isinstance(credentials, DingTalkCredentials):
            raise TypeError("DingTalk adapter requires resolved DingTalk credentials")
        self._credentials = credentials
        self._credential_test_client = _new_oauth_client()
        token_provider = _SDKAccessTokenProvider(credentials, _new_oauth_client())
        self._http_client = _new_http_client()
        self._directory = _DingTalkDirectory(token_provider, self._http_client)
        self._messaging = _DingTalkMessaging(credentials.client_id, token_provider, _new_robot_client())
        self._closed = False

    @property
    def provider(self) -> IMProvider:
        return IMProvider.DING_TALK

    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure:
        try:
            return self._test_credentials()
        except (TimeoutError, RequestsTimeout) as error:
            raise CredentialTestTimeoutError() from error
        except urllib_error.HTTPError as error:
            try:
                rejection = _ProviderResponse.model_validate_json(error.read())
            except ValidationError:
                provider_error_code = None
            else:
                provider_error_code = str(rejection.errcode) if rejection.errcode is not None else None
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN, _CREDENTIAL_REJECTED, provider_error_code, http_status=error.code
            )
        except urllib_error.URLError as error:
            if isinstance(error.reason, TimeoutError):
                raise CredentialTestTimeoutError() from error
            raise

    def _test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure:
        try:
            access_token = _get_access_token(self._credential_test_client, self._credentials)
        except TeaException as error:
            rejection = _OAuthErrorResponse.model_validate({"code": error.code, "data": error.data})
            status_code = rejection.data.status_code if rejection.data is not None else None
            if rejection.code is None and status_code is None:
                raise
            kind = (
                CredentialTestFailureKind.AUTHENTICATION_REJECTED
                if status_code in {400, 401, 403}
                else CredentialTestFailureKind.UNKNOWN
            )
            return CredentialTestFailure(kind, _CREDENTIAL_REJECTED, rejection.code, http_status=status_code)

        try:
            complete_authorization = _has_complete_member_authorization(self._http_client, access_token)
        except _DirectoryProviderRejectedError as error:
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                _AUTHORIZATION_SCOPE_UNVERIFIED,
                error.provider_error_code,
                http_status=error.http_status,
            )
        if not complete_authorization:
            return CredentialTestFailure(
                CredentialTestFailureKind.PERMISSION_DENIED,
                _AUTHORIZATION_SCOPE_UNVERIFIED,
            )
        baseline_failure = _verify_root_boundary(self._http_client, access_token)
        if baseline_failure is not None:
            return baseline_failure
        return CredentialTestSuccess(IMProvider.DING_TALK, self._credentials.corp_id)

    @property
    def directory(self) -> IMDirectory:
        return self._directory

    @property
    def messaging(self) -> IMMessaging:
        return self._messaging

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging | None:
        return None

    def create_webhook_handler(self, consumer: IMEventConsumer) -> IMWebhookHandler | None:
        del consumer
        return None

    def create_stream_handler(self, consumer: IMEventConsumer) -> IMEventStream | None:
        del consumer
        return None

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._http_client.close()


def _new_oauth_client() -> OAuthClient:
    return OAuthClient(_sdk_config())


def _new_robot_client() -> RobotClient:
    return RobotClient(_sdk_config())


def _new_http_client() -> _DirectoryHTTPClient:
    return _UrllibDirectoryHTTPClient()


def _sdk_config() -> Config:
    return Config(
        protocol="https",
        connect_timeout=_SDK_TIMEOUT_MILLISECONDS,
        read_timeout=_SDK_TIMEOUT_MILLISECONDS,
    )


def _get_access_token(client: _OAuthClient, credentials: DingTalkCredentials) -> str:
    return _request_access_token(client, credentials).value


def _request_access_token(client: _OAuthClient, credentials: DingTalkCredentials) -> _AccessToken:
    response = client.get_token(
        credentials.corp_id,
        GetTokenRequest(
            client_id=credentials.client_id,
            client_secret=credentials.client_secret,
            grant_type="client_credentials",
        ),
    )
    try:
        response_body = _AccessTokenResponse.model_validate(response).body
    except ValidationError as error:
        raise IMProviderError(f"DingTalk returned an invalid access token response: {error}") from error
    return _AccessToken(response_body.access_token, response_body.expires_in)


def _verify_root_boundary(http_client: _DirectoryHTTPClient, access_token: str) -> CredentialTestFailure | None:
    try:
        _department_children(http_client, access_token, _ROOT_DEPARTMENT_ID)
    except _DirectoryProviderRejectedError as error:
        return CredentialTestFailure(
            CredentialTestFailureKind.TENANT_ID_UNAVAILABLE,
            _TENANT_BOUNDARY_UNAVAILABLE,
            error.provider_error_code,
            http_status=error.http_status,
        )
    return None


def _has_complete_member_authorization(
    http_client: _DirectoryHTTPClient,
    access_token: str,
) -> bool:
    response_body = http_client.get(_AUTHORIZATION_SCOPE_URL, access_token=access_token)
    scope = _parse_response(response_body, _AuthorizationScopeResponse).auth_org_scopes
    return _ROOT_DEPARTMENT_ID in scope.authed_dept


def _department_children(
    http_client: _DirectoryHTTPClient,
    access_token: str,
    department_id: int,
) -> tuple[_Department, ...]:
    response_body = http_client.post(
        _DEPARTMENT_LIST_URL,
        access_token=access_token,
        body={"dept_id": department_id},
    )
    payload = _parse_response(response_body, _DepartmentListResponse)
    if payload.result is None:
        raise IMProviderError("DingTalk did not provide department results.")
    return payload.result


def _user_page(
    http_client: _DirectoryHTTPClient,
    access_token: str,
    department_id: int,
    cursor: int,
) -> _UserPage:
    response_body = http_client.post(
        _USER_LIST_URL,
        access_token=access_token,
        body={"dept_id": department_id, "cursor": cursor, "size": _DIRECTORY_PAGE_SIZE},
    )
    payload = _parse_response(response_body, _UserListResponse)
    if payload.result is None:
        raise IMProviderError("DingTalk did not provide user results.")
    return payload.result


def _parse_response[ResponseT: _ProviderResponse](
    response_body: _DirectoryHTTPResponse,
    response_type: type[ResponseT],
) -> ResponseT:
    rejection = _ProviderResponse.model_validate_json(response_body.body)
    if rejection.errcode != 0:
        raise _DirectoryProviderRejectedError(rejection.errcode, http_status=response_body.http_status)
    return response_type.model_validate_json(response_body.body)


def _optional_non_blank(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return value


def _has_rejected_recipients(response_body: object) -> bool:
    for field_name in (
        "filtered_staff_id_list",
        "flow_controlled_staff_id_list",
        "invalid_staff_id_list",
    ):
        value = getattr(response_body, field_name, None)
        if value is None:
            continue
        if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)) or value:
            return True
    return False


__all__ = ["DingTalkIMProviderAdapter"]
