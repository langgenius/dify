"""Concrete Microsoft Teams adapter for Provider-neutral IM contracts."""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.message import Message
from typing import Literal, override
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
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError, field_validator

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
    IMWebhookHandler,
    MessageAccepted,
    MessageReference,
    MessageSendingError,
    MessageSendingResult,
    MSTeamsIMIntegrationCredentials,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    StaticCardIntent,
    WebhookRequest,
    WebhookResponse,
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
_ADAPTIVE_CARD_CONTENT_TYPE = "application/vnd.microsoft.card.adaptive"
_MAX_ADAPTIVE_CARD_SIZE_BYTES = 28 * 1024
_SUPPORTED_ACTION_STYLES = frozenset((ButtonStyle.DEFAULT, ButtonStyle.PRIMARY, ButtonStyle.ACCENT))
_JSON_CONTENT_TYPE = "application/json"
_TEAMS_BOT_CHANNEL_ID_PREFIX = "28:"
_MESSAGE_LOCATOR_DIGEST_CONTEXT = b"dify-ms-teams-message-reference-v1\0"
_MESSAGE_LOCATOR_DIGEST_SIZE = 32
_OAUTH_CREDENTIAL_REJECTION_CODES = frozenset(("invalid_client", "invalid_grant", "unauthorized_client"))


class _AdaptiveCardModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class _AdaptiveTextBlock(_AdaptiveCardModel):
    type: Literal["TextBlock"] = "TextBlock"
    text: str
    wrap: bool = True
    size: Literal["Medium"] | None = None
    weight: Literal["Bolder"] | None = None


class _AdaptiveTextInput(_AdaptiveCardModel):
    type: Literal["Input.Text"] = "Input.Text"
    id: str
    label: str
    is_multiline: bool = Field(default=True, alias="isMultiline")
    value: str | None = None


class _AdaptiveChoice(_AdaptiveCardModel):
    title: str
    value: str


class _AdaptiveChoiceInput(_AdaptiveCardModel):
    type: Literal["Input.ChoiceSet"] = "Input.ChoiceSet"
    id: str
    label: str
    choices: tuple[_AdaptiveChoice, ...]
    style: Literal["expanded"] = "expanded"
    value: str | None = None


class _AdaptiveActionData(_AdaptiveCardModel):
    action_id: str
    correlation_token: str


class _AdaptiveSubmitAction(_AdaptiveCardModel):
    type: Literal["Action.Submit"] = "Action.Submit"
    title: str
    data: _AdaptiveActionData


type _AdaptiveCardBody = _AdaptiveTextBlock | _AdaptiveTextInput | _AdaptiveChoiceInput


class _AdaptiveCard(_AdaptiveCardModel):
    schema_: Literal["http://adaptivecards.io/schemas/adaptive-card.json"] = Field(
        default="http://adaptivecards.io/schemas/adaptive-card.json",
        alias="$schema",
    )
    type: Literal["AdaptiveCard"] = "AdaptiveCard"
    version: Literal["1.5"] = "1.5"
    body: tuple[_AdaptiveCardBody, ...]
    actions: tuple[_AdaptiveSubmitAction, ...]


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


class _MSTeamsMessageLocatorData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    version: Literal[1] = 1
    message_kind: Literal["text", "dynamic_card"]
    tenant_id: str
    client_id: str
    service_url: str
    conversation_id: str
    activity_id: str


@dataclass(frozen=True, slots=True, repr=False, init=False)
class _MSTeamsMessageLocator(MessageReference):
    _serialized_value: str = field(repr=False)

    def __init__(
        self,
        *,
        message_kind: Literal["text", "dynamic_card"],
        tenant_id: str,
        client_id: str,
        service_url: str,
        conversation_id: str,
        activity_id: str,
    ) -> None:
        locator = _MSTeamsMessageLocatorData(
            message_kind=message_kind,
            tenant_id=tenant_id,
            client_id=client_id,
            service_url=service_url,
            conversation_id=conversation_id,
            activity_id=activity_id,
        )
        object.__setattr__(self, "_serialized_value", _encode_message_locator(locator))


def _reject_non_standard_json_constant(value: str) -> object:
    del value
    raise ValueError("non-standard JSON constant")


def _encode_message_locator(locator: _MSTeamsMessageLocatorData) -> str:
    serialized_locator = json.dumps(
        locator.model_dump(mode="json"),
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    digest = hashlib.sha256(_MESSAGE_LOCATOR_DIGEST_CONTEXT + serialized_locator).digest()
    return base64.urlsafe_b64encode(serialized_locator + digest).rstrip(b"=").decode("ascii")


def _decode_message_locator(serialized_value: str) -> _MSTeamsMessageLocatorData | None:
    try:
        padding = "=" * (-len(serialized_value) % 4)
        serialized_with_digest = base64.b64decode(
            serialized_value + padding,
            altchars=b"-_",
            validate=True,
        )
        if len(serialized_with_digest) <= _MESSAGE_LOCATOR_DIGEST_SIZE:
            return None
        serialized_locator = serialized_with_digest[:-_MESSAGE_LOCATOR_DIGEST_SIZE]
        supplied_digest = serialized_with_digest[-_MESSAGE_LOCATOR_DIGEST_SIZE:]
        expected_digest = hashlib.sha256(_MESSAGE_LOCATOR_DIGEST_CONTEXT + serialized_locator).digest()
        if not hmac.compare_digest(supplied_digest, expected_digest):
            return None
        decoded_locator = json.loads(serialized_locator, parse_constant=_reject_non_standard_json_constant)
        return _MSTeamsMessageLocatorData.model_validate(decoded_locator)
    except (binascii.Error, UnicodeDecodeError, ValueError, ValidationError):
        return None


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


def _adaptive_card(
    intent: ResolvedForm,
    correlation_token: CorrelationToken,
) -> tuple[_AdaptiveCard | None, str | None]:
    if not intent.blocks and not intent.user_actions:
        return None, "Microsoft Teams cannot preserve an empty card."
    if intent.title is not None and not intent.title:
        return None, "Microsoft Teams cannot preserve an empty card title."

    body: list[_AdaptiveCardBody] = []
    if intent.title is not None:
        body.append(_AdaptiveTextBlock(text=intent.title, size="Medium", weight="Bolder"))

    input_names: set[str] = set()
    for block in intent.blocks:
        match block:
            case MarkdownText(text=text):
                if not text:
                    return None, "Microsoft Teams cannot preserve an empty Markdown block."
                body.append(_AdaptiveTextBlock(text=text))
                continue
            case FileInput() | FileListInput():
                return None, "Microsoft Teams cards cannot represent file inputs."
            case ParagraphInput(output_variable_name=input_name, default_value=default_value):
                adaptive_input: _AdaptiveTextInput | _AdaptiveChoiceInput = _AdaptiveTextInput(
                    id=input_name,
                    label=input_name,
                    value=default_value,
                )
            case SelectInput(output_variable_name=input_name, options=options, default_value=default_value):
                if not options or any(not option for option in options):
                    return None, "Microsoft Teams cannot preserve one select input's options."
                if len(options) != len(set(options)):
                    return None, "Microsoft Teams cannot preserve duplicate select options."
                if default_value is not None and default_value not in options:
                    return None, "Microsoft Teams cannot preserve one select input default."
                adaptive_input = _AdaptiveChoiceInput(
                    id=input_name,
                    label=input_name,
                    choices=tuple(_AdaptiveChoice(title=option, value=option) for option in options),
                    value=default_value,
                )
        if input_name in input_names:
            return None, "Microsoft Teams cannot preserve duplicate card input identifiers."
        input_names.add(input_name)
        body.append(adaptive_input)

    actions: list[_AdaptiveSubmitAction] = []
    for action in intent.user_actions:
        if action.button_style not in _SUPPORTED_ACTION_STYLES:
            return None, "Microsoft Teams cannot preserve one card action style."
        # Teams does not support positive or destructive Adaptive Card action styling.
        # The approved degradation preserves the action while allowing Teams to use its default style.
        actions.append(
            _AdaptiveSubmitAction(
                title=action.title,
                data=_AdaptiveActionData(
                    action_id=action.id,
                    correlation_token=str(correlation_token),
                ),
            )
        )
    card = _AdaptiveCard(body=tuple(body), actions=tuple(actions))
    serialized_card = json.dumps(
        card.model_dump(mode="json", by_alias=True, exclude_none=True),
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    if len(serialized_card) > _MAX_ADAPTIVE_CARD_SIZE_BYTES:
        return None, "Microsoft Teams cannot preserve a card beyond the Provider payload limit."
    return card, None


def _card_summary(intent: ResolvedForm) -> str:
    if intent.title:
        return intent.title
    for block in intent.blocks:
        if isinstance(block, MarkdownText) and block.text.strip():
            return block.text
    return "Human input form"


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
        return self._send_activity(
            provider_user_id,
            Activity(type="message", text=body),
            message_kind="text",
        )

    def _send_activity(
        self,
        provider_user_id: ProviderUserId,
        activity: Activity,
        *,
        message_kind: Literal["text", "dynamic_card"],
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
                _MSTeamsMessageLocator(
                    message_kind=message_kind,
                    tenant_id=self._tenant_id,
                    client_id=self._client_id,
                    service_url=service_url,
                    conversation_id=conversation_id,
                    activity_id=activity_id,
                )
            )
        except Exception:
            _log_safe_error("Unexpected Microsoft Teams message creation failure")
            return MessageSendingError("Microsoft Teams message acceptance could not be confirmed.")


class _MSTeamsDynamicCardMessaging(_MSTeamsMessaging, IMDynamicCardMessaging):
    @override
    def assess(self, intent: ResolvedForm) -> CardAssessment:
        _, reason = _adaptive_card(intent, CorrelationToken(""))
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
        card, reason = _adaptive_card(intent, correlation_token)
        if reason is not None:
            raise DynamicCardMessagingError(reason)
        assert card is not None
        content = card.model_dump(mode="json", by_alias=True, exclude_none=True)
        activity = Activity(
            type="message",
            summary=_card_summary(intent),
            attachments=[Attachment(content_type=_ADAPTIVE_CARD_CONTENT_TYPE, content=content)],
        )
        return self._send_activity(provider_user_id, activity, message_kind="dynamic_card")

    @override
    def replace_with_static(
        self,
        reference: MessageReference,
        intent: StaticCardIntent,
    ) -> ReplacementError | None:
        locator = self._compatible_card_locator(reference)
        if locator is None:
            return ReplacementError(
                ReplacementErrorKind.INVALID_REFERENCE,
                "The Microsoft Teams message reference is invalid.",
            )
        try:
            client = _mutation_connector(self._credentials, locator.service_url)
            client.conversations.update_activity(
                locator.conversation_id,
                locator.activity_id,
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

    def _compatible_card_locator(self, reference: MessageReference) -> _MSTeamsMessageLocatorData | None:
        if not isinstance(reference, _MSTeamsMessageLocator):
            return None
        locator = _decode_message_locator(reference._serialized_value)
        if locator is None:
            return None
        if (
            locator.message_kind != "dynamic_card"
            or _canonical_guid(locator.tenant_id) != _canonical_guid(self._tenant_id)
            or _canonical_guid(locator.client_id) != _canonical_guid(self._client_id)
            or not _trusted_teams_service_url(locator.service_url)
            or not _non_empty_string(locator.conversation_id)
            or not _non_empty_string(locator.activity_id)
        ):
            return None
        return locator


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

    def __init__(self, credentials: MSTeamsIMIntegrationCredentials) -> None:
        if not isinstance(credentials, MSTeamsIMIntegrationCredentials):
            raise TypeError("Microsoft Teams adapter requires resolved Microsoft Teams credentials")
        self._credentials = credentials
        self._graph_credential = ClientSecretCredential(
            credentials.tenant_id,
            credentials.client_id,
            credentials.client_secret,
        )
        self._graph_client = httpx.Client(timeout=_HTTP_TIMEOUT_SECONDS)
        self._bot_credentials = MicrosoftAppCredentials(
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
