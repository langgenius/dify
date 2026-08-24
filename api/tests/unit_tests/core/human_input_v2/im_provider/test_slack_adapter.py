from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
from datetime import UTC, datetime
from types import MappingProxyType
from typing import override

import pytest
from pytest_mock import MockerFixture
from slack_sdk.errors import SlackApiError, SlackClientError
from slack_sdk.socket_mode.request import SocketModeRequest
from slack_sdk.web import WebClient

from core.human_input import ButtonStyle
from core.human_input_v2 import (
    FileInput,
    FileListInput,
    MarkdownText,
    ParagraphInput,
    ResolvedForm,
    ResolvedFormAction,
    SelectInput,
)
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import slack as slack_module
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
from core.human_input_v2.im_provider import (
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryReadFailure,
    DynamicCardMessagingError,
    EventAcceptance,
    IMEventIngressKind,
    IMStreamStartError,
    IMStreamStopError,
    MessageAccepted,
    MessageLocator,
    MessageSendingError,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    SlackIMIntegrationCredentials,
    StaticCardIntent,
    WebhookRequest,
)

_RECEIVED_AT = datetime(2026, 8, 6, 8, 0, 0)
_REQUEST_TIMESTAMP = str(int(_RECEIVED_AT.replace(tzinfo=UTC).timestamp()))


class SlackResponse:
    def __init__(self, values: dict[str, object], *, headers: dict[str, str] | None = None) -> None:
        self._values = values
        self.headers = headers or {}

    def get(self, key: str, default: object = None) -> object:
        return self._values.get(key, default)


class FakeWebClient(WebClient):
    def __init__(self) -> None:
        self.auth_responses: list[SlackResponse | Exception] = []
        self.connection_responses: list[SlackResponse | Exception] = []
        self.directory_responses: list[SlackResponse | Exception] = []
        self.post_responses: list[SlackResponse | Exception] = []
        self.update_responses: list[SlackResponse | Exception] = []
        self.auth_calls = 0
        self.connection_calls = 0
        self.directory_calls: list[dict[str, object]] = []
        self.post_calls: list[dict[str, object]] = []
        self.update_calls: list[dict[str, object]] = []

    @staticmethod
    def _next(responses: list[SlackResponse | Exception]) -> SlackResponse:
        response = responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def auth_test(self) -> SlackResponse:
        self.auth_calls += 1
        return self._next(self.auth_responses)

    def apps_connections_open(self, *, app_token: str) -> SlackResponse:
        del app_token
        self.connection_calls += 1
        return self._next(self.connection_responses)

    def users_list(self, **kwargs: object) -> SlackResponse:
        self.directory_calls.append(kwargs)
        return self._next(self.directory_responses)

    @override
    def chat_postMessage(self, **kwargs: object) -> SlackResponse:
        self.post_calls.append(kwargs)
        return self._next(self.post_responses)

    def chat_update(self, **kwargs: object) -> SlackResponse:
        self.update_calls.append(kwargs)
        return self._next(self.update_responses)


class RecordingConsumer:
    def __init__(self, acceptance: EventAcceptance = EventAcceptance.ACCEPTED) -> None:
        self.acceptance = acceptance
        self.events = []

    def accept(self, event):
        self.events.append(event)
        return self.acceptance


def _credentials(
    *,
    signing_secret: str = "signing-secret",
    app_token: str | None = "xapp-test-app-token",
) -> SlackIMIntegrationCredentials:
    return SlackIMIntegrationCredentials(
        provider=IMProvider.SLACK,
        client_id="client-id",
        client_secret="client-secret",
        signing_secret=signing_secret,
        bot_token="xoxb-test-bot-token",
        app_token=app_token,
    )


def _successful_auth_response(team_id: str = "team-1") -> SlackResponse:
    return SlackResponse(
        {"ok": True, "team_id": team_id},
        headers={"x-oauth-scopes": "chat:write,users:read,users:read.email"},
    )


def _adapter(
    mocker,
    client: FakeWebClient,
    credentials: SlackIMIntegrationCredentials | None = None,
) -> SlackIMProviderAdapter:
    web_client = mocker.patch("core.human_input_v2.im_integration.adapters.slack.WebClient")
    web_client.return_value = client
    return SlackIMProviderAdapter(credentials or _credentials())


def _intent(*, input_type: str = "paragraph") -> ResolvedForm:
    if input_type == "select":
        input_block = SelectInput("comment", ("One", "Two"), "One")
    elif input_type == "file":
        input_block = FileInput("comment", (), (), ())
    elif input_type == "file-list":
        input_block = FileListInput("comment", (), (), (), 1)
    else:
        input_block = ParagraphInput("comment", "Initial")
    return ResolvedForm(
        title="Approval",
        blocks=(MarkdownText("Rendered **content**"), input_block, MarkdownText("After input")),
        user_actions=(
            ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),
            ResolvedFormAction("reject", "Reject", ButtonStyle.ACCENT),
        ),
        legacy_form_content="This value must not be rendered",
    )


def _intent_with_paragraph_default(default_value: str) -> ResolvedForm:
    return ResolvedForm(
        title="Approval",
        blocks=(ParagraphInput("comment", default_value),),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="This value must not be rendered",
    )


def _intent_with_select_option_count(option_count: int) -> ResolvedForm:
    options = tuple(f"option-{ordinal}" for ordinal in range(option_count))
    return ResolvedForm(
        title="Approval",
        blocks=(SelectInput("risk_level", options, options[0]),),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="This value must not be rendered",
    )


def _signed_request(body: bytes, *, signature: str | None = None) -> WebhookRequest:
    calculated = (
        "v0="
        + hmac.new(
            b"signing-secret",
            f"v0:{_REQUEST_TIMESTAMP}:".encode() + body,
            hashlib.sha256,
        ).hexdigest()
    )
    return WebhookRequest(
        method="POST",
        headers=(
            ("X-Slack-Request-Timestamp", _REQUEST_TIMESTAMP),
            ("X-Slack-Signature", signature or calculated),
            ("Content-Type", "application/json"),
        ),
        body=body,
        received_at=_RECEIVED_AT,
    )


def test_construction_and_capability_inspection_perform_no_provider_io(mocker) -> None:
    client = FakeWebClient()
    adapter = _adapter(mocker, client)
    consumer = RecordingConsumer()

    first_stream = adapter.create_stream_handler(consumer)
    second_stream = adapter.create_stream_handler(consumer)

    assert adapter.provider is IMProvider.SLACK
    assert adapter.directory is not None
    assert adapter.messaging is not None
    assert adapter.dynamic_card_messaging is not None
    assert adapter.create_webhook_handler(consumer) is not None
    assert first_stream is not second_stream
    assert client.auth_calls == 0
    assert client.connection_calls == 0
    adapter.close()
    adapter.close()


def test_credential_test_authenticates_both_tokens_and_checks_baseline_scopes(mocker) -> None:
    client = FakeWebClient()
    client.auth_responses.append(_successful_auth_response())
    client.connection_responses.append(SlackResponse({"ok": True, "url": "wss://example.invalid"}))
    adapter = _adapter(mocker, client)

    result = adapter.test_credentials()

    assert result == CredentialTestSuccess(IMProvider.SLACK, "team-1")
    assert client.auth_calls == 1
    assert client.connection_calls == 1


def test_credential_test_does_not_require_socket_mode_app_token(mocker) -> None:
    client = FakeWebClient()
    client.auth_responses.append(_successful_auth_response())
    adapter = _adapter(mocker, client, _credentials(app_token=None))

    result = adapter.test_credentials()

    assert result == CredentialTestSuccess(IMProvider.SLACK, "team-1")
    assert client.auth_calls == 1
    assert client.connection_calls == 0


def test_stream_capability_is_unavailable_without_socket_mode_app_token(mocker) -> None:
    client = FakeWebClient()
    adapter = _adapter(mocker, client, _credentials(app_token=None))

    assert adapter.create_stream_handler(RecordingConsumer()) is None
    assert adapter.create_webhook_handler(RecordingConsumer()) is not None


def test_credential_test_returns_safe_typed_failures(mocker) -> None:
    client = FakeWebClient()
    api_response = SlackResponse({"ok": False, "error": "invalid_auth", "sensitive": "must-not-leak"})
    client.auth_responses.append(SlackApiError("raw-provider-message", response=api_response))
    adapter = _adapter(mocker, client)

    rejected = adapter.test_credentials()

    assert isinstance(rejected, CredentialTestFailure)
    assert rejected.kind is CredentialTestFailureKind.AUTHENTICATION_REJECTED
    assert "raw-provider-message" not in rejected.reason
    assert "must-not-leak" not in rejected.reason

    second_client = FakeWebClient()
    second_client.auth_responses.append(
        SlackResponse({"ok": True}, headers={"x-oauth-scopes": "chat:write,users:read,users:read.email"})
    )
    second_adapter = _adapter(mocker, second_client)
    missing_tenant = second_adapter.test_credentials()
    assert isinstance(missing_tenant, CredentialTestFailure)
    assert missing_tenant.kind is CredentialTestFailureKind.TENANT_ID_UNAVAILABLE


@pytest.mark.parametrize("connection_url", ["", "   "])
def test_credential_test_rejects_blank_socket_url(mocker, connection_url: str) -> None:
    client = FakeWebClient()
    client.auth_responses.append(_successful_auth_response())
    client.connection_responses.append(SlackResponse({"ok": True, "url": connection_url}))
    adapter = _adapter(mocker, client)

    result = adapter.test_credentials()

    assert result == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "Slack Socket Mode credentials could not be confirmed.",
    )


def test_credential_test_normalizes_unexpected_socket_failure_without_details(mocker, caplog) -> None:
    sensitive_marker = "sensitive socket credential details"
    client = FakeWebClient()
    client.auth_responses.append(_successful_auth_response())
    client.connection_responses.append(RuntimeError(sensitive_marker))
    adapter = _adapter(mocker, client)

    with caplog.at_level(logging.ERROR, logger="core.human_input_v2.im_integration.adapters.slack"):
        result = adapter.test_credentials()

    assert result == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "Slack credential testing could not be completed.",
    )
    assert sensitive_marker not in caplog.text


def test_directory_returns_one_ordered_complete_snapshot(mocker) -> None:
    client = FakeWebClient()
    client.directory_responses.extend(
        (
            SlackResponse(
                {
                    "ok": True,
                    "members": [
                        {
                            "id": "user-1",
                            "deleted": False,
                            "is_bot": False,
                            "is_app_user": False,
                            "profile": {"display_name_normalized": "First", "email": "first@example.com"},
                        },
                        {
                            "id": "bot-1",
                            "deleted": False,
                            "is_bot": True,
                            "profile": {"real_name_normalized": "Bot"},
                        },
                    ],
                    "response_metadata": {"next_cursor": "cursor-2"},
                }
            ),
            SlackResponse(
                {
                    "ok": True,
                    "members": [
                        {
                            "id": "user-2",
                            "deleted": False,
                            "is_bot": False,
                            "is_app_user": False,
                            "profile": {"real_name_normalized": "Second"},
                        }
                    ],
                    "response_metadata": {"next_cursor": ""},
                }
            ),
        )
    )
    adapter = _adapter(mocker, client)

    result = adapter.directory.read_directory()

    assert isinstance(result, Directory)
    assert [entry.provider_user_id for entry in result.entries] == ["user-1", "user-2"]
    assert result.entries[0].email == "first@example.com"
    assert result.entries[1].display_name == "Second"
    assert result.entries[1].email is None
    assert client.directory_calls == [{"limit": 200}, {"limit": 200, "cursor": "cursor-2"}]


def test_directory_excludes_slack_owned_special_users(mocker: MockerFixture) -> None:
    client = FakeWebClient()
    client.directory_responses.append(
        SlackResponse(
            {
                "ok": True,
                "members": [
                    {
                        "id": "USLACKBOT",
                        "deleted": False,
                        "is_bot": False,
                        "is_app_user": False,
                        "profile": {"real_name_normalized": "Slackbot"},
                    },
                    {
                        "id": "USLACK",
                        "deleted": False,
                        "is_bot": False,
                        "is_app_user": False,
                        "profile": {"real_name_normalized": "Slack"},
                    },
                    {
                        "id": "user-1",
                        "deleted": False,
                        "is_bot": False,
                        "is_app_user": False,
                        "profile": {
                            "display_name_normalized": "First",
                            "email": "first@example.com",
                        },
                    },
                ],
                "response_metadata": {"next_cursor": ""},
            }
        )
    )
    adapter = _adapter(mocker, client)

    result = adapter.directory.read_directory()

    assert isinstance(result, Directory)
    assert [entry.provider_user_id for entry in result.entries] == ["user-1"]


def test_directory_rejects_unhashable_provider_user_id_without_raising(mocker: MockerFixture) -> None:
    client = FakeWebClient()
    client.directory_responses.append(
        SlackResponse(
            {
                "ok": True,
                "members": [{"id": [], "profile": {}}],
                "response_metadata": {"next_cursor": ""},
            }
        )
    )
    adapter = _adapter(mocker, client)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert result.reason == "Slack returned an invalid directory entry."


def test_directory_page_failure_discards_entries(mocker) -> None:
    client = FakeWebClient()
    client.directory_responses.extend(
        (
            SlackResponse(
                {
                    "ok": True,
                    "members": [{"id": "user-1", "profile": {}}],
                    "response_metadata": {"next_cursor": "cursor-2"},
                }
            ),
            SlackApiError("provider details", SlackResponse({"ok": False, "error": "ratelimited"})),
        )
    )
    adapter = _adapter(mocker, client)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert not hasattr(result, "entries")
    assert "provider details" not in result.reason


@pytest.mark.parametrize(
    "response_values",
    [
        {"ok": True, "members": [{"id": "user-1", "profile": {}}]},
        {"ok": True, "members": [{"id": "user-1", "profile": {}}], "response_metadata": None},
        {"ok": True, "members": [{"id": "user-1", "profile": {}}], "response_metadata": []},
        {"ok": True, "members": [{"id": "user-1", "profile": {}}], "response_metadata": {}},
        {
            "ok": True,
            "members": [{"id": "user-1", "profile": {}}],
            "response_metadata": {"other": "value"},
        },
        {
            "ok": True,
            "members": [{"id": "user-1", "profile": {}}],
            "response_metadata": {"next_cursor": None},
        },
        {
            "ok": True,
            "members": [{"id": "user-1", "profile": {}}],
            "response_metadata": {"next_cursor": 1},
        },
    ],
    ids=(
        "missing-metadata",
        "null-metadata",
        "sequence-metadata",
        "missing-cursor-empty-mapping",
        "missing-cursor-nonempty-mapping",
        "null-cursor",
        "non-string-cursor",
    ),
)
def test_directory_rejects_malformed_pagination_without_partial_snapshot(
    mocker,
    response_values: dict[str, object],
) -> None:
    client = FakeWebClient()
    client.directory_responses.append(SlackResponse(response_values))
    adapter = _adapter(mocker, client)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert not hasattr(result, "entries")
    assert "user-1" not in result.reason
    assert client.directory_calls == [{"limit": 200}]


def test_directory_second_page_malformed_pagination_discards_all_accumulated_entries(mocker) -> None:
    client = FakeWebClient()
    client.directory_responses.extend(
        (
            SlackResponse(
                {
                    "ok": True,
                    "members": [{"id": "user-1", "profile": {}}],
                    "response_metadata": {"next_cursor": "cursor-2"},
                }
            ),
            SlackResponse(
                {
                    "ok": True,
                    "members": [{"id": "user-2", "profile": {}}],
                    "response_metadata": {"unexpected": "value"},
                }
            ),
        )
    )
    adapter = _adapter(mocker, client)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert not hasattr(result, "entries")
    assert "user-1" not in result.reason
    assert "user-2" not in result.reason
    assert client.directory_calls == [{"limit": 200}, {"limit": 200, "cursor": "cursor-2"}]


def test_directory_rejects_repeated_pagination_cursor_without_request_loop(mocker) -> None:
    client = FakeWebClient()
    client.directory_responses.extend(
        (
            SlackResponse(
                {
                    "ok": True,
                    "members": [{"id": "user-1", "profile": {}}],
                    "response_metadata": {"next_cursor": "cursor-2"},
                }
            ),
            SlackResponse(
                {
                    "ok": True,
                    "members": [{"id": "user-2", "profile": {}}],
                    "response_metadata": {"next_cursor": "cursor-2"},
                }
            ),
        )
    )
    adapter = _adapter(mocker, client)

    result = adapter.directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert not hasattr(result, "entries")
    assert client.directory_calls == [{"limit": 200}, {"limit": 200, "cursor": "cursor-2"}]


def test_directory_accepts_mapping_and_sequence_sdk_values(mocker) -> None:
    client = FakeWebClient()
    client.directory_responses.append(
        SlackResponse(
            {
                "ok": True,
                "members": (
                    MappingProxyType(
                        {
                            "id": "user-1",
                            "profile": MappingProxyType({"display_name_normalized": "First"}),
                        }
                    ),
                ),
                "response_metadata": MappingProxyType({"next_cursor": ""}),
            }
        )
    )
    adapter = _adapter(mocker, client)

    result = adapter.directory.read_directory()

    assert isinstance(result, Directory)
    assert [entry.provider_user_id for entry in result.entries] == ["user-1"]
    assert result.entries[0].display_name == "First"


def test_text_send_attempts_creation_once_and_returns_persistable_locator(mocker) -> None:
    client = FakeWebClient()
    client.auth_responses.append(_successful_auth_response())
    client.post_responses.append(SlackResponse({"ok": True, "channel": "dm-1", "ts": "1000.000001"}))
    adapter = _adapter(mocker, client)

    result = adapter.messaging.send_text(ProviderUserId("user-1"), "Exact **CommonMark**")

    assert isinstance(result, MessageAccepted)
    assert isinstance(result.locator, str)
    assert slack_module._SlackLocatorPayload.decode(str(result.locator)) == slack_module._SlackLocatorPayload(
        v=1,
        p=IMProvider.SLACK,
        channel_id="dm-1",
        message_ts="1000.000001",
    )
    assert client.auth_calls == 0
    assert client.post_calls == [{"channel": "user-1", "markdown_text": "Exact **CommonMark**"}]


def test_card_send_returns_persistable_locator(mocker) -> None:
    client = FakeWebClient()
    client.auth_responses.append(_successful_auth_response())
    client.post_responses.append(SlackResponse({"ok": True, "channel": "dm-1", "ts": "1000.000001"}))
    adapter = _adapter(mocker, client)

    result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("user-1"),
        _intent(),
        CorrelationToken("correlation-1"),
    )

    assert isinstance(result, MessageAccepted)
    assert isinstance(result.locator, str)
    assert slack_module._SlackLocatorPayload.decode(str(result.locator)) == slack_module._SlackLocatorPayload(
        v=1,
        p=IMProvider.SLACK,
        channel_id="dm-1",
        message_ts="1000.000001",
    )
    assert client.auth_calls == 0


def test_static_replacement_accepts_locator_across_adapter_instances(mocker) -> None:
    source_client = FakeWebClient()
    source_client.auth_responses.append(_successful_auth_response("T0123456789"))
    source_client.post_responses.append(
        SlackResponse({"ok": True, "channel": "D0123456789", "ts": "1712345678.123456"})
    )
    source_adapter = _adapter(mocker, source_client)
    accepted = source_adapter.dynamic_card_messaging.send_card(
        ProviderUserId("U0123456789"),
        _intent(),
        CorrelationToken("correlation-1"),
    )
    assert isinstance(accepted, MessageAccepted)

    replacement_client = FakeWebClient()
    replacement_client.auth_responses.append(_successful_auth_response("T0123456789"))
    replacement_client.update_responses.append(SlackResponse({"ok": True}))
    replacement_adapter = _adapter(mocker, replacement_client)

    result = replacement_adapter.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )

    assert result is None
    assert source_client.auth_calls == 0
    assert replacement_client.auth_calls == 0
    assert replacement_client.update_calls == [
        {
            "channel": "D0123456789",
            "ts": "1712345678.123456",
            "text": "Submitted",
            "blocks": [],
        }
    ]


def test_static_replacement_updates_the_exact_message_from_a_valid_locator(mocker) -> None:
    client = FakeWebClient()
    client.auth_responses.append(_successful_auth_response())
    client.post_responses.append(SlackResponse({"ok": True, "channel": "dm-1", "ts": "1000.000001"}))
    client.update_responses.append(SlackResponse({"ok": True}))
    adapter = _adapter(mocker, client)
    accepted = adapter.messaging.send_text(ProviderUserId("user-1"), "Body")
    assert isinstance(accepted, MessageAccepted)

    result = adapter.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )

    assert result is None
    assert client.update_calls == [
        {
            "channel": "dm-1",
            "ts": "1000.000001",
            "text": "Submitted",
            "blocks": [],
        }
    ]


def test_static_replacement_rejects_foreign_reference_without_provider_io(mocker) -> None:
    client = FakeWebClient()
    adapter = _adapter(mocker, client)

    result = adapter.dynamic_card_messaging.replace_with_static(
        MessageLocator("invalid."),
        StaticCardIntent("Submitted"),
    )

    assert isinstance(result, ReplacementError)
    assert result.kind is ReplacementErrorKind.INVALID_REFERENCE
    assert client.update_calls == []


def test_message_send_failure_is_safe_and_never_replayed(mocker) -> None:
    client = FakeWebClient()
    client.auth_responses.append(_successful_auth_response())
    client.post_responses.append(
        SlackApiError("raw message", SlackResponse({"ok": False, "error": "internal_error", "token": "secret"}))
    )
    adapter = _adapter(mocker, client)

    result = adapter.messaging.send_text(ProviderUserId("user-1"), "body")

    assert isinstance(result, MessageSendingError)
    assert len(client.post_calls) == 1
    assert "raw message" not in result.reason
    assert "secret" not in result.reason


@pytest.mark.parametrize("input_type", ["file", "file-list"])
def test_card_assessment_rejects_file_controls_without_side_effects(mocker, input_type: str) -> None:
    client = FakeWebClient()
    adapter = _adapter(mocker, client)

    assessment = adapter.dynamic_card_messaging.assess(_intent(input_type=input_type))

    assert assessment.representable is False
    assert client.post_calls == []
    with pytest.raises(DynamicCardMessagingError):
        adapter.dynamic_card_messaging.send_card(
            ProviderUserId("user-1"),
            _intent(input_type=input_type),
            CorrelationToken("correlation-1"),
        )
    assert client.post_calls == []


@pytest.mark.parametrize(
    ("option_count", "expected_representable"),
    [
        pytest.param(100, True, id="maximum-static-select-options"),
        pytest.param(101, False, id="too-many-static-select-options"),
    ],
)
def test_card_assessment_uses_static_select_option_limit(
    mocker: MockerFixture,
    option_count: int,
    expected_representable: bool,
) -> None:
    client = FakeWebClient()
    adapter = _adapter(mocker, client)

    assessment = adapter.dynamic_card_messaging.assess(_intent_with_select_option_count(option_count))

    assert assessment.representable is expected_representable
    assert client.post_calls == []


def test_card_send_preserves_controls_actions_defaults_and_correlation(mocker) -> None:
    client = FakeWebClient()
    client.auth_responses.append(_successful_auth_response())
    client.post_responses.append(SlackResponse({"ok": True, "channel": "dm-1", "ts": "1000.000001"}))
    adapter = _adapter(mocker, client)
    intent = _intent(input_type="select")

    result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("user-1"),
        intent,
        CorrelationToken("correlation-1"),
    )

    assert isinstance(result, MessageAccepted)
    assert set(client.post_calls[0]) == {"channel", "blocks"}
    blocks = client.post_calls[0]["blocks"]
    assert isinstance(blocks, list)
    assert "text" not in client.post_calls[0]
    assert "markdown_text" not in client.post_calls[0]
    markdown_blocks = [block for block in blocks if block["type"] == "markdown"]
    input_blocks = [block for block in blocks if block["type"] == "input"]
    action_blocks = [block for block in blocks if block["type"] == "actions"]
    assert markdown_blocks == [
        {"type": "markdown", "text": "Rendered **content**"},
        {"type": "markdown", "text": "After input"},
    ]
    assert [block["type"] for block in blocks] == ["header", "markdown", "input", "markdown", "actions"]
    assert len(input_blocks) == 1
    assert input_blocks[0]["element"]["type"] == "static_select"
    assert input_blocks[0]["element"]["initial_option"]["value"] == "One"
    assert len(action_blocks) == 1
    assert [element["action_id"] for element in action_blocks[0]["elements"]] == ["approve", "reject"]
    for element in action_blocks[0]["elements"]:
        action_value = json.loads(element["value"])
        assert action_value["correlation_token"] == "correlation-1"
        assert action_value["action_id"] == element["action_id"]


def test_paragraph_uses_resolved_default_in_assessment_and_rendering(mocker) -> None:
    client = FakeWebClient()
    client.auth_responses.append(_successful_auth_response())
    client.post_responses.append(SlackResponse({"ok": True, "channel": "dm-1", "ts": "1000.000001"}))
    adapter = _adapter(mocker, client)
    intent = _intent_with_paragraph_default("Resolved default")

    assessment = adapter.dynamic_card_messaging.assess(intent)
    result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("user-1"),
        intent,
        CorrelationToken("correlation-1"),
    )

    assert assessment.representable is True
    assert isinstance(result, MessageAccepted)
    blocks = client.post_calls[0]["blocks"]
    assert isinstance(blocks, list)
    input_element = next(block["element"] for block in blocks if block["type"] == "input")
    assert input_element["initial_value"] == "Resolved default"


def test_static_replacement_validates_reference_before_one_exact_mutation(mocker) -> None:
    client = FakeWebClient()
    client.auth_responses.extend((_successful_auth_response(), _successful_auth_response()))
    client.post_responses.append(SlackResponse({"ok": True, "channel": "dm-1", "ts": "1000.000001"}))
    client.update_responses.append(SlackResponse({"ok": True, "channel": "dm-1", "ts": "1000.000001"}))
    adapter = _adapter(mocker, client)
    accepted = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("user-1"),
        _intent(),
        CorrelationToken("correlation-1"),
    )
    assert isinstance(accepted, MessageAccepted)

    invalid = adapter.dynamic_card_messaging.replace_with_static(
        MessageLocator("invalid."),
        StaticCardIntent("Submitted"),
    )
    replaced = adapter.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Submitted"),
    )

    assert isinstance(invalid, ReplacementError)
    assert invalid.kind is ReplacementErrorKind.INVALID_REFERENCE
    assert replaced is None
    assert len(client.update_calls) == 1
    update_call = client.update_calls[0]
    assert set(update_call) == {"channel", "ts", "text", "blocks"}
    assert update_call["channel"] == "dm-1"
    assert update_call["ts"] == "1000.000001"
    assert update_call["text"] == "Submitted"
    assert update_call["blocks"] == []
    assert "markdown_text" not in update_call


def test_webhook_authenticates_challenge_and_business_events_before_consumer(mocker) -> None:
    client = FakeWebClient()
    adapter = _adapter(mocker, client)
    consumer = RecordingConsumer()
    handler = adapter.create_webhook_handler(consumer)
    challenge_body = json.dumps({"type": "url_verification", "challenge": "challenge-value"}).encode()

    challenge = handler.handle(_signed_request(challenge_body))

    assert challenge.status_code == 200
    assert json.loads(challenge.body) == {"challenge": "challenge-value"}
    assert consumer.events == []

    event_body = json.dumps(
        {
            "type": "event_callback",
            "team_id": "team-1",
            "event_id": "event-1",
            "event_time": 1786003200,
            "event": {"type": "message", "nested": [1, None, {"kept": True}]},
            "extra": "preserved",
        }
    ).encode()
    response = handler.handle(_signed_request(event_body))

    assert response.status_code == 200
    assert len(consumer.events) == 1
    event = consumer.events[0]
    assert event.event_id == "event-1"
    assert event.event_type == "message"
    assert event.ingress_kind is IMEventIngressKind.WEBHOOK
    assert json.loads(event.payload) == json.loads(event_body)

    unauthenticated = handler.handle(_signed_request(event_body, signature="v0=invalid"))
    assert unauthenticated.status_code == 401
    assert len(consumer.events) == 1


def test_webhook_not_accepted_is_not_successfully_acknowledged(mocker) -> None:
    adapter = _adapter(mocker, FakeWebClient())
    consumer = RecordingConsumer(EventAcceptance.NOT_ACCEPTED)
    handler = adapter.create_webhook_handler(consumer)
    event_body = json.dumps({"type": "block_actions", "team": {"id": "team-1"}, "actions": []}).encode()

    response = handler.handle(_signed_request(event_body))

    assert response.status_code >= 400
    assert len(consumer.events) == 1


def test_webhook_consumer_exception_returns_safe_failure(mocker, caplog) -> None:
    class FailingConsumer:
        def accept(self, event):
            del event
            raise RuntimeError("sensitive consumer details")

    adapter = _adapter(mocker, FakeWebClient())
    handler = adapter.create_webhook_handler(FailingConsumer())
    event_body = json.dumps({"type": "block_actions", "team": {"id": "team-1"}, "actions": []}).encode()

    with caplog.at_level(logging.ERROR, logger="core.human_input_v2.im_integration.adapters.slack"):
        response = handler.handle(_signed_request(event_body))

    assert response.status_code == 503
    assert b"sensitive consumer details" not in response.body
    assert "sensitive consumer details" not in caplog.text


def test_stream_start_delivers_complete_sdk_serialization_and_stop_is_idempotent(mocker) -> None:
    consumer = RecordingConsumer()
    request = SocketModeRequest(
        type="events_api",
        envelope_id="envelope-1",
        payload={
            "team_id": "team-1",
            "event_id": "event-1",
            "event_time": 1786003200,
            "event": {"type": "message", "text": "hello"},
        },
    )

    class FakeSocketModeClient:
        instances = []

        def __init__(self, **kwargs):
            self.socket_mode_request_listeners = []
            self.responses = []
            self.closed = False
            self.kwargs = kwargs
            self.__class__.instances.append(self)

        def connect(self):
            self.socket_mode_request_listeners[0](self, request)

        def send_socket_mode_response(self, response):
            self.responses.append(response)

        def close(self):
            self.closed = True

    mocker.patch("core.human_input_v2.im_integration.adapters.slack.SocketModeClient", FakeSocketModeClient)
    adapter = _adapter(mocker, FakeWebClient())
    stream = adapter.create_stream_handler(consumer)

    stream.start()

    socket_client = FakeSocketModeClient.instances[0]
    assert socket_client.kwargs["app_token"] == "xapp-test-app-token"
    assert socket_client.closed is False
    assert len(socket_client.responses) == 1
    assert len(consumer.events) == 1
    event = consumer.events[0]
    assert event.event_id == "event-1"
    assert event.event_type == "message"
    assert event.occurred_at == datetime.fromtimestamp(1786003200, tz=UTC).replace(tzinfo=None)
    assert event.ingress_kind is IMEventIngressKind.STREAM
    assert json.loads(event.payload) == request.to_dict()
    assert json.loads(event.payload)["payload"] == request.payload

    stream.stop()
    stream.stop()

    assert socket_client.closed is True
    with pytest.raises(IMStreamStartError, match="already been started"):
        stream.start()


def test_stream_consumer_exception_is_one_event_failure(mocker, caplog) -> None:
    first_request = SocketModeRequest(
        type="events_api",
        envelope_id="envelope-1",
        payload={"team_id": "team-1", "event": {"type": "message"}},
    )
    second_request = SocketModeRequest(
        type="events_api",
        envelope_id="envelope-2",
        payload={"team_id": "team-1", "event": {"type": "message"}},
    )

    class FailOnceConsumer:
        def __init__(self) -> None:
            self.calls = 0

        def accept(self, event):
            del event
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("sensitive consumer details")
            return EventAcceptance.ACCEPTED

    class FakeSocketModeClient:
        instances = []

        def __init__(self, **kwargs):
            del kwargs
            self.socket_mode_request_listeners = []
            self.responses = []
            self.closed = False
            self.__class__.instances.append(self)

        def connect(self):
            return None

        def send_socket_mode_response(self, response):
            self.responses.append(response)

        def close(self):
            self.closed = True

    mocker.patch("core.human_input_v2.im_integration.adapters.slack.SocketModeClient", FakeSocketModeClient)
    adapter = _adapter(mocker, FakeWebClient())
    consumer = FailOnceConsumer()
    stream = adapter.create_stream_handler(consumer)

    with caplog.at_level(logging.ERROR, logger="core.human_input_v2.im_integration.adapters.slack"):
        stream.start()
        socket_client = FakeSocketModeClient.instances[0]
        listener = socket_client.socket_mode_request_listeners[0]
        listener(socket_client, first_request)
        listener(socket_client, second_request)
        stream.stop()

    assert "sensitive consumer details" not in caplog.text
    assert consumer.calls == 2
    assert len(socket_client.responses) == 1
    assert socket_client.responses[0].envelope_id == "envelope-2"
    assert socket_client.closed is True


def test_stream_protocol_response_exception_is_one_event_failure(mocker, caplog) -> None:
    first_request = SocketModeRequest(
        type="events_api",
        envelope_id="envelope-1",
        payload={"team_id": "team-1", "event": {"type": "message"}},
    )
    second_request = SocketModeRequest(
        type="events_api",
        envelope_id="envelope-2",
        payload={"team_id": "team-1", "event": {"type": "message"}},
    )

    class FakeSocketModeClient:
        instances = []

        def __init__(self, **kwargs):
            del kwargs
            self.socket_mode_request_listeners = []
            self.response_attempts = 0
            self.closed = False
            self.__class__.instances.append(self)

        def connect(self):
            return None

        def send_socket_mode_response(self, response):
            del response
            self.response_attempts += 1
            if self.response_attempts == 1:
                raise SlackClientError("sensitive response details")

        def close(self):
            self.closed = True

    mocker.patch("core.human_input_v2.im_integration.adapters.slack.SocketModeClient", FakeSocketModeClient)
    adapter = _adapter(mocker, FakeWebClient())
    stream = adapter.create_stream_handler(RecordingConsumer())

    with caplog.at_level(logging.ERROR, logger="core.human_input_v2.im_integration.adapters.slack"):
        stream.start()
        socket_client = FakeSocketModeClient.instances[0]
        listener = socket_client.socket_mode_request_listeners[0]
        listener(socket_client, first_request)
        listener(socket_client, second_request)
        stream.stop()

    assert "sensitive response details" not in caplog.text
    assert socket_client.response_attempts == 2
    assert socket_client.closed is True


def test_stream_wraps_connect_exception_as_safe_start_error_and_cleans_up(mocker, caplog) -> None:
    class FakeSocketModeClient:
        instances = []

        def __init__(self, **kwargs):
            del kwargs
            self.socket_mode_request_listeners = []
            self.closed = False
            self.__class__.instances.append(self)

        def connect(self):
            raise RuntimeError("sensitive connect details")

        def close(self):
            self.closed = True

    mocker.patch("core.human_input_v2.im_integration.adapters.slack.SocketModeClient", FakeSocketModeClient)
    adapter = _adapter(mocker, FakeWebClient())
    stream = adapter.create_stream_handler(RecordingConsumer())

    with caplog.at_level(logging.ERROR, logger="core.human_input_v2.im_integration.adapters.slack"):
        with pytest.raises(IMStreamStartError) as raised:
            stream.start()
        stream.stop()
        stream.stop()

    assert "sensitive connect details" not in str(raised.value)
    assert "sensitive connect details" not in caplog.text
    assert FakeSocketModeClient.instances[0].closed is True


def test_stream_runtime_error_is_observable_without_adapter_lifecycle_transition(mocker, caplog) -> None:
    sensitive_marker = "sensitive remote socket error"
    consumer = RecordingConsumer()
    request = SocketModeRequest(
        type="events_api",
        envelope_id="envelope-1",
        payload={"team_id": "team-1", "event": {"type": "message"}},
    )

    class FailingSocketModeClient:
        instances = []

        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.socket_mode_request_listeners = []
            self.responses = []
            self.closed = False
            self.__class__.instances.append(self)

        def connect(self):
            return None

        def send_socket_mode_response(self, response):
            self.responses.append(response)

        def close(self):
            self.closed = True

    mocker.patch("core.human_input_v2.im_integration.adapters.slack.SocketModeClient", FailingSocketModeClient)
    stream = _adapter(mocker, FakeWebClient()).create_stream_handler(consumer)

    with caplog.at_level(logging.ERROR, logger="core.human_input_v2.im_integration.adapters.slack"):
        stream.start()
        socket_client = FailingSocketModeClient.instances[0]
        socket_client.kwargs["on_error_listeners"][0](RuntimeError(sensitive_marker))
        socket_client.socket_mode_request_listeners[0](socket_client, request)
        stream.stop()

    assert len(consumer.events) == 1
    assert len(socket_client.responses) == 1
    assert sensitive_marker not in caplog.text
    assert "Slack Socket Mode remote error" in caplog.text
    assert socket_client.closed is True


def test_stream_stop_delegates_to_sdk_without_waiting_for_inflight_consumer(mocker) -> None:
    consumer_started = threading.Event()
    release_consumer = threading.Event()
    stop_finished = threading.Event()
    request = SocketModeRequest(
        type="events_api",
        envelope_id="envelope-1",
        payload={"team_id": "team-1", "event": {"type": "message"}},
    )

    class BlockingConsumer:
        def __init__(self) -> None:
            self.calls = 0

        def accept(self, event):
            del event
            self.calls += 1
            consumer_started.set()
            assert release_consumer.wait(2)
            return EventAcceptance.ACCEPTED

    class FakeSocketModeClient:
        instances = []

        def __init__(self, **kwargs):
            del kwargs
            self.socket_mode_request_listeners = []
            self.responses = []
            self.closed = False
            self.__class__.instances.append(self)

        def connect(self):
            return None

        def send_socket_mode_response(self, response):
            self.responses.append(response)

        def close(self):
            self.closed = True

    mocker.patch("core.human_input_v2.im_integration.adapters.slack.SocketModeClient", FakeSocketModeClient)
    blocking_consumer = BlockingConsumer()
    stream = _adapter(mocker, FakeWebClient()).create_stream_handler(blocking_consumer)
    stream.start()
    socket_client = FakeSocketModeClient.instances[0]
    listener = socket_client.socket_mode_request_listeners[0]
    callback_thread = threading.Thread(target=listener, args=(socket_client, request))
    callback_thread.start()
    assert consumer_started.wait(2)

    def stop_stream() -> None:
        stream.stop()
        stop_finished.set()

    stop_thread = threading.Thread(target=stop_stream)
    stop_thread.start()

    assert stop_finished.wait(2)
    assert socket_client.closed is True

    release_consumer.set()
    callback_thread.join(2)
    stop_thread.join(2)

    assert not callback_thread.is_alive()
    assert not stop_thread.is_alive()
    assert stop_finished.is_set()
    assert socket_client.closed is True
    assert len(socket_client.responses) == 1


def test_stream_wraps_close_exception_as_safe_stop_error(mocker, caplog) -> None:

    class FakeSocketModeClient:
        def __init__(self, **kwargs):
            del kwargs
            self.socket_mode_request_listeners = []

        def connect(self):
            return None

        def close(self):
            raise RuntimeError("sensitive close details")

    mocker.patch("core.human_input_v2.im_integration.adapters.slack.SocketModeClient", FakeSocketModeClient)
    adapter = _adapter(mocker, FakeWebClient())
    stream = adapter.create_stream_handler(RecordingConsumer())

    with caplog.at_level(logging.ERROR, logger="core.human_input_v2.im_integration.adapters.slack"):
        stream.start()
        with pytest.raises(IMStreamStopError) as raised:
            stream.stop()

    assert "sensitive close details" not in str(raised.value)
    assert "sensitive close details" not in caplog.text
