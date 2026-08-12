from __future__ import annotations

import json
import os
import sys
from collections.abc import Generator, Mapping, Sequence
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode
from uuid import uuid4

import pytest
from pydantic import ValidationError
from slack_sdk.signature import SignatureVerifier
from slack_sdk.socket_mode.request import SocketModeRequest
from slack_sdk.web import WebClient

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ParagraphInput, ResolvedForm, ResolvedFormAction, SelectInput
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import slack as slack_module
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DynamicCardMessagingError,
    EventAcceptance,
    IMCardEvent,
    IMCardEventDecodingError,
    IMStreamStartError,
    MessageAccepted,
    MessageSendingError,
    ProviderUserId,
    SlackIMIntegrationCredentials,
    StaticCardIntent,
    UnrecognizedIMEvent,
    WebhookRequest,
)

_SLACK_DIRECTORY_REFERENCE_PAGE_SIZE = 1
_MINIMUM_EXPECTED_SLACK_DIRECTORY_USERS = 2
_RAW_JSON_EXTRA_PLACEHOLDER = "__raw_json_extra_placeholder__"
_RECEIVED_AT = datetime(2026, 8, 11, 12, 0, 0)
_FIXTURE_DIRECTORY = Path(__file__).resolve().parents[4] / "unit_tests/core/human_input_v2/im_provider/fixtures"


class _RecordingConsumer:
    def __init__(self, acceptance: EventAcceptance = EventAcceptance.ACCEPTED) -> None:
        self._acceptance = acceptance
        self.events: list[AuthenticatedIMEvent] = []

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        self.events.append(event)
        return self._acceptance


class _FailingConsumer:
    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        del event
        raise RuntimeError("sensitive consumer failure")


def _fixture(fixture_name: str) -> dict[str, object]:
    decoded = json.loads((_FIXTURE_DIRECTORY / fixture_name).read_text(encoding="utf-8"))
    assert isinstance(decoded, dict)
    return decoded


def _signed_webhook_request(
    signing_secret: str,
    body: bytes,
    *,
    content_type: str = "application/json",
    method: str = "POST",
    valid_signature: bool = True,
) -> WebhookRequest:
    timestamp = str(int(_RECEIVED_AT.replace(tzinfo=UTC).timestamp()))
    signature = SignatureVerifier(signing_secret).generate_signature(timestamp=timestamp, body=body)
    assert signature is not None
    if not valid_signature:
        signature = "v0=invalid"
    return WebhookRequest(
        method=method,
        headers=(
            ("X-Slack-Request-Timestamp", timestamp),
            ("X-Slack-Signature", signature),
            ("Content-Type", content_type),
        ),
        body=body,
        received_at=_RECEIVED_AT,
    )


def _serialize_callback_with_raw_extra(callback: Mapping[str, object], raw_json_value: str) -> str:
    callback_with_extra = dict(callback)
    callback_with_extra["ignored_extra"] = _RAW_JSON_EXTRA_PLACEHOLDER
    serialized_callback = json.dumps(callback_with_extra, ensure_ascii=False)
    serialized_placeholder = json.dumps(_RAW_JSON_EXTRA_PLACEHOLDER)
    assert serialized_callback.count(serialized_placeholder) == 1
    return serialized_callback.replace(serialized_placeholder, raw_json_value)


def _authenticated_slack_card_event(serialized_callback: str, received_second: int) -> AuthenticatedIMEvent:
    return AuthenticatedIMEvent(
        provider=IMProvider.SLACK,
        provider_tenant_id="integration-workspace",
        event_id=None,
        event_type="block_actions",
        occurred_at=None,
        received_at=datetime(2026, 8, 11, 12, 0, received_second),
        payload=serialized_callback,
    )


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


def _read_exact_message(client: WebClient, locator: str) -> Mapping[object, object]:
    locator_payload = slack_module._SlackLocatorPayload.decode(locator)
    response = client.conversations_replies(
        channel=locator_payload.channel_id,
        ts=locator_payload.message_ts,
        inclusive=True,
        limit=1,
    )
    messages = response.get("messages")
    assert isinstance(messages, Sequence)
    assert not isinstance(messages, str | bytes | bytearray)
    matching_messages = [
        message
        for message in messages
        if isinstance(message, Mapping) and message.get("ts") == locator_payload.message_ts
    ]
    assert len(matching_messages) == 1
    return matching_messages[0]


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


def test_slack_adapter_composes_capabilities_and_decoder_survives_lifecycle(
    slack_adapter: SlackIMProviderAdapter,
) -> None:
    consumer = _RecordingConsumer()
    decoder = SlackIMProviderAdapter.card_event_decoder()
    event_stream = slack_adapter.create_stream_handler(consumer)

    assert slack_adapter.provider is IMProvider.SLACK
    assert slack_adapter.directory is not None
    assert slack_adapter.messaging is not None
    assert slack_adapter.dynamic_card_messaging is not None
    assert slack_adapter.create_webhook_handler(consumer) is not None

    slack_adapter.close()
    slack_adapter.close()
    assert isinstance(
        decoder.decode(
            AuthenticatedIMEvent(
                provider=IMProvider.SLACK,
                provider_tenant_id="integration-workspace",
                event_id=None,
                event_type="message",
                occurred_at=None,
                received_at=_RECEIVED_AT,
                payload="{}",
            )
        ),
        UnrecognizedIMEvent,
    )

    event_stream.stop()
    event_stream.stop()
    with pytest.raises(IMStreamStartError):
        event_stream.start()


def test_slack_credentials_validate_real_web_and_socket_tokens(
    slack_adapter: SlackIMProviderAdapter,
) -> None:
    result = slack_adapter.test_credentials()

    assert isinstance(result, CredentialTestSuccess)
    assert result.provider is IMProvider.SLACK
    assert result.provider_tenant_id.strip()


def test_slack_credential_test_translates_documented_provider_rejections(
    slack_credentials: SlackIMIntegrationCredentials,
) -> None:
    invalid_bot_credentials = SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id=slack_credentials.client_id,
        client_secret=slack_credentials.client_secret,
        signing_secret=slack_credentials.signing_secret,
        bot_token="xoxb-invalid",
        app_token=slack_credentials.app_token,
    )
    invalid_bot_adapter = SlackIMProviderAdapter(invalid_bot_credentials)
    try:
        invalid_bot_result = invalid_bot_adapter.test_credentials()
    finally:
        invalid_bot_adapter.close()

    assert isinstance(invalid_bot_result, CredentialTestFailure)
    assert invalid_bot_result.kind is CredentialTestFailureKind.AUTHENTICATION_REJECTED

    invalid_app_credentials = SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id=slack_credentials.client_id,
        client_secret=slack_credentials.client_secret,
        signing_secret=slack_credentials.signing_secret,
        bot_token=slack_credentials.bot_token,
        app_token="xapp-invalid",
    )
    invalid_app_adapter = SlackIMProviderAdapter(invalid_app_credentials)
    try:
        invalid_app_result = invalid_app_adapter.test_credentials()
        invalid_app_stream = invalid_app_adapter.create_stream_handler(_RecordingConsumer())
        with pytest.raises(IMStreamStartError):
            invalid_app_stream.start()
        invalid_app_stream.stop()
    finally:
        invalid_app_adapter.close()

    assert isinstance(invalid_app_result, CredentialTestFailure)
    assert invalid_app_result.kind is CredentialTestFailureKind.AUTHENTICATION_REJECTED


def test_slack_webhook_hmac_reconstructs_json_and_form_callbacks(
    slack_adapter: SlackIMProviderAdapter,
    slack_credentials: SlackIMIntegrationCredentials,
) -> None:
    consumer = _RecordingConsumer()
    handler = slack_adapter.create_webhook_handler(consumer)
    event_callback = {
        "type": "event_callback",
        "team_id": "T012SANITIZED",
        "event_id": "Ev012SANITIZED",
        "event_time": 1786400000,
        "event": {"type": "app_mention", "text": "sanitized"},
    }
    event_body = json.dumps(event_callback, separators=(",", ":")).encode()

    event_response = handler.handle(_signed_webhook_request(slack_credentials.signing_secret, event_body))

    callback_fixture = _fixture("slack_block_actions_webhook.json")
    form_body = urlencode({"payload": json.dumps(callback_fixture, ensure_ascii=False)}).encode()
    form_response = handler.handle(
        _signed_webhook_request(
            slack_credentials.signing_secret,
            form_body,
            content_type="application/x-www-form-urlencoded",
        )
    )

    assert event_response.status_code == 200
    assert form_response.status_code == 200
    assert len(consumer.events) == 2
    event, callback = consumer.events
    assert event.provider is IMProvider.SLACK
    assert event.provider_tenant_id == "T012SANITIZED"
    assert event.event_id == "Ev012SANITIZED"
    assert event.event_type == "app_mention"
    assert event.occurred_at == datetime.fromtimestamp(1786400000, tz=UTC).replace(tzinfo=None)
    assert callback.provider_tenant_id == "T012SANITIZED"
    assert callback.event_type == "block_actions"
    assert SlackIMProviderAdapter.card_event_decoder().decode(callback) == IMCardEvent(
        provider_user_id=ProviderUserId("U012SANITIZED"),
        action_id="\u6279\u51c6\u2705",
        inputs={
            "\u8bf4\u660e\U0001f4dd": "\u4f60\u597d\uff0c\u4e16\u754c \U0001f30d",
            "\u9009\u62e9\U0001f310": "\u9009\u9879 \u03b2",
        },
        correlation_token=CorrelationToken("\u5173\u8054\u4ee4\u724c-\U0001f30d"),
    )


def test_slack_webhook_rejects_unauthenticated_and_authenticated_malformed_requests(
    slack_adapter: SlackIMProviderAdapter,
    slack_credentials: SlackIMIntegrationCredentials,
) -> None:
    consumer = _RecordingConsumer(EventAcceptance.NOT_ACCEPTED)
    handler = slack_adapter.create_webhook_handler(consumer)
    valid_event = json.dumps(
        {"type": "event_callback", "team_id": "T012SANITIZED", "event": {"type": "message"}},
        separators=(",", ":"),
    ).encode()

    unauthenticated = handler.handle(
        _signed_webhook_request(slack_credentials.signing_secret, valid_event, valid_signature=False)
    )
    wrong_method = handler.handle(_signed_webhook_request(slack_credentials.signing_secret, valid_event, method="GET"))
    invalid_json = handler.handle(_signed_webhook_request(slack_credentials.signing_secret, b"{"))
    missing_tenant = handler.handle(
        _signed_webhook_request(slack_credentials.signing_secret, b'{"type":"event_callback"}')
    )
    not_accepted = handler.handle(_signed_webhook_request(slack_credentials.signing_secret, valid_event))
    consumer_failure = slack_adapter.create_webhook_handler(_FailingConsumer()).handle(
        _signed_webhook_request(slack_credentials.signing_secret, valid_event)
    )
    invalid_challenge = handler.handle(
        _signed_webhook_request(slack_credentials.signing_secret, b'{"type":"url_verification"}')
    )
    missing_form_payload = handler.handle(
        _signed_webhook_request(
            slack_credentials.signing_secret,
            b"field=value",
            content_type="application/x-www-form-urlencoded",
        )
    )
    invalid_form_payload = handler.handle(
        _signed_webhook_request(
            slack_credentials.signing_secret,
            b"payload=%7B",
            content_type="application/x-www-form-urlencoded",
        )
    )
    non_object_form_payload = handler.handle(
        _signed_webhook_request(
            slack_credentials.signing_secret,
            b"payload=%5B%5D",
            content_type="application/x-www-form-urlencoded",
        )
    )
    unsupported_content_type = handler.handle(
        _signed_webhook_request(slack_credentials.signing_secret, valid_event, content_type="text/plain")
    )
    overflow_event = json.dumps(
        {
            "type": "event_callback",
            "team_id": "T012SANITIZED",
            "event_time": 10**100,
            "event": {"type": "message"},
        },
        separators=(",", ":"),
    ).encode()
    overflow_event_response = handler.handle(_signed_webhook_request(slack_credentials.signing_secret, overflow_event))
    one_content_type_request = _signed_webhook_request(slack_credentials.signing_secret, valid_event)
    duplicate_content_type_response = handler.handle(
        WebhookRequest(
            method=one_content_type_request.method,
            headers=(*one_content_type_request.headers, ("Content-Type", "application/json")),
            body=one_content_type_request.body,
            received_at=one_content_type_request.received_at,
        )
    )

    assert unauthenticated.status_code == 401
    assert wrong_method.status_code == 405
    assert invalid_json.status_code == 400
    assert missing_tenant.status_code == 400
    assert not_accepted.status_code == 503
    assert consumer_failure.status_code == 503
    assert invalid_challenge.status_code == 400
    assert missing_form_payload.status_code == 400
    assert invalid_form_payload.status_code == 400
    assert non_object_form_payload.status_code == 400
    assert unsupported_content_type.status_code == 400
    assert overflow_event_response.status_code == 503
    assert duplicate_content_type_response.status_code == 400
    assert len(consumer.events) == 2


def test_slack_webhook_completes_signed_url_verification(
    slack_adapter: SlackIMProviderAdapter,
    slack_credentials: SlackIMIntegrationCredentials,
) -> None:
    handler = slack_adapter.create_webhook_handler(_RecordingConsumer())
    body = b'{"type":"url_verification","challenge":"sanitized-challenge"}'

    response = handler.handle(_signed_webhook_request(slack_credentials.signing_secret, body))

    assert response.status_code == 200
    assert json.loads(response.body) == {"challenge": "sanitized-challenge"}


def test_slack_messaging_sends_and_reads_exact_text(
    slack_test_recipient_id: ProviderUserId,
    slack_adapter: SlackIMProviderAdapter,
    slack_web_client: WebClient,
) -> None:
    message_body = f"Dify Slack integration test {uuid4()}"

    message_result = slack_adapter.messaging.send_text(slack_test_recipient_id, message_body)

    assert isinstance(message_result, MessageAccepted)
    locator_payload = slack_module._SlackLocatorPayload.decode(str(message_result.locator))
    response = slack_web_client.conversations_replies(
        channel=locator_payload.channel_id,
        ts=locator_payload.message_ts,
        inclusive=True,
        limit=1,
    )
    messages = response.get("messages")
    assert isinstance(messages, Sequence)
    assert not isinstance(messages, (str, bytes, bytearray))
    matching_messages = [
        message
        for message in messages
        if isinstance(message, Mapping) and message.get("ts") == locator_payload.message_ts
    ]
    assert len(matching_messages) == 1
    assert matching_messages[0].get("text") == message_body

    invalid_recipient_result = slack_adapter.messaging.send_text(
        ProviderUserId("D000000000000000000"),
        f"{message_body} invalid-recipient",
    )
    assert isinstance(invalid_recipient_result, MessageSendingError)

    replacement_result = slack_adapter.dynamic_card_messaging.replace_with_static(
        message_result.locator,
        StaticCardIntent("This must not replace a text message."),
    )
    assert replacement_result is None


def test_slack_card_assessment_matches_static_select_provider_boundary(
    slack_adapter: SlackIMProviderAdapter,
    slack_test_recipient_id: ProviderUserId,
) -> None:
    supported_options = tuple(f"option-{ordinal}" for ordinal in range(100))
    supported = ResolvedForm(
        title="Supported Slack selector boundary",
        blocks=(SelectInput("risk_level", supported_options, supported_options[0]),),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="unused",
    )
    unsupported_options = (*supported_options, "option-100")
    unsupported = ResolvedForm(
        title="Unsupported Slack selector boundary",
        blocks=(SelectInput("risk_level", unsupported_options, unsupported_options[0]),),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="unused",
    )

    assert slack_adapter.dynamic_card_messaging.assess(supported).representable is True
    assert slack_adapter.dynamic_card_messaging.assess(unsupported).representable is False
    with pytest.raises(DynamicCardMessagingError):
        slack_adapter.dynamic_card_messaging.send_card(
            slack_test_recipient_id,
            unsupported,
            CorrelationToken("unsupported-selector"),
        )


def test_slack_card_sender_and_decoder_cross_real_web_api_boundary(
    slack_test_recipient_id: ProviderUserId,
    slack_adapter: SlackIMProviderAdapter,
    slack_web_client: WebClient,
) -> None:
    marker = f"codex-implementer-slack-card-event-5ab7-20260811-{uuid4()}"
    correlation_token = CorrelationToken(f"{marker}-correlation")
    intent = ResolvedForm(
        title=f"Slack card integration [{marker}]",
        blocks=(
            MarkdownText("Review the provider-persisted form."),
            ParagraphInput("review_comment", "Initial review"),
            SelectInput("risk_level", ("low", "high"), "low"),
        ),
        user_actions=(
            ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),
            ResolvedFormAction("reject", "Reject", ButtonStyle.ACCENT),
        ),
        legacy_form_content="unused",
    )

    message_result = slack_adapter.dynamic_card_messaging.send_card(
        slack_test_recipient_id,
        intent,
        correlation_token,
    )

    assert isinstance(message_result, MessageAccepted)
    message_reference = str(message_result.locator)
    locator_payload = slack_module._SlackLocatorPayload.decode(message_reference)
    persisted_message = _read_exact_message(slack_web_client, message_reference)
    blocks = persisted_message.get("blocks")
    assert isinstance(blocks, Sequence)
    assert not isinstance(blocks, str | bytes | bytearray)
    input_blocks = [block for block in blocks if isinstance(block, Mapping) and block.get("type") == "input"]
    assert len(input_blocks) == 2
    assert [block.get("block_id") for block in input_blocks] == ["__dify.input.0", "__dify.input.1"]
    select_input_block = next(
        block
        for block in input_blocks
        if isinstance(block.get("element"), Mapping) and block["element"].get("action_id") == "risk_level"
    )
    select_element = select_input_block.get("element")
    assert isinstance(select_element, Mapping)
    assert select_element.get("type") == "static_select"
    assert select_element.get("placeholder") == {
        "type": "plain_text",
        "text": "Select an option",
        "emoji": True,
    }
    assert select_element.get("options") == [
        {"text": {"type": "plain_text", "text": "low", "emoji": True}, "value": "low"},
        {"text": {"type": "plain_text", "text": "high", "emoji": True}, "value": "high"},
    ]
    assert select_element.get("initial_option") == {
        "text": {"type": "plain_text", "text": "low", "emoji": True},
        "value": "low",
    }
    action_blocks = [block for block in blocks if isinstance(block, Mapping) and block.get("type") == "actions"]
    assert len(action_blocks) == 1
    action_block = action_blocks[0]
    action_block_id = action_block.get("block_id")
    assert action_block_id == "__dify.actions"
    action_elements = action_block.get("elements")
    assert isinstance(action_elements, Sequence)
    assert not isinstance(action_elements, str | bytes | bytearray)
    assert len(action_elements) == 2
    invoked_action = next(
        action for action in action_elements if isinstance(action, Mapping) and action.get("action_id") == "approve"
    )
    assert isinstance(invoked_action, Mapping)
    callback_action = {**invoked_action, "block_id": action_block_id}

    input_block_ids: dict[str, str] = {}
    for input_block in input_blocks:
        block_id = input_block.get("block_id")
        element = input_block.get("element")
        assert isinstance(block_id, str)
        assert isinstance(element, Mapping)
        action_id = element.get("action_id")
        assert isinstance(action_id, str)
        input_block_ids[action_id] = block_id

    callback_payload = {
        "type": "block_actions",
        "team": {"id": "integration-workspace"},
        "user": {"id": str(slack_test_recipient_id)},
        "container": {
            "type": "message",
            "channel_id": locator_payload.channel_id,
            "message_ts": locator_payload.message_ts,
        },
        "message": persisted_message,
        "state": {
            "values": {
                input_block_ids["review_comment"]: {
                    "review_comment": {"type": "plain_text_input", "value": "Reviewed exactly ✅"}
                },
                input_block_ids["risk_level"]: {
                    "risk_level": {
                        "type": "static_select",
                        "selected_option": {"value": "high"},
                    }
                },
            }
        },
        "actions": [callback_action],
    }
    socket_request = SocketModeRequest(
        type="interactive",
        envelope_id=f"{marker}-envelope",
        payload=callback_payload,
        accepts_response_payload=False,
    )
    authenticated_event = AuthenticatedIMEvent(
        provider=IMProvider.SLACK,
        provider_tenant_id="integration-workspace",
        event_id=None,
        event_type="block_actions",
        occurred_at=None,
        received_at=datetime(2026, 8, 11, 12, 0, 0),
        payload=json.dumps(socket_request.to_dict(), ensure_ascii=False),
    )

    decoded = SlackIMProviderAdapter.card_event_decoder().decode(authenticated_event)

    assert decoded == IMCardEvent(
        provider_user_id=slack_test_recipient_id,
        action_id="approve",
        inputs={"review_comment": "Reviewed exactly ✅", "risk_level": "high"},
        correlation_token=correlation_token,
    )

    finite_number_decoded = SlackIMProviderAdapter.card_event_decoder().decode(
        _authenticated_slack_card_event(
            _serialize_callback_with_raw_extra(callback_payload, '{"integer":42,"float":1e300}'),
            received_second=6,
        )
    )
    assert finite_number_decoded == decoded

    parser_boundary_values = (
        "1" * (sys.get_int_max_str_digits() + 1),
        "[" * (sys.getrecursionlimit() * 20) + "null" + "]" * (sys.getrecursionlimit() * 20),
        "1e400",
    )
    for received_second, raw_json_value in enumerate(parser_boundary_values, start=7):
        with pytest.raises(IMCardEventDecodingError) as captured:
            SlackIMProviderAdapter.card_event_decoder().decode(
                _authenticated_slack_card_event(
                    _serialize_callback_with_raw_extra(callback_payload, raw_json_value),
                    received_second=received_second,
                )
            )
        assert captured.value.__cause__ is None
        assert captured.value.__context__ is None

    missing_input_payload = deepcopy(callback_payload)
    missing_state = missing_input_payload["state"]
    assert isinstance(missing_state, dict)
    missing_values = missing_state["values"]
    assert isinstance(missing_values, dict)
    missing_values.pop(input_block_ids["risk_level"])
    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(
            AuthenticatedIMEvent(
                provider=IMProvider.SLACK,
                provider_tenant_id="integration-workspace",
                event_id=None,
                event_type="block_actions",
                occurred_at=None,
                received_at=datetime(2026, 8, 11, 12, 0, 1),
                payload=json.dumps(missing_input_payload, ensure_ascii=False),
            )
        )

    reserved_input_block_payload = deepcopy(callback_payload)
    reserved_message = reserved_input_block_payload["message"]
    assert isinstance(reserved_message, dict)
    reserved_message_blocks = reserved_message["blocks"]
    assert isinstance(reserved_message_blocks, list)
    reserved_input_block = next(
        block
        for block in reserved_message_blocks
        if isinstance(block, dict) and block.get("block_id") == input_block_ids["risk_level"]
    )
    reserved_input_block["type"] = "section"
    reserved_state = reserved_input_block_payload["state"]
    assert isinstance(reserved_state, dict)
    reserved_values = reserved_state["values"]
    assert isinstance(reserved_values, dict)
    reserved_values.pop(input_block_ids["risk_level"])
    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(
            _authenticated_slack_card_event(
                json.dumps(reserved_input_block_payload, ensure_ascii=False),
                received_second=10,
            )
        )

    mismatched_action_payload = deepcopy(callback_payload)
    mismatched_actions = mismatched_action_payload["actions"]
    assert isinstance(mismatched_actions, list)
    mismatched_action = mismatched_actions[0]
    assert isinstance(mismatched_action, dict)
    mismatched_action["action_id"] = "reject"
    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(
            AuthenticatedIMEvent(
                provider=IMProvider.SLACK,
                provider_tenant_id="integration-workspace",
                event_id=None,
                event_type="block_actions",
                occurred_at=None,
                received_at=datetime(2026, 8, 11, 12, 0, 2),
                payload=json.dumps(mismatched_action_payload, ensure_ascii=False),
            )
        )

    extra_input_payload = deepcopy(callback_payload)
    extra_state = extra_input_payload["state"]
    assert isinstance(extra_state, dict)
    extra_values = extra_state["values"]
    assert isinstance(extra_values, dict)
    extra_values["external.unexpected"] = {"external": {"type": "plain_text_input", "value": "unexpected"}}
    with pytest.raises(IMCardEventDecodingError):
        SlackIMProviderAdapter.card_event_decoder().decode(
            AuthenticatedIMEvent(
                provider=IMProvider.SLACK,
                provider_tenant_id="integration-workspace",
                event_id=None,
                event_type="block_actions",
                occurred_at=None,
                received_at=datetime(2026, 8, 11, 12, 0, 3),
                payload=json.dumps(extra_input_payload, ensure_ascii=False),
            )
        )

    null_input_payload = deepcopy(callback_payload)
    null_state = null_input_payload["state"]
    assert isinstance(null_state, dict)
    null_values = null_state["values"]
    assert isinstance(null_values, dict)
    null_text_state = null_values[input_block_ids["review_comment"]]
    null_select_state = null_values[input_block_ids["risk_level"]]
    assert isinstance(null_text_state, dict)
    assert isinstance(null_select_state, dict)
    null_text_state["review_comment"] = {"type": "plain_text_input", "value": None}
    null_select_state["risk_level"] = {"type": "static_select", "selected_option": None}
    null_decoded = SlackIMProviderAdapter.card_event_decoder().decode(
        AuthenticatedIMEvent(
            provider=IMProvider.SLACK,
            provider_tenant_id="integration-workspace",
            event_id=None,
            event_type="block_actions",
            occurred_at=None,
            received_at=datetime(2026, 8, 11, 12, 0, 4),
            payload=json.dumps(null_input_payload, ensure_ascii=False),
        )
    )
    assert isinstance(null_decoded, IMCardEvent)
    assert null_decoded.inputs == {"review_comment": None, "risk_level": None}

    selection_payload = deepcopy(callback_payload)
    selection_payload["actions"] = [
        {
            "type": "static_select",
            "block_id": input_block_ids["risk_level"],
            "action_id": "risk_level",
            "selected_option": {"value": "high"},
        }
    ]
    selection_request = SocketModeRequest(
        type="interactive",
        envelope_id=f"{marker}-selection-envelope",
        payload=selection_payload,
    )
    selection_event = AuthenticatedIMEvent(
        provider=IMProvider.SLACK,
        provider_tenant_id="integration-workspace",
        event_id=None,
        event_type="block_actions",
        occurred_at=None,
        received_at=_RECEIVED_AT,
        payload=json.dumps(selection_request.to_dict(), ensure_ascii=False),
    )
    assert isinstance(SlackIMProviderAdapter.card_event_decoder().decode(selection_event), UnrecognizedIMEvent)

    malformed_socket_request = SocketModeRequest(
        type="interactive",
        envelope_id=f"{marker}-malformed-envelope",
        payload="invalid",
    )
    malformed_socket_event = AuthenticatedIMEvent(
        provider=IMProvider.SLACK,
        provider_tenant_id="integration-workspace",
        event_id=None,
        event_type="block_actions",
        occurred_at=None,
        received_at=_RECEIVED_AT,
        payload=json.dumps(malformed_socket_request.to_dict(), ensure_ascii=False),
    )
    assert isinstance(
        SlackIMProviderAdapter.card_event_decoder().decode(malformed_socket_event),
        UnrecognizedIMEvent,
    )

    legacy_action_payload = deepcopy(callback_payload)
    legacy_actions = legacy_action_payload["actions"]
    assert isinstance(legacy_actions, list)
    legacy_action = legacy_actions[0]
    assert isinstance(legacy_action, dict)
    legacy_action["block_id"] = "__dify.actions.legacy"
    legacy_event = AuthenticatedIMEvent(
        provider=IMProvider.SLACK,
        provider_tenant_id="integration-workspace",
        event_id=None,
        event_type="block_actions",
        occurred_at=None,
        received_at=_RECEIVED_AT,
        payload=json.dumps(legacy_action_payload, ensure_ascii=False),
    )
    assert isinstance(SlackIMProviderAdapter.card_event_decoder().decode(legacy_event), UnrecognizedIMEvent)

    invalid_recipient_result = slack_adapter.dynamic_card_messaging.send_card(
        ProviderUserId("D000000000000000000"),
        intent,
        CorrelationToken(f"{marker}-invalid-recipient"),
    )
    assert isinstance(invalid_recipient_result, MessageSendingError)

    replacement_body = f"Slack card integration completed [{marker}]"
    replacement_error = slack_adapter.dynamic_card_messaging.replace_with_static(
        message_reference,
        StaticCardIntent(replacement_body),
    )
    assert replacement_error is None
    replaced_message = _read_exact_message(slack_web_client, message_reference)
    assert replaced_message.get("text") == replacement_body
    replaced_blocks = replaced_message.get("blocks")
    assert isinstance(replaced_blocks, Sequence)
    assert not isinstance(replaced_blocks, str | bytes | bytearray)
    assert not any(
        isinstance(block, Mapping) and block.get("type") in {"input", "actions"} for block in replaced_blocks
    )


def test_slack_zero_input_card_round_trips_without_callback_state(
    slack_test_recipient_id: ProviderUserId,
    slack_adapter: SlackIMProviderAdapter,
    slack_web_client: WebClient,
) -> None:
    marker = f"codex-implementer-slack-card-event-zero-input-5ab7-20260811-{uuid4()}"
    correlation_token = CorrelationToken(f"{marker}-correlation")
    intent = ResolvedForm(
        title=None,
        blocks=(MarkdownText(f"Choose one action [{marker}]."),),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="unused",
    )

    message_result = slack_adapter.dynamic_card_messaging.send_card(
        slack_test_recipient_id,
        intent,
        correlation_token,
    )

    assert isinstance(message_result, MessageAccepted)
    persisted_message = _read_exact_message(slack_web_client, str(message_result.locator))
    blocks = persisted_message.get("blocks")
    assert isinstance(blocks, Sequence)
    assert not isinstance(blocks, str | bytes | bytearray)
    assert not any(isinstance(block, Mapping) and block.get("type") == "input" for block in blocks)
    action_block = next(block for block in blocks if isinstance(block, Mapping) and block.get("type") == "actions")
    action_block_id = action_block.get("block_id")
    action_elements = action_block.get("elements")
    assert isinstance(action_block_id, str)
    assert isinstance(action_elements, Sequence)
    assert not isinstance(action_elements, str | bytes | bytearray)
    assert len(action_elements) == 1
    invoked_action = action_elements[0]
    assert isinstance(invoked_action, Mapping)
    callback_payload = {
        "type": "block_actions",
        "team": {"id": "integration-workspace"},
        "user": {"id": str(slack_test_recipient_id)},
        "message": persisted_message,
        "actions": [{**invoked_action, "block_id": action_block_id}],
    }
    authenticated_event = AuthenticatedIMEvent(
        provider=IMProvider.SLACK,
        provider_tenant_id="integration-workspace",
        event_id=None,
        event_type="block_actions",
        occurred_at=None,
        received_at=datetime(2026, 8, 11, 12, 0, 5),
        payload=json.dumps(callback_payload, ensure_ascii=False),
    )

    decoded = SlackIMProviderAdapter.card_event_decoder().decode(authenticated_event)

    assert decoded == IMCardEvent(
        provider_user_id=slack_test_recipient_id,
        action_id="approve",
        inputs={},
        correlation_token=correlation_token,
    )
