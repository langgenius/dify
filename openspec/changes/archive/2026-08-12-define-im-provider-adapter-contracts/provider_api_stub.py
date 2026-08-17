"""Review-only API stub for Provider-bound IM adapters.

This file records the proposed public contracts before implementation. It is
not imported by production code and deliberately contains no SDK behavior.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal, NewType, Protocol

from core.human_input_v2 import ResolvedForm
from core.human_input_v2.entities import IMProvider
from pydantic import BaseModel, ConfigDict, Field, JsonValue, NaiveDatetime


class _ResolvedIMIntegrationCredentials(BaseModel):
    """Immutable credentials accepted after the controller resolves secret patches.

    These canonical types own the logical credential schema. Request and
    encrypted persistence models must project every applicable field explicitly
    and prove alignment in tests. ``PreserveOriginalValue`` is intentionally not
    accepted here because it is an update instruction rather than a credential.
    Adapter-derived runtime facts do not belong to any credential projection.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)


class SlackIMIntegrationCredentials(_ResolvedIMIntegrationCredentials):
    provider: Literal[IMProvider.SLACK] = Field(
        description="Slack credential discriminator."
    )
    client_id: str = Field(description="Slack OAuth client identifier.")
    client_secret: str = Field(
        repr=False, description="Resolved Slack OAuth client secret."
    )
    signing_secret: str = Field(
        repr=False, description="Resolved Slack callback signing secret."
    )
    bot_token: str = Field(repr=False, description="Resolved Slack bot API token.")


# Provider-issued user identity meaningful and comparable only within the
# (provider, provider_tenant_id) namespace for a specific IM application.
#
# The bound adapter must be able to
# use this value to attempt personal messaging without caller-supplied
# transport facts.
ProviderUserId = NewType("ProviderUserId", str)


# Opaque, persistable locator to an exact Provider message.
#
# Callers may store, compare, and return the value to a compatible adapter, but
# must not parse, alter, or synthesize it.
#
# A MessageLocator may be consumed across process boundaries and after the
# originating adapter has been recreated. Its consumption must not depend on
# in-memory state held by the originating adapter instance.
#
# A MessageLocator is valid only for a compatible concrete adapter of the same
# Provider and tenant. Locators from different adapter types, Providers, or
# tenants are not interchangeable.
MessageLocator = NewType("MessageLocator", str)


# Caller-issued opaque value exposed unchanged by interaction callbacks from
# one dynamic card.
CorrelationToken = NewType("CorrelationToken", str)


class CredentialTestFailureKind(StrEnum):
    """Credential-test distinctions required by the configuration caller."""

    # The Provider conclusively rejected the bound API credential material.
    AUTHENTICATION_REJECTED = "authentication_rejected"

    # Authentication succeeded, but no stable Provider tenant could be proven.
    TENANT_ID_UNAVAILABLE = "tenant_id_unavailable"

    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class CredentialTestSuccess:
    # Normalized Provider identity; it is safe routing data, not a credential.
    provider: IMProvider

    # Stable Provider-owned organization or workspace identifier.
    provider_tenant_id: str


@dataclass(frozen=True, slots=True)
class CredentialTestFailure:
    kind: CredentialTestFailureKind

    # Operator-safe diagnostic text that callers must not parse or branch on.
    reason: str


@dataclass(frozen=True, slots=True)
class DirectoryEntry:
    """
    Current Provider identity observed in one complete directory snapshot.
    """

    # Provider-owned user identifier stable within (provider, provider_tenant_id).
    provider_user_id: ProviderUserId

    # Provider display name when exposed; absence is a valid directory state.
    display_name: str | None

    # Provider email when visible; absence if the IM provider does not return
    # the value.
    email: str | None


@dataclass(frozen=True, slots=True)
class Directory:
    """A sequence of directory entries obtained by enumerating IM directory in a
    short time period. It should be considered as a relative stable snapshot of the
    upstream IM directory."""

    # Ordered entries are published only after every required page or node succeeds.
    entries: tuple[DirectoryEntry, ...]


@dataclass(frozen=True, slots=True)
class DirectoryReadFailure:
    # Operator-safe diagnostic text that callers must not parse or branch on.
    reason: str


class IMDirectory(Protocol):
    def read_directory(self) -> Directory | DirectoryReadFailure:
        """Read and return full IM directory.

        This method must not return partial directory.
        """
        ...


@dataclass(frozen=True, slots=True)
class StaticCardIntent:
    # Fully rendered CommonMark replacing the original interactive card.
    rendered_content: str


@dataclass(frozen=True, slots=True)
class CardAssessment:
    """Side-effect-free representability decision for one complete card intent.

    ``reason`` is absent when ``representable`` is true. A false result applies
    to the entire intent; partial-card assessment is not a valid state.
    """

    # Whether every input, action and semantic can be preserved by the Provider.
    representable: bool

    # Human-readable diagnostic text that must not be parsed as a decision code.
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class MessageAccepted:
    """Provider acceptance of one send operation, not end-user delivery proof."""

    # Opaque exact-message locator issued by the accepting concrete adapter.
    locator: MessageLocator


@dataclass(frozen=True, slots=True)
class MessageSendingError:
    """Send operation that did not yield confirmed Provider acceptance.

    This may represent either a conclusive rejection or an indeterminate
    outcome. Callers must not infer from this result alone whether the Provider
    accepted a message. Recipient reachability is learned from the real send
    attempt, not from a separate preflight operation.
    """

    # Operator-safe diagnostic text that callers must not parse or branch on.
    reason: str


type MessageSendingResult = MessageAccepted | MessageSendingError


class ReplacementErrorKind(StrEnum):
    """Stable terminal-card failures that require different caller behavior."""

    # The opaque locator is malformed or was issued by an incompatible adapter.
    INVALID_REFERENCE = "invalid_reference"

    # The referenced Provider message no longer exists or cannot be replaced.
    STALE_REFERENCE = "stale_reference"

    # unknown error kind
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class ReplacementError:
    """Known terminal-card failure with no accepted replacement content."""

    # Stable rejection category used by the caller to select recovery behavior.
    kind: ReplacementErrorKind

    # Operator-safe diagnostic text that callers must not parse or branch on.
    reason: str


class IMMessaging(Protocol):
    """IMMessaging is a capability for sending a text message to a specific IM provider user.

    Each send invocation attempts to create the requested message at most once
    and never replays an ambiguous message-creation operation. Provider-specific
    prerequisite calls remain inside this capability. Unsupported CommonMark
    formatting falls back to equivalent plain text.
    """

    def send_text(
        self, provider_user_id: ProviderUserId, body: str
    ) -> MessageSendingResult:
        """Send one fully rendered CommonMark body to one Provider user."""
        ...


class DynamicCardMessagingError(Exception):
    pass


class IMDynamicCardMessaging(Protocol):
    def assess(self, intent: ResolvedForm) -> CardAssessment:
        """Judge the complete intent without trigger any side effect.

        If assess returns representable=False, the caller should not invoke send_card
        method below. The sending should be done with `IMMessaging.send_text` instead.
        """
        ...

    def send_card(
        self,
        provider_user_id: ProviderUserId,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> MessageSendingResult:
        """Send one complete dynamic card and return its opaque exact locator.

        If th intent is not representable by the provider's dynamic card, this method must
        raise a `DynamicCardMessagingError` exception, and must not downgrades to text implicitly
        or emits a partial card.

        Every interaction callback originating from the card must expose
        ``correlation_token`` unchanged. The adapter must not interpret it.
        """
        ...

    def replace_with_static(
        self,
        locator: MessageLocator,
        intent: StaticCardIntent,
    ) -> ReplacementError | None:
        """Replace the located interactive card with a static presentation.

        The `locator` argument must be a valid locator returned by `send_card`.
        """
        ...


@dataclass(frozen=True, slots=True)
class WebhookRequest:
    """Framework-neutral inbound HTTP data retaining verification-critical bytes.

    Header ordering and duplicates are preserved. ``body`` must be captured
    before framework decoding because Provider signatures may cover its exact
    byte representation.
    """

    # Upper-case HTTP method supplied by the controller boundary.
    method: str

    # Ordered header pairs preserving duplicate fields.
    headers: tuple[tuple[str, str], ...]

    # Exact request body bytes before JSON parsing or decryption.
    body: bytes

    # Local trusted receive time used for timestamp and replay policy.
    received_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class WebhookResponse:
    """Framework-neutral Provider response emitted by a concrete webhook view."""

    # HTTP status selected according to Provider challenge or ACK semantics.
    status_code: int

    # Ordered response headers to be written without framework-specific objects.
    headers: tuple[tuple[str, str], ...]

    # Provider-specific challenge, ACK or failure response bytes.
    body: bytes


class IMEventIngressKind(StrEnum):
    """Ingress contract used to construct the Provider payload snapshot."""

    WEBHOOK = "webhook"
    STREAM = "stream"


@dataclass(frozen=True, slots=True)
class AuthenticatedIMEvent:
    """Authenticated Provider evidence before consumer-specific decoding.

    Authentication, replay checks and decryption have completed before this
    value is created.

    ``event_id`` is present only when Provider evidence confirms a stable ID
    across redelivery. The adapter must never synthesize it from payloads,
    timestamps, message locators or transport ACK envelopes.
    """

    # Provider whose concrete adapter authenticated the event.
    provider: IMProvider

    # Stable Provider-owned tenant identity confirmed for this adapter.
    provider_tenant_id: str

    # Real stable Provider event ID, or None when the Provider supplies none.
    event_id: str | None

    # Provider-owned event discriminator retained only when available.
    event_type: str | None

    # Provider event time retained only when its wire semantics are confirmed.
    occurred_at: NaiveDatetime | None

    # Trusted local time at which Dify received the delivery.
    received_at: NaiveDatetime

    # Actual ingress contract used to construct this payload snapshot.
    ingress_kind: IMEventIngressKind

    # For Webhook transports, the JSON serialization of the complete JSON object
    # obtained from the Provider HTTP request body after authentication and
    # applicable decryption. It preserves the entire decoded JSON data model
    # without consumer-specific transformation. For an encrypted envelope, this
    # is the decrypted plaintext object rather than the outer envelope.
    #
    # For STREAM transports, the complete JSON serialization of the native event
    # value supplied to the callback by the Provider SDK. It preserves every
    # field and value exposed by the SDK's supported serialization without
    # consumer-specific transformation.
    #
    # Original wire bytes and byte-for-byte equality between Webhook and STREAM
    # payloads are not guaranteed. STREAM payloads do not preserve fields that
    # the Provider SDK does not expose.
    payload: str


@dataclass(frozen=True, slots=True)
class IMCardEvent:
    """Provider-neutral normalized card interaction."""

    provider_user_id: ProviderUserId
    action_id: str
    inputs: Mapping[str, JsonValue]
    correlation_token: CorrelationToken


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
    """consumer outcome needed for Provider-specific acknowledgement."""

    ACCEPTED = "accepted"

    NOT_ACCEPTED = "not_accepted"


class IMEventConsumer(Protocol):
    """A IM event consumer which abstract the event consumption logic for authenticated events."""

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        """The `accept` should return `ACCEPTED` only when the event is
        successfully processed or persisted for further processing.
        Otherwise it should return `NOT_ACCEPTED`.

        This method must be safe to be invoked by multiple threads.
        """
        ...


class IMWebhookHandler(Protocol):
    """`IMWebhookHandler` abstract the provider specific webhook handling logic,
    wraps the actual event handler and expose a `handle` method to be invoked
    by the http handler.

    This class generally takes an `IMEventConsumer` as constructor argument, and
    invoke the consumer if the `handle` method is invoked.
    """

    def handle(self, request: WebhookRequest) -> WebhookResponse:
        """The `handle` method validates and / or decrypts provider specific webhook requests,
        convert them to the standarized `AuthenticatedIMEvent`, then invokes the wrapped
        `IMEventConsumer`.

        This method is supposed to be invoked by the http handler, and must
        be safe to be invoked by multiple threads."""
        ...


class IMStreamStartError(Exception):
    """Operator-safe synchronous stream startup failure."""


class IMStreamStopError(Exception):
    """Operator-safe failure to establish the graceful-stop guarantees."""


class IMEventStream(Protocol):
    """
    `IMEventStream` abstract the provider specific stream listening logic,
    invoke the actual event handler when events are delivered by the underlying
    SDK / connections.

    This class generally takes an `IMEventConsumer` as constructor argument, and
    invoke the `IMEventConsumer.accept` if new event arrives.
    """

    def start(self) -> None:
        """Synchronously initialize and start this one-shot event stream."""
        ...

    def stop(self) -> None:
        """Synchronously drain accepted events and release all owned resources."""
        ...


class IMProviderAdapter(Protocol):
    """This is the core abstraction for IM providers.

    This class is NOT thread safe.
    """

    @classmethod
    def card_event_decoder(cls) -> IMCardEventDecoder | None:
        """Return a stateless decoder independent from credentials and root lifecycles."""
        return None

    @property
    def provider(self) -> IMProvider:
        """Return the normalized Provider bound for the adapter lifetime."""
        ...

    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure:
        """Authenticate, identify the tenant and inspect baseline permissions."""
        ...

    @property
    def directory(self) -> IMDirectory:
        """Return the directory reading capability for this provider instance.

        The returned `IMDirectory` remains valid until `IMProviderAdapter.close` is invoked.
        """
        ...

    @property
    def messaging(self) -> IMMessaging:
        """Return the text messaging capability for this provider instance.

        The returned `IMMessaging` remains valid until `IMProviderAdapter.close` is invoked.
        """
        ...

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging | None:
        """Return the optional dynamic card messsaging capability for this provider instance.

        If the provider does not support dynamic card messaging, this method should return `None`.

        The returned `IMDynamicCardMessaging` remains valid until `IMProviderAdapter.close` is invoked.
        """
        ...

    def create_webhook_handler(
        self, consumer: IMEventConsumer
    ) -> IMWebhookHandler | None:
        """
        Create a webhook handler bound to consumer, or return None if unsupported.

        The lifecycle of `IMWebhookHandler` is NOT bound to the current `IMProviderAdapter`.
        It may be used after `IMProviderAdapter.close` is invoked.
        """
        ...

    def create_stream_handler(self, consumer: IMEventConsumer) -> IMEventStream | None:
        """
        Create a stream handler bound to consumer, or return None if unsupported.

        The lifecycle of `IMEventStream` is NOT bound to the current `IMProviderAdapter`.
        It may be used after `IMProviderAdapter.close` is invoked.
        """
        ...

    def close(self) -> None:
        """Idempotently release resources owned by this adapter."""
        ...


class SlackIMProviderAdapter(IMProviderAdapter):
    """Slack composition with required card, Webhook and STREAM capabilities.

    Bot identity, signing material and app-level STREAM material are bound once
    through ``SlackIMIntegrationCredentials`` and never appear in operation
    arguments.
    """

    def __init__(self, credentials: SlackIMIntegrationCredentials) -> None: ...
