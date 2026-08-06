"""Concrete Slack adapter for Provider-neutral Human Input IM contracts.

The root and its ordinary capabilities rely on the contract's external
serialization rule and intentionally contain no synchronization. Socket Mode
owns all concurrency state required by its independent lifecycle.
"""

from __future__ import annotations

import json
import logging
import re
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
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

from core.human_input_v2.approval.frozen_values import JSONPrimitive
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
    IMStreamRunError,
    IMWebhookHandler,
    MessageAccepted,
    MessageReference,
    MessageSendingError,
    MessageSendingResult,
    NormalizedCardIntent,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    SlackIMIntegrationCredentials,
    StaticCardIntent,
    StopSignal,
    WebhookRequest,
    WebhookResponse,
)

logger = logging.getLogger(__name__)
_SLACK_SOCKET_SDK_LOGGER = logging.Logger(f"{__name__}.socket_sdk")
_SLACK_SOCKET_SDK_LOGGER.addHandler(logging.NullHandler())
_SLACK_SOCKET_SDK_LOGGER.propagate = False

_SLACK_DIRECTORY_PAGE_SIZE = 200
_SOCKET_WAIT_SECONDS = 0.05
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


class _SlackSocketModeClient(SocketModeClient):
    """Official client variant with reconnect disabled for bounded ownership.

    The SDK's disconnect control-frame path reconnects even when its public
    automatic-reconnect option is false. This stream deliberately exposes a
    single connection attempt so a stop request cannot race an SDK reconnect.
    """

    @override
    def connect_to_new_endpoint(self, force: bool = False) -> None:
        del force


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
            if member.get("deleted") is True or member.get("is_bot") is True or member.get("is_app_user") is True:
                continue
            provider_user_id = member.get("id")
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
    def assess(self, intent: NormalizedCardIntent) -> CardAssessment:
        reason = _card_unrepresentable_reason(intent)
        if reason is not None:
            return CardAssessment(False, reason)
        return CardAssessment(True)

    @override
    def send_card(
        self,
        provider_user_id: ProviderUserId,
        intent: NormalizedCardIntent,
        correlation_token: CorrelationToken,
    ) -> MessageSendingResult:
        reason = _card_unrepresentable_reason(intent)
        if reason is not None:
            raise DynamicCardMessagingError(reason)
        blocks = _render_card_blocks(intent, correlation_token)
        try:
            response = self._client.chat_postMessage(
                channel=str(provider_user_id),
                text=intent.rendered_content,
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
        try:
            decoded = json.loads(request.body)
        except (UnicodeDecodeError, json.JSONDecodeError):
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
        if not isinstance(decoded, dict) or any(not isinstance(key, str) for key in decoded):
            return None
        return decoded


class _SlackEventStream(IMEventStream):
    """One independent Socket Mode lifecycle with private callback coordination.

    Claiming ``establishing`` under ``_condition`` is the connection attempt's
    linearization point. A later stop makes that attempt in-flight, but the
    established session can never transition to usable ``running`` state.
    """

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
        self._run_lock = threading.Lock()
        self._condition = threading.Condition()
        self._has_run = False
        self._state: Literal["idle", "establishing", "running", "stopping", "failed", "closed"] = "idle"
        self._stop_signal: StopSignal | None = None
        self._accepting_callbacks = False
        self._in_flight_callbacks = 0
        self._terminal_failure = False

    @override
    def run(self, signal: StopSignal) -> None:
        with self._run_lock:
            if self._has_run:
                raise IMStreamRunError("This Slack event stream has already been run.")
            self._has_run = True
        if signal.stop_requested:
            return

        client: BaseSocketModeClient | None = None
        stop_watcher_done = threading.Event()
        with self._condition:
            self._stop_signal = signal
        stop_watcher = threading.Thread(
            target=self._watch_for_stop,
            args=(signal, stop_watcher_done),
            daemon=True,
        )
        stop_watcher.start()
        try:
            web_client = WebClient(
                token=self._bot_token,
                timeout=_SOCKET_WEB_API_TIMEOUT_SECONDS,
                retry_handlers=[],
            )
            client = _SlackSocketModeClient(
                app_token=self._app_token,
                logger=_SLACK_SOCKET_SDK_LOGGER,
                web_client=web_client,
                auto_reconnect_enabled=False,
                on_error_listeners=[self._handle_socket_error],
                on_close_listeners=[self._handle_socket_close],
            )
            client.socket_mode_request_listeners.append(self._handle_request)
            if self._claim_establishment(signal):
                client.connect()
                if self._finish_establishment(signal):
                    while True:
                        with self._condition:
                            if self._state in {"stopping", "failed"}:
                                break
                        if signal.wait(_SOCKET_WAIT_SECONDS):
                            self._request_stop()
                            break
        except SlackClientError:
            if signal.stop_requested:
                self._request_stop()
            else:
                self._mark_terminal_failure()
        except Exception:
            if signal.stop_requested:
                self._request_stop()
            else:
                _log_safe_error("Unexpected Slack Socket Mode run failure")
                self._mark_terminal_failure()
        finally:
            self._request_stop()
            if client is not None:
                try:
                    client.close()
                except SlackClientError:
                    self._mark_terminal_failure()
                except Exception:
                    _log_safe_error("Unexpected Slack Socket Mode close failure")
                    self._mark_terminal_failure()
            with self._condition:
                while self._in_flight_callbacks:
                    self._condition.wait()
                self._state = "closed"
                self._stop_signal = None
            stop_watcher_done.set()
            stop_watcher.join()
        if self._terminal_failure:
            raise IMStreamRunError("The Slack event stream stopped unexpectedly.")

    def _watch_for_stop(self, signal: StopSignal, done: threading.Event) -> None:
        while not done.is_set():
            if signal.wait(_SOCKET_WAIT_SECONDS):
                self._request_stop()
                return

    def _claim_establishment(self, signal: StopSignal) -> bool:
        with self._condition:
            if signal.stop_requested or self._state == "stopping":
                self._state = "stopping"
                self._accepting_callbacks = False
                return False
            if self._state != "idle":
                return False
            self._state = "establishing"
            self._accepting_callbacks = True
            return True

    def _finish_establishment(self, signal: StopSignal) -> bool:
        with self._condition:
            if self._terminal_failure:
                return False
            if signal.stop_requested or self._state == "stopping":
                self._state = "stopping"
                self._accepting_callbacks = False
                return False
            if self._state != "establishing":
                return False
            self._state = "running"
            return True

    def _request_stop(self) -> None:
        with self._condition:
            if self._state not in {"failed", "closed"}:
                self._state = "stopping"
            self._accepting_callbacks = False
            self._condition.notify_all()

    def _mark_terminal_failure(self) -> None:
        with self._condition:
            self._terminal_failure = True
            self._state = "failed"
            self._accepting_callbacks = False
            self._condition.notify_all()

    def _handle_socket_error(self, error: Exception) -> None:
        del error
        self._handle_remote_disconnect("Slack Socket Mode remote error")

    def _handle_socket_close(self, code: int, reason: str | None = None) -> None:
        del code, reason
        self._handle_remote_disconnect("Slack Socket Mode remote close")

    def _handle_remote_disconnect(self, log_message: str) -> None:
        with self._condition:
            stop_requested = self._stop_signal is not None and self._stop_signal.stop_requested
            if stop_requested or self._state in {"stopping", "closed"}:
                if self._state != "closed":
                    self._state = "stopping"
                self._accepting_callbacks = False
                self._condition.notify_all()
                return
            self._terminal_failure = True
            self._state = "failed"
            self._accepting_callbacks = False
            self._condition.notify_all()
        _log_safe_error(log_message)

    def _handle_request(self, client: BaseSocketModeClient, request: SocketModeRequest) -> None:
        if request.type not in _BUSINESS_SOCKET_REQUEST_TYPES:
            return
        with self._condition:
            stop_requested = self._stop_signal is not None and self._stop_signal.stop_requested
            if stop_requested:
                if self._state != "failed":
                    self._state = "stopping"
                self._accepting_callbacks = False
                self._condition.notify_all()
            if not self._accepting_callbacks or self._state not in {"establishing", "running"}:
                return
            self._in_flight_callbacks += 1
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
            self._mark_terminal_failure()
        except Exception:
            _log_safe_error("Unexpected Slack Socket Mode callback failure")
            self._mark_terminal_failure()
        finally:
            with self._condition:
                self._in_flight_callbacks -= 1
                self._condition.notify_all()


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


def _card_unrepresentable_reason(intent: NormalizedCardIntent) -> str | None:
    definition = intent.form_definition
    if not intent.rendered_content or len(intent.rendered_content) > _MAX_MARKDOWN_TEXT_LENGTH:
        return "Slack cannot preserve rendered card content of this length."
    if definition.node_title is not None and len(definition.node_title) > _MAX_HEADER_TEXT_LENGTH:
        return "Slack cannot preserve the card title of this length."
    block_count = 1 + len(definition.inputs) + (1 if definition.node_title else 0) + (1 if definition.actions else 0)
    if block_count > _MAX_BLOCK_COUNT:
        return "Slack cannot preserve this number of card controls."
    if len(definition.actions) > _MAX_ACTION_COUNT:
        return "Slack cannot preserve this number of card actions."

    defaults = definition.default_values.to_mapping()
    input_names: set[str] = set()
    for input_definition in definition.inputs:
        input_mapping = input_definition.to_mapping()
        reason = _input_unrepresentable_reason(input_mapping, defaults)
        if reason is not None:
            return reason
        input_name = input_mapping.get("output_variable_name")
        assert isinstance(input_name, str)
        if input_name in input_names:
            return "Slack cannot preserve duplicate card input identifiers."
        input_names.add(input_name)
    if not defaults.keys() <= input_names:
        return "Slack cannot preserve a default without a matching card input."
    for action in definition.actions:
        if len(action.id) > _MAX_ACTION_ID_LENGTH or len(action.title) > _MAX_ACTION_TEXT_LENGTH:
            return "Slack cannot preserve one card action identifier or title."
        if action.button_style not in {"default", "primary", "accent"}:
            return "Slack cannot preserve one card action style."
    return None


def _input_unrepresentable_reason(
    input_definition: Mapping[str, JSONPrimitive],
    defaults: Mapping[str, JSONPrimitive],
) -> str | None:
    input_type = input_definition.get("type")
    input_name = input_definition.get("output_variable_name")
    if input_type in {"file", "file-list"}:
        return "Slack cards cannot represent file inputs."
    if input_type not in {"paragraph", "select"} or not isinstance(input_name, str) or not input_name:
        return "Slack cannot preserve one card input definition."
    if len(input_name) > _MAX_ACTION_ID_LENGTH or len(input_name) > _MAX_INPUT_LABEL_LENGTH:
        return "Slack cannot preserve one card input identifier."
    default, default_error = _effective_input_default(input_definition, defaults)
    if default_error is not None:
        return default_error
    if input_type == "paragraph":
        if default is not None and len(default) > _MAX_INPUT_INITIAL_VALUE_LENGTH:
            return "Slack cannot preserve one card input default."
        return None

    option_source = input_definition.get("option_source")
    if not isinstance(option_source, Mapping) or option_source.get("type") != "constant":
        return "Slack cannot preserve a select input with unresolved options."
    options = option_source.get("value")
    if (
        not isinstance(options, Sequence)
        or isinstance(options, (str, bytes, bytearray))
        or not 1 <= len(options) <= _MAX_RADIO_OPTION_COUNT
    ):
        return "Slack cannot preserve one select input's option count."
    for option in options:
        if (
            not isinstance(option, str)
            or not option
            or len(option) > _MAX_RADIO_OPTION_TEXT_LENGTH
            or len(option) > _MAX_RADIO_OPTION_VALUE_LENGTH
        ):
            return "Slack cannot preserve one select option."
    if default is not None and default not in options:
        return "Slack cannot preserve one select input default."
    return None


def _effective_input_default(
    input_definition: Mapping[str, JSONPrimitive],
    defaults: Mapping[str, JSONPrimitive],
) -> tuple[str | None, str | None]:
    input_name = input_definition.get("output_variable_name")
    input_type = input_definition.get("type")
    if not isinstance(input_name, str):
        return None, "Slack cannot preserve one card input default."

    resolved_default = defaults.get(input_name)
    if input_type != "paragraph" or input_definition.get("default") is None:
        if resolved_default is not None and not isinstance(resolved_default, str):
            return None, "Slack cannot preserve one card input default."
        return resolved_default, None

    default_source = input_definition.get("default")
    if not isinstance(default_source, Mapping):
        return None, "Slack cannot preserve one card input default."
    if set(default_source) != {"type", "selector", "value"}:
        return None, "Slack cannot preserve one card input default."
    source_type = default_source.get("type")
    selector = default_source.get("selector")
    if (
        not isinstance(selector, Sequence)
        or isinstance(selector, (str, bytes, bytearray))
        or any(not isinstance(part, str) or not part for part in selector)
    ):
        return None, "Slack cannot preserve one card input default."
    if source_type == "constant":
        constant_value = default_source.get("value")
        if not isinstance(constant_value, str):
            return None, "Slack cannot preserve one card input default."
        if resolved_default is not None and resolved_default != constant_value:
            return None, "Slack cannot preserve one card input default."
        return constant_value, None
    if source_type == "variable":
        if len(selector) < 2 or not isinstance(default_source.get("value"), str):
            return None, "Slack cannot preserve one card input default."
        if resolved_default is not None and not isinstance(resolved_default, str):
            return None, "Slack cannot preserve one card input default."
        return resolved_default, None
    return None, "Slack cannot preserve one card input default."


def _render_card_blocks(
    intent: NormalizedCardIntent,
    correlation_token: CorrelationToken,
) -> list[dict[str, object]]:
    definition = intent.form_definition
    blocks: list[dict[str, object]] = []
    if definition.node_title:
        blocks.append({"type": "header", "text": {"type": "plain_text", "text": definition.node_title}})
    blocks.append(MarkdownBlock(text=intent.rendered_content).to_dict())
    defaults = definition.default_values.to_mapping()
    for frozen_input in definition.inputs:
        input_definition = frozen_input.to_mapping()
        input_name = input_definition["output_variable_name"]
        input_type = input_definition["type"]
        if not isinstance(input_name, str) or not isinstance(input_type, str):
            raise DynamicCardMessagingError("Slack cannot preserve one card input definition.")
        input_element: dict[str, object] = {"action_id": input_name}
        default, default_error = _effective_input_default(input_definition, defaults)
        if default_error is not None:
            raise DynamicCardMessagingError(default_error)
        if input_type == "paragraph":
            input_element.update({"type": "plain_text_input", "multiline": True})
            if isinstance(default, str):
                input_element["initial_value"] = default
        else:
            option_source = input_definition["option_source"]
            assert isinstance(option_source, Mapping)
            raw_options = option_source["value"]
            assert isinstance(raw_options, Sequence)
            assert not isinstance(raw_options, (str, bytes, bytearray))
            options = [
                {"text": {"type": "plain_text", "text": option}, "value": option}
                for option in raw_options
                if isinstance(option, str)
            ]
            input_element.update({"type": "radio_buttons", "options": options})
            if isinstance(default, str):
                input_element["initial_option"] = next(option for option in options if option["value"] == default)
        blocks.append(
            {
                "type": "input",
                "block_id": input_name,
                "label": {"type": "plain_text", "text": input_name},
                "element": input_element,
            }
        )
    if definition.actions:
        action_elements: list[dict[str, object]] = []
        for action in definition.actions:
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
            if action.button_style == "primary":
                action_element["style"] = "primary"
            elif action.button_style == "accent":
                action_element["style"] = "danger"
            action_elements.append(action_element)
        blocks.append({"type": "actions", "elements": action_elements})
    return blocks


def _header_values(headers: tuple[tuple[str, str], ...], target_name: str) -> tuple[str, ...]:
    return tuple(value for name, value in headers if name.casefold() == target_name)


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
