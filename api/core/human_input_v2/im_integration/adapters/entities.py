"""Stable values, results, and errors shared by IM provider adapters."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import NewType

from pydantic import ConfigDict, JsonValue, NaiveDatetime, TypeAdapter, ValidationError

from core.human_input_v2.entities import IMProvider

from .message_locator import MessageLocator

ProviderUserId = NewType("ProviderUserId", str)
CorrelationToken = NewType("CorrelationToken", str)


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


class DynamicCardMessagingError(Exception):
    """Complete dynamic card intent cannot be represented by the provider."""


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
    """Ingress contract used to construct the provider payload snapshot."""

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


class EventAcceptance(StrEnum):
    """Consumer result controlling provider acknowledgement."""

    ACCEPTED = "accepted"
    NOT_ACCEPTED = "not_accepted"


class IMStreamStartError(Exception):
    """Operator-safe synchronous stream startup failure."""


class IMStreamStopError(Exception):
    """Operator-safe failure to establish the graceful-stop guarantees."""


__all__ = [
    "AuthenticatedIMEvent",
    "CardAssessment",
    "CorrelationToken",
    "CredentialTestFailure",
    "CredentialTestFailureKind",
    "CredentialTestSuccess",
    "Directory",
    "DirectoryEntry",
    "DirectoryReadFailure",
    "DynamicCardMessagingError",
    "EventAcceptance",
    "IMCardEvent",
    "IMCardEventDecodeResult",
    "IMCardEventDecodingError",
    "IMEventIngressKind",
    "IMStreamStartError",
    "IMStreamStopError",
    "MessageAccepted",
    "MessageSendingError",
    "MessageSendingResult",
    "ProviderUserId",
    "ReplacementError",
    "ReplacementErrorKind",
    "StaticCardIntent",
    "UnrecognizedIMEvent",
    "WebhookRequest",
    "WebhookResponse",
]
