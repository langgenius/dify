"""Canonical approval-plan values persisted by Human Input v2 forms."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from hashlib import sha256

from core.human_input_v2.entities import HumanInputApproverGrantSubjectType, HumanInputDeliveryChannel, IMProvider
from core.human_input_v2.shared import (
    ContactId,
    EndUserId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
)


@dataclass(frozen=True, slots=True)
class CanonicalSubjectKey:
    """Portable form-scoped deduplication key, not an authorization identity."""

    value: str

    def __post_init__(self) -> None:
        namespace, separator, identity = self.value.partition(":")
        valid_named_identity = namespace in {"contact", "end_user"} and bool(identity)
        valid_email_digest = (
            namespace == "email_address"
            and len(identity) == 64
            and all(character in "0123456789abcdef" for character in identity)
        )
        if not separator or not (valid_named_identity or valid_email_digest):
            raise ValueError("canonical subject key has an invalid portable format")

    @classmethod
    def for_contact(cls, contact_id: ContactId) -> CanonicalSubjectKey:
        return cls(f"contact:{contact_id}")

    @classmethod
    def for_end_user(cls, end_user_id: EndUserId) -> CanonicalSubjectKey:
        return cls(f"end_user:{end_user_id}")

    @classmethod
    def for_email(cls, normalized_email: NormalizedEmail) -> CanonicalSubjectKey:
        digest = sha256(normalized_email.value.encode()).hexdigest()
        return cls(f"email_address:{digest}")


@dataclass(frozen=True, slots=True)
class ContactApprovalSubject:
    """Approval authority backed by one canonical Contact."""

    contact_id: ContactId

    @property
    def subject_type(self) -> HumanInputApproverGrantSubjectType:
        return HumanInputApproverGrantSubjectType.CONTACT

    def to_primitive(self) -> dict[str, object]:
        return {"type": self.subject_type.value, "contact_id": self.contact_id}


@dataclass(frozen=True, slots=True)
class EndUserApprovalSubject:
    """Approval authority backed by one app-scoped EndUser."""

    end_user_id: EndUserId

    @property
    def subject_type(self) -> HumanInputApproverGrantSubjectType:
        return HumanInputApproverGrantSubjectType.END_USER

    def to_primitive(self) -> dict[str, object]:
        return {"type": self.subject_type.value, "end_user_id": self.end_user_id}


@dataclass(frozen=True, slots=True)
class EmailAddressApprovalSubject:
    """Task-scoped approval authority backed by one normalized Email address."""

    normalized_email: NormalizedEmail

    @property
    def subject_type(self) -> HumanInputApproverGrantSubjectType:
        return HumanInputApproverGrantSubjectType.EMAIL_ADDRESS

    def to_primitive(self) -> dict[str, object]:
        return {"type": self.subject_type.value, "normalized_email": self.normalized_email.to_primitive()}


type ApprovalSubject = ContactApprovalSubject | EndUserApprovalSubject | EmailAddressApprovalSubject


class RecipientSourceKind(StrEnum):
    """Stable source discriminator retained after canonicalization."""

    STATIC_CONTACT = "static_contact"
    ONE_TIME_EMAIL = "one_time_email"
    DYNAMIC_EMAIL = "dynamic_email"
    CURRENT_INITIATOR = "current_initiator"
    DEBUG_REPLACEMENT = "debug_replacement"


@dataclass(frozen=True, slots=True)
class MatchedRecipientSource:
    """One ordered configured or request-scoped source of an approver."""

    kind: RecipientSourceKind
    position: int
    reference: str | None

    def __post_init__(self) -> None:
        if self.position < 0:
            raise ValueError("recipient source position must not be negative")

    def to_primitive(self) -> dict[str, object]:
        return {"kind": self.kind.value, "position": self.position, "reference": self.reference}


@dataclass(frozen=True, slots=True)
class SubjectSnapshot:
    """Display-only identity facts captured by resolution."""

    display_name: str | None
    email: str | None

    def to_primitive(self) -> dict[str, object]:
        return {"display_name": self.display_name, "email": self.email}


@dataclass(frozen=True, slots=True)
class EmailEndpointPlan:
    """Email delivery destination for one canonical approver."""

    email_address: NormalizedEmail

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.EMAIL

    def to_primitive(self) -> dict[str, object]:
        return {"channel": self.channel.value, "email_address": self.email_address.to_primitive()}


@dataclass(frozen=True, slots=True)
class IMEndpointPlan:
    """Credential-free IM delivery destination frozen from an effective binding."""

    integration_id: IntegrationId
    provider: IMProvider
    provider_tenant_id: str
    identity_id: IMIdentityId
    binding_id: IMBindingId | None
    provider_user_id: str

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.IM

    def to_primitive(self) -> dict[str, object]:
        return {
            "channel": self.channel.value,
            "integration_id": self.integration_id,
            "provider": self.provider.value,
            "provider_tenant_id": self.provider_tenant_id,
            "identity_id": self.identity_id,
            "binding_id": self.binding_id,
            "provider_user_id": self.provider_user_id,
        }


@dataclass(frozen=True, slots=True)
class WebEndpointPlan:
    """Public or trusted-app web interaction surface without a saved token."""

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.WEB

    def to_primitive(self) -> dict[str, object]:
        return {"channel": self.channel.value}


@dataclass(frozen=True, slots=True)
class ConsoleEndpointPlan:
    """Authenticated console interaction surface without a notification address."""

    @property
    def channel(self) -> HumanInputDeliveryChannel:
        return HumanInputDeliveryChannel.CONSOLE

    def to_primitive(self) -> dict[str, object]:
        return {"channel": self.channel.value}


type DeliveryEndpointPlan = EmailEndpointPlan | IMEndpointPlan | WebEndpointPlan | ConsoleEndpointPlan


class RecipientRejectionReason(StrEnum):
    """Transport-neutral reason for rejecting one recipient source."""

    INVALID_CONTACT_ID = "invalid_contact_id"
    CONTACT_UNAVAILABLE = "contact_unavailable"
    INVALID_DYNAMIC_SELECTOR = "invalid_dynamic_selector"
    DYNAMIC_VALUE_UNAVAILABLE = "dynamic_value_unavailable"
    UNSUPPORTED_DYNAMIC_TYPE = "unsupported_dynamic_type"
    INVALID_EMAIL = "invalid_email"
    INITIATOR_UNAVAILABLE = "initiator_unavailable"
    NO_USABLE_ENDPOINT = "no_usable_endpoint"


@dataclass(frozen=True, slots=True)
class RejectedRecipient:
    """Machine-readable source failure retained alongside valid approvers."""

    source: MatchedRecipientSource
    reason: RecipientRejectionReason
    rejected_value: str | None

    def to_primitive(self) -> dict[str, object]:
        return {
            "source": self.source.to_primitive(),
            "reason": self.reason.value,
            "rejected_value": self.rejected_value,
        }


@dataclass(frozen=True, slots=True)
class ResolvedApprover:
    """One canonical subject with all matched sources and usable endpoints."""

    subject: ApprovalSubject
    subject_key: CanonicalSubjectKey
    matched_sources: tuple[MatchedRecipientSource, ...]
    subject_snapshot: SubjectSnapshot
    endpoints: tuple[DeliveryEndpointPlan, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.matched_sources, tuple) or not isinstance(self.endpoints, tuple):
            raise TypeError("resolved approver collections must be immutable tuples")
        if self.subject_key != _canonical_key_for_subject(self.subject):
            raise ValueError("resolved approver subject key does not match its subject")

    def to_primitive(self) -> dict[str, object]:
        return {
            "subject": self.subject.to_primitive(),
            "subject_key": self.subject_key.value,
            "matched_sources": [source.to_primitive() for source in self.matched_sources],
            "subject_snapshot": self.subject_snapshot.to_primitive(),
            "endpoints": [endpoint.to_primitive() for endpoint in self.endpoints],
        }


class RecipientResolutionFailureReason(StrEnum):
    """Stable whole-plan failure independent from HTTP or provider semantics."""

    NO_VALID_RECIPIENTS = "no_valid_recipients"


@dataclass(frozen=True, slots=True)
class ResolvedApprovalPlan:
    """Immutable complete output of one recipient resolution request."""

    approvers: tuple[ResolvedApprover, ...]
    rejected_recipients: tuple[RejectedRecipient, ...]
    failure_reason: RecipientResolutionFailureReason | None

    def __post_init__(self) -> None:
        if not isinstance(self.approvers, tuple) or not isinstance(self.rejected_recipients, tuple):
            raise TypeError("approval plan collections must be immutable tuples")
        if self.approvers and self.failure_reason is not None:
            raise ValueError("a plan with approvers cannot have a failure reason")
        if not self.approvers and self.failure_reason is None:
            raise ValueError("a plan without approvers must have a failure reason")

    def to_primitive(self) -> dict[str, object]:
        return {
            "approvers": [approver.to_primitive() for approver in self.approvers],
            "rejected_recipients": [rejection.to_primitive() for rejection in self.rejected_recipients],
            "failure_reason": self.failure_reason.value if self.failure_reason is not None else None,
        }


def _canonical_key_for_subject(subject: ApprovalSubject) -> CanonicalSubjectKey:
    if isinstance(subject, ContactApprovalSubject):
        return CanonicalSubjectKey.for_contact(subject.contact_id)
    if isinstance(subject, EndUserApprovalSubject):
        return CanonicalSubjectKey.for_end_user(subject.end_user_id)
    return CanonicalSubjectKey.for_email(subject.normalized_email)
