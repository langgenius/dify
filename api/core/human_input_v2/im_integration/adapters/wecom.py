"""Concrete WeCom adapter for Provider-neutral Human Input IM contracts."""

from __future__ import annotations

import time
from email.headerregistry import Address
from typing import Annotated, Literal, Protocol, override

import httpx
from pydantic import BaseModel, ConfigDict, Field, RootModel, StrictInt, StrictStr, ValidationError, field_validator
from wechatpy.enterprise import WeChatClient
from wechatpy.exceptions import WeChatClientException

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters._message_locator_codec import _Base64JSONLocatorPayload
from core.human_input_v2.im_provider import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    IMDirectory,
    IMDynamicCardMessaging,
    IMEventConsumer,
    IMEventStream,
    IMMessaging,
    IMWebhookHandler,
    MessageAccepted,
    MessageLocator,
    MessageSendingError,
    MessageSendingResult,
    ProviderUserId,
    WeComIMIntegrationCredentials,
)

_SDK_TIMEOUT_SECONDS = 5.0
_ACCESS_TOKEN_URL = "https://qyapi.weixin.qq.com/cgi-bin/gettoken"

_AUTHENTICATION_REJECTION_CODES = frozenset({40001, 40013})
_TENANT_BOUNDARY_REJECTION_CODES = frozenset({40056, 48002, 60011})

_CREDENTIAL_TEST_FAILED = "WeCom credential testing could not be completed."
_CREDENTIAL_REJECTED = "WeCom rejected the credential test."
_TENANT_BOUNDARY_UNAVAILABLE = "WeCom could not verify the configured corporation directory boundary."
_DIRECTORY_READ_FAILED = "WeCom directory could not be read completely."
_MESSAGE_ACCEPTANCE_UNCONFIRMED = "WeCom message acceptance could not be confirmed."


class AccessTokenProvider(Protocol):
    def get(self) -> str:
        """Return a currently usable access token."""
        ...


class _AgentAPI(Protocol):
    def get(self, agent_id: int) -> object: ...


class _DepartmentAPI(Protocol):
    def get(self, id: int | None = None) -> object: ...


class _UserAPI(Protocol):
    def get(self, user_id: str) -> object: ...

    def list(
        self,
        department_id: int,
        fetch_child: bool = False,
        status: int = 0,
        simple: bool = False,
    ) -> object: ...


class _TagAPI(Protocol):
    def get_users(self, tag_id: int) -> object: ...


class _MessageAPI(Protocol):
    def send_text(
        self,
        agent_id: int,
        user_ids: list[str],
        content: str,
        party_ids: str = "",
        tag_ids: str = "",
        safe: int = 0,
    ) -> object: ...


class _WeComClient(Protocol):
    @property
    def agent(self) -> _AgentAPI: ...

    @property
    def department(self) -> _DepartmentAPI: ...

    @property
    def user(self) -> _UserAPI: ...

    @property
    def tag(self) -> _TagAPI: ...

    @property
    def message(self) -> _MessageAPI: ...

    def fetch_access_token(self) -> object: ...


class _AccessTokenResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    errcode: Literal[0]
    access_token: str = Field(min_length=1, pattern=r"\S")
    expires_in: int = Field(gt=0)


class _AccessTokenStatus(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    errcode: StrictInt


class _WeComClientWithBoundedTokenFetch(WeChatClient):
    @override
    def fetch_access_token(self) -> object:
        response = httpx.get(
            _ACCESS_TOKEN_URL,
            params={
                "corpid": self.corp_id,
                "corpsecret": self.secret,
            },
            timeout=_SDK_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
        status = _AccessTokenStatus.model_validate(payload)
        if status.errcode != 0:
            raise WeChatClientException(status.errcode, None)

        token = _AccessTokenResponse.model_validate(payload)
        self.session.set(self.access_token_key, token.access_token, token.expires_in)
        self.expires_at = int(time.time()) + token.expires_in
        return token.model_dump()


class _ScopedUser(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    userid: StrictStr = Field(pattern=r"\S")


class _AllowedDepartments(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    partyid: tuple[Annotated[StrictInt, Field(gt=0)], ...] = ()


class _AllowedUsers(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    user: tuple[_ScopedUser, ...] = ()


class _AllowedTags(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    tagid: tuple[Annotated[StrictInt, Field(gt=0)], ...] = ()


class _AgentResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    errcode: Literal[0]
    agentid: int = Field(gt=0)
    allow_partys: _AllowedDepartments = Field(default_factory=_AllowedDepartments)
    allow_userinfos: _AllowedUsers = Field(default_factory=_AllowedUsers)
    allow_tags: _AllowedTags = Field(default_factory=_AllowedTags)


class _Department(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    id: StrictInt = Field(gt=0)
    parentid: StrictInt = Field(ge=0)


class _DepartmentList(RootModel[tuple[_Department, ...]]):
    pass


class _DirectoryUser(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    userid: StrictStr
    name: StrictStr | None = None
    email: StrictStr | None = None

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return value
        if Address(addr_spec=value).addr_spec != value:
            raise ValueError("email must be an exact addr-spec")
        return value


class _DirectoryUserList(RootModel[tuple[_DirectoryUser, ...]]):
    pass


class _TagResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    errcode: Literal[0]
    userlist: tuple[_ScopedUser, ...] = ()
    partylist: tuple[StrictInt, ...] = ()


class _MessageSendResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    errcode: Literal[0]
    invaliduser: StrictStr | None = None
    invalidparty: StrictStr | None = None
    invalidtag: StrictStr | None = None
    msgid: StrictStr


class _DirectoryBoundaryError(Exception):
    pass


class _WeComLocatorPayload(_Base64JSONLocatorPayload):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    # version of the locator
    v: Literal[1]
    # provider of the locator
    p: Literal[IMProvider.WE_COM]
    # WeCom application message identifier returned by the send API:
    # https://developer.work.weixin.qq.com/document/path/90236
    message_id: StrictStr = Field(pattern=r"\S")


class _SDKAccessTokenProvider(AccessTokenProvider):
    def __init__(self, credentials: WeComIMIntegrationCredentials) -> None:
        self._credentials = credentials

    @override
    def get(self) -> str:
        return _fetch_access_token(_new_client(self._credentials))


class _WeComDirectory(IMDirectory):
    def __init__(
        self,
        credentials: WeComIMIntegrationCredentials,
        token_provider: AccessTokenProvider,
    ) -> None:
        self._credentials = credentials
        self._token_provider = token_provider

    @override
    def read_directory(self) -> Directory | DirectoryReadFailure:
        try:
            return self._read_complete_directory()
        # Provider SDKs may surface transport and decoding failures through
        # different exception classes. Directory never exposes partial state.
        except Exception:
            return DirectoryReadFailure(_DIRECTORY_READ_FAILED)

    def _read_complete_directory(self) -> Directory:
        access_token = self._token_provider.get()
        client = _new_client(self._credentials, access_token=access_token)
        scope = _AgentResponse.model_validate(client.agent.get(int(self._credentials.agent_id)))
        if scope.agentid != int(self._credentials.agent_id):
            raise _DirectoryBoundaryError

        entries: list[DirectoryEntry] = []
        seen_user_ids: set[str] = set()
        seen_department_ids: set[int] = set()

        for department_id in scope.allow_partys.partyid:
            _read_department_scope(
                client,
                department_id,
                entries,
                seen_user_ids,
                seen_department_ids,
            )

        for scoped_user in scope.allow_userinfos.user:
            _read_user_details(client, scoped_user.userid, entries, seen_user_ids)

        for tag_id in scope.allow_tags.tagid:
            if tag_id <= 0:
                raise _DirectoryBoundaryError
            tag = _TagResponse.model_validate(client.tag.get_users(tag_id))
            for scoped_user in tag.userlist:
                _read_user_details(client, scoped_user.userid, entries, seen_user_ids)
            for department_id in tag.partylist:
                _read_department_scope(
                    client,
                    department_id,
                    entries,
                    seen_user_ids,
                    seen_department_ids,
                )

        return Directory(tuple(entries))


class _WeComMessaging(IMMessaging):
    def __init__(
        self,
        credentials: WeComIMIntegrationCredentials,
        token_provider: AccessTokenProvider,
    ) -> None:
        self._credentials = credentials
        self._token_provider = token_provider

    @override
    def send_text(self, provider_user_id: ProviderUserId, body: str) -> MessageSendingResult:
        try:
            access_token = self._token_provider.get()
            client = _new_client(self._credentials, access_token=access_token)
            response = _MessageSendResponse.model_validate(
                client.message.send_text(
                    int(self._credentials.agent_id),
                    [str(provider_user_id)],
                    body,
                )
            )
            if any(
                _optional_non_blank(invalid_target) is not None
                for invalid_target in (response.invaliduser, response.invalidparty, response.invalidtag)
            ):
                return MessageSendingError(_MESSAGE_ACCEPTANCE_UNCONFIRMED)
            if not response.msgid.strip():
                return MessageSendingError(_MESSAGE_ACCEPTANCE_UNCONFIRMED)
            return MessageAccepted(
                MessageLocator(
                    _WeComLocatorPayload(
                        v=1,
                        p=IMProvider.WE_COM,
                        message_id=response.msgid,
                    ).encode()
                )
            )
        # One mutation attempt is the maximum; every SDK/transport/response
        # failure is normalized without replay or Provider material.
        except Exception:
            return MessageSendingError(_MESSAGE_ACCEPTANCE_UNCONFIRMED)


class WeComIMProviderAdapter:
    """Externally serialized WeCom capability composition root."""

    def __init__(self, credentials: WeComIMIntegrationCredentials) -> None:
        if not isinstance(credentials, WeComIMIntegrationCredentials):
            raise TypeError("WeCom adapter requires resolved WeCom credentials")
        self._credentials = credentials
        token_provider = _SDKAccessTokenProvider(credentials)
        self._directory = _WeComDirectory(credentials, token_provider)
        self._messaging = _WeComMessaging(credentials, token_provider)
        self._closed = False

    @property
    def provider(self) -> IMProvider:
        return IMProvider.WE_COM

    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure:
        try:
            client = _new_client(self._credentials)
            _fetch_access_token(client)
        except WeChatClientException as error:
            if error.errcode in _AUTHENTICATION_REJECTION_CODES:
                return CredentialTestFailure(CredentialTestFailureKind.AUTHENTICATION_REJECTED, _CREDENTIAL_REJECTED)
            return CredentialTestFailure(CredentialTestFailureKind.UNKNOWN, _CREDENTIAL_TEST_FAILED)
        except ValidationError:
            return CredentialTestFailure(CredentialTestFailureKind.UNKNOWN, _CREDENTIAL_TEST_FAILED)
        # The SDK can surface transport and decoding failures outside its documented
        # exception hierarchy. The shared boundary must normalize all of them.
        except Exception:
            return CredentialTestFailure(CredentialTestFailureKind.UNKNOWN, _CREDENTIAL_TEST_FAILED)

        try:
            agent = _AgentResponse.model_validate(client.agent.get(int(self._credentials.agent_id)))
        except WeChatClientException as error:
            if error.errcode in _TENANT_BOUNDARY_REJECTION_CODES:
                return CredentialTestFailure(
                    CredentialTestFailureKind.TENANT_ID_UNAVAILABLE,
                    _TENANT_BOUNDARY_UNAVAILABLE,
                )
            return CredentialTestFailure(CredentialTestFailureKind.UNKNOWN, _CREDENTIAL_TEST_FAILED)
        except ValidationError:
            return CredentialTestFailure(CredentialTestFailureKind.UNKNOWN, _CREDENTIAL_TEST_FAILED)
        # See the token boundary above; no Provider exception may cross this API.
        except Exception:
            return CredentialTestFailure(CredentialTestFailureKind.UNKNOWN, _CREDENTIAL_TEST_FAILED)

        if agent.agentid != int(self._credentials.agent_id):
            return CredentialTestFailure(CredentialTestFailureKind.UNKNOWN, _CREDENTIAL_TEST_FAILED)
        return CredentialTestSuccess(IMProvider.WE_COM, self._credentials.corp_id)

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


def _new_client(
    credentials: WeComIMIntegrationCredentials,
    *,
    access_token: str | None = None,
) -> _WeComClient:
    return _WeComClientWithBoundedTokenFetch(
        credentials.corp_id,
        credentials.secret,
        access_token=access_token,
        timeout=_SDK_TIMEOUT_SECONDS,
        auto_retry=False,
    )


def _fetch_access_token(client: _WeComClient) -> str:
    response = _AccessTokenResponse.model_validate(client.fetch_access_token())
    return response.access_token


def _read_department_scope(
    client: _WeComClient,
    root_department_id: int,
    entries: list[DirectoryEntry],
    seen_user_ids: set[str],
    seen_department_ids: set[int],
) -> None:
    if root_department_id <= 0:
        raise _DirectoryBoundaryError
    if root_department_id in seen_department_ids:
        return

    departments = _DepartmentList.model_validate(client.department.get(root_department_id)).root
    _validate_department_topology(root_department_id, departments)
    for department in departments:
        if department.id in seen_department_ids:
            continue
        seen_department_ids.add(department.id)
        users = _DirectoryUserList.model_validate(
            client.user.list(
                department.id,
                fetch_child=False,
                status=0,
                simple=False,
            )
        ).root
        for user in users:
            _append_directory_user(user, entries, seen_user_ids)


def _validate_department_topology(
    root_department_id: int,
    departments: tuple[_Department, ...],
) -> None:
    parent_by_department: dict[int, int] = {}
    for department in departments:
        if department.id in parent_by_department:
            raise _DirectoryBoundaryError
        parent_by_department[department.id] = department.parentid

    if root_department_id not in parent_by_department:
        raise _DirectoryBoundaryError
    if parent_by_department[root_department_id] in parent_by_department:
        raise _DirectoryBoundaryError

    for department_id in parent_by_department:
        current_department_id = department_id
        visited: set[int] = set()
        while current_department_id != root_department_id:
            if current_department_id in visited:
                raise _DirectoryBoundaryError
            visited.add(current_department_id)
            parent_id = parent_by_department.get(current_department_id)
            if parent_id is None:
                raise _DirectoryBoundaryError
            current_department_id = parent_id


def _read_user_details(
    client: _WeComClient,
    user_id: str,
    entries: list[DirectoryEntry],
    seen_user_ids: set[str],
) -> None:
    _require_valid_user_id(user_id)
    if user_id in seen_user_ids:
        return
    user = _DirectoryUser.model_validate(client.user.get(user_id))
    if user.userid != user_id:
        raise _DirectoryBoundaryError
    _append_directory_user(user, entries, seen_user_ids)


def _append_directory_user(
    user: _DirectoryUser,
    entries: list[DirectoryEntry],
    seen_user_ids: set[str],
) -> None:
    _require_valid_user_id(user.userid)
    if user.userid in seen_user_ids:
        return
    seen_user_ids.add(user.userid)
    entries.append(
        DirectoryEntry(
            ProviderUserId(user.userid),
            _optional_non_blank(user.name),
            _optional_non_blank(user.email),
        )
    )


def _require_valid_user_id(user_id: str) -> None:
    if not user_id.strip():
        raise _DirectoryBoundaryError


def _optional_non_blank(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return value


__all__ = ["WeComIMProviderAdapter"]
