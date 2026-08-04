"""Review-only API stub for Provider-bound IM adapters.

This file records the proposed public contracts before implementation. It is
not imported by production code and deliberately contains no SDK behavior.

Configuration ownership
-----------------------
The existing ``FeishuIMIntegrationCredentials``,
``LarkIMIntegrationCredentials``, ``SlackIMIntegrationCredentials``,
``DingTalkIMIntegrationCredentials``, ``MSTeamsIMIntegrationCredentials`` and
``WeComIMIntegrationCredentials`` names become the canonical immutable adapter
configuration types. They move out of the controller module so infrastructure
code never imports transport DTOs.

Canonical credentials contain resolved secret values only.
``PreserveOriginalValue`` remains a controller-only update-patch sentinel and
must be resolved before an adapter is constructed. No parallel
``*ProviderConfiguration`` hierarchy is introduced.

The canonical resolved credential types below own the logical user-supplied
field set. Controller request models and encrypted persistence models are
boundary-specific projections of these canonical types and must remain aligned
through explicit mappers and alignment tests. Request models may replace secret
values with the transport-only ``PreserveOriginalValue`` union; persistence
models may rename those fields with an ``encrypted_`` prefix and store only
ciphertext. Neither boundary representation is the source of truth.

If Provider evidence requires another user-supplied credential, the canonical
type changes first and both boundary projections change in the same work.
Adapter-derived tenant, client, session and connection facts remain private and
must not be added to the canonical or boundary models merely for structural
symmetry.

Opaque-reference policy
-----------------------
``MessageReference`` is the only adapter-issued opaque reference in this
contract. A caller may persist, compare, rehydrate and return the exact value to
a compatible adapter, but must not interpret, alter or synthesize it. The value
must be self-contained and versioned so it survives adapter recreation and
process restart; an in-memory locator registry is forbidden. Concrete encodings
retain all Provider locator facts, such as Slack channel plus timestamp or Teams
conversation plus activity, without exposing those shapes through the common
interface. Decoding must validate the encoding version and adapter namespace
before any Provider submitted-state mutation is attempted.

The following values are intentionally not adapter-issued opaque references:

* ``ProviderUserId`` is a Provider-issued user identity meaningful and
  comparable only within the ``(provider, provider_tenant_id)`` namespace.
  Callers may persist and reconcile it within that namespace, while the
  concrete adapter owns any conversion to private transport addressing. This
  contract assumes that applications configured for one such namespace share
  one Provider developer identity; Feishu/Lark therefore use ``union_id``, not
  application-scoped ``open_id``.
* Provider tenant IDs and confirmed event IDs are Provider facts that downstream
  code must be able to persist, reconcile or audit.
* Card metadata is caller-owned opaque data, not an adapter-issued reference.
* Webhook responses, STREAM acknowledgements, pagination cursors and SDK
  connection handles remain entirely inside concrete adapters.

Existing IM delivery persistence must carry ``MessageReference`` semantics all
the way through. Fields such as ``DeliveryAttempt.provider_message_id`` or
``SafeDeliveryOutcome.provider_message_id`` must not store an opaque composite
reference under a false scalar-ID name; an IM delivery path should use
``message_reference`` instead. The Email-only ``DeliveryReceipt`` may keep its
current provider-message-ID semantics because Email has no adapter round trip.

Task 1.3 is an evidence gate that each concrete adapter can attempt personal
messaging from ``ProviderUserId``. Microsoft Teams conversation acquisition and
refresh, including conversation IDs and service URLs, remain adapter-private.
If an initial Provider cannot address a user from this identity plus its bound
configuration and private state, the design must return for review rather than
leak a Provider-specific destination DTO into the common API.

Failure policy
--------------
Result variants expose only distinctions that a current caller can act on.
Every ``reason`` is operator-safe diagnostic text and must never be parsed as a
stable decision code. Raw Provider responses, SDK exceptions and credentials do
not cross these contracts. Adapter lifecycle misuse is represented by the
custom ``IMProviderAdapterClosedError`` rather than a generic runtime error.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated, Literal, NewType, Protocol

from core.human_input_v2.approval.form import FrozenFormDefinition
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


class _FeishuLarkIMIntegrationCredentialsBase(_ResolvedIMIntegrationCredentials):
    """Resolved fields shared by the aligned Feishu and Lark request shapes."""

    app_id: str = Field(description="Feishu or Lark application identifier.")
    app_secret: str = Field(
        repr=False, description="Resolved Feishu or Lark application secret."
    )
    verification_token: str | None = Field(
        default=None,
        repr=False,
        description="Resolved optional callback verification token.",
    )
    encrypt_key: str | None = Field(
        default=None,
        repr=False,
        description="Resolved optional callback encryption key.",
    )


class FeishuIMIntegrationCredentials(_FeishuLarkIMIntegrationCredentialsBase):
    """Canonical source for Feishu request and encrypted credential projections."""

    provider: Literal[IMProvider.FEISHU] = Field(
        description="Feishu credential discriminator."
    )


class LarkIMIntegrationCredentials(_FeishuLarkIMIntegrationCredentialsBase):
    """Canonical source for Lark request and encrypted credential projections."""

    provider: Literal[IMProvider.LARK] = Field(
        description="Lark credential discriminator."
    )


class SlackIMIntegrationCredentials(_ResolvedIMIntegrationCredentials):
    """Canonical source for Slack request and encrypted credential projections."""

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


class DingTalkIMIntegrationCredentials(_ResolvedIMIntegrationCredentials):
    """Canonical source for DingTalk request and encrypted credential projections."""

    provider: Literal[IMProvider.DING_TALK] = Field(
        description="DingTalk credential discriminator."
    )
    client_id: str = Field(description="DingTalk application client identifier.")
    client_secret: str = Field(
        repr=False, description="Resolved DingTalk application client secret."
    )


class MSTeamsIMIntegrationCredentials(_ResolvedIMIntegrationCredentials):
    """Canonical source for Teams request and encrypted credential projections.

    ``tenant_id`` and ``client_id`` are immutable adapter configuration. Bot
    identity aliases and SDK conversation state are derived private facts, not
    additional public credential fields.
    """

    provider: Literal[IMProvider.MS_TEAMS] = Field(
        description="Microsoft Teams credential discriminator."
    )
    tenant_id: str = Field(description="Microsoft Entra tenant identifier.")
    client_id: str = Field(description="Microsoft Teams application client identifier.")
    client_secret: str = Field(
        repr=False, description="Resolved Microsoft Teams application client secret."
    )


class WeComIMIntegrationCredentials(_ResolvedIMIntegrationCredentials):
    """Canonical source for WeCom request and encrypted credential projections."""

    provider: Literal[IMProvider.WE_COM] = Field(
        description="WeCom credential discriminator."
    )
    corp_id: str = Field(description="WeCom corporation identifier.")
    agent_id: str = Field(description="WeCom application agent identifier.")
    secret: str = Field(repr=False, description="Resolved WeCom application secret.")


IMIntegrationCredentials = Annotated[
    FeishuIMIntegrationCredentials
    | LarkIMIntegrationCredentials
    | SlackIMIntegrationCredentials
    | DingTalkIMIntegrationCredentials
    | MSTeamsIMIntegrationCredentials
    | WeComIMIntegrationCredentials,
    Field(discriminator="provider"),
]

# Provider-issued user identity meaningful and comparable only within the
# (provider, provider_tenant_id) namespace. The bound adapter must be able to
# use this value to attempt personal messaging without caller-supplied
# transport facts.
ProviderUserId = NewType("ProviderUserId", str)


# This nominal string originates only from a successful send operation. A
# persistence adapter may rehydrate an exact stored value, but no caller may
# synthesize or interpret its concrete-adapter encoding.
MessageReference = NewType("MessageReference", str)


class IMProviderAdapterClosedError(Exception):
    """A capability was used after its owning root adapter was closed.

    Closing is idempotent, but every later capability operation fails with this
    stable exception. A closed adapter must never lazily recreate SDK resources.
    """


class CredentialTestFailureKind(StrEnum):
    """Credential-test distinctions required by the configuration caller."""

    # The Provider conclusively rejected the bound API credential material.
    AUTHENTICATION_REJECTED = "authentication_rejected"

    # Authentication succeeded, but no stable Provider tenant could be proven.
    TENANT_ID_UNAVAILABLE = "tenant_id_unavailable"

    # Transport or Provider availability prevented a conclusive credential test.
    INDETERMINATE = "indeterminate"


@dataclass(frozen=True, slots=True)
class CredentialTestSuccess:
    """Confirmed API identity for the adapter's immutable configuration."""

    # Normalized Provider identity; it is safe routing data, not a credential.
    provider: IMProvider

    # Stable Provider-owned organization or workspace identifier.
    provider_tenant_id: str


@dataclass(frozen=True, slots=True)
class CredentialTestFailure:
    """Conclusive or indeterminate credential-test failure without SDK data."""

    # Stable branch selected only from the narrow credential-test taxonomy.
    kind: CredentialTestFailureKind

    # Operator-safe diagnostic text that callers must not parse or branch on.
    reason: str


@dataclass(frozen=True, slots=True)
class DirectoryEntry:
    """Current Provider identity observed in one complete directory snapshot.

    ``provider_user_id`` is stable and comparable only within the
    ``(provider, provider_tenant_id)`` namespace. It is sufficient for a bound
    adapter in that namespace to attempt personal messaging, but need not equal
    the Provider's private transport address. Snapshot presence does not
    guarantee that the user can receive a message.
    """

    # Provider-owned user identifier stable within (provider, provider_tenant_id).
    provider_user_id: ProviderUserId

    # Provider display name when exposed; absence is a valid directory state.
    display_name: str | None

    # Provider email when visible; absence is a valid directory state.
    email: str | None


@dataclass(frozen=True, slots=True)
class DirectorySnapshot:
    """One all-or-nothing in-memory view of the configured directory scope."""

    # Ordered entries are published only after every required page or node succeeds.
    entries: tuple[DirectoryEntry, ...]


@dataclass(frozen=True, slots=True)
class DirectoryReadFailure:
    """A complete-snapshot failure that never carries partial directory entries."""

    # Operator-safe diagnostic text that callers must not parse or branch on.
    reason: str


class IMDirectory(Protocol):
    """Complete-snapshot directory view backed by the root adapter context.

    The operation accepts no credentials, SDK clients, pagination cursors or
    integration context. Concrete adapters own traversal, rate-limit handling
    and failure translation. Messaging is never invoked by this capability.
    """

    def read_snapshot(self) -> DirectorySnapshot | DirectoryReadFailure:
        """Return a complete immutable snapshot or one failure with no entries."""
        ...


@dataclass(frozen=True, slots=True)
class NormalizedCardIntent:
    """Provider-neutral card presentation projected from one frozen HITL form.

    The complete ``FrozenFormDefinition`` is retained so assessment sees every
    ordered input, action, default value and presentation fact. In particular,
    FILE and FILE_LIST inputs must reach assessment and may not be filtered out
    by an upstream normalizer.
    """

    # Fully rendered CommonMark content shared with the text fallback path.
    rendered_content: str

    # Complete immutable HITL form definition used for card controls and actions.
    form_definition: FrozenFormDefinition


@dataclass(frozen=True, slots=True)
class SubmittedCardIntent:
    """Complete static presentation for one durably committed submission.

    The caller owns all business presentation policy, including which submitted
    values, actor facts and timestamps are safe to display. The adapter receives
    no submission record and does not infer terminal content from the original
    interactive intent.

    This intent contains no inputs, actions or callback metadata. It may be
    passed to ``mark_as_submitted`` only after the submission transaction has
    committed successfully.
    """

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
    reference: MessageReference


@dataclass(frozen=True, slots=True)
class MessageSendingError:
    """Known send failure for which the adapter knows no message was accepted.

    This includes a Provider user that cannot be addressed or receive the
    requested message. Reachability is learned from the real send attempt, not
    from a separate preflight operation.
    """

    # Operator-safe diagnostic text that callers must not parse or branch on.
    reason: str


type MessageSendingResult = MessageAccepted | MessageSendingError


class MarkAsSubmittedFailureKind(StrEnum):
    """Stable terminal-card failures that require different caller behavior."""

    # The opaque reference is malformed or was issued by an incompatible adapter.
    INVALID_REFERENCE = "invalid_reference"

    # The referenced Provider message no longer exists or cannot be replaced.
    STALE_REFERENCE = "stale_reference"

    # unknown error kind
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class MarkAsSubmissionError:
    """Known terminal-card failure with no accepted replacement content."""

    # Stable rejection category used by the caller to select recovery behavior.
    kind: MarkAsSubmittedFailureKind

    # Operator-safe diagnostic text that callers must not parse or branch on.
    reason: str


class IMMessaging(Protocol):
    """Basic outbound messaging bound to one concrete Provider adapter.

    ``ProviderUserId`` identifies a user in the adapter's
    ``(provider, provider_tenant_id)`` namespace. The concrete adapter owns any
    private transport-address or conversation acquisition and never invokes
    Directory during a Messaging operation.

    Each send invocation attempts to create the requested message at most once
    and never replays an ambiguous message-creation operation. Provider-specific
    prerequisite calls remain inside the adapter. Unsupported CommonMark
    formatting falls back to equivalent plain text.
    """

    def send_text(
        self, provider_user_id: ProviderUserId, body: str
    ) -> MessageSendingResult:
        """Send one fully rendered CommonMark body to one Provider user."""
        ...


class IMDynamicCardMessaging(Protocol):
    """Optional complete-card capability backed by the root adapter context.

    Assessment is authoritative and side-effect free. Send never downgrades to
    text implicitly or emits a partial card. ``mark_as_submitted`` is the only
    mutation of an accepted card: it replaces the interactive card with one
    complete static terminal presentation.

    ``metadata`` is caller-owned immutable JSON embedded for later interaction
    correlation. The adapter may encode it but must not reinterpret it as
    Provider configuration or an adapter-issued reference.

    The caller must commit the winning business submission before calling
    ``mark_as_submitted``. The adapter neither reads submission persistence nor
    decides whether the business form is submitted. Each method attempts its
    requested Provider message mutation at most once without automatic replay.
    """

    def assess(self, intent: NormalizedCardIntent) -> CardAssessment:
        """Judge the complete intent without creating Provider-side state."""
        ...

    def send_card(
        self,
        provider_user_id: ProviderUserId,
        intent: NormalizedCardIntent,
        metadata: Mapping[str, JsonValue],
    ) -> MessageSendingResult:
        """Send one complete dynamic card and return its opaque exact reference."""
        ...

    def mark_as_submitted(
        self,
        reference: MessageReference,
        intent: SubmittedCardIntent,
    ) -> MarkAsSubmissionError | None:
        """Replace the exact referenced card with its committed terminal state."""
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


@dataclass(frozen=True, slots=True)
class AuthenticatedIMEvent:
    """Authenticated Provider evidence before consumer-specific decoding.

    Authentication, replay checks and decryption have completed before this
    value is created. The payload remains Provider-native because the adapter
    does not own card-submission or workflow schemas.

    ``event_id`` is present only when Provider evidence confirms a stable ID
    across redelivery. The adapter must never synthesize it from payloads,
    timestamps, message references or transport ACK envelopes.
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
    occurred_at: NaiveDatetime

    # Trusted local time at which Dify received the delivery.
    received_at: NaiveDatetime

    # Immutable decrypted Provider-native JSON for independent consumers.
    payload: Mapping[str, JsonValue]


class EventAcceptance(StrEnum):
    """Minimum sink outcome needed for Provider-specific acknowledgement."""

    # The sink durably took responsibility, so a successful ACK is permitted.
    ACCEPTED = "accepted"

    # The sink did not take responsibility, so success must not be acknowledged.
    RETRY = "retry"


class IMEventSink(Protocol):
    """Only downstream dependency shared by Webhook and STREAM event views.

    Implementations may persist or enqueue events, but business processing must
    not block the Provider ACK path. Raising unexpectedly is treated the same as
    ``RETRY`` by the concrete event adapter.
    """

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        """Take responsibility for one event before the Provider receives ACK."""
        ...


class StopSignal(Protocol):
    """Caller-owned cooperative stop signal independent from one SDK runtime."""

    def is_requested(self) -> bool:
        """Return whether reconnect and further callbacks must stop."""
        ...

    def wait(self, timeout: float | None = None) -> bool:
        """Wait for stop and return true when termination was requested."""
        ...


class IMWebhookEvents(Protocol):
    """Caller-driven Webhook capability owning the complete Provider protocol.

    The concrete view owns challenge handling, authentication, replay checks,
    decryption and response encoding. It calls the sink at most once and only
    after authentication. Challenge and authentication failures never reach the
    sink.
    """

    def handle(self, request: WebhookRequest, sink: IMEventSink) -> WebhookResponse:
        """Map one inbound request and sink decision to a Provider response."""
        ...


class IMStreamRunError(Exception):
    """Operator-safe terminal STREAM failure after internal reconnect policy.

    Provider SDK exceptions and connection objects are retained as private
    causes and must not become public fields on this exception.
    """


class IMStreamEvents(Protocol):
    """SDK-driven long-running event capability owning connection and ACK state.

    Concrete views own connection establishment, callbacks, control frames,
    reconnect policy and ACK mapping. Stop suppresses further reconnects and
    returns normally; only a terminal translated failure raises
    ``IMStreamRunError``.
    """

    def run(self, sink: IMEventSink, stop: StopSignal) -> None:
        """Run until cooperative stop or a translated terminal stream failure."""
        ...


class IMProviderAdapter(Protocol):
    """Root lifecycle owner exposing narrow views over one Provider context.

    Construction performs local shape validation only and no remote I/O. The
    canonical credentials, SDK clients, token caches and connection resources
    remain private instance state. Capability properties are side-effect free
    and never create a second client role.

    Required Directory and Basic Messaging views are always present. Optional
    views use ``None`` as the sole support signal; there are no parallel support
    flags and unsupported Providers do not return dummy capabilities.
    """

    @property
    def provider(self) -> IMProvider:
        """Return the normalized Provider bound for the adapter lifetime."""
        ...

    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure:
        """Authenticate and identify the tenant without permission inspection."""
        ...

    @property
    def directory(self) -> IMDirectory:
        """Return the required directory view backed by the root client context."""
        ...

    @property
    def messaging(self) -> IMMessaging:
        """Return the required basic messaging view backed by the root context."""
        ...

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging | None:
        """Return the optional card view without performing capability discovery."""
        ...

    @property
    def webhook_events(self) -> IMWebhookEvents | None:
        """Return the optional caller-driven event view without remote I/O."""
        ...

    @property
    def stream_events(self) -> IMStreamEvents | None:
        """Return the optional SDK-driven event view without opening a connection."""
        ...

    def close(self) -> None:
        """Idempotently release every resource owned by this root adapter."""
        ...


class SlackIMProviderAdapter(IMProviderAdapter, Protocol):
    """Slack composition with required card, Webhook and STREAM capabilities.

    Bot identity, signing material and app-level STREAM material are bound once
    through ``SlackIMIntegrationCredentials`` and never appear in operation
    arguments.
    """

    def __init__(self, credentials: SlackIMIntegrationCredentials) -> None: ...

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging: ...

    @property
    def webhook_events(self) -> IMWebhookEvents: ...

    @property
    def stream_events(self) -> IMStreamEvents: ...


class FeishuIMProviderAdapter(IMProviderAdapter, Protocol):
    """Feishu composition interpreting every ``ProviderUserId`` as ``union_id``.

    ``union_id`` remains stable across applications owned by the same Provider
    developer identity. The concrete adapter fixes the receive-ID type; callers
    cannot select or override it through the shared Messaging contracts.
    """

    def __init__(self, credentials: FeishuIMIntegrationCredentials) -> None: ...

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging: ...

    @property
    def webhook_events(self) -> IMWebhookEvents: ...

    @property
    def stream_events(self) -> IMStreamEvents: ...


class LarkIMProviderAdapter(IMProviderAdapter, Protocol):
    """Lark composition interpreting every ``ProviderUserId`` as ``union_id``.

    ``union_id`` remains stable across applications owned by the same Provider
    developer identity. The concrete adapter fixes the receive-ID type; callers
    cannot select or override it through the shared Messaging contracts.
    """

    def __init__(self, credentials: LarkIMIntegrationCredentials) -> None: ...

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging: ...

    @property
    def webhook_events(self) -> IMWebhookEvents: ...

    @property
    def stream_events(self) -> IMStreamEvents: ...


class DingTalkIMProviderAdapter(IMProviderAdapter, Protocol):
    """DingTalk composition exposing only Directory and Basic Messaging."""

    def __init__(self, credentials: DingTalkIMIntegrationCredentials) -> None: ...

    @property
    def dynamic_card_messaging(self) -> None: ...

    @property
    def webhook_events(self) -> None: ...

    @property
    def stream_events(self) -> None: ...


class WeComIMProviderAdapter(IMProviderAdapter, Protocol):
    """WeCom composition exposing only Directory and Basic Messaging."""

    def __init__(self, credentials: WeComIMIntegrationCredentials) -> None: ...

    @property
    def dynamic_card_messaging(self) -> None: ...

    @property
    def webhook_events(self) -> None: ...

    @property
    def stream_events(self) -> None: ...


class MSTeamsIMProviderAdapter(IMProviderAdapter, Protocol):
    """Teams composition with card and Webhook capabilities but no STREAM view.

    Tenant ID and bot application identity are immutable instance configuration.
    ``service_url``, channel IDs and SDK conversation objects remain private
    adapter state. Messaging accepts a Provider user ID; the adapter acquires
    and refreshes any required personal conversation without exposing its ID.
    """

    def __init__(self, credentials: MSTeamsIMIntegrationCredentials) -> None: ...

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging: ...

    @property
    def webhook_events(self) -> IMWebhookEvents: ...

    @property
    def stream_events(self) -> None: ...
