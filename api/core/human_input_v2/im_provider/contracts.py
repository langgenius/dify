"""Provider-neutral contracts for bound instant-messaging adapters.

The module contains only immutable values and narrow protocols. Concrete SDK,
persistence, controller, and business-consumer details deliberately stay
outside this boundary.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Literal, NewType, Protocol

from pydantic import BaseModel, ConfigDict, Field, JsonValue, NaiveDatetime, TypeAdapter, ValidationError

from core.human_input_v2 import ResolvedForm
from core.human_input_v2.entities import IMProvider


class _ResolvedIMIntegrationCredentials(BaseModel):
    """Strict immutable credentials after controller update resolution."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class SlackIMIntegrationCredentials(_ResolvedIMIntegrationCredentials):
    """Resolved Slack credentials bound for one adapter lifetime."""

    provider: Literal[IMProvider.SLACK] = Field(description="Slack credential discriminator.")
    client_id: str = Field(min_length=1, description="Slack OAuth client identifier.")
    client_secret: str = Field(min_length=1, repr=False, description="Resolved Slack OAuth client secret.")
    signing_secret: str = Field(min_length=1, repr=False, description="Resolved Slack callback signing secret.")
    bot_token: str = Field(
        min_length=1,
        pattern=r"^xoxb-",
        repr=False,
        description="Resolved Slack bot API token.",
    )
    app_token: str | None = Field(
        default=None,
        min_length=1,
        pattern=r"^xapp-",
        repr=False,
        description="Optional resolved Slack app-level token required only for Socket Mode.",
    )


class DingTalkIMIntegrationCredentials(_ResolvedIMIntegrationCredentials):
    """Resolved DingTalk credentials bound for one adapter lifetime."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    provider: Literal[IMProvider.DING_TALK] = Field(description="DingTalk credential discriminator.")
    corp_id: str = Field(min_length=1, pattern=r"\S", description="DingTalk corporation identifier.")
    client_id: str = Field(min_length=1, pattern=r"\S", description="DingTalk application client identifier.")
    client_secret: str = Field(
        min_length=1,
        pattern=r"\S",
        repr=False,
        description="Resolved DingTalk application client secret.",
    )


class MSTeamsIMIntegrationCredentials(_ResolvedIMIntegrationCredentials):
    """Resolved Microsoft Teams credentials bound for one adapter lifetime."""

    provider: Literal[IMProvider.MS_TEAMS] = Field(description="Microsoft Teams credential discriminator.")
    tenant_id: str = Field(
        min_length=1,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        description="Microsoft Entra tenant identifier.",
    )
    client_id: str = Field(
        min_length=1,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        description="Microsoft Teams bot application client identifier.",
    )
    client_secret: str = Field(
        min_length=1,
        repr=False,
        description="Resolved Microsoft Teams application client secret.",
    )


class WeComIMIntegrationCredentials(_ResolvedIMIntegrationCredentials):
    """Resolved WeCom credentials bound for one adapter lifetime."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    provider: Literal[IMProvider.WE_COM] = Field(description="WeCom credential discriminator.")
    corp_id: str = Field(min_length=1, pattern=r"\S", description="WeCom corporation identifier.")
    agent_id: str = Field(
        min_length=1,
        pattern=r"^[1-9][0-9]*$",
        description="WeCom application agent identifier.",
    )
    secret: str = Field(
        min_length=1,
        pattern=r"\S",
        repr=False,
        description="Resolved WeCom application secret.",
    )


ProviderUserId = NewType("ProviderUserId", str)
CorrelationToken = NewType("CorrelationToken", str)


# Opaque, persistable locator for one exact Provider message.
#
# Callers may store, compare, and return this value to a compatible adapter,
# but must not parse, alter, or synthesize it.
#
# The value is a plain, versioned serialization of Provider-private locator
# facts. It may cross process boundaries and survive adapter recreation.
# Keep this value within a trusted application boundary; it must not cross
# a security boundary.
# "Opaque" constrains caller behavior; it does not imply encryption, signing,
# cryptographic authenticity, or authorization.
MessageLocator = NewType("MessageLocator", str)


class CredentialTestFailureKind(StrEnum):
    """Credential-test distinctions required by configuration callers."""

    AUTHENTICATION_REJECTED = "authentication_rejected"
    TENANT_ID_UNAVAILABLE = "tenant_id_unavailable"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class CredentialTestSuccess:
    """Confirmed provider authentication and stable tenant identity."""

    provider: IMProvider
    provider_tenant_id: str


@dataclass(frozen=True, slots=True)
class CredentialTestFailure:
    """Safe credential-test failure without provider response material."""

    kind: CredentialTestFailureKind
    reason: str


@dataclass(frozen=True, slots=True)
class DirectoryEntry:
    """Minimal provider identity from one complete directory snapshot."""

    provider_user_id: ProviderUserId
    display_name: str | None
    email: str | None


@dataclass(frozen=True, slots=True)
class Directory:
    """Immutable ordered complete provider directory snapshot."""

    entries: tuple[DirectoryEntry, ...]


@dataclass(frozen=True, slots=True)
class DirectoryReadFailure:
    """Safe whole-snapshot failure without partial entries."""

    reason: str


class IMDirectory(Protocol):
    """Adapter-bound directory capability."""

    def read_directory(self) -> Directory | DirectoryReadFailure:
        """Return a complete snapshot or one failure without partial entries."""
        ...


@dataclass(frozen=True, slots=True)
class StaticCardIntent:
    """Caller-rendered non-interactive replacement presentation."""

    rendered_content: str


@dataclass(frozen=True, slots=True)
class CardAssessment:
    """Side-effect-free whole-intent representability decision."""

    representable: bool
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class MessageAccepted:
    """Confirmed provider acceptance, not end-user delivery proof."""

    locator: MessageLocator


@dataclass(frozen=True, slots=True)
class MessageSendingError:
    """Message creation without confirmed provider acceptance."""

    reason: str


type MessageSendingResult = MessageAccepted | MessageSendingError


class ReplacementErrorKind(StrEnum):
    """Stable exact-message replacement failure categories."""

    INVALID_REFERENCE = "invalid_reference"
    STALE_REFERENCE = "stale_reference"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class ReplacementError:
    """Static replacement failure without accepted mutation content."""

    kind: ReplacementErrorKind
    reason: str


class IMMessaging(Protocol):
    """Adapter-bound personal text messaging capability."""

    def send_text(self, provider_user_id: ProviderUserId, body: str) -> MessageSendingResult:
        """Attempt one provider message creation without automatic replay."""
        ...


class DynamicCardMessagingError(Exception):
    """Complete dynamic card intent cannot be represented by the provider."""


class IMDynamicCardMessaging(Protocol):
    """Adapter-bound complete dynamic card capability."""

    def assess(self, intent: ResolvedForm) -> CardAssessment:
        """Assess every intent fact without provider I/O or side effects."""
        ...

    def send_card(
        self,
        provider_user_id: ProviderUserId,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> MessageSendingResult:
        """Attempt one complete card creation and preserve callback identity."""
        ...

    def replace_with_static(
        self,
        locator: MessageLocator,
        intent: StaticCardIntent,
    ) -> ReplacementError | None:
        """Replace only the exact compatible referenced card once."""
        ...


@dataclass(frozen=True, slots=True)
class WebhookRequest:
    """Framework-neutral request preserving verification-critical values."""

    method: str
    headers: tuple[tuple[str, str], ...]
    body: bytes
    received_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class WebhookResponse:
    """Framework-neutral response containing exact provider ACK facts."""

    status_code: int
    headers: tuple[tuple[str, str], ...]
    body: bytes


class IMEventIngressKind(StrEnum):
    """Ingress contract used to construct the Provider payload snapshot."""

    WEBHOOK = "webhook"
    STREAM = "stream"


@dataclass(frozen=True, slots=True)
class AuthenticatedIMEvent:
    """Authenticated provider evidence before consumer-specific decoding."""

    provider: IMProvider
    provider_tenant_id: str
    event_id: str | None
    event_type: str | None
    occurred_at: NaiveDatetime | None
    received_at: NaiveDatetime
    ingress_kind: IMEventIngressKind
    payload: str


_CARD_EVENT_INPUTS_ADAPTER = TypeAdapter(
    dict[str, JsonValue],
    config=ConfigDict(strict=True, allow_inf_nan=False),
)


@dataclass(frozen=True, slots=True)
class IMCardEvent:
    """Provider-neutral normalized card interaction."""

    provider_user_id: ProviderUserId
    action_id: str
    inputs: Mapping[str, JsonValue]
    correlation_token: CorrelationToken

    def __post_init__(self) -> None:
        if not isinstance(self.action_id, str) or not self.action_id:
            raise ValueError("card event action identifier must not be empty")
        if not isinstance(self.inputs, Mapping):
            raise TypeError("card event inputs must be a mapping")
        try:
            copied_inputs = _CARD_EVENT_INPUTS_ADAPTER.validate_python(dict(self.inputs), strict=True)
        except ValidationError:
            raise TypeError("card event inputs must contain only JSON values") from None
        object.__setattr__(self, "inputs", MappingProxyType(copied_inputs))


@dataclass(frozen=True, slots=True)
class UnrecognizedIMEvent:
    """Authenticated event outside one decoder's supported card protocol."""


type IMCardEventDecodeResult = IMCardEvent | UnrecognizedIMEvent


class IMCardEventDecodingError(ValueError):
    """Recognized card event cannot be decoded using the expected schema."""


class IMCardEventDecoder(Protocol):
    """Credential-free and thread-safe Provider card callback decoder."""

    def decode(self, event: AuthenticatedIMEvent) -> IMCardEventDecodeResult:
        """Normalize one authenticated event without Provider or persistence I/O."""
        ...


class EventAcceptance(StrEnum):
    """Consumer result controlling provider acknowledgement."""

    ACCEPTED = "accepted"
    NOT_ACCEPTED = "not_accepted"


class IMEventConsumer(Protocol):
    """Thread-safe consumer of authenticated provider events."""

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        """Accept only after processing or taking responsibility for processing."""
        ...


class IMWebhookHandler(Protocol):
    """Thread-safe framework-neutral authenticated Webhook handler."""

    def handle(self, request: WebhookRequest) -> WebhookResponse:
        """Authenticate, decode, consume, and map one provider request."""
        ...


class IMStreamStartError(Exception):
    """Operator-safe synchronous stream startup failure."""


class IMStreamStopError(Exception):
    """Operator-safe failure to establish the graceful-stop guarantees."""


class IMEventStream(Protocol):
    """Owner-managed inbound event resource with a one-shot lifecycle."""

    def start(self) -> None:
        """Synchronously initialize and start receiving events."""
        ...

    def stop(self) -> None:
        """Synchronously drain accepted events and release owned resources."""
        ...


class IMProviderAdapter(Protocol):
    """Externally serialized provider-bound capability composition root."""

    @classmethod
    def card_event_decoder(cls) -> IMCardEventDecoder | None:
        """Return a stateless decoder independent from credentials and root lifecycles."""
        return None

    @property
    def provider(self) -> IMProvider: ...

    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure: ...

    @property
    def directory(self) -> IMDirectory: ...

    @property
    def messaging(self) -> IMMessaging: ...

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging | None: ...

    def create_webhook_handler(self, consumer: IMEventConsumer) -> IMWebhookHandler | None: ...

    def create_stream_handler(self, consumer: IMEventConsumer) -> IMEventStream | None: ...

    def close(self) -> None:
        """Idempotently end the root lifecycle without invalidating transports."""
        ...


__all__ = [
    "AuthenticatedIMEvent",
    "CardAssessment",
    "CorrelationToken",
    "CredentialTestFailure",
    "CredentialTestFailureKind",
    "CredentialTestSuccess",
    "DingTalkIMIntegrationCredentials",
    "Directory",
    "DirectoryEntry",
    "DirectoryReadFailure",
    "DynamicCardMessagingError",
    "EventAcceptance",
    "IMCardEvent",
    "IMCardEventDecodeResult",
    "IMCardEventDecoder",
    "IMCardEventDecodingError",
    "IMDirectory",
    "IMDynamicCardMessaging",
    "IMEventConsumer",
    "IMEventIngressKind",
    "IMEventStream",
    "IMMessaging",
    "IMProviderAdapter",
    "IMStreamStartError",
    "IMStreamStopError",
    "IMWebhookHandler",
    "MSTeamsIMIntegrationCredentials",
    "MessageAccepted",
    "MessageLocator",
    "MessageSendingError",
    "MessageSendingResult",
    "ProviderUserId",
    "ReplacementError",
    "ReplacementErrorKind",
    "SlackIMIntegrationCredentials",
    "StaticCardIntent",
    "UnrecognizedIMEvent",
    "WeComIMIntegrationCredentials",
    "WebhookRequest",
    "WebhookResponse",
]
