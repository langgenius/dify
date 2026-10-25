from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from html import escape
from typing import Literal, NoReturn
from urllib.parse import quote, urlsplit
from uuid import uuid4

import httpx
import pytest
from azure.core.exceptions import AzureError
from azure.identity import ClientSecretCredential
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    Directory,
    MessageAccepted,
    MSTeamsCredentials,
    ProviderUserId,
)
from core.human_input_v2.im_integration.adapters.ms_teams import MSTeamsIMProviderAdapter

_GRAPH_SCOPE = "https://graph.microsoft.com/.default"
_GRAPH_USERS_URL = "https://graph.microsoft.com/v1.0/users"
_GRAPH_HTTP_TIMEOUT_SECONDS = 10.0
_GRAPH_CONTROL_PAGE_SIZE = 1
_MESSAGE_LOOKBACK = timedelta(minutes=1)
_MESSAGE_LOOKAHEAD = timedelta(minutes=10)
_MESSAGE_RETRIEVAL_TIMEOUT_SECONDS = 60.0
_MESSAGE_RETRIEVAL_POLL_SECONDS = 2.0
_MESSAGE_RETRIEVAL_PAGE_SIZE = 50
_MESSAGE_RETRIEVAL_MAX_PAGES_PER_POLL = 8
_MESSAGE_RETRIEVAL_MAX_REQUESTS = 64
_EXTERNAL_CLIENT_LOGGER_NAMES = (
    "azure",
    "botbuilder",
    "botframework",
    "httpcore",
    "httpx",
    "msrest",
    "requests",
    "urllib3",
)
_SUPPRESSED_CLIENT_LOG_LEVEL = logging.CRITICAL + 1


@dataclass(frozen=True, slots=True, repr=False)
class _MSTeamsTestEnvironment:
    tenant_id: str
    client_id: str
    client_secret: str
    recipient_id: str | None

    def credentials(self) -> MSTeamsCredentials:
        try:
            return MSTeamsCredentials(
                provider=IMProvider.MS_TEAMS,
                tenant_id=self.tenant_id,
                client_id=self.client_id,
                client_secret=self.client_secret,
            )
        except ValidationError:
            pass
        pytest.fail("Microsoft Teams integration credentials are invalid.", pytrace=False)


@dataclass(slots=True)
class _MessageRetrievalBudget:
    deadline: float
    remaining_requests: int = _MESSAGE_RETRIEVAL_MAX_REQUESTS

    def next_request_timeout(self) -> float:
        if self.remaining_requests <= 0:
            pytest.fail("Microsoft Graph message retrieval exceeded its request budget.", pytrace=False)
        remaining_seconds = self.deadline - time.monotonic()
        if remaining_seconds <= 0:
            pytest.fail("Microsoft Graph message retrieval exceeded its time budget.", pytrace=False)
        self.remaining_requests -= 1
        return min(_GRAPH_HTTP_TIMEOUT_SECONDS, remaining_seconds)


class _GraphModel(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)


class _GraphDirectoryUser(_GraphModel):
    id: str = Field(min_length=1)
    display_name: str | None = Field(default=None, alias="displayName")
    email: str | None = Field(default=None, alias="mail")

    @field_validator("display_name", "email", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class _GraphDirectoryPage(_GraphModel):
    users: tuple[_GraphDirectoryUser, ...] = Field(alias="value")
    next_link: str | None = Field(default=None, alias="@odata.nextLink")


class _GraphMessageBody(_GraphModel):
    content: str
    content_type: Literal["html", "text"] = Field(alias="contentType")


class _GraphMessage(_GraphModel):
    body: _GraphMessageBody


class _GraphMessagePage(_GraphModel):
    messages: tuple[_GraphMessage, ...] = Field(alias="value")
    next_link: str | None = Field(default=None, alias="@odata.nextLink")


@pytest.fixture(autouse=True)
def _suppress_external_client_logs() -> Iterator[None]:
    client_loggers = tuple(logging.getLogger(name) for name in _EXTERNAL_CLIENT_LOGGER_NAMES)
    original_levels = tuple(logger.level for logger in client_loggers)
    for logger in client_loggers:
        logger.setLevel(_SUPPRESSED_CLIENT_LOG_LEVEL)
    try:
        yield
    finally:
        for logger, original_level in zip(client_loggers, original_levels, strict=True):
            logger.setLevel(original_level)


def _test_environment(*, require_recipient: bool) -> _MSTeamsTestEnvironment:
    tenant_id = os.environ.get("MS_TEAMS_TENANT_ID")
    client_id = os.environ.get("MS_TEAMS_CLIENT_ID")
    client_secret = os.environ.get("MS_TEAMS_CLIENT_SECRET")
    if not tenant_id or not client_id or not client_secret:
        pytest.skip("Real Microsoft Teams integration credentials are not configured.")

    recipient_id = os.environ.get("MS_TEAMS_TEST_RECIPIENT_ID")
    if require_recipient and not recipient_id:
        pytest.skip("MS_TEAMS_TEST_RECIPIENT_ID is not configured for the Messaging integration test.")
    return _MSTeamsTestEnvironment(tenant_id, client_id, client_secret, recipient_id)


def _graph_access_token(environment: _MSTeamsTestEnvironment) -> str:
    credential = ClientSecretCredential(
        environment.tenant_id,
        environment.client_id,
        environment.client_secret,
    )
    try:
        try:
            access_token = credential.get_token(_GRAPH_SCOPE).token
        except AzureError:
            access_token = None
    finally:
        credential.close()
    if access_token is None:
        pytest.fail("Microsoft Graph authentication failed.", pytrace=False)
    return access_token


def _fail_invalid_graph_response(operation: str) -> NoReturn:
    pytest.fail(f"Microsoft Graph {operation} returned an invalid response.", pytrace=False)


def _graph_response_json(
    client: httpx.Client,
    url: str,
    access_token: str,
    *,
    operation: str,
    request_timeout: float,
    params: Mapping[str, str] | None = None,
) -> object:
    try:
        response = client.get(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
            timeout=request_timeout,
        )
    except httpx.HTTPError:
        response = None

    if response is None:
        pytest.fail(f"Microsoft Graph {operation} could not be completed.", pytrace=False)

    if response.is_error:
        pytest.fail(
            f"Microsoft Graph {operation} failed with HTTP {response.status_code}.",
            pytrace=False,
        )
    try:
        return response.json()
    except ValueError:
        pass
    pytest.fail(f"Microsoft Graph {operation} could not be completed.", pytrace=False)


def _trusted_graph_users_url(url: str) -> bool:
    parsed = urlsplit(url)
    return parsed.scheme == "https" and parsed.netloc == "graph.microsoft.com" and parsed.path == "/v1.0/users"


def _trusted_graph_messages_url(url: str) -> bool:
    parsed = urlsplit(url)
    return (
        parsed.scheme == "https"
        and parsed.netloc == "graph.microsoft.com"
        and parsed.path.casefold().endswith("/chats/getallmessages")
    )


def _real_graph_directory(environment: _MSTeamsTestEnvironment) -> tuple[tuple[_GraphDirectoryUser, ...], int]:
    access_token = _graph_access_token(environment)
    users: list[_GraphDirectoryUser] = []
    page_count = 0
    next_url: str | None = _GRAPH_USERS_URL
    seen_urls: set[str] = set()
    params: Mapping[str, str] | None = {
        "$select": "id,displayName,mail",
        "$top": str(_GRAPH_CONTROL_PAGE_SIZE),
    }

    with httpx.Client(timeout=_GRAPH_HTTP_TIMEOUT_SECONDS) as client:
        while next_url is not None:
            if not _trusted_graph_users_url(next_url) or next_url in seen_urls:
                pytest.fail("Microsoft Graph returned an untrusted directory continuation.", pytrace=False)
            seen_urls.add(next_url)
            response_body = _graph_response_json(
                client,
                next_url,
                access_token,
                operation="directory control enumeration",
                request_timeout=_GRAPH_HTTP_TIMEOUT_SECONDS,
                params=params,
            )
            try:
                page = _GraphDirectoryPage.model_validate(response_body)
            except ValidationError:
                page = None
            if page is None:
                _fail_invalid_graph_response("directory control enumeration")
            users.extend(page.users)
            page_count += 1
            next_url = page.next_link
            params = None
    return tuple(users), page_count


def _graph_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _recent_graph_messages(
    environment: _MSTeamsTestEnvironment,
    access_token: str,
    modified_after: datetime,
    modified_before: datetime,
    retrieval_budget: _MessageRetrievalBudget,
) -> tuple[_GraphMessage, ...]:
    if environment.recipient_id is None:
        pytest.fail("Microsoft Teams Messaging test configuration is invalid.", pytrace=False)
    recipient = quote(environment.recipient_id, safe="")
    next_url: str | None = f"https://graph.microsoft.com/v1.0/users/{recipient}/chats/getAllMessages"
    params: Mapping[str, str] | None = {
        "$top": str(_MESSAGE_RETRIEVAL_PAGE_SIZE),
        "$filter": (
            f"lastModifiedDateTime gt {_graph_datetime(modified_after)} "
            f"and lastModifiedDateTime lt {_graph_datetime(modified_before)}"
        ),
    }
    messages: list[_GraphMessage] = []
    seen_urls: set[str] = set()
    page_count = 0

    with httpx.Client(timeout=_GRAPH_HTTP_TIMEOUT_SECONDS) as client:
        while next_url is not None:
            if not _trusted_graph_messages_url(next_url) or next_url in seen_urls:
                pytest.fail("Microsoft Graph returned an untrusted message continuation.", pytrace=False)
            if page_count >= _MESSAGE_RETRIEVAL_MAX_PAGES_PER_POLL:
                pytest.fail("Microsoft Graph message retrieval exceeded its pagination limit.", pytrace=False)
            seen_urls.add(next_url)
            response_body = _graph_response_json(
                client,
                next_url,
                access_token,
                operation="message retrieval",
                request_timeout=retrieval_budget.next_request_timeout(),
                params=params,
            )
            try:
                page = _GraphMessagePage.model_validate(response_body)
            except ValidationError:
                page = None
            if page is None:
                _fail_invalid_graph_response("message retrieval")
            messages.extend(page.messages)
            page_count += 1
            next_url = page.next_link
            params = None
    return tuple(messages)


def _validate_directory_snapshot(
    directory_result: object,
    control_users: tuple[_GraphDirectoryUser, ...],
    control_page_count: int,
) -> None:
    if not isinstance(directory_result, Directory):
        pytest.fail("Microsoft Teams production directory could not be read.", pytrace=False)
    if control_page_count < 2:
        pytest.fail("Microsoft Graph directory control did not traverse multiple pages.", pytrace=False)
    if not directory_result.entries:
        pytest.fail("Microsoft Teams production directory was empty.", pytrace=False)
    if any(not str(entry.provider_user_id).strip() for entry in directory_result.entries):
        pytest.fail("Microsoft Teams production directory contained an incomplete entry.", pytrace=False)
    if any(entry.display_name is None or not entry.display_name.strip() for entry in directory_result.entries):
        pytest.fail("Microsoft Teams production directory contained an incomplete entry.", pytrace=False)
    if any(entry.email is None or not entry.email.strip() for entry in directory_result.entries):
        pytest.fail("Microsoft Teams production directory contained an incomplete entry.", pytrace=False)

    adapter_facts = {
        (str(entry.provider_user_id), entry.display_name, entry.email) for entry in directory_result.entries
    }
    control_facts = {(user.id, user.display_name, user.email) for user in control_users}
    if len(adapter_facts) != len(directory_result.entries) or len(control_facts) != len(control_users):
        pytest.fail("Microsoft Teams directory comparison contained duplicate entries.", pytrace=False)
    if adapter_facts != control_facts:
        pytest.fail("Microsoft Teams production and control directories did not match.", pytrace=False)


def _exact_graph_message_found(
    messages: tuple[_GraphMessage, ...],
    exact_graph_bodies: frozenset[tuple[str, str]],
) -> bool:
    match_count = sum((message.body.content_type, message.body.content) in exact_graph_bodies for message in messages)
    if match_count > 1:
        pytest.fail("Microsoft Graph returned multiple exact accepted Teams messages.", pytrace=False)
    return match_count == 1


def test_directory_matches_complete_real_graph_multi_page_control() -> None:
    environment = _test_environment(require_recipient=False)
    adapter = MSTeamsIMProviderAdapter(environment.credentials())
    try:
        directory_result = adapter.directory.read_directory()
    finally:
        adapter.close()

    control_users, control_page_count = _real_graph_directory(environment)
    _validate_directory_snapshot(directory_result, control_users, control_page_count)


def test_send_text_is_retrievable_with_exact_content_from_real_graph() -> None:
    environment = _test_environment(require_recipient=True)
    if environment.recipient_id is None:
        pytest.fail("Microsoft Teams Messaging test configuration is invalid.", pytrace=False)
    exact_body = f"Dify Microsoft Teams integration verification {uuid4()}"
    modified_after = datetime.now(UTC) - _MESSAGE_LOOKBACK
    adapter = MSTeamsIMProviderAdapter(environment.credentials())
    try:
        send_result = adapter.messaging.send_text(
            ProviderUserId(environment.recipient_id),
            exact_body,
        )
    finally:
        adapter.close()

    if not isinstance(send_result, MessageAccepted):
        pytest.fail("Microsoft Teams did not confirm message acceptance.", pytrace=False)
    modified_before = datetime.now(UTC) + _MESSAGE_LOOKAHEAD
    access_token = _graph_access_token(environment)
    retrieval_deadline = time.monotonic() + _MESSAGE_RETRIEVAL_TIMEOUT_SECONDS
    retrieval_budget = _MessageRetrievalBudget(retrieval_deadline)
    exact_graph_bodies = frozenset(
        (
            ("html", f"<p>{escape(exact_body)}</p>"),
            ("text", exact_body),
        )
    )
    while True:
        messages = _recent_graph_messages(
            environment,
            access_token,
            modified_after,
            modified_before,
            retrieval_budget,
        )
        if _exact_graph_message_found(messages, exact_graph_bodies):
            return
        remaining_seconds = retrieval_deadline - time.monotonic()
        if remaining_seconds <= 0:
            pytest.fail("Microsoft Graph did not return the exact accepted Teams message.", pytrace=False)
        time.sleep(min(_MESSAGE_RETRIEVAL_POLL_SECONDS, remaining_seconds))
