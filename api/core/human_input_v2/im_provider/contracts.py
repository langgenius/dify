"""Provider-neutral contracts for bound instant-messaging adapters.

The module contains only immutable values and narrow protocols. Concrete SDK,
persistence, controller, and business-consumer details deliberately stay
outside this boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal, NewType, Protocol

from pydantic import BaseModel, ConfigDict, Field, NaiveDatetime

from core.human_input_v2.approval.form import FrozenFormDefinition
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
    app_token: str = Field(
        min_length=1,
        pattern=r"^xapp-",
        repr=False,
        description="Resolved Slack app-level Socket Mode token.",
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


ProviderUserId = NewType("ProviderUserId", str)
CorrelationToken = NewType("CorrelationToken", str)


class MessageReference:
    """In-process nominal marker for a concrete Provider's private message locator."""

    __slots__ = ()


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
class NormalizedCardIntent:
    """Complete rendered content and immutable HITL form definition."""

    rendered_content: str
    form_definition: FrozenFormDefinition


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

    reference: MessageReference


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

    def assess(self, intent: NormalizedCardIntent) -> CardAssessment:
        """Assess every intent fact without provider I/O or side effects."""
        ...

    def send_card(
        self,
        provider_user_id: ProviderUserId,
        intent: NormalizedCardIntent,
        correlation_token: CorrelationToken,
    ) -> MessageSendingResult:
        """Attempt one complete card creation and preserve callback identity."""
        ...

    def replace_with_static(
        self,
        reference: MessageReference,
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


@dataclass(frozen=True, slots=True)
class AuthenticatedIMEvent:
    """Authenticated provider evidence before consumer-specific decoding."""

    provider: IMProvider
    provider_tenant_id: str
    event_id: str | None
    event_type: str | None
    occurred_at: NaiveDatetime | None
    received_at: NaiveDatetime
    payload: str


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
    "IMDirectory",
    "IMDynamicCardMessaging",
    "IMEventConsumer",
    "IMEventStream",
    "IMMessaging",
    "IMProviderAdapter",
    "IMStreamStartError",
    "IMStreamStopError",
    "IMWebhookHandler",
    "MSTeamsIMIntegrationCredentials",
    "MessageAccepted",
    "MessageReference",
    "MessageSendingError",
    "MessageSendingResult",
    "NormalizedCardIntent",
    "ProviderUserId",
    "ReplacementError",
    "ReplacementErrorKind",
    "SlackIMIntegrationCredentials",
    "StaticCardIntent",
    "WebhookRequest",
    "WebhookResponse",
]
