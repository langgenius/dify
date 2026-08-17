"""Immutable, secret-safe contracts for rendered Email delivery."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from enum import StrEnum

from pydantic import NaiveDatetime

from core.human_input_v2.channel_identity import ChannelKind, ChannelRef
from core.human_input_v2.shared import (
    DeliveryAttemptId,
    EmailProviderId,
    NormalizedEmail,
    TenantId,
)


@dataclass(frozen=True, slots=True)
class ProviderCredential:
    """Ephemeral plaintext credential whose representation is always redacted."""

    value: str = field(repr=False)

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise ValueError("provider credential must not be blank")


@dataclass(frozen=True, slots=True)
class ConfigurationSnapshotIdentity:
    configuration_id: EmailProviderId
    updated_at: NaiveDatetime

    def to_mapping(self) -> dict[str, str]:
        return {
            "configuration_id": str(self.configuration_id),
            "updated_at": self.updated_at.isoformat(),
        }


@dataclass(frozen=True, slots=True)
class RenderedEmailDeliveryRequest:
    """Complete provider-ready content for exactly one logical attempt."""

    tenant_id: TenantId
    channel: ChannelRef
    delivery_id: DeliveryAttemptId
    recipient: NormalizedEmail = field(repr=False)
    subject: str = field(repr=False)
    html: str = field(repr=False)
    text: str | None = field(default=None, repr=False)
    idempotency_key: str = field(default="", repr=False)

    def __post_init__(self) -> None:
        if self.channel.kind is not ChannelKind.EMAIL:
            raise ValueError("rendered Email delivery requires an Email channel")
        if not self.subject.strip():
            raise ValueError("rendered Email subject must not be blank")
        if not self.html.strip():
            raise ValueError("rendered Email HTML body must not be blank")
        if not self.idempotency_key.strip() or len(self.idempotency_key) > 256:
            raise ValueError("provider idempotency key must contain 1 to 256 characters")


@dataclass(frozen=True, slots=True)
class ResolvedEmailChannelSnapshot:
    """Send-time configuration with only its credential kept ephemeral."""

    identity: ConfigurationSnapshotIdentity
    channel: ChannelRef
    sender_email: NormalizedEmail
    sender_name: str
    credential: ProviderCredential = field(repr=False)

    def __post_init__(self) -> None:
        if self.channel.kind is not ChannelKind.EMAIL:
            raise ValueError("resolved Email snapshot requires an Email channel")


@dataclass(frozen=True, slots=True)
class PreparedRenderedEmailDelivery:
    """A request bound to one immutable send-time provider snapshot."""

    request: RenderedEmailDeliveryRequest = field(repr=False)
    snapshot: ResolvedEmailChannelSnapshot = field(repr=False)
    payload_fingerprint: str
    _runtime_token: object = field(repr=False, compare=False)


class DeliveryOutcomeStatus(StrEnum):
    ACCEPTED = "accepted"
    RETRYABLE_FAILURE = "retryable_failure"
    TERMINAL_FAILURE = "terminal_failure"


@dataclass(frozen=True, slots=True)
class RetryGuidance:
    retry_after_seconds: float | None = None

    def __post_init__(self) -> None:
        if self.retry_after_seconds is not None and self.retry_after_seconds < 0:
            raise ValueError("retry delay must not be negative")


@dataclass(frozen=True, slots=True)
class DeliveryReceipt:
    provider_message_id: str

    def __post_init__(self) -> None:
        if not self.provider_message_id.strip():
            raise ValueError("provider message id must not be blank")


@dataclass(frozen=True, slots=True)
class DeliveryFailure:
    code: str
    retry: RetryGuidance | None = None

    def __post_init__(self) -> None:
        if not self.code.strip():
            raise ValueError("delivery failure code must not be blank")


@dataclass(frozen=True, slots=True)
class DeliveryOutcome:
    status: DeliveryOutcomeStatus
    receipt: DeliveryReceipt | None = None
    failure: DeliveryFailure | None = None

    def __post_init__(self) -> None:
        if self.status is DeliveryOutcomeStatus.ACCEPTED:
            if self.receipt is None or self.failure is not None:
                raise ValueError("accepted delivery requires only a receipt")
        elif self.failure is None or self.receipt is not None:
            raise ValueError("failed delivery requires only a failure")
        failure = self.failure
        if self.status is DeliveryOutcomeStatus.RETRYABLE_FAILURE and (failure is None or failure.retry is None):
            raise ValueError("retryable failure requires retry guidance")
        if self.status is DeliveryOutcomeStatus.TERMINAL_FAILURE and failure is not None and failure.retry is not None:
            raise ValueError("terminal failure cannot contain retry guidance")

    @classmethod
    def accepted(cls, provider_message_id: str) -> DeliveryOutcome:
        return cls(DeliveryOutcomeStatus.ACCEPTED, receipt=DeliveryReceipt(provider_message_id))

    @classmethod
    def retryable(cls, code: str, *, retry_after_seconds: float | None = None) -> DeliveryOutcome:
        return cls(
            DeliveryOutcomeStatus.RETRYABLE_FAILURE,
            failure=DeliveryFailure(code, RetryGuidance(retry_after_seconds)),
        )

    @classmethod
    def terminal(cls, code: str) -> DeliveryOutcome:
        return cls(DeliveryOutcomeStatus.TERMINAL_FAILURE, failure=DeliveryFailure(code))


def fingerprint_rendered_email(request: RenderedEmailDeliveryRequest) -> str:
    payload = json.dumps(
        {
            "channel_kind": request.channel.kind.value,
            "channel_provider": request.channel.provider.value,
            "recipient": str(request.recipient),
            "subject": request.subject,
            "html": request.html,
            "text": request.text,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def derive_idempotency_key(delivery_id: DeliveryAttemptId) -> str:
    digest = hashlib.sha256(str(delivery_id).encode()).hexdigest()
    return f"hitl-v2-{digest}"
