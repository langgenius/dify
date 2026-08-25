"""Concrete Microsoft Teams adapter for Provider-neutral IM contracts."""

from __future__ import annotations

import asyncio
import binascii
import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import Message
from typing import ClassVar, Literal, override
from urllib.parse import urlsplit
from uuid import UUID

import httpx
import jwt
from azure.core.exceptions import ClientAuthenticationError
from azure.identity import ClientSecretCredential
from botbuilder.schema import (
    Activity,
    Attachment,
    ChannelAccount,
    ConversationParameters,
    ConversationResourceResponse,
    ResourceResponse,
)
from botframework.connector import ConnectorClient
from botframework.connector.auth import (
    JwtTokenValidation,
    MicrosoftAppCredentials,
    SimpleCredentialProvider,
)
from msrest.exceptions import HttpOperationError
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, JsonValue, ValidationError, field_validator

from core.human_input import ButtonStyle
from core.human_input_v2 import FileInput, FileListInput, MarkdownText, ParagraphInput, ResolvedForm, SelectInput
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.credentials import MSTeamsCredentials
from core.human_input_v2.im_integration.adapters.entities import (
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
    IMCardEvent,
    IMCardEventDecodeResult,
    IMCardEventDecodingError,
    IMEventIngressKind,
    MessageAccepted,
    MessageSendingError,
    MessageSendingResult,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    StaticCardIntent,
    UnrecognizedIMEvent,
    WebhookRequest,
    WebhookResponse,
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

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT_SECONDS = 10.0
_GRAPH_SCOPE = "https://graph.microsoft.com/.default"
_GRAPH_AUDIENCE = "https://graph.microsoft.com"
_GRAPH_USERS_URL = "https://graph.microsoft.com/v1.0/users"
_GRAPH_DIRECTORY_PAGE_SIZE = 999
_BOT_FRAMEWORK_AUDIENCE = "https://api.botframework.com"
_BASELINE_GRAPH_ROLES = frozenset(("User.Read.All",))
_PUBLIC_TEAMS_SERVICE_URL = "https://smba.trafficmanager.net/teams/"
_JSON_CONTENT_TYPE = "application/json"
_TEAMS_BOT_CHANNEL_ID_PREFIX = "28:"
_OAUTH_CREDENTIAL_REJECTION_CODES = frozenset(("invalid_client", "invalid_grant", "unauthorized_client"))


class _AccessTokenClaims(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    aud: str
    tid: str | None = None
    roles: tuple[str, ...] = ()
    appid: str | None = None


class _GraphUser(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    id: str = Field(min_length=1)
    display_name: str | None = Field(default=None, alias="displayName")
    mail: str | None = None

    @field_validator("display_name", "mail", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class _GraphUsersPage(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    users: tuple[_GraphUser, ...] = Field(alias="value")
    next_link: str | None = Field(default=None, alias="@odata.nextLink")


class _TeamsConversation(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    tenant_id: str | None = Field(default=None, alias="tenantId")


class _TeamsTenant(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    id: str


class _TeamsChannelData(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    tenant: _TeamsTenant | None = None


class _TeamsInboundActivity(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    type: str = Field(min_length=1)
    id: str | None = None
    timestamp: AwareDatetime | None = None
    service_url: str = Field(alias="serviceUrl", min_length=1)
    channel_id: Literal["msteams"] = Field(alias="channelId")
    conversation: _TeamsConversation
    channel_data: _TeamsChannelData = Field(alias="channelData")

    @field_validator("id", mode="before")
    @classmethod
    def normalize_optional_identifier(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class _MSTeamsLocatorPayload(_Base64JSONLocatorPayload):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    # version of the locator
    v: Literal[1]
    # provider of the locator
    p: Literal[IMProvider.MS_TEAMS]
    # Bot Framework service endpoint used for subsequent message operations:
    # https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0
    service_url: str = Field(min_length=1)
    # Bot Framework conversation containing the activity:
    # https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0
    conversation_id: str = Field(min_length=1, pattern=r"\S")
    # Bot Framework activity identifier of the exact message:
    # https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0
    activity_id: str = Field(min_length=1, pattern=r"\S")

    @field_validator("service_url")
    @classmethod
    def _require_trusted_service_url(cls, value: str) -> str:
        if not _trusted_teams_service_url(value):
            raise ValueError("service_url must be a trusted Teams service endpoint")
        return value


class _MSTeamsBotCredentials(MicrosoftAppCredentials):
    """Concrete credentials wrapper kept private to this adapter module."""


def _reject_non_standard_json_constant(value: str) -> object:
    del value
    raise ValueError("non-standard JSON constant")


def _safe_access_token_claims(token: str) -> _AccessTokenClaims | None:
    try:
        claims = jwt.decode(
            token,
            options={"verify_signature": False, "verify_aud": False, "verify_exp": False},
        )
        return _AccessTokenClaims.model_validate(claims)
    except (jwt.PyJWTError, ValidationError):
        return None


def _canonical_guid(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return str(UUID(value))
    except ValueError:
        return None


def _permission_error_is_credential_rejection(error: PermissionError) -> bool:
    error_text = str(error).strip().casefold()
    sdk_error_marker = "error:"
    if sdk_error_marker in error_text:
        error_text = error_text.split(sdk_error_marker, maxsplit=1)[1].lstrip()
    error_code = error_text.split(",", maxsplit=1)[0].split(":", maxsplit=1)[0].strip()
    return error_code in _OAUTH_CREDENTIAL_REJECTION_CODES


def _log_safe_error(message: str) -> None:
    logger.error(message)


def _trusted_graph_users_url(url: str) -> bool:
    parsed = urlsplit(url)
    return parsed.scheme == "https" and parsed.hostname == "graph.microsoft.com" and parsed.path == "/v1.0/users"


def _trusted_teams_service_url(url: object) -> bool:
    if not isinstance(url, str):
        return False
    parsed = urlsplit(url)
    return parsed.scheme == "https" and parsed.hostname == "smba.trafficmanager.net"


def _non_empty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _header_values(headers: tuple[tuple[str, str], ...], target_name: str) -> tuple[str, ...]:
    normalized_target = target_name.casefold()
    return tuple(value for name, value in headers if name.casefold() == normalized_target)


def _content_type(headers: tuple[tuple[str, str], ...]) -> str | None:
    values = _header_values(headers, "content-type")
    if len(values) != 1:
        return None
    parsed = Message()
    parsed["Content-Type"] = values[0]
    return parsed.get_content_type()


def _webhook_response(status_code: int, body: bytes) -> WebhookResponse:
    return WebhookResponse(
        status_code=status_code,
        headers=(("Content-Type", "text/plain; charset=utf-8"),),
        body=body,
    )


def _mutation_connector(credentials: MicrosoftAppCredentials, base_url: str) -> ConnectorClient:
    client = ConnectorClient(credentials, base_url=base_url)
    # The SDK retries every HTTP verb by default. Message mutations must retain
    # their contract's at-most-once boundary even when acceptance is uncertain.
    client.config.retry_policy.retries = 0
    return client


def _card_summary(intent: ResolvedForm) -> str:
    if intent.title:
        return intent.title
    for block in intent.blocks:
        if isinstance(block, MarkdownText) and block.text.strip():
            return block.text
    return "Human input form"


@dataclass(frozen=True, slots=True)
class _MSTeamsCardCodec(IMCardEventDecoder):
    """Own the credential-free Microsoft Teams card wire contract."""

    _CONTENT_TYPE = "application/vnd.microsoft.card.adaptive"
    _SCHEMA_URL = "http://adaptivecards.io/schemas/adaptive-card.json"
    _CARD_VERSION = "1.5"
    _MAX_CARD_SIZE_BYTES = 28 * 1024
    _SUPPORTED_ACTION_STYLES = frozenset((ButtonStyle.DEFAULT, ButtonStyle.PRIMARY, ButtonStyle.ACCENT))
    _METADATA_MEMBER = "__dify.human_input"
    _CALLBACK_SCHEMA_VERSION: ClassVar[Literal[1]] = 1
    _APPLICABLE_ACTIVITY_TYPES = frozenset(("invoke", "message"))

    class _CallbackModel(BaseModel):
        model_config = ConfigDict(
            allow_inf_nan=False,
            extra="ignore",
            frozen=True,
            strict=True,
        )

    class _CallbackActor(_CallbackModel):
        id: str = Field(min_length=1)

        @field_validator("id")
        @classmethod
        def _require_non_blank_identifier(cls, value: str) -> str:
            if not value.strip():
                raise ValueError("Microsoft Teams card actor identifier is empty.")
            return value

    class _ButtonMetadata(BaseModel):
        model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

        version: Literal[1]
        action_id: str = Field(min_length=1)
        correlation_token: str

    class _SubmissionActivity(_CallbackModel):
        type: Literal["invoke", "message"]
        actor: _MSTeamsCardCodec._CallbackActor = Field(alias="from")
        value: dict[str, JsonValue]

    def assess(self, intent: ResolvedForm) -> CardAssessment:
        reason = self._unrepresentable_reason(intent)
        if reason is not None:
            return CardAssessment(False, reason)
        return CardAssessment(True)

    def encode(
        self,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> Mapping[str, JsonValue]:
        reason = self._unrepresentable_reason(intent)
        if reason is not None:
            raise DynamicCardMessagingError(reason)
        card = self._render_card(intent, correlation_token)
        if self._serialized_card_size(card) > self._MAX_CARD_SIZE_BYTES:
            raise DynamicCardMessagingError("Microsoft Teams cannot preserve a card beyond the Provider payload limit.")
        return card

    @override
    def decode(self, event: AuthenticatedIMEvent) -> IMCardEventDecodeResult:
        if event.provider is not IMProvider.MS_TEAMS or event.event_type not in self._APPLICABLE_ACTIVITY_TYPES:
            return UnrecognizedIMEvent()
        callback = self._decode_json_object(event.payload)
        if callback is None:
            raise IMCardEventDecodingError("Microsoft Teams card event payload is invalid.")

        callback_value = callback.get("value")
        if not isinstance(callback_value, dict):
            return UnrecognizedIMEvent()
        if self._METADATA_MEMBER not in callback_value:
            return UnrecognizedIMEvent()

        validated_submission = self._validate_submission(callback)
        if validated_submission is None:
            raise IMCardEventDecodingError("Microsoft Teams card event schema is invalid.")
        submission, metadata = validated_submission
        if submission.type != event.event_type:
            raise IMCardEventDecodingError("Microsoft Teams card event schema is invalid.")
        inputs = dict(submission.value)
        inputs.pop(self._METADATA_MEMBER)
        return IMCardEvent(
            provider_user_id=ProviderUserId(submission.actor.id),
            action_id=metadata.action_id,
            inputs=inputs,
            correlation_token=CorrelationToken(metadata.correlation_token),
        )

    @classmethod
    def _decode_json_object(cls, serialized_callback: str) -> dict[str, object] | None:
        try:
            decoded_callback = json.loads(
                serialized_callback,
                parse_constant=_reject_non_standard_json_constant,
            )
        except (json.JSONDecodeError, ValueError, RecursionError):
            return None
        if not isinstance(decoded_callback, dict) or any(not isinstance(key, str) for key in decoded_callback):
            return None
        return decoded_callback

    @classmethod
    def _validate_submission(
        cls,
        callback: dict[str, object],
    ) -> tuple[_SubmissionActivity, _ButtonMetadata] | None:
        try:
            submission = cls._SubmissionActivity.model_validate(callback)
            metadata = cls._ButtonMetadata.model_validate(submission.value[cls._METADATA_MEMBER])
        except (KeyError, ValidationError):
            return None
        return submission, metadata

    @classmethod
    def _unrepresentable_reason(cls, intent: ResolvedForm) -> str | None:
        if not intent.blocks and not intent.user_actions:
            return "Microsoft Teams cannot preserve an empty card."
        if intent.title is not None and not intent.title:
            return "Microsoft Teams cannot preserve an empty card title."

        input_names: set[str] = set()
        for block in intent.blocks:
            match block:
                case MarkdownText(text=text):
                    if not text:
                        return "Microsoft Teams cannot preserve an empty Markdown block."
                    continue
                case FileInput() | FileListInput():
                    return "Microsoft Teams cards cannot represent file inputs."
                case ParagraphInput(output_variable_name=input_name):
                    pass
                case SelectInput(output_variable_name=input_name, options=options, default_value=default_value):
                    if not options or any(not option for option in options):
                        return "Microsoft Teams cannot preserve one select input's options."
                    if len(options) != len(set(options)):
                        return "Microsoft Teams cannot preserve duplicate select options."
                    if default_value is not None and default_value not in options:
                        return "Microsoft Teams cannot preserve one select input default."
            if input_name in input_names:
                return "Microsoft Teams cannot preserve duplicate card input identifiers."
            if input_name == cls._METADATA_MEMBER:
                return "Microsoft Teams card input identifier is reserved."
            input_names.add(input_name)

        if any(action.button_style not in cls._SUPPORTED_ACTION_STYLES for action in intent.user_actions):
            return "Microsoft Teams cannot preserve one card action style."
        assessment_card = cls._render_card(intent, CorrelationToken(""))
        if cls._serialized_card_size(assessment_card) > cls._MAX_CARD_SIZE_BYTES:
            return "Microsoft Teams cannot preserve a card beyond the Provider payload limit."
        return None

    @classmethod
    def _render_card(
        cls,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> dict[str, JsonValue]:
        body: list[JsonValue] = []
        if intent.title is not None:
            body.append(
                {
                    "type": "TextBlock",
                    "text": intent.title,
                    "wrap": True,
                    "size": "Medium",
                    "weight": "Bolder",
                }
            )
        for block in intent.blocks:
            if isinstance(block, MarkdownText):
                body.append({"type": "TextBlock", "text": block.text, "wrap": True})
                continue
            if isinstance(block, ParagraphInput):
                text_input: dict[str, JsonValue] = {
                    "type": "Input.Text",
                    "id": block.output_variable_name,
                    "label": block.output_variable_name,
                    "isMultiline": True,
                }
                if block.default_value is not None:
                    text_input["value"] = block.default_value
                body.append(text_input)
                continue
            if isinstance(block, SelectInput):
                choice_input: dict[str, JsonValue] = {
                    "type": "Input.ChoiceSet",
                    "id": block.output_variable_name,
                    "label": block.output_variable_name,
                    "choices": [{"title": option, "value": option} for option in block.options],
                    "style": "compact",
                }
                if block.default_value is not None:
                    choice_input["value"] = block.default_value
                body.append(choice_input)
                continue
            raise DynamicCardMessagingError("Microsoft Teams cards cannot represent file inputs.")

        actions: list[JsonValue] = []
        for action in intent.user_actions:
            metadata = cls._ButtonMetadata(
                version=cls._CALLBACK_SCHEMA_VERSION,
                action_id=action.id,
                correlation_token=str(correlation_token),
            )
            actions.append(
                {
                    "type": "Action.Submit",
                    "title": action.title,
                    "data": {cls._METADATA_MEMBER: metadata.model_dump(mode="json")},
                }
            )
        return {
            "$schema": cls._SCHEMA_URL,
            "type": "AdaptiveCard",
            "version": cls._CARD_VERSION,
            "body": body,
            "actions": actions,
        }

    @staticmethod
    def _serialized_card_size(card: Mapping[str, JsonValue]) -> int:
        return len(
            json.dumps(
                card,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            ).encode()
        )


class _MSTeamsDirectory(IMDirectory):
    def __init__(self, credential: ClientSecretCredential, client: httpx.Client) -> None:
        self._credential = credential
        self._client = client

    @override
    def read_directory(self) -> Directory | DirectoryReadFailure:
        try:
            access_token = self._credential.get_token(_GRAPH_SCOPE).token
            return self._read_all_pages(access_token)
        except (ClientAuthenticationError, httpx.HTTPError, ValidationError, ValueError):
            return DirectoryReadFailure("Microsoft Teams directory could not be read completely.")
        except Exception:
            _log_safe_error("Unexpected Microsoft Teams directory failure")
            return DirectoryReadFailure("Microsoft Teams directory could not be read completely.")

    def _read_all_pages(self, access_token: str) -> Directory:
        entries: list[DirectoryEntry] = []
        next_url: str | None = None
        seen_urls: set[str] = set()
        headers = {"Authorization": f"Bearer {access_token}"}
        while True:
            if next_url is None:
                response = self._client.get(
                    _GRAPH_USERS_URL,
                    headers=headers,
                    params={
                        "$select": "id,displayName,mail",
                        "$top": _GRAPH_DIRECTORY_PAGE_SIZE,
                    },
                )
            else:
                response = self._client.get(next_url, headers=headers)
            response.raise_for_status()
            page = _GraphUsersPage.model_validate(response.json())
            entries.extend(
                DirectoryEntry(
                    provider_user_id=ProviderUserId(user.id),
                    display_name=user.display_name,
                    email=user.mail,
                )
                for user in page.users
            )
            if page.next_link is None:
                return Directory(tuple(entries))
            if not _trusted_graph_users_url(page.next_link) or page.next_link in seen_urls:
                raise ValueError("invalid Microsoft Graph pagination")
            seen_urls.add(page.next_link)
            next_url = page.next_link


class _MSTeamsMessaging(IMMessaging):
    def __init__(self, credentials: MicrosoftAppCredentials, tenant_id: str, client_id: str) -> None:
        self._credentials = credentials
        self._tenant_id = tenant_id
        self._client_id = client_id

    @override
    def send_text(self, provider_user_id: ProviderUserId, body: str) -> MessageSendingResult:
        return self._send_activity(provider_user_id, Activity(type="message", text=body))

    def _send_activity(
        self,
        provider_user_id: ProviderUserId,
        activity: Activity,
    ) -> MessageSendingResult:
        try:
            conversation_client = _mutation_connector(self._credentials, _PUBLIC_TEAMS_SERVICE_URL)
            conversation = conversation_client.conversations.create_conversation(
                ConversationParameters(
                    is_group=False,
                    bot=ChannelAccount(id=f"{_TEAMS_BOT_CHANNEL_ID_PREFIX}{self._client_id}"),
                    members=[ChannelAccount(id=str(provider_user_id))],
                    tenant_id=self._tenant_id,
                )
            )
            if not isinstance(conversation, ConversationResourceResponse):
                return MessageSendingError("Microsoft Teams returned no usable personal conversation reference.")
            conversation_id = conversation.id
            service_url = conversation.service_url or _PUBLIC_TEAMS_SERVICE_URL
            if not _non_empty_string(conversation_id) or not _trusted_teams_service_url(service_url):
                return MessageSendingError("Microsoft Teams returned no usable personal conversation reference.")
            message_client = _mutation_connector(self._credentials, service_url)
            response = message_client.conversations.send_to_conversation(conversation_id, activity)
            if not isinstance(response, ResourceResponse):
                return MessageSendingError("Microsoft Teams returned no exact message reference.")
            activity_id = response.id
            if not _non_empty_string(activity_id):
                return MessageSendingError("Microsoft Teams returned no exact message reference.")
            return MessageAccepted(
                MessageLocator(
                    _MSTeamsLocatorPayload(
                        v=1,
                        p=IMProvider.MS_TEAMS,
                        service_url=service_url,
                        conversation_id=conversation_id,
                        activity_id=activity_id,
                    ).encode()
                )
            )
        except Exception:
            _log_safe_error("Unexpected Microsoft Teams message creation failure")
            return MessageSendingError("Microsoft Teams message acceptance could not be confirmed.")


class _MSTeamsDynamicCardMessaging(_MSTeamsMessaging, IMDynamicCardMessaging):
    def __init__(
        self,
        credentials: MicrosoftAppCredentials,
        tenant_id: str,
        client_id: str,
        codec: _MSTeamsCardCodec,
    ) -> None:
        super().__init__(credentials, tenant_id, client_id)
        self._codec = codec

    @override
    def assess(self, intent: ResolvedForm) -> CardAssessment:
        return self._codec.assess(intent)

    @override
    def send_card(
        self,
        provider_user_id: ProviderUserId,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> MessageSendingResult:
        content = self._codec.encode(intent, correlation_token)
        activity = Activity(
            type="message",
            summary=_card_summary(intent),
            attachments=[Attachment(content_type=self._codec._CONTENT_TYPE, content=dict(content))],
        )
        return self._send_activity(provider_user_id, activity)

    @override
    def replace_with_static(
        self,
        locator: MessageLocator,
        intent: StaticCardIntent,
    ) -> ReplacementError | None:
        decoded_locator = self._compatible_card_locator(locator)
        if decoded_locator is None:
            return ReplacementError(
                ReplacementErrorKind.INVALID_REFERENCE,
                "The Microsoft Teams message reference is invalid.",
            )
        try:
            client = _mutation_connector(self._credentials, decoded_locator.service_url)
            client.conversations.update_activity(
                decoded_locator.conversation_id,
                decoded_locator.activity_id,
                Activity(type="message", text=intent.rendered_content),
            )
        except HttpOperationError as error:
            if error.response.status_code in {404, 410}:
                return ReplacementError(
                    ReplacementErrorKind.STALE_REFERENCE,
                    "The referenced Microsoft Teams card is no longer replaceable.",
                )
            return ReplacementError(
                ReplacementErrorKind.UNKNOWN,
                "Microsoft Teams replacement acceptance is unknown.",
            )
        except Exception:
            _log_safe_error("Unexpected Microsoft Teams card replacement failure")
            return ReplacementError(
                ReplacementErrorKind.UNKNOWN,
                "Microsoft Teams replacement acceptance is unknown.",
            )
        return None

    def _compatible_card_locator(self, locator: MessageLocator) -> _MSTeamsLocatorPayload | None:
        try:
            return _MSTeamsLocatorPayload.decode(str(locator))
        except (binascii.Error, UnicodeDecodeError, ValueError, ValidationError):
            return None


class _MSTeamsWebhookHandler(IMWebhookHandler):
    def __init__(
        self,
        *,
        tenant_id: str,
        client_id: str,
        client_secret: str,
        consumer: IMEventConsumer,
    ) -> None:
        self._tenant_id = tenant_id
        self._credential_provider = SimpleCredentialProvider(client_id, client_secret)
        self._consumer = consumer

    @override
    def handle(self, request: WebhookRequest) -> WebhookResponse:
        if request.method != "POST":
            return _webhook_response(405, b"method not allowed")
        if _content_type(request.headers) != _JSON_CONTENT_TYPE:
            return _webhook_response(415, b"unsupported content type")
        authorization_values = _header_values(request.headers, "authorization")
        if len(authorization_values) != 1:
            return _webhook_response(401, b"request authentication failed")

        decoded_body = self._decoded_body(request.body)
        if decoded_body is None:
            return _webhook_response(400, b"invalid Microsoft Teams activity")
        try:
            activity = _TeamsInboundActivity.model_validate(decoded_body)
        except ValidationError:
            return _webhook_response(400, b"invalid Microsoft Teams activity")
        if not _trusted_teams_service_url(activity.service_url):
            return _webhook_response(400, b"invalid Microsoft Teams activity")
        if not self._authenticated(activity, authorization_values[0]):
            return _webhook_response(401, b"request authentication failed")
        if not self._configured_tenant(activity):
            return _webhook_response(403, b"Microsoft Teams tenant mismatch")

        event = AuthenticatedIMEvent(
            provider=IMProvider.MS_TEAMS,
            provider_tenant_id=self._tenant_id,
            event_id=activity.id,
            event_type=activity.type,
            occurred_at=self._occurred_at(activity),
            received_at=request.received_at,
            ingress_kind=IMEventIngressKind.WEBHOOK,
            payload=json.dumps(decoded_body, ensure_ascii=False, allow_nan=False, separators=(",", ":")),
        )
        try:
            acceptance = self._consumer.accept(event)
        except Exception:
            _log_safe_error("Unexpected Microsoft Teams Webhook consumer failure")
            return _webhook_response(503, b"event processing failed")
        if acceptance is EventAcceptance.ACCEPTED:
            return _webhook_response(200, b"")
        return _webhook_response(503, b"event not accepted")

    @staticmethod
    def _decoded_body(body: bytes) -> dict[str, object] | None:
        try:
            decoded = json.loads(body, parse_constant=_reject_non_standard_json_constant)
        except (UnicodeDecodeError, ValueError):
            return None
        if not isinstance(decoded, dict) or any(not isinstance(key, str) for key in decoded):
            return None
        return decoded

    def _authenticated(self, activity: _TeamsInboundActivity, authorization: str) -> bool:
        sdk_activity = Activity(
            type=activity.type,
            channel_id=activity.channel_id,
            service_url=activity.service_url,
        )
        try:
            identity = asyncio.run(
                JwtTokenValidation.authenticate_request(
                    sdk_activity,
                    authorization,
                    self._credential_provider,
                    "",
                )
            )
        except Exception:
            _log_safe_error("Microsoft Teams Webhook authentication failed")
            return False
        return identity.is_authenticated

    def _configured_tenant(self, activity: _TeamsInboundActivity) -> bool:
        tenant_ids = {
            _canonical_guid(tenant_id)
            for tenant_id in (
                activity.conversation.tenant_id,
                activity.channel_data.tenant.id if activity.channel_data.tenant is not None else None,
            )
            if tenant_id is not None
        }
        configured_tenant_id = _canonical_guid(self._tenant_id)
        return configured_tenant_id is not None and None not in tenant_ids and tenant_ids == {configured_tenant_id}

    @staticmethod
    def _occurred_at(activity: _TeamsInboundActivity) -> datetime | None:
        if activity.timestamp is None:
            return None
        return activity.timestamp.astimezone(UTC).replace(tzinfo=None)


class MSTeamsIMProviderAdapter:
    """Externally serialized Microsoft Teams capability composition root."""

    @classmethod
    def card_event_decoder(cls) -> IMCardEventDecoder:
        """Return a credential-free decoder independent from root adapter instances."""
        return _MSTeamsCardCodec()

    def __init__(self, credentials: MSTeamsCredentials) -> None:
        if not isinstance(credentials, MSTeamsCredentials):
            raise TypeError("Microsoft Teams adapter requires resolved Microsoft Teams credentials")
        self._credentials = credentials
        self._graph_credential = ClientSecretCredential(
            credentials.tenant_id,
            credentials.client_id,
            credentials.client_secret,
        )
        self._graph_client = httpx.Client(timeout=_HTTP_TIMEOUT_SECONDS)
        self._bot_credentials = _MSTeamsBotCredentials(
            credentials.client_id,
            credentials.client_secret,
            channel_auth_tenant=credentials.tenant_id,
        )
        self._directory = _MSTeamsDirectory(self._graph_credential, self._graph_client)
        self._messaging = _MSTeamsMessaging(
            self._bot_credentials,
            credentials.tenant_id,
            credentials.client_id,
        )
        self._dynamic_card_messaging = _MSTeamsDynamicCardMessaging(
            self._bot_credentials,
            credentials.tenant_id,
            credentials.client_id,
            _MSTeamsCardCodec(),
        )

    @property
    def provider(self) -> IMProvider:
        return IMProvider.MS_TEAMS

    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure:
        try:
            graph_token = self._graph_credential.get_token(_GRAPH_SCOPE).token
        except ClientAuthenticationError:
            return CredentialTestFailure(
                CredentialTestFailureKind.AUTHENTICATION_REJECTED,
                "Microsoft rejected the Graph credentials.",
            )
        except Exception:
            _log_safe_error("Unexpected Microsoft Graph credential test failure")
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Microsoft Teams credential testing could not be completed.",
            )

        graph_claims = _safe_access_token_claims(graph_token)
        if graph_claims is None:
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Microsoft Graph token claims could not be confirmed.",
            )
        if graph_claims.tid is None:
            return CredentialTestFailure(
                CredentialTestFailureKind.TENANT_ID_UNAVAILABLE,
                "Microsoft did not provide a stable tenant identity.",
            )
        configured_tenant_id = _canonical_guid(self._credentials.tenant_id)
        graph_tenant_id = _canonical_guid(graph_claims.tid)
        if configured_tenant_id is None or graph_tenant_id is None:
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Microsoft Graph tenant claims could not be confirmed.",
            )
        if graph_tenant_id != configured_tenant_id:
            return CredentialTestFailure(
                CredentialTestFailureKind.AUTHENTICATION_REJECTED,
                "Microsoft returned credentials for a different tenant.",
            )
        if graph_claims.aud != _GRAPH_AUDIENCE or not _BASELINE_GRAPH_ROLES.issubset(graph_claims.roles):
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Microsoft Graph baseline permissions could not be confirmed.",
            )

        try:
            bot_token = self._bot_credentials.get_access_token()
        except PermissionError as error:
            if _permission_error_is_credential_rejection(error):
                return CredentialTestFailure(
                    CredentialTestFailureKind.AUTHENTICATION_REJECTED,
                    "Microsoft rejected the Bot Framework credentials.",
                )
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Microsoft Teams credential testing could not be completed.",
            )
        except Exception:
            _log_safe_error("Unexpected Microsoft Bot Framework credential test failure")
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Microsoft Teams credential testing could not be completed.",
            )

        bot_claims = _safe_access_token_claims(bot_token)
        if bot_claims is None or bot_claims.aud != _BOT_FRAMEWORK_AUDIENCE:
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Microsoft Bot Framework credentials could not be confirmed.",
            )
        bot_tenant_id = _canonical_guid(bot_claims.tid)
        bot_client_id = _canonical_guid(bot_claims.appid)
        configured_client_id = _canonical_guid(self._credentials.client_id)
        if (
            bot_tenant_id is None
            or bot_client_id is None
            or configured_client_id is None
            or bot_tenant_id != configured_tenant_id
            or bot_client_id != configured_client_id
        ):
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                "Microsoft Bot Framework credentials could not be confirmed.",
            )
        return CredentialTestSuccess(IMProvider.MS_TEAMS, graph_tenant_id)

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
        return _MSTeamsWebhookHandler(
            tenant_id=self._credentials.tenant_id,
            client_id=self._credentials.client_id,
            client_secret=self._credentials.client_secret,
            consumer=consumer,
        )

    def create_stream_handler(self, consumer: IMEventConsumer) -> IMEventStream | None:
        del consumer
        return None

    def close(self) -> None:
        self._graph_client.close()
        self._graph_credential.close()


__all__ = ["MSTeamsIMProviderAdapter"]
