"""Capability protocols implemented by IM provider adapters."""

from __future__ import annotations

from typing import Protocol

from core.human_input_v2 import ResolvedForm
from core.human_input_v2.entities import IMProvider

from .entities import (
    AuthenticatedIMEvent,
    CardAssessment,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestSuccess,
    Directory,
    DirectoryReadFailure,
    EventAcceptance,
    IMCardEventDecodeResult,
    MessageSendingResult,
    ProviderUserId,
    ReplacementError,
    StaticCardIntent,
    WebhookRequest,
    WebhookResponse,
)
from .message_locator import MessageLocator


class IMDirectory(Protocol):
    """Adapter-bound directory capability."""

    def read_directory(self) -> Directory | DirectoryReadFailure:
        """Return a complete snapshot or one failure without partial entries."""
        ...


class IMMessaging(Protocol):
    """Adapter-bound personal text messaging capability."""

    def send_text(self, provider_user_id: ProviderUserId, body: str) -> MessageSendingResult:
        """Attempt one provider message creation without automatic replay."""
        ...


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


class IMCardEventDecoder(Protocol):
    """Credential-free and thread-safe provider card callback decoder."""

    def decode(self, event: AuthenticatedIMEvent) -> IMCardEventDecodeResult:
        """Normalize one authenticated event without provider or persistence I/O."""
        ...


class IMEventConsumer(Protocol):
    """Thread-safe consumer of authenticated provider events."""

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        """Accept only after processing or taking responsibility for processing."""
        ...


class IMWebhookHandler(Protocol):
    """Thread-safe framework-neutral authenticated webhook handler."""

    def handle(self, request: WebhookRequest) -> WebhookResponse:
        """Authenticate, decode, consume, and map one provider request."""
        ...


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
    "IMCardEventDecoder",
    "IMDirectory",
    "IMDynamicCardMessaging",
    "IMEventConsumer",
    "IMEventStream",
    "IMMessaging",
    "IMProviderAdapter",
    "IMWebhookHandler",
]
