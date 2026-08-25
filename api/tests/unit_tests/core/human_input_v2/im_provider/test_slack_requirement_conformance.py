from __future__ import annotations

import json
import logging
import threading
from collections import UserDict
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import get_args, get_origin, get_type_hints
from urllib.parse import urlencode

import pytest
from pytest_mock import MockerFixture
from slack_sdk.errors import SlackApiError, SlackClientError
from slack_sdk.signature import SignatureVerifier
from slack_sdk.socket_mode.request import SocketModeRequest
from slack_sdk.web import WebClient

from core.human_input import ButtonStyle
from core.human_input_v2 import (
    FileInput,
    MarkdownText,
    ParagraphInput,
    ResolvedForm,
    ResolvedFormAction,
    ResolvedFormContent,
    SelectInput,
)
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import (
    AuthenticatedIMEvent,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    Directory,
    DirectoryReadFailure,
    DynamicCardMessagingError,
    EventAcceptance,
    IMStreamStartError,
    MessageAccepted,
    MessageLocator,
    MessageSendingError,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    SlackCredentials,
    StaticCardIntent,
    WebhookRequest,
)
from core.human_input_v2.im_integration.adapters import slack as slack_adapter_module
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter

_SIGNING_SECRET = "sanitized-signing-material"


class _SlackResponse(UserDict[str, object]):
    def __init__(self, values: Mapping[str, object], *, headers: Mapping[str, str] | None = None) -> None:
        super().__init__(values)
        self.headers = dict(headers or {})


class _RecordingConsumer:
    def __init__(self, acceptance: EventAcceptance = EventAcceptance.ACCEPTED) -> None:
        self.acceptance = acceptance
        self.events: list[AuthenticatedIMEvent] = []
        self._lock = threading.Lock()

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        with self._lock:
            self.events.append(event)
        return self.acceptance


def _credentials() -> SlackCredentials:
    return SlackCredentials(
        provider=IMProvider.SLACK,
        client_id="sanitized-client-id",
        client_secret="sanitized-client-secret",
        signing_secret=_SIGNING_SECRET,
        bot_token="xoxb-sanitized-placeholder",
        app_token="xapp-sanitized-placeholder",
    )


def _successful_auth_response(team_id: str = "sanitized-team") -> _SlackResponse:
    return _SlackResponse(
        {"ok": True, "team_id": team_id},
        headers={"x-oauth-scopes": "chat:write,users:read,users:read.email"},
    )


def _adapter(mocker: MockerFixture, client: WebClient) -> SlackIMProviderAdapter:
    mocker.patch.object(slack_adapter_module, "WebClient", return_value=client)
    return SlackIMProviderAdapter(_credentials())


def _signed_request(
    body: bytes,
    *,
    content_type: str | None = "application/json",
    received_at: datetime | None = None,
    timestamp_seconds: int | None = None,
    signing_secret: str = _SIGNING_SECRET,
    signature_body: bytes | None = None,
) -> WebhookRequest:
    if received_at is None:
        received_at = datetime.now(tz=UTC).replace(tzinfo=None)
    trusted_receive_time = (
        received_at.replace(tzinfo=UTC) if received_at.tzinfo is None else received_at.astimezone(UTC)
    )
    if timestamp_seconds is None:
        timestamp_seconds = int(trusted_receive_time.timestamp())
    timestamp = str(timestamp_seconds)
    signature = SignatureVerifier(signing_secret).generate_signature(
        timestamp=timestamp,
        body=body if signature_body is None else signature_body,
    )
    assert signature is not None
    headers = [
        ("X-Slack-Request-Timestamp", timestamp),
        ("X-Slack-Signature", signature),
    ]
    if content_type is not None:
        headers.append(("Content-Type", content_type))
    return WebhookRequest(
        method="POST",
        headers=tuple(headers),
        body=body,
        received_at=received_at,
    )


def _card_intent(
    *,
    blocks: tuple[ResolvedFormContent, ...] = (MarkdownText("Sanitized rendered content"),),
    actions: tuple[ResolvedFormAction, ...] | None = None,
    title: str | None = "Sanitized title",
) -> ResolvedForm:
    if actions is None:
        actions = (ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),)
    return ResolvedForm(
        title=title,
        blocks=blocks,
        user_actions=actions,
        legacy_form_content="This value must not be rendered",
    )


def _annotation_contains_mapping(annotation: object) -> bool:
    origin = get_origin(annotation)
    if origin is Mapping:
        return True
    return any(_annotation_contains_mapping(argument) for argument in get_args(annotation))


def test_webhook_authentication_delegates_exact_body_to_official_sdk_verifier(mocker: MockerFixture) -> None:
    verifier_class = mocker.patch.object(slack_adapter_module, "SignatureVerifier", create=True)
    verifier = verifier_class.return_value
    verifier.is_valid.return_value = True
    verifier.is_valid_request.return_value = True
    consumer = _RecordingConsumer()
    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(consumer)
    body = json.dumps(
        {"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}},
        separators=(",", ":"),
    ).encode()
    request = WebhookRequest(
        method="POST",
        headers=(
            ("X-Slack-Request-Timestamp", "1"),
            ("X-Slack-Signature", "invalid-without-sdk-delegation"),
            ("Content-Type", "application/json"),
        ),
        body=body,
        received_at=datetime.now(tz=UTC).replace(tzinfo=None),
    )

    response = handler.handle(request)

    assert response.status_code == 200
    assert verifier_class.call_count >= 1
    verification_calls = verifier.is_valid.call_args_list + verifier.is_valid_request.call_args_list
    assert verification_calls
    assert any(body in call.args or body in call.kwargs.values() for call in verification_calls)
    assert len(consumer.events) == 1


def test_decoded_provider_json_boundaries_use_mapping_abstractions() -> None:
    authenticated_hints = get_type_hints(slack_adapter_module._authenticated_event)
    tenant_hints = get_type_hints(slack_adapter_module._provider_tenant_id)

    assert _annotation_contains_mapping(authenticated_hints["body"])
    assert _annotation_contains_mapping(authenticated_hints["serialized_body"])
    assert _annotation_contains_mapping(tenant_hints["body"])


def test_credential_test_normalizes_unexpected_failure_without_secret_leak(mocker: MockerFixture) -> None:
    client = mocker.Mock(spec=WebClient)
    client.auth_test.side_effect = RuntimeError("sanitized-client-secret")
    adapter = _adapter(mocker, client)

    result = adapter.test_credentials()

    assert result == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "Slack credential testing could not be completed.",
    )


def test_credential_test_maps_transport_and_scope_failures_to_safe_results(mocker: MockerFixture) -> None:
    transport_client = mocker.Mock(spec=WebClient)
    transport_client.auth_test.side_effect = SlackClientError("sanitized transport details")
    transport_result = _adapter(mocker, transport_client).test_credentials()

    scope_client = mocker.Mock(spec=WebClient)
    scope_client.auth_test.return_value = _SlackResponse(
        {"ok": True, "team_id": "sanitized-team"},
        headers={"X-OAuth-Scopes": "chat:write, users:read"},
    )
    scope_result = _adapter(mocker, scope_client).test_credentials()

    assert transport_result == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "Slack credential testing could not be completed.",
    )
    assert scope_result == CredentialTestFailure(
        CredentialTestFailureKind.UNKNOWN,
        "Slack baseline permissions could not be confirmed.",
    )
    scope_client.apps_connections_open.assert_not_called()


@pytest.mark.parametrize(
    ("socket_failure", "expected_kind"),
    [
        (
            SlackApiError(
                "sanitized authentication details",
                response=_SlackResponse({"ok": False, "error": "invalid_auth"}),
            ),
            CredentialTestFailureKind.AUTHENTICATION_REJECTED,
        ),
        (
            SlackApiError(
                "sanitized provider details",
                response=_SlackResponse({"ok": False, "error": "internal_error"}),
            ),
            CredentialTestFailureKind.UNKNOWN,
        ),
        (SlackClientError("sanitized socket transport details"), CredentialTestFailureKind.UNKNOWN),
    ],
    ids=("authentication-rejected", "provider-unknown", "transport-unknown"),
)
def test_credential_test_maps_socket_mode_sdk_failures(
    mocker: MockerFixture,
    socket_failure: SlackClientError,
    expected_kind: CredentialTestFailureKind,
) -> None:
    client = mocker.Mock(spec=WebClient)
    client.auth_test.return_value = _successful_auth_response()
    client.apps_connections_open.side_effect = socket_failure

    result = _adapter(mocker, client).test_credentials()

    assert isinstance(result, CredentialTestFailure)
    assert result.kind is expected_kind
    assert "sanitized" not in result.reason


@pytest.mark.parametrize(
    "provider_response",
    [
        _SlackResponse({"ok": True}),
        _SlackResponse({"ok": True, "members": [None]}),
        _SlackResponse({"ok": True, "members": [{"profile": {}}]}),
    ],
    ids=("missing-members", "non-object-member", "missing-member-id"),
)
def test_directory_rejects_incomplete_or_invalid_pages(
    mocker: MockerFixture,
    provider_response: _SlackResponse,
) -> None:
    client = mocker.Mock(spec=WebClient)
    client.users_list.return_value = provider_response

    result = _adapter(mocker, client).directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert "Slack" in result.reason


def test_directory_skips_non_people_and_normalizes_optional_profile_fields(mocker: MockerFixture) -> None:
    client = mocker.Mock(spec=WebClient)
    client.users_list.return_value = _SlackResponse(
        {
            "ok": True,
            "members": [
                {"id": "sanitized-deleted", "deleted": True},
                {"id": "sanitized-bot", "is_bot": True},
                {"id": "sanitized-app", "is_app_user": True},
                {"id": "sanitized-user", "profile": "malformed-profile"},
            ],
            "response_metadata": {"next_cursor": ""},
        }
    )

    result = _adapter(mocker, client).directory.read_directory()

    assert isinstance(result, Directory)
    assert len(result.entries) == 1
    assert result.entries[0].provider_user_id == "sanitized-user"
    assert result.entries[0].display_name is None
    assert result.entries[0].email is None


@pytest.mark.parametrize(
    "provider_response",
    [
        _SlackResponse(
            {
                "ok": True,
                "members": [{"id": "sanitized-user", "profile": {}}],
            }
        ),
        _SlackResponse(
            {
                "ok": True,
                "members": [{"id": "sanitized-user", "profile": {}}],
                "response_metadata": "malformed-metadata",
            }
        ),
        _SlackResponse(
            {
                "ok": True,
                "members": [{"id": "sanitized-user", "profile": {}}],
                "response_metadata": {},
            }
        ),
        _SlackResponse(
            {
                "ok": True,
                "members": [{"id": "sanitized-user", "profile": {}}],
                "response_metadata": {"next_cursor": None},
            }
        ),
        _SlackResponse(
            {
                "ok": True,
                "members": [{"id": "sanitized-user", "profile": {}}],
                "response_metadata": {"next_cursor": 1},
            }
        ),
    ],
    ids=(
        "missing-metadata",
        "malformed-metadata",
        "missing-cursor",
        "null-cursor",
        "non-string-cursor",
    ),
)
def test_directory_rejects_invalid_pagination_without_partial_snapshot(
    mocker: MockerFixture,
    provider_response: _SlackResponse,
) -> None:
    client = mocker.Mock(spec=WebClient)
    client.users_list.return_value = provider_response

    result = _adapter(mocker, client).directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert not hasattr(result, "entries")
    assert "sanitized-user" not in result.reason
    client.users_list.assert_called_once_with(limit=200)


@pytest.mark.parametrize(
    "second_page",
    [
        SlackClientError("sanitized second-page transport details"),
        _SlackResponse(
            {
                "ok": True,
                "members": [{"id": "sanitized-user-2", "profile": {}}],
                "response_metadata": "malformed-metadata",
            }
        ),
    ],
    ids=("transport-failure", "malformed-pagination"),
)
def test_directory_later_page_failure_discards_accumulated_entries(
    mocker: MockerFixture,
    second_page: _SlackResponse | SlackClientError,
) -> None:
    client = mocker.Mock(spec=WebClient)
    client.users_list.side_effect = (
        _SlackResponse(
            {
                "ok": True,
                "members": [{"id": "sanitized-user-1", "profile": {}}],
                "response_metadata": {"next_cursor": "sanitized-cursor"},
            }
        ),
        second_page,
    )

    result = _adapter(mocker, client).directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert not hasattr(result, "entries")
    assert "sanitized-user-1" not in result.reason
    assert "sanitized-user-2" not in result.reason
    assert client.users_list.call_args_list == [
        mocker.call(limit=200),
        mocker.call(limit=200, cursor="sanitized-cursor"),
    ]


def test_directory_rejects_repeated_cursor_without_request_loop_or_partial_snapshot(
    mocker: MockerFixture,
) -> None:
    client = mocker.Mock(spec=WebClient)
    client.users_list.side_effect = (
        _SlackResponse(
            {
                "ok": True,
                "members": [{"id": "sanitized-user-1", "profile": {}}],
                "response_metadata": {"next_cursor": "sanitized-cursor"},
            }
        ),
        _SlackResponse(
            {
                "ok": True,
                "members": [{"id": "sanitized-user-2", "profile": {}}],
                "response_metadata": {"next_cursor": "sanitized-cursor"},
            }
        ),
    )

    result = _adapter(mocker, client).directory.read_directory()

    assert isinstance(result, DirectoryReadFailure)
    assert not hasattr(result, "entries")
    assert client.users_list.call_args_list == [
        mocker.call(limit=200),
        mocker.call(limit=200, cursor="sanitized-cursor"),
    ]


def test_messaging_maps_card_transport_failure_without_workspace_preflight(
    mocker: MockerFixture,
) -> None:
    transport_client = mocker.Mock(spec=WebClient)
    transport_client.chat_postMessage.side_effect = SlackClientError("sanitized transport details")
    transport_result = _adapter(mocker, transport_client).dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user"),
        _card_intent(),
        CorrelationToken("sanitized-correlation"),
    )

    assert isinstance(transport_result, MessageSendingError)
    assert "sanitized" not in transport_result.reason
    transport_client.auth_test.assert_not_called()


def test_static_replacement_maps_transport_failures_without_workspace_preflight(
    mocker: MockerFixture,
) -> None:
    source_client = mocker.Mock(spec=WebClient)
    source_client.chat_postMessage.return_value = _SlackResponse(
        {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"}
    )
    accepted = _adapter(mocker, source_client).dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user"),
        _card_intent(),
        CorrelationToken("sanitized-correlation"),
    )
    assert isinstance(accepted, MessageAccepted)

    transport_client = mocker.Mock(spec=WebClient)
    transport_client.chat_update.side_effect = SlackClientError("sanitized transport details")
    transport_result = _adapter(mocker, transport_client).dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Sanitized static content"),
    )

    unconfirmed_client = mocker.Mock(spec=WebClient)
    unconfirmed_client.chat_update.return_value = _SlackResponse({"ok": False})
    unconfirmed_result = _adapter(mocker, unconfirmed_client).dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Sanitized static content"),
    )

    assert isinstance(transport_result, ReplacementError)
    assert transport_result.kind is ReplacementErrorKind.UNKNOWN
    assert isinstance(unconfirmed_result, ReplacementError)
    assert unconfirmed_result.kind is ReplacementErrorKind.UNKNOWN
    source_client.auth_test.assert_not_called()
    transport_client.auth_test.assert_not_called()
    unconfirmed_client.auth_test.assert_not_called()


@pytest.mark.parametrize(
    ("channel_id", "message_ts"),
    [
        ("", "1000.000001"),
        ("sanitized-channel", "not-a-slack-timestamp"),
    ],
)
def test_message_acceptance_requires_a_persistently_round_trippable_locator(
    mocker: MockerFixture,
    channel_id: str,
    message_ts: str,
) -> None:
    client = mocker.Mock(spec=WebClient)
    client.auth_test.return_value = _successful_auth_response()
    client.chat_postMessage.return_value = _SlackResponse({"ok": True, "channel": channel_id, "ts": message_ts})
    adapter = _adapter(mocker, client)

    result = adapter.messaging.send_text(ProviderUserId("sanitized-user"), "Sanitized message")

    assert isinstance(result, MessageSendingError)
    client.chat_postMessage.assert_called_once()


def test_real_paragraph_resolved_default_is_preserved_and_rendered(mocker: MockerFixture) -> None:
    intent = _card_intent(
        blocks=(
            MarkdownText("Before input"),
            ParagraphInput("comment", "Sanitized preserved default"),
            MarkdownText("After input"),
        )
    )
    client = mocker.Mock(spec=WebClient)
    client.auth_test.return_value = _successful_auth_response()
    client.chat_postMessage.return_value = _SlackResponse(
        {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"}
    )
    adapter = _adapter(mocker, client)

    assessment = adapter.dynamic_card_messaging.assess(intent)
    result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user"),
        intent,
        CorrelationToken("sanitized-correlation"),
    )

    assert assessment.representable is True
    assert isinstance(result, MessageAccepted)
    input_block = next(
        block for block in client.chat_postMessage.call_args.kwargs["blocks"] if block["type"] == "input"
    )
    assert input_block["element"]["initial_value"] == "Sanitized preserved default"
    assert [block["type"] for block in client.chat_postMessage.call_args.kwargs["blocks"]] == [
        "header",
        "markdown",
        "input",
        "markdown",
        "actions",
    ]


@pytest.mark.parametrize(
    "intent",
    [
        _card_intent(blocks=(), actions=(), title=None),
        _card_intent(blocks=(MarkdownText(""),)),
        _card_intent(blocks=(MarkdownText("x" * 20_000),)),
        _card_intent(title="x" * 151),
        _card_intent(blocks=tuple(ParagraphInput(f"input_{index}", None) for index in range(49))),
        _card_intent(
            actions=tuple(
                ResolvedFormAction(f"action_{index}", f"Action {index}", ButtonStyle.DEFAULT) for index in range(26)
            )
        ),
        _card_intent(
            blocks=(
                ParagraphInput("duplicate", None),
                ParagraphInput("duplicate", None),
            )
        ),
        _card_intent(actions=(ResolvedFormAction("x" * 256, "Action", ButtonStyle.DEFAULT),)),
        _card_intent(actions=(ResolvedFormAction("action", "Action", ButtonStyle.GHOST),)),
        _card_intent(blocks=(FileInput("attachment", (), (), ()),)),
        _card_intent(blocks=(ParagraphInput("x" * 256, None),)),
        _card_intent(blocks=(ParagraphInput("input", "x" * 3_001),)),
        _card_intent(blocks=(SelectInput("input", (), None),)),
        _card_intent(blocks=(SelectInput("input", ("",), None),)),
    ],
    ids=(
        "empty-card",
        "empty-markdown",
        "oversized-markdown",
        "oversized-title",
        "block-count",
        "action-count",
        "duplicate-input",
        "action-identifier",
        "action-style",
        "file-input",
        "input-identifier",
        "paragraph-default",
        "select-count",
        "select-option",
    ),
)
def test_card_assessment_rejects_slack_representation_boundaries(
    mocker: MockerFixture,
    intent: ResolvedForm,
) -> None:
    client = mocker.Mock(spec=WebClient)
    adapter = _adapter(mocker, client)

    assessment = adapter.dynamic_card_messaging.assess(intent)

    assert assessment.representable is False
    with pytest.raises(DynamicCardMessagingError):
        adapter.dynamic_card_messaging.send_card(
            ProviderUserId("sanitized-user"),
            intent,
            CorrelationToken("sanitized-correlation"),
        )
    client.chat_postMessage.assert_not_called()


def test_card_render_preserves_optional_sections_and_default_action_style(mocker: MockerFixture) -> None:
    client = mocker.Mock(spec=WebClient)
    client.auth_test.return_value = _successful_auth_response()
    client.chat_postMessage.side_effect = (
        _SlackResponse({"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"}),
        _SlackResponse({"ok": True, "channel": "sanitized-channel", "ts": "1000.000002"}),
    )
    adapter = _adapter(mocker, client)
    paragraph_intent = _card_intent(
        blocks=(ParagraphInput("comment", None),),
        actions=(),
        title=None,
    )
    default_action_intent = _card_intent(
        actions=(ResolvedFormAction("continue", "Continue", ButtonStyle.DEFAULT),),
        title=None,
    )

    paragraph_result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user"),
        paragraph_intent,
        CorrelationToken("sanitized-correlation"),
    )
    default_action_result = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user"),
        default_action_intent,
        CorrelationToken("sanitized-correlation"),
    )

    assert isinstance(paragraph_result, MessageAccepted)
    assert isinstance(default_action_result, MessageAccepted)
    paragraph_blocks = client.chat_postMessage.call_args_list[0].kwargs["blocks"]
    paragraph_element = next(block["element"] for block in paragraph_blocks if block["type"] == "input")
    assert "initial_value" not in paragraph_element
    assert all(block["type"] != "header" for block in paragraph_blocks)
    assert all(block["type"] != "actions" for block in paragraph_blocks)
    action_blocks = client.chat_postMessage.call_args_list[1].kwargs["blocks"]
    action_element = next(block["elements"][0] for block in action_blocks if block["type"] == "actions")
    assert "style" not in action_element


def test_card_send_rejects_oversized_serialized_correlation_before_provider_io(mocker: MockerFixture) -> None:
    client = mocker.Mock(spec=WebClient)
    adapter = _adapter(mocker, client)

    with pytest.raises(DynamicCardMessagingError, match="correlation token"):
        adapter.dynamic_card_messaging.send_card(
            ProviderUserId("sanitized-user"),
            _card_intent(),
            CorrelationToken("x" * 2_100),
        )

    client.auth_test.assert_not_called()
    client.chat_postMessage.assert_not_called()


def test_webhook_consumer_failure_does_not_log_exception_details(
    mocker: MockerFixture,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sensitive_marker = "sanitized-sensitive-consumer-marker"

    class _FailingConsumer:
        def accept(self, event: object) -> EventAcceptance:
            del event
            raise RuntimeError(sensitive_marker)

    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(_FailingConsumer())
    body = json.dumps({"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}).encode()

    with caplog.at_level(logging.ERROR, logger=slack_adapter_module.__name__):
        response = handler.handle(_signed_request(body))

    assert response.status_code == 503
    assert sensitive_marker not in caplog.text


def test_message_locator_can_be_reused_across_adapter_instances(mocker: MockerFixture) -> None:
    first_client = mocker.Mock(spec=WebClient)
    first_client.chat_postMessage.return_value = _SlackResponse(
        {"ok": True, "channel": "D0123456789", "ts": "1712345678.123456"}
    )
    second_client = mocker.Mock(spec=WebClient)
    second_client.chat_update.return_value = _SlackResponse({"ok": True})
    web_client = mocker.patch.object(slack_adapter_module, "WebClient", side_effect=(first_client, second_client))
    first_adapter = SlackIMProviderAdapter(_credentials())
    accepted = first_adapter.dynamic_card_messaging.send_card(
        ProviderUserId("U0123456789"),
        _card_intent(),
        CorrelationToken("sanitized-correlation"),
    )
    assert isinstance(accepted, MessageAccepted)
    first_adapter.close()
    second_adapter = SlackIMProviderAdapter(_credentials())

    result = second_adapter.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Sanitized static content"),
    )

    assert result is None
    assert web_client.call_count == 2
    first_client.auth_test.assert_not_called()
    second_client.auth_test.assert_not_called()
    second_client.chat_update.assert_called_once()
    update_parameters = second_client.chat_update.call_args.kwargs
    assert set(update_parameters) == {"blocks", "channel", "text", "ts"}
    assert update_parameters["channel"] == "D0123456789"
    assert update_parameters["ts"] == "1712345678.123456"
    assert update_parameters["text"] == "Sanitized static content"
    assert update_parameters["blocks"] == []
    assert "markdown_text" not in update_parameters


def test_static_replacement_rejects_foreign_reference_before_provider_io(mocker: MockerFixture) -> None:
    client = mocker.Mock(spec=WebClient)
    adapter = _adapter(mocker, client)

    result = adapter.dynamic_card_messaging.replace_with_static(
        MessageLocator("invalid."),
        StaticCardIntent("Sanitized static content"),
    )

    assert isinstance(result, ReplacementError)
    assert result.kind is ReplacementErrorKind.INVALID_REFERENCE
    client.auth_test.assert_not_called()
    client.chat_update.assert_not_called()


def test_static_replacement_rejects_public_text_reference_without_mutation(mocker: MockerFixture) -> None:
    client = mocker.Mock(spec=WebClient)
    client.auth_test.return_value = _successful_auth_response()
    client.chat_postMessage.return_value = _SlackResponse(
        {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"}
    )
    adapter = _adapter(mocker, client)
    accepted = adapter.messaging.send_text(ProviderUserId("sanitized-user"), "Sanitized message")
    assert isinstance(accepted, MessageAccepted)
    client.reset_mock()
    client.chat_update.return_value = _SlackResponse({"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"})

    result = adapter.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Sanitized static content"),
    )

    assert result is None
    client.auth_test.assert_not_called()
    client.chat_update.assert_called_once()


@pytest.mark.parametrize(
    ("error_code", "expected_kind"),
    [
        ("message_not_found", ReplacementErrorKind.STALE_REFERENCE),
        ("internal_error", ReplacementErrorKind.UNKNOWN),
    ],
)
def test_static_replacement_maps_provider_failures_without_replay(
    mocker: MockerFixture,
    error_code: str,
    expected_kind: ReplacementErrorKind,
) -> None:
    first_client = mocker.Mock(spec=WebClient)
    first_client.auth_test.return_value = _successful_auth_response()
    first_client.chat_postMessage.return_value = _SlackResponse(
        {"ok": True, "channel": "sanitized-channel", "ts": "1000.000001"}
    )
    adapter = _adapter(mocker, first_client)
    accepted = adapter.dynamic_card_messaging.send_card(
        ProviderUserId("sanitized-user"),
        _card_intent(),
        CorrelationToken("sanitized-correlation"),
    )
    assert isinstance(accepted, MessageAccepted)
    first_client.chat_update.side_effect = SlackApiError(
        "sanitized-provider-error",
        response=_SlackResponse({"ok": False, "error": error_code}),
    )

    result = adapter.dynamic_card_messaging.replace_with_static(
        accepted.locator,
        StaticCardIntent("Sanitized static content"),
    )

    assert isinstance(result, ReplacementError)
    assert result.kind is expected_kind
    first_client.chat_update.assert_called_once()
    assert "sanitized-provider-error" not in result.reason


def test_webhook_rejects_authenticated_non_post_requests_before_parsing(mocker: MockerFixture) -> None:
    consumer = _RecordingConsumer()
    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(consumer)
    body = json.dumps({"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}).encode()
    signed = _signed_request(body, received_at=datetime(2026, 8, 6, 8, tzinfo=UTC))
    request = WebhookRequest(
        method="GET",
        headers=signed.headers,
        body=signed.body,
        received_at=signed.received_at,
    )

    response = handler.handle(request)

    assert response.status_code == 405
    assert consumer.events == []


@pytest.mark.parametrize(
    ("body", "content_type", "expected_status", "expected_events"),
    [
        (b"not-json", "application/json", 400, 0),
        (b"payload=not-json", "application/x-www-form-urlencoded", 400, 0),
        (b"payload=%7B%7D&payload=%7B%7D", "application/x-www-form-urlencoded", 400, 0),
        (b"payload=%5B%5D", "application/x-www-form-urlencoded", 400, 0),
        (json.dumps({"type": "url_verification", "challenge": 1}).encode(), "application/json", 400, 0),
        (
            json.dumps({"type": "event_callback", "event": {"type": "message"}}).encode(),
            "application/json",
            400,
            0,
        ),
        (
            urlencode(
                {
                    "payload": json.dumps(
                        {
                            "type": "block_actions",
                            "team": {"id": "sanitized-team"},
                            "actions": [],
                        }
                    )
                }
            ).encode(),
            "application/x-www-form-urlencoded; charset=utf-8",
            200,
            1,
        ),
    ],
    ids=(
        "malformed-json",
        "malformed-payload-json",
        "duplicate-form-payload",
        "non-object-payload",
        "invalid-challenge",
        "missing-tenant",
        "valid-form-payload",
    ),
)
def test_webhook_parsing_fails_closed_without_partial_consumption(
    mocker: MockerFixture,
    body: bytes,
    content_type: str,
    expected_status: int,
    expected_events: int,
) -> None:
    consumer = _RecordingConsumer()
    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(consumer)

    response = handler.handle(_signed_request(body, content_type=content_type))

    assert response.status_code == expected_status
    assert len(consumer.events) == expected_events


@pytest.mark.parametrize(
    ("body", "content_type"),
    [
        (
            json.dumps({"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}).encode(),
            "application/x-www-form-urlencoded",
        ),
        (
            urlencode(
                {"payload": json.dumps({"type": "block_actions", "team": {"id": "sanitized-team"}, "actions": []})}
            ).encode(),
            "application/json",
        ),
        (
            json.dumps({"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}).encode(),
            "text/plain",
        ),
    ],
    ids=("json-as-form", "form-as-json", "unsupported-media-type"),
)
def test_webhook_dispatches_body_parser_only_by_content_type(
    mocker: MockerFixture,
    body: bytes,
    content_type: str,
) -> None:
    consumer = _RecordingConsumer()
    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(consumer)

    response = handler.handle(_signed_request(body, content_type=content_type))

    assert response.status_code == 400
    assert consumer.events == []


def test_webhook_rejects_missing_or_duplicate_content_type(mocker: MockerFixture) -> None:
    consumer = _RecordingConsumer()
    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(consumer)
    body = json.dumps({"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}).encode()
    missing = _signed_request(body, content_type=None)
    duplicate = _signed_request(body)
    duplicate = WebhookRequest(
        method=duplicate.method,
        headers=(*duplicate.headers, ("content-type", "application/json")),
        body=duplicate.body,
        received_at=duplicate.received_at,
    )

    missing_response = handler.handle(missing)
    duplicate_response = handler.handle(duplicate)

    assert missing_response.status_code == 400
    assert duplicate_response.status_code == 400
    assert consumer.events == []


@pytest.mark.parametrize(
    "verification_failure",
    [ValueError("sanitized verifier value details"), RuntimeError("sanitized verifier runtime details")],
    ids=("expected-sdk-failure", "unexpected-sdk-failure"),
)
def test_webhook_signature_verifier_failures_are_safe_and_unauthenticated(
    mocker: MockerFixture,
    caplog: pytest.LogCaptureFixture,
    verification_failure: Exception,
) -> None:
    consumer = _RecordingConsumer()
    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(consumer)
    verifier = mocker.Mock()
    verifier.is_valid.side_effect = verification_failure
    mocker.patch.object(slack_adapter_module, "SignatureVerifier", return_value=verifier)
    body = json.dumps({"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}).encode()

    with caplog.at_level(logging.ERROR, logger=slack_adapter_module.__name__):
        response = handler.handle(_signed_request(body))

    assert response.status_code == 401
    assert consumer.events == []
    assert "sanitized verifier" not in caplog.text


def test_webhook_rejects_duplicate_verification_headers_before_consuming(mocker: MockerFixture) -> None:
    consumer = _RecordingConsumer()
    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(consumer)
    body = json.dumps({"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}).encode()
    request = _signed_request(body)
    request = WebhookRequest(
        method=request.method,
        headers=(*request.headers, ("x-slack-signature", "sanitized-duplicate")),
        body=request.body,
        received_at=request.received_at,
    )

    response = handler.handle(request)

    assert response.status_code == 401
    assert consumer.events == []


def test_webhook_freshness_treats_trusted_naive_receive_time_as_utc(mocker: MockerFixture) -> None:
    consumer = _RecordingConsumer()
    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(consumer)
    body = json.dumps({"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}).encode()
    received_at = datetime.now(tz=UTC).replace(tzinfo=None)

    response = handler.handle(_signed_request(body, received_at=received_at))

    assert response.status_code == 200
    assert len(consumer.events) == 1


@pytest.mark.parametrize(
    ("case", "timestamp_delta", "signing_secret", "tamper_body", "expected_status"),
    [
        ("valid", 0, _SIGNING_SECRET, False, 200),
        ("body-tamper", 0, _SIGNING_SECRET, True, 401),
        ("wrong-material", 0, "sanitized-wrong-signing-material", False, 401),
        ("past-boundary", -300, _SIGNING_SECRET, False, 200),
        ("future-boundary", 300, _SIGNING_SECRET, False, 200),
        ("stale", -301, _SIGNING_SECRET, False, 401),
        ("future", 301, _SIGNING_SECRET, False, 401),
    ],
    ids=("valid", "body-tamper", "wrong-material", "past-boundary", "future-boundary", "stale", "future"),
)
def test_sanitized_signed_webhook_structure_obeys_sdk_verification_boundaries(
    mocker: MockerFixture,
    case: str,
    timestamp_delta: int,
    signing_secret: str,
    tamper_body: bool,
    expected_status: int,
) -> None:
    del case
    consumer = _RecordingConsumer()
    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(consumer)
    signed_body = json.dumps(
        {
            "type": "event_callback",
            "team_id": "sanitized-team",
            "event_id": "sanitized-event",
            "event_time": 1786003200,
            "event": {
                "type": "message",
                "text": "Sanitized content",
                "metadata": {"nested": [1, True, None]},
            },
        },
        separators=(",", ":"),
    ).encode()
    request_body = signed_body + b" " if tamper_body else signed_body
    received_at = datetime(2026, 8, 6, 8)
    received_timestamp = int(received_at.replace(tzinfo=UTC).timestamp())
    request = _signed_request(
        request_body,
        received_at=received_at,
        timestamp_seconds=received_timestamp + timestamp_delta,
        signing_secret=signing_secret,
        signature_body=signed_body,
    )

    response = handler.handle(request)

    assert response.status_code == expected_status
    assert len(consumer.events) == (1 if expected_status == 200 else 0)


def test_webhook_replay_within_freshness_window_remains_consumer_owned(mocker: MockerFixture) -> None:
    consumer = _RecordingConsumer()
    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(consumer)
    body = json.dumps(
        {
            "type": "event_callback",
            "team_id": "sanitized-team",
            "event_id": "sanitized-replayed-event",
            "event": {"type": "message"},
        },
        separators=(",", ":"),
    ).encode()
    request = _signed_request(body)

    first_response = handler.handle(request)
    second_response = handler.handle(request)

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert [event.event_id for event in consumer.events] == [
        "sanitized-replayed-event",
        "sanitized-replayed-event",
    ]


def test_webhook_handler_supports_overlapping_calls_with_independent_responses(mocker: MockerFixture) -> None:
    overlap_barrier = threading.Barrier(2)
    state_lock = threading.Lock()
    consumed_event_ids: list[str | None] = []
    active_calls = 0
    maximum_active_calls = 0

    class _OverlappingConsumer:
        def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
            nonlocal active_calls, maximum_active_calls
            with state_lock:
                active_calls += 1
                maximum_active_calls = max(maximum_active_calls, active_calls)
                consumed_event_ids.append(event.event_id)
            try:
                overlap_barrier.wait(timeout=2)
                if event.event_id == "sanitized-accepted-event":
                    return EventAcceptance.ACCEPTED
                return EventAcceptance.NOT_ACCEPTED
            finally:
                with state_lock:
                    active_calls -= 1

    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(_OverlappingConsumer())
    requests = {
        "accepted": _signed_request(
            json.dumps(
                {
                    "type": "event_callback",
                    "team_id": "sanitized-team",
                    "event_id": "sanitized-accepted-event",
                    "event": {"type": "message"},
                },
                separators=(",", ":"),
            ).encode()
        ),
        "not_accepted": _signed_request(
            json.dumps(
                {
                    "type": "event_callback",
                    "team_id": "sanitized-team",
                    "event_id": "sanitized-not-accepted-event",
                    "event": {"type": "message"},
                },
                separators=(",", ":"),
            ).encode()
        ),
    }
    responses: dict[str, int] = {}
    failures: list[BaseException] = []

    def _invoke(name: str) -> None:
        try:
            responses[name] = handler.handle(requests[name]).status_code
        except BaseException as error:
            failures.append(error)

    threads = [threading.Thread(target=_invoke, args=(name,)) for name in requests]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(2)

    assert all(not thread.is_alive() for thread in threads)
    assert failures == []
    assert maximum_active_calls == 2
    assert responses == {"accepted": 200, "not_accepted": 503}
    assert len(consumed_event_ids) == 2
    assert "sanitized-accepted-event" in consumed_event_ids
    assert "sanitized-not-accepted-event" in consumed_event_ids


def test_webhook_without_confirmed_event_identity_does_not_synthesize_facts(mocker: MockerFixture) -> None:
    consumer = _RecordingConsumer()
    handler = _adapter(mocker, mocker.Mock(spec=WebClient)).create_webhook_handler(consumer)
    body = json.dumps(
        {
            "type": "event_callback",
            "team_id": "sanitized-team",
            "event": {"type": "message", "nested": [1, None, {"preserved": True}]},
        }
    ).encode()

    response = handler.handle(_signed_request(body))

    assert response.status_code == 200
    assert len(consumer.events) == 1
    event = consumer.events[0]
    assert event.event_id is None
    assert event.occurred_at is None
    assert json.loads(event.payload) == json.loads(body)


def test_webhook_handler_remains_usable_after_root_close(mocker: MockerFixture) -> None:
    consumer = _RecordingConsumer()
    adapter = _adapter(mocker, mocker.Mock(spec=WebClient))
    handler = adapter.create_webhook_handler(consumer)
    adapter.close()
    adapter.close()
    body = json.dumps({"type": "event_callback", "team_id": "sanitized-team", "event": {"type": "message"}}).encode()

    response = handler.handle(_signed_request(body))

    assert response.status_code == 200
    assert len(consumer.events) == 1


def test_socket_control_frames_and_not_accepted_business_events_are_not_acked(mocker: MockerFixture) -> None:
    consumer = _RecordingConsumer(EventAcceptance.NOT_ACCEPTED)
    control = SocketModeRequest(type="hello", envelope_id="sanitized-control", payload={})
    business = SocketModeRequest(
        type="events_api",
        envelope_id="sanitized-business",
        payload={"team_id": "sanitized-team", "event": {"type": "message"}},
    )

    class _FakeSocketModeClient:
        instances: list[_FakeSocketModeClient] = []

        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []
            self.responses: list[object] = []
            self.closed = False
            self.__class__.instances.append(self)

        def connect(self) -> None:
            listener = self.socket_mode_request_listeners[0]
            listener(self, control)
            listener(self, business)

        def send_socket_mode_response(self, response: object) -> None:
            self.responses.append(response)

        def close(self) -> None:
            self.closed = True

    mocker.patch.object(slack_adapter_module, "SocketModeClient", _FakeSocketModeClient)
    stream = _adapter(mocker, mocker.Mock(spec=WebClient)).create_stream_handler(consumer)

    stream.start()

    socket_client = _FakeSocketModeClient.instances[0]
    assert socket_client.kwargs["app_token"] == "xapp-sanitized-placeholder"
    assert socket_client.responses == []
    assert socket_client.closed is False
    assert len(consumer.events) == 1

    stream.stop()

    assert socket_client.closed is True


def test_socket_stop_before_start_opens_no_connection_and_consumes_one_shot(mocker: MockerFixture) -> None:
    socket_client = mocker.patch.object(slack_adapter_module, "SocketModeClient")
    stream = _adapter(mocker, mocker.Mock(spec=WebClient)).create_stream_handler(_RecordingConsumer())

    stream.stop()
    stream.stop()

    socket_client.assert_not_called()
    with pytest.raises(IMStreamStartError):
        stream.start()
    socket_client.assert_not_called()


@pytest.mark.parametrize("disconnect_kind", ["error", "close"])
def test_socket_remote_disconnect_is_observable_without_adapter_lifecycle_transition(
    mocker: MockerFixture,
    caplog: pytest.LogCaptureFixture,
    disconnect_kind: str,
) -> None:
    sensitive_marker = f"sanitized-sensitive-remote-{disconnect_kind}"
    request = SocketModeRequest(
        type="events_api",
        envelope_id="sanitized-business",
        payload={"team_id": "sanitized-team", "event": {"type": "message"}},
    )
    consumer = _RecordingConsumer()

    class _ListenerSocketModeClient:
        instance: _ListenerSocketModeClient | None = None

        def __init__(
            self,
            *,
            on_error_listeners: list[Callable[[Exception], None]],
            on_close_listeners: list[Callable[[int, str | None], None]],
            **kwargs: object,
        ) -> None:
            del kwargs
            self.on_error_listeners = on_error_listeners
            self.on_close_listeners = on_close_listeners
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []
            self.responses: list[object] = []
            self.closed = False
            self.__class__.instance = self

        def connect(self) -> None:
            return None

        def send_socket_mode_response(self, response: object) -> None:
            self.responses.append(response)

        def close(self) -> None:
            self.closed = True

    mocker.patch.object(slack_adapter_module, "SocketModeClient", _ListenerSocketModeClient)
    stream = _adapter(mocker, mocker.Mock(spec=WebClient)).create_stream_handler(consumer)

    with caplog.at_level(logging.ERROR, logger=slack_adapter_module.__name__):
        stream.start()
        socket_client = _ListenerSocketModeClient.instance
        assert socket_client is not None
        if disconnect_kind == "error":
            socket_client.on_error_listeners[0](RuntimeError(sensitive_marker))
        else:
            socket_client.on_close_listeners[0](1006, sensitive_marker)
        socket_client.socket_mode_request_listeners[0](socket_client, request)
        stream.stop()

    socket_client = _ListenerSocketModeClient.instance
    assert socket_client is not None
    assert socket_client.closed is True
    assert len(socket_client.responses) == 1
    assert len(consumer.events) == 1
    assert sensitive_marker not in caplog.text


def test_socket_close_listener_after_local_stop_is_normal_and_redacted(
    mocker: MockerFixture,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sensitive_marker = "sanitized-sensitive-local-close"

    class _LocallyClosedSocketModeClient:
        instance: _LocallyClosedSocketModeClient | None = None

        def __init__(
            self,
            *,
            on_close_listeners: list[Callable[[int, str | None], None]],
            **kwargs: object,
        ) -> None:
            del kwargs
            self.on_close_listeners = on_close_listeners
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []
            self.closed = False
            self.__class__.instance = self

        def connect(self) -> None:
            return None

        def close(self) -> None:
            self.closed = True
            self.on_close_listeners[0](1000, sensitive_marker)

    mocker.patch.object(slack_adapter_module, "SocketModeClient", _LocallyClosedSocketModeClient)
    stream = _adapter(mocker, mocker.Mock(spec=WebClient)).create_stream_handler(_RecordingConsumer())

    with caplog.at_level(logging.ERROR, logger=slack_adapter_module.__name__):
        stream.start()
        stream.stop()

    socket_client = _LocallyClosedSocketModeClient.instance
    assert socket_client is not None
    assert socket_client.closed is True
    assert sensitive_marker not in caplog.text


def test_socket_connect_failure_is_normalized_and_cleans_up_partial_resources(
    mocker: MockerFixture,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sensitive_marker = "sanitized-sensitive-connect-failure"

    class _FailingSocketModeClient:
        instance: _FailingSocketModeClient | None = None

        def __init__(self, **kwargs: object) -> None:
            del kwargs
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []
            self.connect_calls = 0
            self.closed = False
            self.__class__.instance = self

        def connect(self) -> None:
            self.connect_calls += 1
            raise SlackClientError(sensitive_marker)

        def close(self) -> None:
            self.closed = True

    mocker.patch.object(slack_adapter_module, "SocketModeClient", _FailingSocketModeClient)
    stream = _adapter(mocker, mocker.Mock(spec=WebClient)).create_stream_handler(_RecordingConsumer())

    with caplog.at_level(logging.ERROR, logger=slack_adapter_module.__name__):
        with pytest.raises(IMStreamStartError) as raised:
            stream.start()
        stream.stop()

    socket_client = _FailingSocketModeClient.instance
    assert socket_client is not None
    assert socket_client.connect_calls == 1
    assert socket_client.closed is True
    assert sensitive_marker not in str(raised.value)
    assert sensitive_marker not in caplog.text


def test_socket_stop_delegates_to_sdk_without_waiting_for_inflight_consumer(mocker: MockerFixture) -> None:
    consumer_started = threading.Event()
    release_consumer = threading.Event()
    stop_finished = threading.Event()
    request = SocketModeRequest(
        type="events_api",
        envelope_id="sanitized-business",
        payload={"team_id": "sanitized-team", "event": {"type": "message"}},
    )

    class _BlockingConsumer:
        def __init__(self) -> None:
            self.calls = 0

        def accept(self, event: object) -> EventAcceptance:
            del event
            self.calls += 1
            consumer_started.set()
            assert release_consumer.wait(2)
            return EventAcceptance.ACCEPTED

    consumer = _BlockingConsumer()

    class _FakeSocketModeClient:
        instance: _FakeSocketModeClient | None = None

        def __init__(self, **kwargs: object) -> None:
            del kwargs
            self.socket_mode_request_listeners: list[Callable[[object, SocketModeRequest], None]] = []
            self.responses: list[object] = []
            self.closed = False
            self.callback_thread: threading.Thread | None = None
            self.__class__.instance = self

        def connect(self) -> None:
            listener = self.socket_mode_request_listeners[0]
            self.callback_thread = threading.Thread(target=listener, args=(self, request))
            self.callback_thread.start()

        def send_socket_mode_response(self, response: object) -> None:
            self.responses.append(response)

        def close(self) -> None:
            self.closed = True

    mocker.patch.object(slack_adapter_module, "SocketModeClient", _FakeSocketModeClient)
    adapter = _adapter(mocker, mocker.Mock(spec=WebClient))
    stream = adapter.create_stream_handler(consumer)

    stream.start()
    assert consumer_started.wait(2)
    adapter.close()

    def _stop() -> None:
        stream.stop()
        stop_finished.set()

    stop_thread = threading.Thread(target=_stop)
    stop_thread.start()

    assert stop_finished.wait(2)
    socket_client = _FakeSocketModeClient.instance
    assert socket_client is not None
    assert socket_client.closed is True

    release_consumer.set()
    stop_thread.join(2)
    assert socket_client.callback_thread is not None
    socket_client.callback_thread.join(2)

    assert not stop_thread.is_alive()
    assert not socket_client.callback_thread.is_alive()
    assert stop_finished.is_set()
    assert socket_client.closed is True
    assert len(socket_client.responses) == 1
    assert consumer.calls == 1
