from __future__ import annotations

import os
from collections.abc import Generator, Mapping, Sequence
from uuid import uuid4

import pytest
from pydantic import ValidationError
from slack_sdk.web import WebClient

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter, _SlackMessageLocator
from core.human_input_v2.im_provider import (
    Directory,
    MessageAccepted,
    ProviderUserId,
    SlackIMIntegrationCredentials,
)

_SLACK_DIRECTORY_REFERENCE_PAGE_SIZE = 1
_MINIMUM_EXPECTED_SLACK_DIRECTORY_USERS = 2


def _non_empty_environment_value(name: str) -> str | None:
    value = os.getenv(name)
    if value is None or not value.strip():
        return None
    return value


@pytest.fixture
def slack_credentials() -> SlackIMIntegrationCredentials:
    client_id = _non_empty_environment_value("SLACK_CLIENT_ID")
    client_secret = _non_empty_environment_value("SLACK_CLIENT_SECRET")
    signing_secret = _non_empty_environment_value("SLACK_SIGNING_SECRET")
    bot_token = _non_empty_environment_value("SLACK_BOT_TOKEN")
    app_token = _non_empty_environment_value("SLACK_APP_SOCKET_TOKEN")

    missing_names = [
        name
        for name, value in (
            ("SLACK_CLIENT_ID", client_id),
            ("SLACK_CLIENT_SECRET", client_secret),
            ("SLACK_SIGNING_SECRET", signing_secret),
            ("SLACK_BOT_TOKEN", bot_token),
            ("SLACK_APP_SOCKET_TOKEN", app_token),
        )
        if value is None
    ]
    if missing_names:
        pytest.skip(f"Slack integration credentials are unavailable: {', '.join(missing_names)}")

    assert client_id is not None
    assert client_secret is not None
    assert signing_secret is not None
    assert bot_token is not None
    assert app_token is not None
    try:
        return SlackIMIntegrationCredentials(
            provider=IMProvider.SLACK,
            client_id=client_id,
            client_secret=client_secret,
            signing_secret=signing_secret,
            bot_token=bot_token,
            app_token=app_token,
        )
    except ValidationError:
        pytest.fail("Slack integration credentials are invalid.", pytrace=False)


@pytest.fixture
def slack_adapter(slack_credentials: SlackIMIntegrationCredentials) -> Generator[SlackIMProviderAdapter, None, None]:
    adapter = SlackIMProviderAdapter(slack_credentials)
    try:
        yield adapter
    finally:
        adapter.close()


@pytest.fixture
def slack_web_client(slack_credentials: SlackIMIntegrationCredentials) -> WebClient:
    return WebClient(token=slack_credentials.bot_token, retry_handlers=[])


@pytest.fixture
def slack_test_recipient_id() -> ProviderUserId:
    recipient_id = _non_empty_environment_value("SLACK_TEST_RECIPIENT_ID")
    if recipient_id is None:
        pytest.skip("SLACK_TEST_RECIPIENT_ID is unavailable.")
    return ProviderUserId(recipient_id)


def _profile_field(profile: Mapping[object, object], name: str) -> str | None:
    value = profile.get(name)
    if not isinstance(value, str) or not value.strip():
        return None
    return value


def _paginated_slack_directory_entries(client: WebClient) -> tuple[dict[str, tuple[str, str]], int]:
    directory_entries: dict[str, tuple[str, str]] = {}
    seen_cursors: set[str] = set()
    cursor: str | None = None
    page_count = 0

    while True:
        if cursor is None:
            response = client.users_list(limit=_SLACK_DIRECTORY_REFERENCE_PAGE_SIZE)
        else:
            response = client.users_list(limit=_SLACK_DIRECTORY_REFERENCE_PAGE_SIZE, cursor=cursor)
        page_count += 1

        members = response.get("members")
        assert isinstance(members, Sequence)
        assert not isinstance(members, (str, bytes, bytearray))
        for member in members:
            assert isinstance(member, Mapping)
            provider_user_id = member.get("id")
            if member.get("deleted") is True or member.get("is_bot") is True or member.get("is_app_user") is True:
                continue
            assert isinstance(provider_user_id, str)
            assert provider_user_id.strip()
            profile = member.get("profile")
            assert isinstance(profile, Mapping)
            display_name = _profile_field(profile, "display_name_normalized") or _profile_field(
                profile, "real_name_normalized"
            )
            email = _profile_field(profile, "email")
            if display_name is not None and email is not None:
                directory_entries[provider_user_id] = (display_name, email)

        response_metadata = response.get("response_metadata")
        assert isinstance(response_metadata, Mapping)
        next_cursor = response_metadata.get("next_cursor")
        assert isinstance(next_cursor, str)
        if not next_cursor:
            return directory_entries, page_count
        assert next_cursor not in seen_cursors
        seen_cursors.add(next_cursor)
        cursor = next_cursor


def test_slack_directory_matches_real_paginated_directory(
    slack_adapter: SlackIMProviderAdapter,
    slack_web_client: WebClient,
) -> None:
    expected_entries, page_count = _paginated_slack_directory_entries(slack_web_client)

    directory_result = slack_adapter.directory.read_directory()

    assert page_count >= 2
    assert isinstance(directory_result, Directory)
    assert len(directory_result.entries) >= _MINIMUM_EXPECTED_SLACK_DIRECTORY_USERS
    actual_entries: dict[str, tuple[str, str]] = {}
    for entry in directory_result.entries:
        provider_user_id = str(entry.provider_user_id)
        assert provider_user_id.strip()
        assert entry.display_name is not None
        assert entry.display_name.strip()
        assert entry.email is not None
        assert entry.email.strip()
        actual_entries[provider_user_id] = (entry.display_name, entry.email)
    assert actual_entries == expected_entries


def test_slack_messaging_sends_and_reads_exact_text(
    slack_test_recipient_id: ProviderUserId,
    slack_adapter: SlackIMProviderAdapter,
    slack_web_client: WebClient,
) -> None:
    message_body = f"Dify Slack integration test {uuid4()}"

    message_result = slack_adapter.messaging.send_text(slack_test_recipient_id, message_body)

    assert isinstance(message_result, MessageAccepted)
    assert isinstance(message_result.reference, _SlackMessageLocator)
    message_reference = message_result.reference
    response = slack_web_client.conversations_replies(
        channel=message_reference.channel_id,
        ts=message_reference.message_ts,
        inclusive=True,
        limit=1,
    )
    messages = response.get("messages")
    assert isinstance(messages, Sequence)
    assert not isinstance(messages, (str, bytes, bytearray))
    matching_messages = [
        message
        for message in messages
        if isinstance(message, Mapping) and message.get("ts") == message_reference.message_ts
    ]
    assert len(matching_messages) == 1
    assert matching_messages[0].get("text") == message_body
