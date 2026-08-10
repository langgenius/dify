"""Concrete Slack adapter for Provider-neutral Human Input IM contracts.

The root and its ordinary capabilities rely on the contract's external
serialization rule and intentionally contain no synchronization. Socket Mode
delegates connection concurrency and resource shutdown to the Slack SDK.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import Message
from typing import Literal, override
from urllib.parse import parse_qs

from slack_sdk.errors import SlackApiError, SlackClientError
from slack_sdk.models.blocks import MarkdownBlock
from slack_sdk.signature import Clock, SignatureVerifier
from slack_sdk.socket_mode import SocketModeClient
from slack_sdk.socket_mode.client import BaseSocketModeClient
from slack_sdk.socket_mode.request import SocketModeRequest
from slack_sdk.socket_mode.response import SocketModeResponse
from slack_sdk.web import WebClient
from slack_sdk.web.slack_response import SlackResponse

from core.human_input import ButtonStyle
from core.human_input_v2 import FileInput, FileListInput, MarkdownText, ParagraphInput, ResolvedForm, SelectInput
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CardAssessment,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    DynamicCardMessagingError,
    EventAcceptance,
    IMDirectory,
    IMDynamicCardMessaging,
    IMEventConsumer,
    IMEventStream,
    IMMessaging,
    IMStreamStartError,
    IMStreamStopError,
    IMWebhookHandler,
    MessageAccepted,
    MessageReference,
    MessageSendingError,
    MessageSendingResult,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    SlackIMIntegrationCredentials,
    StaticCardIntent,
    WebhookRequest,
    WebhookResponse,
)

logger = logging.getLogger(__name__)
_SLACK_SOCKET_SDK_LOGGER = logging.Logger(f"{__name__}.socket_sdk")
_SLACK_SOCKET_SDK_LOGGER.addHandler(logging.NullHandler())
_SLACK_SOCKET_SDK_LOGGER.propagate = False

_SLACK_DIRECTORY_PAGE_SIZE = 200
_SLACKBOT_USER_ID = "USLACKBOT"
_SOCKET_WEB_API_TIMEOUT_SECONDS = 5
_MAX_MARKDOWN_TEXT_LENGTH = MarkdownBlock.text_max_length
_MAX_HEADER_TEXT_LENGTH = 150
_MAX_BLOCK_COUNT = 50
_MAX_ACTION_COUNT = 25
_MAX_ACTION_ID_LENGTH = 255
_MAX_ACTION_TEXT_LENGTH = 75
_MAX_ACTION_VALUE_LENGTH = 2000
_MAX_INPUT_LABEL_LENGTH = 2000
_MAX_INPUT_INITIAL_VALUE_LENGTH = 3000
_MAX_RADIO_OPTION_COUNT = 10
_MAX_RADIO_OPTION_TEXT_LENGTH = 75
_MAX_RADIO_OPTION_VALUE_LENGTH = 150
_SLACK_MESSAGE_TIMESTAMP = re.compile(r"^[0-9]+\.[0-9]+$")
_JSON_CONTENT_TYPE = "application/json"
_FORM_CONTENT_TYPE = "application/x-www-form-urlencoded"
_BASELINE_BOT_SCOPES = frozenset(("chat:write", "users:read", "users:read.email"))
_AUTHENTICATION_ERROR_CODES = frozenset(
    (
        "account_inactive",
        "invalid_auth",
        "not_authed",
        "token_expired",
        "token_revoked",
    )
)
_STALE_MESSAGE_ERROR_CODES = frozenset(
    (
        "cant_update_message",
        "channel_not_found",
        "edit_window_closed",
        "message_not_found",
    )
)
_BUSINESS_SOCKET_REQUEST_TYPES = frozenset(("events_api", "interactive", "slash_commands"))


def _log_safe_error(message: str, *, extra: Mapping[str, object] | None = None) -> None:
    """Record a static diagnostic without serializing the active exception."""

    logger.error(message, extra=extra)


@dataclass(frozen=True, slots=True)
class _SlackMessageLocator(MessageReference):
    message_kind: Literal["text", "dynamic_card"]
    channel_id: str
    message_ts: str


class _TrustedReceiveTimeClock(Clock):
    """SDK clock fixed to the framework's trusted UTC receive time."""

    def __init__(self, received_at: datetime) -> None:
        if received_at.tzinfo is None:
            received_at = received_at.replace(tzinfo=UTC)
        else:
            received_at = received_at.astimezone(UTC)
        self._received_timestamp = received_at.timestamp()

    @override
    def now(self) -> float:
        return self._received_timestamp


@dataclass(frozen=True, slots=True)
class _SlackDirectoryPagination:
    next_cursor: str | None


class _SlackDirectory(IMDirectory):
    def __init__(self, client: WebClient) -> None:
        self._client = client

    @override
    def read_directory(self) -> Directory | DirectoryReadFailure:
        entries: list[DirectoryEntry] = []
        cursor: str | None = None
        seen_cursors: set[str] = set()
        try:
            while True:
                if cursor is None:
                    response = self._client.users_list(limit=_SLACK_DIRECTORY_PAGE_SIZE)
                else:
                    response = self._client.users_list(limit=_SLACK_DIRECTORY_PAGE_SIZE, cursor=cursor)
                members = response.get("members")
                if not isinstance(members, Sequence) or isinstance(members, (str, bytes, bytearray)):
                    return DirectoryReadFailure("Slack returned an incomplete directory response.")
                page_entries = self._directory_entries(members)
                if page_entries is None:
                    return DirectoryReadFailure("Slack returned an invalid directory entry.")
                pagination = self._pagination(response.get("response_metadata"))
                if pagination is None:
                    return DirectoryReadFailure("Slack returned invalid directory pagination.")
                next_cursor = pagination.next_cursor
                if next_cursor is not None and next_cursor in seen_cursors:
                    return DirectoryReadFailure("Slack returned invalid directory pagination.")
                entries.extend(page_entries)
                if next_cursor is None:
                    return Directory(tuple(entries))
                seen_cursors.add(next_cursor)
                cursor = next_cursor
        except SlackClientError:
            return DirectoryReadFailure("Slack directory could not be read completely.")

    @staticmethod
    def _directory_entries(members: Sequence[object]) -> tuple[DirectoryEntry, ...] | None:
        entries: list[DirectoryEntry] = []
        for member in members:
            if not isinstance(member, Mapping):
                return None
            provider_user_id = member.get("id")
            if (
                member.get("deleted") is True
                or member.get("is_bot") is True
                or member.get("is_app_user") is True
                or provider_user_id == _SLACKBOT_USER_ID
            ):
                continue
            if not isinstance(provider_user_id, str) or not provider_user_id:
                return None
            profile = member.get("profile")
            if not isinstance(profile, Mapping):
                profile = {}
            display_name = _first_non_empty_string(
                profile.get("display_name_normalized"),
                profile.get("real_name_normalized"),
            )
            email = _optional_non_empty_string(profile.get("email"))
            entries.append(DirectoryEntry(ProviderUserId(provider_user_id), display_name, email))
        return tuple(entries)

    @staticmethod
    def _pagination(response_metadata: object) -> _SlackDirectoryPagination | None:
        if not isinstance(response_metadata, Mapping) or "next_cursor" not in response_metadata:
            return None
        next_cursor = response_metadata.get("next_cursor")
        if not isinstance(next_cursor, str):
            return None
        return _SlackDirectoryPagination(next_cursor or None)


class _SlackMessaging(IMMessaging):
    def __init__(self, client: WebClient) -> None:
        self._client = client

    @override
    def send_text(self, provider_user_id: ProviderUserId, body: str) -> MessageSendingResult:
        try:
            response = self._client.chat_postMessage(
                channel=str(provider_user_id),
                markdown_text=body,
            )
        except SlackClientError:
            return MessageSendingError("Slack message acceptance could not be confirmed.")
        return _accepted_message(response, "text")


class _SlackDynamicCardMessaging(IMDynamicCardMessaging):
    def __init__(self, client: WebClient) -> None:
        self._client = client

    @override
    def assess(self, intent: ResolvedForm) -> CardAssessment:
        reason = _card_unrepresentable_reason(intent)
        if reason is not None:
            return CardAssessment(False, reason)
        return CardAssessment(True)

    @override
    def send_card(
        self,
        provider_user_id: ProviderUserId,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> MessageSendingResult:
        reason = _card_unrepresentable_reason(intent)
        if reason is not None:
            raise DynamicCardMessagingError(reason)
        blocks = _render_card_blocks(intent, correlation_token)
        try:
            response = self._client.chat_postMessage(
                channel=str(provider_user_id),
                text=_card_summary(intent),
                blocks=blocks,
            )
        except SlackClientError:
            return MessageSendingError("Slack card acceptance could not be confirmed.")
        return _accepted_message(response, "dynamic_card")

    @override
    def replace_with_static(
        self,
        reference: MessageReference,
        intent: StaticCardIntent,
    ) -> ReplacementError | None:
        if not isinstance(reference, _SlackMessageLocator) or reference.message_kind != "dynamic_card":
            return ReplacementError(ReplacementErrorKind.INVALID_REFERENCE, "The Slack message reference is invalid.")
        locator = reference
        try:
            response = self._client.chat_update(
                channel=locator.channel_id,
                ts=locator.message_ts,
                text=intent.rendered_content,
                blocks=[],
            )
        except SlackApiError as error:
            error_code = _slack_error_code(error)
            if error_code in _STALE_MESSAGE_ERROR_CODES:
                return ReplacementError(
                    ReplacementErrorKind.STALE_REFERENCE,
                    "The referenced Slack card is no longer replaceable.",
                )
            return ReplacementError(ReplacementErrorKind.UNKNOWN, "Slack replacement acceptance is unknown.")
        except SlackClientError:
            return ReplacementError(ReplacementErrorKind.UNKNOWN, "Slack replacement acceptance is unknown.")
        if response.get("ok") is not True:
            return ReplacementError(ReplacementErrorKind.UNKNOWN, "Slack replacement acceptance is unknown.")
        return None


class _SlackWebhookHandler(IMWebhookHandler):
    def __init__(self, signing_secret: str, consumer: IMEventConsumer) -> None:
        self._signing_secret = signing_secret
        self._consumer = consumer

    @override
    def handle(self, request: WebhookRequest) -> WebhookResponse:
        if not self._authenticated(request):
            return _webhook_response(401, b"request authentication failed")
        if request.method != "POST":
            return _webhook_response(405, b"method not allowed")
        body = self._decoded_body(request)
        if body is None:
            return _webhook_response(400, b"invalid Slack request")
        if body.get("type") == "url_verification":
            challenge = body.get("challenge")
            if not isinstance(challenge, str):
                return _webhook_response(400, b"invalid Slack challenge")
            response_body = json.dumps({"challenge": challenge}, separators=(",", ":")).encode()
            return WebhookResponse(200, (("Content-Type", "application/json"),), response_body)
        event = _authenticated_event(body, request.received_at)
        if event is None:
            return _webhook_response(400, b"invalid Slack event")
        try:
            acceptance = self._consumer.accept(event)
        except Exception:
            _log_safe_error(
                "Slack Webhook consumer failed",
                extra={"provider_tenant_id": event.provider_tenant_id},
            )
            return _webhook_response(503, b"event processing failed")
        if acceptance is EventAcceptance.ACCEPTED:
            return _webhook_response(200, b"")
        return _webhook_response(503, b"event not accepted")

    def _authenticated(self, request: WebhookRequest) -> bool:
        timestamps = _header_values(request.headers, "x-slack-request-timestamp")
        signatures = _header_values(request.headers, "x-slack-signature")
        if len(timestamps) != 1 or len(signatures) != 1:
            return False
        try:
            verifier = SignatureVerifier(
                self._signing_secret,
                clock=_TrustedReceiveTimeClock(request.received_at),
            )
            return verifier.is_valid(
                body=request.body,
                timestamp=timestamps[0],
                signature=signatures[0],
            )
        except (UnicodeDecodeError, ValueError):
            return False
        except Exception:
            _log_safe_error("Unexpected Slack Webhook signature verification failure")
            return False

    @staticmethod
    def _decoded_body(request: WebhookRequest) -> dict[str, object] | None:
        content_type = _parse_content_type(request.headers)
        if content_type == _JSON_CONTENT_TYPE:
            try:
                decoded = json.loads(request.body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                return None
        elif content_type == _FORM_CONTENT_TYPE:
            try:
                form_values = parse_qs(request.body.decode("utf-8"), strict_parsing=True)
            except (UnicodeDecodeError, ValueError):
                return None
            payload_values = form_values.get("payload")
            if payload_values is None or len(payload_values) != 1:
                return None
            try:
                decoded = json.loads(payload_values[0])
            except json.JSONDecodeError:
                return None
        else:
            return None
        if not isinstance(decoded, dict) or any(not isinstance(key, str) for key in decoded):
            return None
        return decoded


class _SlackEventStream(IMEventStream):
    """One owner-managed Socket Mode client with a one-shot lifecycle."""

    def __init__(
        self,
        *,
        app_token: str,
        bot_token: str,
        consumer: IMEventConsumer,
    ) -> None:
        self._app_token = app_token
        self._bot_token = bot_token
        self._consumer = consumer
        self._client: BaseSocketModeClient | None = None
        self._start_attempted = False
        self._stop_requested = False
        self._stopped = False

    @override
    def start(self) -> None:
        if self._start_attempted or self._stopped:
            raise IMStreamStartError("This Slack event stream has already been started or stopped.")
        self._start_attempted = True

        client: BaseSocketModeClient | None = None
        try:
            web_client = WebClient(
                token=self._bot_token,
                timeout=_SOCKET_WEB_API_TIMEOUT_SECONDS,
                retry_handlers=[],
            )
            client = SocketModeClient(
                app_token=self._app_token,
                logger=_SLACK_SOCKET_SDK_LOGGER,
                web_client=web_client,
                on_error_listeners=[self._handle_socket_error],
                on_close_listeners=[self._handle_socket_close],
            )
            client.socket_mode_request_listeners.append(self._handle_request)
            self._client = client
            client.connect()
        except SlackClientError:
            self._clean_up_failed_start(client)
            raise IMStreamStartError("The Slack event stream could not be started.") from None
        except Exception:
            _log_safe_error("Unexpected Slack Socket Mode startup failure")
            self._clean_up_failed_start(client)
            raise IMStreamStartError("The Slack event stream could not be started.") from None

    @override
    def stop(self) -> None:
        if self._stopped:
            return
        self._stop_requested = True
        client = self._client

        if client is None:
            self._stopped = True
            return

        try:
            client.close()
        except SlackClientError:
            _log_safe_error("Slack Socket Mode shutdown failure")
            raise IMStreamStopError("The Slack event stream could not be stopped.") from None
        except Exception:
            _log_safe_error("Unexpected Slack Socket Mode shutdown failure")
            raise IMStreamStopError("The Slack event stream could not be stopped.") from None

        self._client = None
        self._stopped = True

    def _clean_up_failed_start(self, client: BaseSocketModeClient | None) -> None:
        if client is None:
            return

        self._stop_requested = True
        try:
            client.close()
        except SlackClientError:
            _log_safe_error("Slack Socket Mode startup cleanup failure")
        except Exception:
            _log_safe_error("Unexpected Slack Socket Mode startup cleanup failure")
        else:
            self._client = None

    def _handle_socket_error(self, error: Exception) -> None:
        del error
        self._handle_remote_disconnect("Slack Socket Mode remote error")

    def _handle_socket_close(self, code: int, reason: str | None = None) -> None:
        del code, reason
        self._handle_remote_disconnect("Slack Socket Mode remote close")

    def _handle_remote_disconnect(self, log_message: str) -> None:
        if self._stop_requested:
            return
        _log_safe_error(log_message)

    def _handle_request(self, client: BaseSocketModeClient, request: SocketModeRequest) -> None:
        if request.type not in _BUSINESS_SOCKET_REQUEST_TYPES:
            return
        try:
            serialized_request = request.to_dict()
            event_body = serialized_request.get("payload")
            if not isinstance(event_body, dict):
                return
            event = _authenticated_event(
                event_body,
                datetime.now(tz=UTC).replace(tzinfo=None),
                serialized_body=serialized_request,
            )
            if event is None:
                return
            acceptance = self._consumer.accept(event)
            if acceptance is EventAcceptance.ACCEPTED:
                client.send_socket_mode_response(SocketModeResponse(envelope_id=request.envelope_id))
        except SlackClientError:
            _log_safe_error("Slack Socket Mode event delivery failure")
        except Exception:
            _log_safe_error("Unexpected Slack Socket Mode callback failure")


class SlackIMProviderAdapter:
    """Externally serialized Slack capability composition root."""

    def __init__(self, credentials: SlackIMIntegrationCredentials) -> None:
        if not isinstance(credentials, SlackIMIntegrationCredentials):
            raise TypeError("Slack adapter requires resolved Slack credentials")
        self._credentials = credentials
        self._client = WebClient(token=credentials.bot_token, retry_handlers=[])
        self._directory = _SlackDirectory(self._client)
        self._messaging = _SlackMessaging(self._client)
        self._dynamic_card_messaging = _SlackDynamicCardMessaging(self._client)
        self._closed = False

    @property
    def provider(self) -> IMProvider:
        return IMProvider.SLACK

    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure:
        try:
            response = self._client.auth_test()
        except SlackApiError as error:
            kind = (
                CredentialTestFailureKind.AUTHENTICATION_REJECTED
                if _slack_error_code(error) in _AUTHENTICATION_ERROR_CODES
                else CredentialTestFailureKind.UNKNOWN
            )
            return CredentialTestFailure(kind, "Slack rejected the credential test.")
        except SlackClientError:
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack credential testing could not be completed.",
            )
        except Exception:
            _log_safe_error("Unexpected Slack credential test failure")
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack credential testing could not be completed.",
            )

        team_id = response.get("team_id")
        if not isinstance(team_id, str) or not team_id:
            return CredentialTestFailure(
                CredentialTestFailureKind.TENANT_ID_UNAVAILABLE,
                "Slack did not provide a stable workspace identity.",
            )
        granted_scopes = _oauth_scopes(response.headers)
        if not _BASELINE_BOT_SCOPES.issubset(granted_scopes):
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack baseline permissions could not be confirmed.",
            )
        try:
            connection_response = self._client.apps_connections_open(app_token=self._credentials.app_token)
        except SlackApiError as error:
            kind = (
                CredentialTestFailureKind.AUTHENTICATION_REJECTED
                if _slack_error_code(error) in _AUTHENTICATION_ERROR_CODES
                else CredentialTestFailureKind.UNKNOWN
            )
            return CredentialTestFailure(kind, "Slack Socket Mode credentials could not be confirmed.")
        except SlackClientError:
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack Socket Mode credential testing could not be completed.",
            )
        except Exception:
            _log_safe_error("Unexpected Slack Socket Mode credential test failure")
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack credential testing could not be completed.",
            )
        connection_url = connection_response.get("url")
        if (
            connection_response.get("ok") is not True
            or not isinstance(connection_url, str)
            or not connection_url.strip()
        ):
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Slack Socket Mode credentials could not be confirmed.",
            )
        return CredentialTestSuccess(IMProvider.SLACK, team_id)

    @property
    def directory(self) -> IMDirectory:
        return self._directory

    @property
    def messaging(self) -> IMMessaging:
        return self._messaging

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging:
        return self._dynamic_card_messaging

    def create_webhook_handler(self, consumer: IMEventConsumer) -> IMWebhookHandler:
        return _SlackWebhookHandler(self._credentials.signing_secret, consumer)

    def create_stream_handler(self, consumer: IMEventConsumer) -> IMEventStream:
        return _SlackEventStream(
            app_token=self._credentials.app_token,
            bot_token=self._credentials.bot_token,
            consumer=consumer,
        )

    def close(self) -> None:
        self._closed = True


def _first_non_empty_string(*values: object) -> str | None:
    for value in values:
        normalized = _optional_non_empty_string(value)
        if normalized is not None:
            return normalized
    return None


def _optional_non_empty_string(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value


def _accepted_message(
    response: SlackResponse,
    message_kind: Literal["text", "dynamic_card"],
) -> MessageSendingResult:
    if response.get("ok") is not True:
        return MessageSendingError("Slack message acceptance could not be confirmed.")
    channel_id = response.get("channel")
    message_ts = response.get("ts")
    if (
        not isinstance(channel_id, str)
        or not channel_id.strip()
        or not isinstance(message_ts, str)
        or _SLACK_MESSAGE_TIMESTAMP.fullmatch(message_ts) is None
    ):
        return MessageSendingError("Slack returned no exact message reference.")
    return MessageAccepted(_SlackMessageLocator(message_kind, channel_id, message_ts))


def _card_unrepresentable_reason(intent: ResolvedForm) -> str | None:
    if not intent.blocks and not intent.user_actions:
        return "Slack cannot preserve an empty card."
    if intent.title is not None and len(intent.title) > _MAX_HEADER_TEXT_LENGTH:
        return "Slack cannot preserve the card title of this length."
    block_count = len(intent.blocks) + (1 if intent.title else 0) + (1 if intent.user_actions else 0)
    if block_count > _MAX_BLOCK_COUNT:
        return "Slack cannot preserve this number of card controls."
    if len(intent.user_actions) > _MAX_ACTION_COUNT:
        return "Slack cannot preserve this number of card actions."

    input_names: set[str] = set()
    for block in intent.blocks:
        match block:
            case MarkdownText(text=text):
                if not text or len(text) > _MAX_MARKDOWN_TEXT_LENGTH:
                    return "Slack cannot preserve one Markdown block of this length."
                continue
            case FileInput() | FileListInput():
                return "Slack cards cannot represent file inputs."
            case ParagraphInput(output_variable_name=input_name, default_value=default_value):
                if len(input_name) > _MAX_ACTION_ID_LENGTH or len(input_name) > _MAX_INPUT_LABEL_LENGTH:
                    return "Slack cannot preserve one card input identifier."
                if default_value is not None and len(default_value) > _MAX_INPUT_INITIAL_VALUE_LENGTH:
                    return "Slack cannot preserve one card input default."
            case SelectInput(output_variable_name=input_name, options=options, default_value=default_value):
                if len(input_name) > _MAX_ACTION_ID_LENGTH or len(input_name) > _MAX_INPUT_LABEL_LENGTH:
                    return "Slack cannot preserve one card input identifier."
                if not 1 <= len(options) <= _MAX_RADIO_OPTION_COUNT:
                    return "Slack cannot preserve one select input's option count."
                if any(
                    not option
                    or len(option) > _MAX_RADIO_OPTION_TEXT_LENGTH
                    or len(option) > _MAX_RADIO_OPTION_VALUE_LENGTH
                    for option in options
                ):
                    return "Slack cannot preserve one select option."
                if default_value is not None and default_value not in options:
                    return "Slack cannot preserve one select input default."
        if input_name in input_names:
            return "Slack cannot preserve duplicate card input identifiers."
        input_names.add(input_name)
    for action in intent.user_actions:
        if len(action.id) > _MAX_ACTION_ID_LENGTH or len(action.title) > _MAX_ACTION_TEXT_LENGTH:
            return "Slack cannot preserve one card action identifier or title."
        if action.button_style not in {ButtonStyle.DEFAULT, ButtonStyle.PRIMARY, ButtonStyle.ACCENT}:
            return "Slack cannot preserve one card action style."
    return None


def _render_card_blocks(
    intent: ResolvedForm,
    correlation_token: CorrelationToken,
) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    if intent.title:
        blocks.append({"type": "header", "text": {"type": "plain_text", "text": intent.title}})
    for block in intent.blocks:
        if isinstance(block, MarkdownText):
            blocks.append(MarkdownBlock(text=block.text).to_dict())
            continue
        input_name = block.output_variable_name
        input_element: dict[str, object] = {"action_id": input_name}
        if isinstance(block, ParagraphInput):
            input_element.update({"type": "plain_text_input", "multiline": True})
            if block.default_value is not None:
                input_element["initial_value"] = block.default_value
        elif isinstance(block, SelectInput):
            options = [{"text": {"type": "plain_text", "text": option}, "value": option} for option in block.options]
            input_element.update({"type": "radio_buttons", "options": options})
            if block.default_value is not None:
                input_element["initial_option"] = next(
                    option for option in options if option["value"] == block.default_value
                )
        else:
            raise DynamicCardMessagingError("Slack cards cannot represent file inputs.")
        blocks.append(
            {
                "type": "input",
                "block_id": input_name,
                "label": {"type": "plain_text", "text": input_name},
                "element": input_element,
            }
        )
    if intent.user_actions:
        action_elements: list[dict[str, object]] = []
        for action in intent.user_actions:
            action_value = json.dumps(
                {"action_id": action.id, "correlation_token": str(correlation_token)},
                sort_keys=True,
                separators=(",", ":"),
            )
            if len(action_value) > _MAX_ACTION_VALUE_LENGTH:
                raise DynamicCardMessagingError("Slack cannot preserve the correlation token.")
            action_element: dict[str, object] = {
                "type": "button",
                "action_id": action.id,
                "text": {"type": "plain_text", "text": action.title},
                "value": action_value,
            }
            if action.button_style is ButtonStyle.PRIMARY:
                action_element["style"] = "primary"
            elif action.button_style is ButtonStyle.ACCENT:
                action_element["style"] = "danger"
            action_elements.append(action_element)
        blocks.append({"type": "actions", "elements": action_elements})
    return blocks


def _card_summary(intent: ResolvedForm) -> str:
    if intent.title:
        return intent.title
    for block in intent.blocks:
        if isinstance(block, MarkdownText) and block.text.strip():
            return block.text
    return "Human input form"


def _header_values(headers: tuple[tuple[str, str], ...], target_name: str) -> tuple[str, ...]:
    return tuple(value for name, value in headers if name.casefold() == target_name)


def _parse_content_type(headers: tuple[tuple[str, str], ...]) -> str | None:
    values = _header_values(headers, "content-type")
    if len(values) != 1:
        return None
    message = Message()
    message["Content-Type"] = values[0]
    return message.get_content_type()


def _webhook_response(status_code: int, body: bytes) -> WebhookResponse:
    return WebhookResponse(status_code, (("Content-Type", "text/plain; charset=utf-8"),), body)


def _authenticated_event(
    body: Mapping[str, object],
    received_at: datetime,
    *,
    serialized_body: Mapping[str, object] | None = None,
) -> AuthenticatedIMEvent | None:
    provider_tenant_id = _provider_tenant_id(body)
    if provider_tenant_id is None:
        return None
    inner_event = body.get("event")
    event_type = None
    if isinstance(inner_event, Mapping):
        event_type = _optional_non_empty_string(inner_event.get("type"))
    if event_type is None:
        event_type = _optional_non_empty_string(body.get("type"))
    event_id = _optional_non_empty_string(body.get("event_id"))
    occurred_at = None
    event_time = body.get("event_time")
    if isinstance(event_time, int | float) and not isinstance(event_time, bool):
        try:
            occurred_at = datetime.fromtimestamp(event_time, tz=UTC).replace(tzinfo=None)
        except (OverflowError, OSError, ValueError):
            occurred_at = None
    try:
        serialized = json.dumps(
            serialized_body if serialized_body is not None else body, sort_keys=True, separators=(",", ":")
        )
    except (TypeError, ValueError):
        return None
    return AuthenticatedIMEvent(
        provider=IMProvider.SLACK,
        provider_tenant_id=provider_tenant_id,
        event_id=event_id,
        event_type=event_type,
        occurred_at=occurred_at,
        received_at=received_at,
        payload=serialized,
    )


def _provider_tenant_id(body: Mapping[str, object]) -> str | None:
    direct = _optional_non_empty_string(body.get("team_id"))
    if direct is not None:
        return direct
    team = body.get("team")
    if isinstance(team, Mapping):
        nested = _optional_non_empty_string(team.get("id"))
        if nested is not None:
            return nested
    payload = body.get("payload")
    if isinstance(payload, Mapping):
        return _provider_tenant_id(payload)
    return None


def _slack_error_code(error: SlackApiError) -> str | None:
    error_code = error.response.get("error")
    return error_code if isinstance(error_code, str) else None


def _oauth_scopes(headers: object) -> frozenset[str]:
    if not isinstance(headers, Mapping):
        return frozenset()
    for name, value in headers.items():
        if isinstance(name, str) and name.casefold() == "x-oauth-scopes" and isinstance(value, str):
            return frozenset(scope.strip() for scope in value.split(",") if scope.strip())
    return frozenset()


__all__ = ["SlackIMProviderAdapter"]
